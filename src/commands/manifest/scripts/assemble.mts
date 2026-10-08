import { existsSync } from 'node:fs'

import {
  type ResolvedArtifactPaths,
  type SocketFactsManifestReference,
  type SocketFactsSbom,
  type SocketFactsSbomComponent,
  type SocketFactsSbomMetadata,
  type SocketFactsSbomProject,
} from './facts.mts'

import constants from '../../../constants.mts'

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
  // projectKey when this node is a build project, else empty.
  project: string
  targets: Set<string>
}

type PerRoot = {
  projectKey: string
  prod: boolean
  nodes: Map<string, RootNode>
}

type RootNode = {
  coord: RawCoord
  children: string[]
  direct: boolean
  project: string
  targets: string[]
}

export function assembleFacts(
  parsed: ParsedRecords,
  opts: AssembleOptions = {},
): AssembleResult {
  const fileExists = opts.fileExists ?? existsSync
  const perRoot = buildPerRoot(parsed)
  const { directByRoot, finalNodes } = mergeById(perRoot)

  const tool = (parsed.tool || 'gradle') as SocketFactsSbomMetadata['tool']
  const components = buildComponents(
    finalNodes,
    buildManifestFilesById(parsed, directByRoot, perRoot),
  )
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
          direct: false,
          project: n.project,
          targets: [],
        }
        nodes.set(id, node)
      }
      node.direct ||= n.direct
      node.targets.push(...n.targets)
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
    out.set(rootId, { projectKey: r.projectKey, prod: r.prod, nodes })
  }
  return out
}

// Components are merged by id across every resolution root; which ids belong
// to which subproject is kept separately (classpathByProject) for
// reachability, which needs each subproject's exact classpath.
function mergeById(perRoot: Map<string, PerRoot>): {
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
          project: node.project,
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

function buildManifestFilesById(
  parsed: ParsedRecords,
  directByRoot: Map<string, Set<string>>,
  perRoot: Map<string, PerRoot>,
): Map<string, SocketFactsManifestReference[]> {
  const buildFilesByCoord = new Map<string, Set<string>>()
  for (const [rootId, ids] of directByRoot) {
    const root = perRoot.get(rootId)
    const project = parsed.projects.get(root?.projectKey ?? '')
    for (const id of ids) {
      let set = buildFilesByCoord.get(id)
      if (!set) {
        set = new Set()
        buildFilesByCoord.set(id, set)
      }
      const coord = root?.nodes.get(id)?.coord
      // A dependency no build script declared (e.g. one a plugin adds) is
      // attributed to the project's own build file.
      const files =
        (coord && project?.declaredIn.get(`${coord.group}:${coord.name}`)) ||
        project?.buildFiles ||
        []
      for (const f of files) {
        set.add(f)
      }
    }
  }
  return new Map(
    [...buildFilesByCoord].map(({ 0: id, 1: buildFiles }) => [
      id,
      [constants.DOT_SOCKET_DOT_FACTS_JSON, ...[...buildFiles].sort()].map(
        file => ({ file }),
      ),
    ]),
  )
}

function buildComponents(
  finalNodes: Map<string, MergedNode>,
  manifestFilesById: Map<string, SocketFactsManifestReference[]>,
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
    if (fn.project) {
      comp.firstParty = true
    }
    if (fn.children.size) {
      comp.dependencies = [...fn.children].sort()
    }
    const manifestFiles = manifestFilesById.get(id)
    if (manifestFiles) {
      comp.manifestFiles = manifestFiles
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
      id: p.projectKey,
      type: PURL_TYPE_MAVEN,
      namespace: p.group,
      name: p.name,
      ...(p.version ? { version: p.version } : {}),
      subprojectDir: p.dir,
      dependencies: [...(directByProject.get(p.projectKey) ?? [])].sort(),
    }
    // A project without a build file of its own is defined by the scripts
    // declaring its dependencies, e.g. the root build script.
    const files = p.buildFiles.length
      ? p.buildFiles
      : [...new Set([...p.declaredIn.values()].flat())]
    if (files.length) {
      entry.manifestFiles = [...files].sort().map(file => ({ file }))
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
    const key = p.projectKey
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
  const pathsById: ResolvedArtifactPaths['pathsById'] = new Map()
  for (const [id, fn] of finalNodes) {
    if (!fn.project) {
      pathsById.set(id, {
        sources: [],
        targets: [...fn.targets].filter(fileExists).sort(),
      })
    }
  }
  // A project's own component shares its id, so this also covers dependency
  // edges onto a sibling project.
  for (const p of projects) {
    pathsById.set(p.projectKey, {
      sources: [...new Set(p.sources)].filter(fileExists).sort(),
      targets: [...new Set(p.targets)].filter(fileExists).sort(),
    })
  }
  return {
    pathsById,
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
