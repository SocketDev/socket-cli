import { existsSync } from 'node:fs'

import {
  type ResolvedArtifactPaths,
  type SocketFactsSbom,
  type SocketFactsSbomComponent,
  type SocketFactsSbomDependency,
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
  // Injectable for tests; an uncompiled module's output dir is dropped (module
  // stays resolvable via its sources).
  fileExists?: ((path: string) => boolean) | undefined
}

type MergedNode = {
  coord: RawCoord
  prod: boolean
  direct: boolean
  targets: Set<string>
}

type SubprojectGraph = {
  children: Map<string, Set<string>>
  direct: Set<string>
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
  const projectsByGav = new Map<string, RawProject>()
  for (const p of parsed.projects.values()) {
    projectsByGav.set(gav(p.group, p.name, p.version), p)
  }
  const components = buildComponents(finalNodes, projectsByGav)
  const { dependencies, projects } = buildDependencyGraph(
    parsed,
    perRoot,
    components,
  )

  const metadata: SocketFactsSbomMetadata = {
    format: 'socket-facts-sbom',
    tool,
    toolVersion: parsed.toolVersion,
    ...(parsed.javaVersion ? { javaVersion: parsed.javaVersion } : {}),
  }

  const facts: SocketFactsSbom = projects.length
    ? { metadata, projects, components, dependencies }
    : { metadata, components }

  return {
    facts,
    report: buildReport(parsed),
    artifactPaths: buildArtifactPaths(
      finalNodes,
      [...parsed.projects.values()],
      directByRoot,
      projectsByGav,
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
  projectsByGav: Map<string, RawProject>,
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
    if (projectsByGav.has(gav(c.group, c.name, c.version ?? ''))) {
      comp.firstParty = true
    }
    return comp
  })
}

// Equal subtrees share an entry; partition refinement (coarsest bisimulation)
// keeps that exact on cycles too.
function buildDependencyGraph(
  parsed: ParsedRecords,
  perRoot: Map<string, PerRoot>,
  components: SocketFactsSbomComponent[],
): {
  dependencies: SocketFactsSbomDependency[]
  projects: SocketFactsSbomProject[]
} {
  const componentIndex = new Map(components.map((c, i) => [c.id, i]))
  const graphs = new Map<string, SubprojectGraph>()
  for (const { nodes, projectKey } of perRoot.values()) {
    let g = graphs.get(projectKey)
    if (!g) {
      g = { children: new Map(), direct: new Set() }
      graphs.set(projectKey, g)
    }
    for (const [coordId, node] of nodes) {
      let set = g.children.get(coordId)
      if (!set) {
        set = new Set()
        g.children.set(coordId, set)
      }
      for (const c of node.children) {
        set.add(c)
      }
      if (node.direct) {
        g.direct.add(coordId)
      }
    }
  }

  const vertexIds = new Map<string, number>()
  const labels: number[] = []
  const edges: number[][] = []
  const vertex = (projectKey: string, coordId: string): number => {
    const key = `${projectKey}\t${coordId}`
    let v = vertexIds.get(key)
    if (v === undefined) {
      v = labels.length
      vertexIds.set(key, v)
      labels.push(componentIndex.get(coordId)!)
      edges.push([])
    }
    return v
  }
  for (const [projectKey, { children }] of graphs) {
    for (const [coordId, kids] of children) {
      const v = vertex(projectKey, coordId)
      for (const c of kids) {
        edges[v]!.push(vertex(projectKey, c))
      }
    }
  }

  // Each round splits blocks by their children's blocks; a round that splits
  // nothing is stable.
  let block = [...labels]
  let blockCount = new Set(block).size
  for (;;) {
    const ids = new Map<string, number>()
    block = block.map((b, v) => {
      const childBlocks = [...new Set(edges[v]!.map(c => block[c]!))].sort(
        (x, y) => x - y,
      )
      const sig = `${b}:${childBlocks.join(',')}`
      let id = ids.get(sig)
      if (id === undefined) {
        id = ids.size
        ids.set(sig, id)
      }
      return id
    })
    if (ids.size === blockCount) {
      break
    }
    blockCount = ids.size
  }

  const byComponent = (a: string, b: string) =>
    componentIndex.get(a)! - componentIndex.get(b)!
  const projects = [...parsed.projects.values()]
    .map(p => ({
      p,
      roots: treeRoots(graphs.get(p.projectKey), byComponent),
    }))
    .sort((a, b) => {
      const ka = `${a.p.dir} ${a.p.group}:${a.p.name}`
      const kb = `${b.p.dir} ${b.p.group}:${b.p.name}`
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })

  // Post-order over the sorted projects, so the numbering is stable.
  const indexOfBlock = new Map<number, number>()
  const vertexOfBlock = new Map<number, number>()
  const dependencies: SocketFactsSbomDependency[] = []
  const visit = (v: number): void => {
    const b = block[v]!
    if (vertexOfBlock.has(b)) {
      return
    }
    vertexOfBlock.set(b, v)
    for (const c of [...edges[v]!].sort((x, y) => labels[x]! - labels[y]!)) {
      visit(c)
    }
    indexOfBlock.set(b, dependencies.length)
    dependencies.push({ component: labels[v]! })
  }
  const indexOf = (v: number) => indexOfBlock.get(block[v]!)!
  for (const { p, roots } of projects) {
    for (const coordId of roots) {
      visit(vertex(p.projectKey, coordId))
    }
  }
  for (const [b, v] of vertexOfBlock) {
    const children = [...new Set(edges[v]!.map(indexOf))].sort((x, y) => x - y)
    if (children.length) {
      dependencies[indexOfBlock.get(b)!]!.children = children
    }
  }

  return {
    dependencies,
    projects: projects.map(({ p, roots }) => ({
      type: PURL_TYPE_MAVEN,
      namespace: p.group,
      name: p.name,
      ...(p.version ? { version: p.version } : {}),
      subprojectDir: p.dir,
      ...(p.buildFiles.length
        ? {
            manifestFiles: [...new Set(p.buildFiles)]
              .sort()
              .map(file => ({ file })),
          }
        : {}),
      children: roots
        .map(coordId => indexOf(vertex(p.projectKey, coordId)))
        .sort((x, y) => x - y),
    })),
  }
}

// Unreached nodes become roots too, so every resolved dependency is in the tree.
function treeRoots(
  graph: SubprojectGraph | undefined,
  byComponent: (a: string, b: string) => number,
): string[] {
  if (!graph) {
    return []
  }
  const roots: string[] = []
  const reached = new Set<string>()
  const add = (root: string) => {
    roots.push(root)
    const stack = [root]
    while (stack.length) {
      const id = stack.pop()!
      if (!reached.has(id)) {
        reached.add(id)
        stack.push(...graph.children.get(id)!)
      }
    }
  }
  for (const id of [...graph.direct].sort(byComponent)) {
    add(id)
  }
  const hasParent = new Set([...graph.children.values()].flatMap(c => [...c]))
  const rest = [...graph.children.keys()].sort(byComponent)
  for (const id of [
    ...rest.filter(id => !hasParent.has(id)),
    ...rest.filter(id => hasParent.has(id)),
  ]) {
    if (!reached.has(id)) {
      add(id)
    }
  }
  return roots
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

function buildDirectDependenciesByProject(
  projects: RawProject[],
  directByRoot: Map<string, Set<string>>,
  perRoot: Map<string, PerRoot>,
): Map<string, string[]> {
  const idsByProjectKey = new Map<string, Set<string>>()
  for (const [rootId, ids] of directByRoot) {
    const projectKey = perRoot.get(rootId)?.projectKey ?? ''
    let set = idsByProjectKey.get(projectKey)
    if (!set) {
      set = new Set()
      idsByProjectKey.set(projectKey, set)
    }
    for (const id of ids) {
      set.add(id)
    }
  }
  const directByProject = new Map<string, Set<string>>()
  for (const p of projects) {
    const key = projectClasspathKey({
      name: p.name,
      namespace: p.group,
      subprojectDir: p.dir,
    })
    let set = directByProject.get(key)
    if (!set) {
      set = new Set()
      directByProject.set(key, set)
    }
    for (const id of idsByProjectKey.get(p.projectKey) ?? []) {
      set.add(id)
    }
  }
  return new Map(
    [...directByProject].map(({ 0: key, 1: ids }) => [key, [...ids].sort()]),
  )
}

function buildArtifactPaths(
  finalNodes: Map<string, MergedNode>,
  projects: RawProject[],
  directByRoot: Map<string, Set<string>>,
  projectsByGav: Map<string, RawProject>,
  perRoot: Map<string, PerRoot>,
  fileExists: (path: string) => boolean,
): ResolvedArtifactPaths {
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
    directDependenciesByProject: buildDirectDependenciesByProject(
      projects,
      directByRoot,
      perRoot,
    ),
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
