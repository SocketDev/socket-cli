import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

import {
  type ResolvedArtifactPaths,
  type SocketFactsSbom,
  type SocketFactsSbomComponent,
  type SocketFactsSbomMetadata,
  type SocketFactsSbomProject,
  mavenCoordinateKey,
} from './facts.mts'

import type { ParsedRecords, RawCoord, RawProject } from './records.mts'
import type { ResolutionReport } from './resolution-report.mts'
import type { PURL_Type } from '../../../utils/ecosystem.mts'

const PURL_TYPE_MAVEN: PURL_Type = 'maven'
const PURL_TYPE_NUGET: PURL_Type = 'nuget'

function purlTypeForTool(tool: SocketFactsSbomMetadata['tool']): PURL_Type {
  return tool === 'dotnet' ? PURL_TYPE_NUGET : PURL_TYPE_MAVEN
}

// Maven-type entries always carry the namespace key (even empty — the
// pre-dotnet output shape, which downstream identity matching may rely on);
// groupless ecosystems (nuget) omit it.
function namespaceEntry(
  purlType: PURL_Type,
  group: string,
): { namespace?: string } {
  if (purlType === PURL_TYPE_NUGET && !group) {
    return {}
  }
  return { namespace: group }
}

export type AssembleResult = {
  facts: SocketFactsSbom
  report: ResolutionReport
  artifactPaths: ResolvedArtifactPaths
}

export type AssembleOptions = {
  emitProjects?: boolean | undefined
  // Injectable for tests; an uncompiled module's output dir is dropped (module
  // stays resolvable via its sources).
  fileExists?: ((path: string) => boolean) | undefined
}

type MergedNode = {
  coord: RawCoord
  children: Set<string>
  prod: boolean
  direct: boolean
  targets: Set<string>
}

type PerRoot = {
  projectKey: string
  prod: boolean
  nodes: Map<
    string,
    { coord: RawCoord; children: string[]; direct: boolean; targets: string[] }
  >
}

export function assembleFacts(
  parsed: ParsedRecords,
  opts: AssembleOptions = {},
): AssembleResult {
  const fileExists = opts.fileExists ?? existsSync
  const perRoot = buildPerRoot(parsed)
  const { directByRoot, finalNodes } = mergePathSensitive(perRoot)

  const tool = (parsed.tool || 'gradle') as SocketFactsSbomMetadata['tool']
  const purlType = purlTypeForTool(tool)
  const components = buildComponents(finalNodes, purlType)
  const projects =
    opts.emitProjects === false
      ? []
      : buildProjects(parsed, finalNodes, directByRoot, perRoot, purlType)

  const metadata: SocketFactsSbomMetadata = {
    format: 'socket-facts-sbom',
    tool,
    toolVersion: parsed.toolVersion,
    ...(parsed.javaVersion ? { javaVersion: parsed.javaVersion } : {}),
  }

  const facts: SocketFactsSbom = projects.length
    ? { metadata, projects, components }
    : { metadata, components }

  return {
    facts,
    report: buildReport(parsed),
    artifactPaths: buildArtifactPaths(
      finalNodes,
      [...parsed.projects.values()],
      fileExists,
    ),
  }
}

function gav(group: string, name: string, version: string): string {
  return `${group}:${name}:${version}`
}

function shortHash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12)
}

function buildPerRoot(parsed: ParsedRecords): Map<string, PerRoot> {
  const out = new Map<string, PerRoot>()
  for (const [rootId, r] of parsed.roots) {
    const childrenByParent = new Map<string, Set<string>>()
    for (const [p, c] of r.edges) {
      if (!r.nodes.has(p) || !r.nodes.has(c)) {
        continue
      }
      let set = childrenByParent.get(p)
      if (!set) {
        set = new Set()
        childrenByParent.set(p, set)
      }
      set.add(c)
    }
    const nodes = new Map<
      string,
      {
        coord: RawCoord
        children: string[]
        direct: boolean
        targets: string[]
      }
    >()
    for (const [coordId, n] of r.nodes) {
      nodes.set(coordId, {
        coord: n.coord,
        children: [...(childrenByParent.get(coordId) ?? [])].sort(),
        direct: n.direct,
        targets: n.targets,
      })
    }
    out.set(rootId, { projectKey: r.projectKey, prod: r.prod, nodes })
  }
  return out
}

// A coordinate with identical subtrees everywhere collapses to one node (id =
// coordId); divergent subtrees each get a content-addressed id
// (`<coordId>#<subtree-hash>`) so per-subproject overrides stay distinct.
function mergePathSensitive(perRoot: Map<string, PerRoot>): {
  finalNodes: Map<string, MergedNode>
  directByRoot: Map<string, Set<string>>
} {
  const memo = new Map<string, string>()
  const nodesOf = (rootId: string) => perRoot.get(rootId)?.nodes

  function computeSig(
    rootId: string,
    coordId: string,
    onPath: Set<string>,
  ): string {
    const memoKey = rootId + ' ' + coordId
    const cached = memo.get(memoKey)
    if (cached !== undefined) {
      return cached
    }
    if (onPath.has(coordId)) {
      // Cycle: back-edge as leaf.
      return coordId
    }
    const node = nodesOf(rootId)?.get(coordId)
    if (!node) {
      return coordId
    }
    onPath.add(coordId)
    const childSigs = node.children.map(c => computeSig(rootId, c, onPath))
    onPath.delete(coordId)
    // Digest, not the raw string: caching expanded subtree strings OOMs on
    // reconverging DAGs; a fixed-size digest keeps the pass O(V+E).
    const sig = coordId + '{' + childSigs.join(',') + '}'
    const digest = createHash('sha256')
      .update(sig, 'utf8')
      .digest('hex')
      .slice(0, 16)
    memo.set(memoKey, digest)
    return digest
  }

  // Sorted iteration keeps cyclic-graph signatures stable run-to-run.
  const sigsByCoord = new Map<string, Set<string>>()
  for (const rootId of [...perRoot.keys()].sort()) {
    const nodes = perRoot.get(rootId)!.nodes
    for (const coordId of [...nodes.keys()].sort()) {
      const sig = computeSig(rootId, coordId, new Set())
      let set = sigsByCoord.get(coordId)
      if (!set) {
        set = new Set()
        sigsByCoord.set(coordId, set)
      }
      set.add(sig)
    }
  }
  const divergent = (coordId: string): boolean =>
    (sigsByCoord.get(coordId)?.size ?? 0) > 1
  const emittedIdMemo = new Map<string, string>()
  const emittedIdFor = (rootId: string, coordId: string): string => {
    const k = rootId + ' ' + coordId
    let v = emittedIdMemo.get(k)
    if (v === undefined) {
      v = divergent(coordId)
        ? coordId + '#' + shortHash(computeSig(rootId, coordId, new Set()))
        : coordId
      emittedIdMemo.set(k, v)
    }
    return v
  }

  const finalNodes = new Map<string, MergedNode>()
  const directByRoot = new Map<string, Set<string>>()
  for (const [rootId, { nodes, prod }] of perRoot) {
    for (const [coordId, node] of nodes) {
      const eid = emittedIdFor(rootId, coordId)
      let fn = finalNodes.get(eid)
      if (!fn) {
        fn = {
          coord: node.coord,
          children: new Set(),
          prod: false,
          direct: false,
          targets: new Set(),
        }
        finalNodes.set(eid, fn)
      }
      if (prod) {
        fn.prod = true
      }
      if (node.direct) {
        fn.direct = true
      }
      for (const c of node.children) {
        fn.children.add(emittedIdFor(rootId, c))
      }
      for (const t of node.targets) {
        fn.targets.add(t)
      }
      if (node.direct) {
        let d = directByRoot.get(rootId)
        if (!d) {
          d = new Set()
          directByRoot.set(rootId, d)
        }
        d.add(eid)
      }
    }
  }
  return { finalNodes, directByRoot }
}

function buildComponents(
  finalNodes: Map<string, MergedNode>,
  purlType: PURL_Type,
): SocketFactsSbomComponent[] {
  return [...finalNodes.keys()].sort().map(id => {
    const fn = finalNodes.get(id)!
    const c = fn.coord
    const qualifiers: Record<string, string> = {
      __proto__: null,
    } as unknown as Record<string, string>
    if (c.classifier) {
      qualifiers['classifier'] = c.classifier
    }
    if (c.ext) {
      qualifiers['ext'] = c.ext
    }
    const comp: SocketFactsSbomComponent = {
      type: purlType,
      ...namespaceEntry(purlType, c.group),
      name: c.name,
      ...(c.version ? { version: c.version } : {}),
      ...(Object.keys(qualifiers).length ? { qualifiers } : {}),
      id,
    }
    if (fn.direct) {
      comp.direct = true
    }
    if (!fn.prod) {
      comp.dev = true
    }
    if (fn.children.size) {
      comp.dependencies = [...fn.children].sort()
    }
    return comp
  })
}

function buildProjects(
  parsed: ParsedRecords,
  finalNodes: Map<string, MergedNode>,
  directByRoot: Map<string, Set<string>>,
  perRoot: Map<string, PerRoot>,
  purlType: PURL_Type,
): SocketFactsSbomProject[] {
  const idsByGav = new Map<string, Set<string>>()
  for (const [id, fn] of finalNodes) {
    const key = gav(fn.coord.group, fn.coord.name, fn.coord.version ?? '')
    let set = idsByGav.get(key)
    if (!set) {
      set = new Set()
      idsByGav.set(key, set)
    }
    set.add(id)
  }
  const directByProject = new Map<string, Set<string>>()
  for (const [rootId, ids] of directByRoot) {
    const pk = perRoot.get(rootId)?.projectKey ?? ''
    let set = directByProject.get(pk)
    if (!set) {
      set = new Set()
      directByProject.set(pk, set)
    }
    for (const id of ids) {
      set.add(id)
    }
  }

  const projects = [...parsed.projects.values()].map(p => {
    const entry: SocketFactsSbomProject = {
      type: purlType,
      ...namespaceEntry(purlType, p.group),
      name: p.name,
      ...(p.version ? { version: p.version } : {}),
      subprojectDir: p.dir,
      dependencies: [...(directByProject.get(p.projectKey) ?? [])].sort(),
      resolvedAs: [
        ...(idsByGav.get(gav(p.group, p.name, p.version)) ?? []),
      ].sort(),
    }
    return entry
  })
  projects.sort((a, b) => {
    const ka = `${a.subprojectDir} ${a.namespace ?? ''}:${a.name}`
    const kb = `${b.subprojectDir} ${b.namespace ?? ''}:${b.name}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return projects
}

function unionInto(
  map: Map<string, string[]>,
  key: string,
  add: string[],
): void {
  if (!add.length) {
    return
  }
  const acc = map.get(key)
  if (acc) {
    for (const f of add) {
      if (!acc.includes(f)) {
        acc.push(f)
      }
    }
  } else {
    map.set(key, [...add])
  }
}

function buildArtifactPaths(
  finalNodes: Map<string, MergedNode>,
  projects: RawProject[],
  fileExists: (path: string) => boolean,
): ResolvedArtifactPaths {
  const projectsByGav = new Map<
    string,
    { sources: string[]; targets: string[] }
  >()
  for (const p of projects) {
    projectsByGav.set(gav(p.group, p.name, p.version), {
      sources: p.sources,
      targets: p.targets,
    })
  }
  const targetsByCoord = new Map<string, string[]>()
  const targetsByGav = new Map<string, string[]>()
  const sourcesByCoord = new Map<string, string[]>()
  const coords = new Set<string>()
  for (const fn of finalNodes.values()) {
    const c = fn.coord
    const coordKey = mavenCoordinateKey(
      c.group,
      c.name,
      c.ext,
      c.classifier,
      c.version,
    )
    if (!coordKey) {
      continue
    }
    coords.add(coordKey)
    const pi = projectsByGav.get(gav(c.group, c.name, c.version ?? ''))
    const sources = (pi?.sources ?? []).filter(fileExists)
    const targets = [...new Set([...fn.targets, ...(pi?.targets ?? [])])]
      .filter(fileExists)
      .sort()
    if (sources.length) {
      sourcesByCoord.set(coordKey, sources)
    }
    if (!targets.length) {
      continue
    }
    targetsByCoord.set(coordKey, targets)
    const gavKey = mavenCoordinateKey(
      c.group,
      c.name,
      undefined,
      undefined,
      c.version,
    )
    if (gavKey) {
      const acc = targetsByGav.get(gavKey)
      if (acc) {
        for (const f of targets) {
          if (!acc.includes(f)) {
            acc.push(f)
          }
        }
      } else {
        targetsByGav.set(gavKey, [...targets])
      }
    }
  }
  // A top-level module is a `project` but usually not a dependency node, so its
  // source roots (where reachability starts) are missed by the node loop above;
  // emit first-party module paths here.
  for (const p of projects) {
    const coordKey = mavenCoordinateKey(
      p.group,
      p.name,
      undefined,
      undefined,
      p.version,
    )
    if (!coordKey) {
      continue
    }
    coords.add(coordKey)
    unionInto(sourcesByCoord, coordKey, p.sources.filter(fileExists))
    const targets = p.targets.filter(fileExists)
    unionInto(targetsByCoord, coordKey, targets)
    unionInto(targetsByGav, coordKey, targets)
  }
  return { targetsByCoord, targetsByGav, sourcesByCoord, coords }
}

function buildReport(parsed: ParsedRecords): ResolutionReport {
  const seen = new Set<string>()
  const failures = parsed.failures.filter(f => {
    const key = `${f.coord}|${f.detail}|${f.config}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  const seenUnscannable = new Set<string>()
  const unscannable = parsed.unscannable.filter(u => {
    const key = `${u.config}|${u.detail}`
    if (seenUnscannable.has(key)) {
      return false
    }
    seenUnscannable.add(key)
    return true
  })
  // Roots carry the (project, config) pairs; label projects by their relative
  // dir (unique and human-readable), falling back to name, then key.
  const configsByProjectKey = new Map<string, Set<string>>()
  for (const root of parsed.roots.values()) {
    if (!root.config) {
      continue
    }
    let set = configsByProjectKey.get(root.projectKey)
    if (!set) {
      set = new Set()
      configsByProjectKey.set(root.projectKey, set)
    }
    set.add(root.config)
  }
  const configsByProject = [...configsByProjectKey]
    .map(({ 0: projectKey, 1: configs }) => {
      const p = parsed.projects.get(projectKey)
      return {
        project: p?.dir || p?.name || projectKey,
        configs: [...configs].sort(),
      }
    })
    .sort((a, b) =>
      a.project < b.project ? -1 : a.project > b.project ? 1 : 0,
    )
  return {
    failures,
    scannedConfigs: parsed.scannedConfigs,
    configsByProject,
    unscannable,
  }
}
