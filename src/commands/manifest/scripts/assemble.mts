import { existsSync } from 'node:fs'

import { NAMESPACELESS_PURL_TYPES, PURL_TYPE_BY_TOOL } from './build-tool.mts'
import {
  type ProjectFramework,
  type ResolvedArtifactPaths,
  type SocketFactsSbom,
  type SocketFactsSbomComponent,
  type SocketFactsSbomDependency,
  type SocketFactsSbomMetadata,
  type SocketFactsSbomProject,
} from './facts.mts'
import { moduleKey } from './resolution-report.mts'
import { getOrInsert } from '../../../utils/get-or-insert.mts'

import type {
  ParsedRecords,
  RawCoord,
  RawProject,
  RawTarget,
} from './records.mts'
import type { ResolutionReport } from './resolution-report.mts'

function purlBase(
  type: string,
  group: string,
  name: string,
): { type: string; namespace?: string; name: string } {
  return NAMESPACELESS_PURL_TYPES.has(type)
    ? { type, name }
    : { type, namespace: group, name }
}

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
  // projectKey when this node is a build project, else empty.
  project: string
  // One per resolution root that recorded files or failed to fetch them.
  resolutions: Array<{ targets: string[]; unfetched: boolean }>
}

type SubprojectGraph = {
  children: Map<string, Set<string>>
  direct: Set<string>
}

type PerRoot = {
  projectKey: string
  prod: boolean
  target?: RawTarget | undefined
  nodes: Map<string, RootNode>
}

type RootNode = {
  coord: RawCoord
  children: string[]
  compileTargets: string[]
  direct: boolean
  project: string
  targets: string[]
  unfetched: boolean
}

export function assembleFacts(
  parsed: ParsedRecords,
  opts: AssembleOptions = {},
): AssembleResult {
  // Every root that fetched an artifact lists its file, so check each path once.
  const fileExists = opts.fileExists ?? existsSync
  const existing = new Map<string, boolean>()
  const exists = (p: string) => {
    let e = existing.get(p)
    if (e === undefined) {
      e = fileExists(p)
      existing.set(p, e)
    }
    return e
  }
  const perRoot = buildPerRoot(parsed)
  const finalNodes = mergeById(perRoot)
  const graphs = buildSubprojectGraphs(perRoot)

  const tool = (parsed.tool || 'gradle') as SocketFactsSbomMetadata['tool']
  const purlType = PURL_TYPE_BY_TOOL[tool]
  const components = buildComponents(finalNodes, purlType)
  const { dependencies, projects } = buildDependencyGraph(
    parsed,
    graphs,
    components,
    purlType,
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
    artifactPaths: {
      ...buildArtifactPaths(
        finalNodes,
        [...parsed.projects.values()],
        [...parsed.excludedProjects.values()],
        graphs,
        exists,
      ),
      ...buildFrameworks(parsed, perRoot, exists),
    },
  }
}

// A node resolving to a build project takes that project's id, so projects
// sharing a coordinate stay apart and the project's variants collapse into it.
function componentId(coordId: string, project: string): string {
  return project || coordId
}

function buildPerRoot(parsed: ParsedRecords): Map<string, PerRoot> {
  const out = new Map<string, PerRoot>()
  for (const [rootId, r] of parsed.roots) {
    const idOf = (coordId: string) =>
      componentId(coordId, r.nodes.get(coordId)?.project ?? '')
    const nodes = new Map<string, RootNode>()
    for (const [coordId, n] of r.nodes) {
      const id = idOf(coordId)
      let node = nodes.get(id)
      if (!node) {
        node = {
          coord: n.project ? { ...n.coord, classifier: '', ext: '' } : n.coord,
          children: [],
          compileTargets: [],
          direct: false,
          project: n.project,
          targets: [],
          unfetched: false,
        }
        nodes.set(id, node)
      }
      node.direct ||= n.direct
      node.unfetched ||= n.unfetched
      node.targets.push(...n.targets)
      node.compileTargets.push(...n.compileTargets)
    }
    for (const [p, c] of r.edges) {
      if (!r.nodes.has(p) || !r.nodes.has(c)) {
        continue
      }
      const parentId = idOf(p)
      const childId = idOf(c)
      const parent = nodes.get(parentId)!
      if (childId !== parentId && !parent.children.includes(childId)) {
        parent.children.push(childId)
      }
    }
    out.set(rootId, {
      projectKey: r.projectKey,
      prod: r.prod,
      target: r.target,
      nodes,
    })
  }
  return out
}

// Components are merged by id across every resolution root; which ids belong
// to which subproject is kept separately (classpathByProject) for
// reachability, which needs each subproject's exact classpath.
function mergeById(perRoot: Map<string, PerRoot>): Map<string, MergedNode> {
  const finalNodes = new Map<string, MergedNode>()
  for (const { nodes, prod } of perRoot.values()) {
    for (const [coordId, node] of nodes) {
      let fn = finalNodes.get(coordId)
      if (!fn) {
        fn = {
          coord: node.coord,
          prod: false,
          direct: false,
          project: node.project,
          resolutions: [],
        }
        finalNodes.set(coordId, fn)
      }
      if (prod) {
        fn.prod = true
      }
      if (node.direct) {
        fn.direct = true
      }
      if (node.unfetched || node.targets.length) {
        fn.resolutions.push({
          targets: node.targets,
          unfetched: node.unfetched,
        })
      }
    }
  }
  return finalNodes
}

function buildComponents(
  finalNodes: Map<string, MergedNode>,
  purlType: string,
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
      ...purlBase(purlType, c.group, c.name),
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
    if (fn.project) {
      comp.firstParty = true
    }
    return comp
  })
}

// One graph per subproject, its configurations merged.
function buildSubprojectGraphs(
  perRoot: Map<string, PerRoot>,
): Map<string, SubprojectGraph> {
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
  return graphs
}

// Equal subtrees share an entry; partition refinement (coarsest bisimulation)
// keeps that exact on cycles too.
function buildDependencyGraph(
  parsed: ParsedRecords,
  graphs: Map<string, SubprojectGraph>,
  components: SocketFactsSbomComponent[],
  purlType: string,
): {
  dependencies: SocketFactsSbomDependency[]
  projects: SocketFactsSbomProject[]
} {
  const componentIndex = new Map(components.map((c, i) => [c.id, i]))

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
      roots: treeRoots(p.projectKey, graphs.get(p.projectKey), byComponent),
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
    projects: projects.map(({ p, roots }) => {
      const entry: SocketFactsSbomProject = {
        id: p.projectKey,
        ...purlBase(purlType, p.group, p.name),
        ...(p.version ? { version: p.version } : {}),
        subprojectDir: p.dir,
        children: roots
          .map(coordId => indexOf(vertex(p.projectKey, coordId)))
          .sort((x, y) => x - y),
      }
      if (p.buildFiles.length) {
        entry.manifestFiles = sortedUnique(p.buildFiles).map(file => ({ file }))
      }
      return entry
    }),
  }
}

function treeRoots(
  projectKey: string,
  graph: SubprojectGraph | undefined,
  byComponent: (a: string, b: string) => number,
): string[] {
  if (!graph) {
    return []
  }
  const roots = [...graph.direct].sort(byComponent)
  const reached = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    if (!reached.has(id)) {
      reached.add(id)
      stack.push(...graph.children.get(id)!)
    }
  }
  const unreached = [...graph.children.keys()].filter(id => !reached.has(id))
  if (unreached.length) {
    throw new Error(
      `Resolved dependencies of ${projectKey} are not reachable from its direct dependencies: ${unreached.sort(byComponent).join(', ')}`,
    )
  }
  return roots
}

function byProject(
  projects: RawProject[],
  graphs: Map<string, SubprojectGraph>,
  ids: (graph: SubprojectGraph) => Iterable<string>,
): Map<string, string[]> {
  return new Map(
    projects.map(p => {
      const g = graphs.get(p.projectKey)
      return [p.projectKey, g ? [...ids(g)].sort() : []]
    }),
  )
}

function buildArtifactPaths(
  finalNodes: Map<string, MergedNode>,
  projects: RawProject[],
  excludedProjects: RawProject[],
  graphs: Map<string, SubprojectGraph>,
  exists: (path: string) => boolean,
): ResolvedArtifactPaths {
  const pathsById: ResolvedArtifactPaths['pathsById'] = new Map()
  for (const [id, fn] of finalNodes) {
    if (!fn.project) {
      const complete = completeResolutions(
        fn.resolutions,
        exists,
        r => r.targets,
      )
      pathsById.set(
        id,
        complete
          ? {
              sources: [],
              targets: sortedUnique(complete.flatMap(r => r.targets)),
            }
          : { sources: [] },
      )
    }
  }
  // A project's own component shares its id, so this also covers dependency
  // edges onto a sibling project.
  for (const p of [...projects, ...excludedProjects]) {
    pathsById.set(p.projectKey, {
      sources: sortedUnique(p.sources).filter(exists),
      targets: sortedUnique(p.targets).filter(exists),
    })
  }
  return {
    pathsById,
    classpathByProject: byProject(projects, graphs, g => g.children.keys()),
    directDependenciesByProject: byProject(projects, graphs, g => g.direct),
  }
}

// Only a root that fetched every file of the artifact, all still on disk,
// resolved it: a partial list would claim it resolved whole. Undefined when
// every root that fetched it failed.
function completeResolutions<R extends { unfetched: boolean }>(
  resolutions: readonly R[],
  exists: (path: string) => boolean,
  files: (resolution: R) => string[],
): R[] | undefined {
  const complete = resolutions.filter(
    r => !r.unfetched && files(r).every(exists),
  )
  return resolutions.length && !complete.length ? undefined : complete
}

function frameworkKey(framework: string, runtime: string): string {
  return `${framework}\t${runtime}`
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort()
}

// Per target framework, for builds that resolve per framework (dotnet): what
// each project's build compiles against and each package contributes to it.
function buildFrameworks(
  parsed: ParsedRecords,
  perRoot: Map<string, PerRoot>,
  exists: (path: string) => boolean,
): Pick<ResolvedArtifactPaths, 'frameworksByProject' | 'frameworksById'> {
  const roots = [...perRoot.values()].filter(
    (r): r is PerRoot & { target: RawTarget } => !!r.target,
  )
  const projects = [...parsed.projects.values()]
  if (!roots.length && !projects.some(p => p.builds.size)) {
    return {}
  }

  const projectBuilds = new Map<string, Map<string, ProjectFramework>>()
  const projectFramework = (
    projectKey: string,
    { alias, framework, runtime }: RawTarget,
  ): ProjectFramework =>
    getOrInsert(
      getOrInsert(projectBuilds, projectKey, () => new Map()),
      frameworkKey(alias, runtime),
      () => {
        const build = parsed.projects.get(projectKey)?.builds.get(alias)
        return {
          ...build,
          alias,
          framework: framework || build?.framework || alias,
          ...(runtime ? { runtime } : {}),
          frameworkReferences: sortedUnique(build?.frameworkReferences ?? []),
          defineConstants: [...new Set(build?.defineConstants)],
          usings: (build?.usings ?? []).map(u => ({
            namespace: u.namespace,
            ...(u.alias ? { alias: u.alias } : {}),
            ...(u.static ? { static: true as const } : {}),
          })),
          // In compiler order, which F# depends on.
          sources: [...new Set(build?.sources)].filter(exists),
          targets: sortedUnique(build?.targets ?? []).filter(exists),
          dependencies: [],
          classpath: [],
        }
      },
    )

  // Per component and framework: the roots' resolutions.
  const componentBuilds = new Map<
    string,
    Map<string, { target: RawTarget; resolutions: RootNode[] }>
  >()
  for (const { nodes, projectKey, target } of roots) {
    const pf = projectFramework(projectKey, target)
    for (const { 0: id, 1: node } of nodes) {
      pf.classpath.push(id)
      if (node.direct) {
        pf.dependencies.push(id)
      }
      if (node.project) {
        continue
      }
      const cb = getOrInsert(
        getOrInsert(componentBuilds, id, () => new Map()),
        frameworkKey(target.framework, target.runtime),
        () => ({ target, resolutions: [] }),
      )
      if (node.unfetched || node.targets.length || node.compileTargets.length) {
        cb.resolutions.push(node)
      }
    }
  }
  // A build with nothing to resolve has no root, yet still compiles.
  for (const p of projects) {
    for (const alias of p.builds.keys()) {
      projectFramework(p.projectKey, { alias, framework: '', runtime: '' })
    }
  }

  const frameworksByProject = new Map(
    [...projectBuilds].map(({ 0: projectKey, 1: builds }) => [
      projectKey,
      [...builds.values()].map(pf => ({
        ...pf,
        dependencies: sortedUnique(pf.dependencies),
        classpath: sortedUnique(pf.classpath.filter(id => id !== projectKey)),
      })),
    ]),
  )
  const frameworksById = new Map(
    [...componentBuilds].map(({ 0: id, 1: byFramework }) => [
      id,
      [...byFramework.values()].map(
        ({ resolutions, target: { framework, runtime } }) => {
          const complete = completeResolutions(resolutions, exists, r => [
            ...r.targets,
            ...r.compileTargets,
          ])
          return {
            framework,
            ...(runtime ? { runtime } : {}),
            ...(complete
              ? {
                  targets: sortedUnique(complete.flatMap(r => r.targets)),
                  compile: sortedUnique(
                    complete.flatMap(r => r.compileTargets),
                  ),
                }
              : {}),
          }
        },
      ),
    ]),
  )
  return { frameworksByProject, frameworksById }
}

function buildReport(parsed: ParsedRecords): ResolutionReport {
  const seen = new Set<string>()
  const failures = parsed.failures.filter(f => {
    const key = `${f.coord}|${f.detail}|${f.config}|${f.project}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  const seenUnscannable = new Set<string>()
  const unscannable = parsed.unscannable.filter(u => {
    const key = `${u.config}|${u.detail}|${u.project}`
    if (seenUnscannable.has(key)) {
      return false
    }
    seenUnscannable.add(key)
    return true
  })
  const resolvedModules = new Set<string>()
  if (failures.length) {
    for (const r of parsed.roots.values()) {
      for (const n of r.nodes.values()) {
        resolvedModules.add(
          moduleKey(r.projectKey, `${n.coord.group}:${n.coord.name}`),
        )
      }
    }
  }
  return {
    failures,
    resolvedModules,
    scannedConfigs: parsed.scannedConfigs,
    unscannable,
  }
}
