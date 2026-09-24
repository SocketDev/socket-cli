import { existsSync } from 'node:fs'

import {
  type ResolvedArtifactPaths,
  type SocketFactsSbom,
  type SocketFactsSbomComponent,
  type SocketFactsSbomMetadata,
  type SocketFactsSbomProject,
  mavenCoordinateKey,
  projectClasspathKey,
} from './facts.mts'

import type { ParsedRecords, RawCoord, RawProject } from './records.mts'
import type { ResolutionReport } from './resolution-report.mts'

const PURL_TYPE_MAVEN = 'maven'

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
  const { directByRoot, finalNodes } = mergeByCoordinate(perRoot)

  const tool = (parsed.tool || 'gradle') as SocketFactsSbomMetadata['tool']
  const components = buildComponents(finalNodes)
  const projects =
    opts.emitProjects === false
      ? []
      : buildProjects(parsed, directByRoot, perRoot)

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
      perRoot,
      fileExists,
    ),
  }
}

function gav(group: string, name: string, version: string): string {
  return `${group}:${name}:${version}`
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
        children: [...(childrenByParent.get(coordId) ?? [])],
        direct: n.direct,
        targets: n.targets,
      })
    }
    out.set(rootId, { projectKey: r.projectKey, prod: r.prod, nodes })
  }
  return out
}

// Components are merged by coordinate across every resolution root; which
// coordinates belong to which subproject is kept separately (classpathByProject)
// for reachability, which needs each subproject's exact classpath.
function mergeByCoordinate(perRoot: Map<string, PerRoot>): {
  finalNodes: Map<string, MergedNode>
  directByRoot: Map<string, Set<string>>
} {
  const finalNodes = new Map<string, MergedNode>()
  const directByRoot = new Map<string, Set<string>>()
  for (const [rootId, { nodes, prod }] of perRoot) {
    for (const [coordId, node] of nodes) {
      let fn = finalNodes.get(coordId)
      if (!fn) {
        fn = {
          coord: node.coord,
          children: new Set(),
          prod: false,
          direct: false,
          targets: new Set(),
        }
        finalNodes.set(coordId, fn)
      }
      if (prod) {
        fn.prod = true
      }
      if (node.direct) {
        fn.direct = true
      }
      for (const c of node.children) {
        fn.children.add(c)
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
        d.add(coordId)
      }
    }
  }
  return { finalNodes, directByRoot }
}

function buildComponents(
  finalNodes: Map<string, MergedNode>,
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
      type: PURL_TYPE_MAVEN,
      namespace: c.group,
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
  directByRoot: Map<string, Set<string>>,
  perRoot: Map<string, PerRoot>,
): SocketFactsSbomProject[] {
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
      type: PURL_TYPE_MAVEN,
      namespace: p.group,
      name: p.name,
      ...(p.version ? { version: p.version } : {}),
      subprojectDir: p.dir,
      dependencies: [...(directByProject.get(p.projectKey) ?? [])].sort(),
    }
    return entry
  })
  projects.sort((a, b) => {
    const ka = `${a.subprojectDir} ${a.namespace}:${a.name}`
    const kb = `${b.subprojectDir} ${b.namespace}:${b.name}`
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

function buildClasspathByProject(
  projects: RawProject[],
  perRoot: Map<string, PerRoot>,
): Map<string, string[]> {
  const idsByProjectKey = new Map<string, Set<string>>()
  for (const { nodes, projectKey } of perRoot.values()) {
    let set = idsByProjectKey.get(projectKey)
    if (!set) {
      set = new Set()
      idsByProjectKey.set(projectKey, set)
    }
    for (const coordId of nodes.keys()) {
      set.add(coordId)
    }
  }
  const classpathByProject = new Map<string, Set<string>>()
  for (const p of projects) {
    const key = projectClasspathKey({
      name: p.name,
      namespace: p.group,
      subprojectDir: p.dir,
    })
    let set = classpathByProject.get(key)
    if (!set) {
      set = new Set()
      classpathByProject.set(key, set)
    }
    for (const id of idsByProjectKey.get(p.projectKey) ?? []) {
      set.add(id)
    }
  }
  return new Map(
    [...classpathByProject].map(({ 0: key, 1: ids }) => [key, [...ids].sort()]),
  )
}

function buildArtifactPaths(
  finalNodes: Map<string, MergedNode>,
  projects: RawProject[],
  perRoot: Map<string, PerRoot>,
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
    const sources = (pi?.sources ?? []).filter(fileExists).sort()
    const targets = [...new Set(pi ? pi.targets : fn.targets)]
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
  return {
    targetsByCoord,
    targetsByGav,
    sourcesByCoord,
    coords,
    classpathByProject: buildClasspathByProject(projects, perRoot),
  }
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
  return { failures, scannedConfigs: parsed.scannedConfigs, unscannable }
}
