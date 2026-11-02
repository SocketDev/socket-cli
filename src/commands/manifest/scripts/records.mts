import type { OutputPaths } from './facts.mts'
import type { ResolutionFailure, Unscannable } from './resolution-report.mts'

// Line-protocol the build-tool scripts emit to a records file (NOT stdout — sbt
// prints unsilenceable resolution noise there). One record per line, fields
// backslash-escaped (\\, \t, \n, \r) so a value can't break framing:
//
//   <tag>\t<field>\t<field>...
//
//   meta        tool  toolVersion  javaVersion
//   buildRoot   path                                     (absolute; the facts file's directory)
//   entry       path                                     (file-addressed builds; build-root-relative)
//   project     projectKey  group  name  version  dir
//   projectSrc  projectKey  path  outputSet              (--with-files only)
//   projectTgt  projectKey  path  outputSet              (--with-files only)
//   outputSet   projectKey  outputSet  includes          (the project's own sets on its classpath)
//   projectBuild  projectKey  path                     (build-root-relative; may be absent on disk)
//   excludedProject  projectKey                          (--with-files only; paths without a project)
//   root        rootId  projectKey  config  prod(0|1)  outputSet  role(runtime|compile)
//   node        rootId  coordId  group  name  version  ext  classifier  direct(0|1)  project  outputSets(brought in)
//   edge        rootId  parentCoordId  childCoordId
//   classpath   projectKey  outputSet  coordId  outputSets   (in order; see below)
//   file        rootId  coordId  path                    (--with-files only)
//   unfetched   rootId  coordId                          (--with-files only; requested artifact not fetched)
//   scanned     config
//   failure     coord  detail  config  projectKey   (config empty: not placeable in one)
//   unscannable config  detail  projectKey          (config empty: whole project)
//
// `projectKey` is the tool's unique project identity (Maven: GAV; Gradle:
// project path; sbt: project id), emitted as the project id; a `node` whose
// `project` names one resolves to that build project.
// A `root` is one (subproject, configuration) resolution root; `coordId` is the
// coordinate key (`group:name:ext:classifier:version`, empty segments dropped),
// used opaquely as the per-root node key. Unknown tags are ignored.
//
// Output sets are a project's code by source set (`main`, `test`, ...). A root
// with one is that set's runtime or compile classpath, its nodes in classpath
// order; `classpath` records state Maven's outright.

export type RawCoord = {
  group: string
  name: string
  version: string
  ext: string
  classifier: string
}

export type RawNode = {
  coordId: string
  coord: RawCoord
  direct: boolean
  // projectKey of the build project this node resolves to; empty for an
  // external artifact.
  project: string
  // The build project's output sets this dependency brings in.
  outputSets: string[]
  // --with-files only.
  targets: string[]
  unfetched: boolean
}

export type RawRoot = {
  rootId: string
  projectKey: string
  prod: boolean
  // The output set whose classpath this root is, or '' for none.
  outputSet: string
  role: 'runtime' | 'compile' | ''
  nodes: Map<string, RawNode>
  edges: Array<[string, string]>
}

export type RawProject = {
  projectKey: string
  group: string
  name: string
  version: string
  dir: string
  outputs: Map<string, OutputPaths>
  // Each output set, with the project's other output sets on its classpath.
  outputSets: Map<string, string[]>
  // The project's build files, build-root-relative.
  buildFiles: string[]
}

export type StatedClasspathEntry = {
  coordId: string
  outputSets: string[]
}

export type ParsedRecords = {
  tool: string
  toolVersion: string
  javaVersion: string
  // Absolute directory the build is rooted at; the facts file is written there.
  buildRoot: string
  // The file the build was invoked on (Maven's top-level POM); empty for a
  // directory-addressed build.
  entry: string
  projects: Map<string, RawProject>
  // Excluded from the scan: not projects of their own, but their paths serve
  // the kept projects depending on them.
  excludedProjects: Map<string, RawProject>
  roots: Map<string, RawRoot>
  // By projectKey, then output set: nodes of the project's roots, in order.
  classpaths: Map<string, Map<string, StatedClasspathEntry[]>>
  scannedConfigs: string[]
  failures: ResolutionFailure[]
  unscannable: Unscannable[]
}

export function unescapeField(s: string): string {
  if (!s.includes('\\')) {
    return s
  }
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i]
      out += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : n
    } else {
      out += c
    }
  }
  return out
}

function bool(s: string | undefined): boolean {
  return s === '1' || s === 'true'
}

function list(s: string | undefined): string[] {
  return s ? s.split(',') : []
}

function role(s: string | undefined): RawRoot['role'] {
  return s === 'runtime' || s === 'compile' ? s : ''
}

export function parseRecords(text: string): ParsedRecords {
  const result: ParsedRecords = {
    tool: '',
    toolVersion: '',
    javaVersion: '',
    buildRoot: '',
    entry: '',
    projects: new Map(),
    excludedProjects: new Map(),
    roots: new Map(),
    classpaths: new Map(),
    scannedConfigs: [],
    failures: [],
    unscannable: [],
  }
  const scanned = new Set<string>()
  const excluded = new Set<string>()

  const root = (id: string): RawRoot => {
    let r = result.roots.get(id)
    if (!r) {
      r = {
        rootId: id,
        projectKey: '',
        prod: false,
        outputSet: '',
        role: '',
        nodes: new Map(),
        edges: [],
      }
      result.roots.set(id, r)
    }
    return r
  }
  const project = (key: string): RawProject => {
    let p = result.projects.get(key)
    if (!p) {
      p = {
        projectKey: key,
        group: '',
        name: '',
        version: '',
        dir: '',
        outputs: new Map(),
        outputSets: new Map(),
        buildFiles: [],
      }
      result.projects.set(key, p)
    }
    return p
  }

  const outputs = (key: string, set: string): OutputPaths => {
    const all = project(key).outputs
    let o = all.get(set)
    if (!o) {
      o = { sources: [], targets: [] }
      all.set(set, o)
    }
    return o
  }

  for (const rawLine of text.split('\n')) {
    if (!rawLine) {
      continue
    }
    const f = rawLine.split('\t').map(unescapeField)
    switch (f[0]) {
      case 'meta':
        result.tool = f[1] ?? ''
        result.toolVersion = f[2] ?? ''
        result.javaVersion = f[3] ?? ''
        break
      case 'buildRoot':
        result.buildRoot = f[1] ?? ''
        break
      case 'entry':
        result.entry = f[1] ?? ''
        break
      case 'project': {
        const p = project(f[1] ?? '')
        p.group = f[2] ?? ''
        p.name = f[3] ?? ''
        p.version = f[4] ?? ''
        p.dir = f[5] ?? ''
        break
      }
      case 'projectSrc':
        if (f[2] && f[3]) {
          outputs(f[1] ?? '', f[3]).sources.push(f[2])
        }
        break
      case 'projectTgt':
        if (f[2] && f[3]) {
          outputs(f[1] ?? '', f[3]).targets.push(f[2])
        }
        break
      case 'outputSet':
        if (f[2]) {
          project(f[1] ?? '').outputSets.set(f[2], list(f[3]))
        }
        break
      case 'excludedProject':
        excluded.add(f[1] ?? '')
        break
      case 'projectBuild':
        if (f[2]) {
          project(f[1] ?? '').buildFiles.push(f[2])
        }
        break
      case 'root': {
        const r = root(f[1] ?? '')
        r.projectKey = f[2] ?? ''
        r.prod = bool(f[4])
        r.outputSet = f[5] ?? ''
        r.role = role(f[6])
        break
      }
      case 'node': {
        const r = root(f[1] ?? '')
        const coordId = f[2] ?? ''
        r.nodes.set(coordId, {
          coordId,
          coord: {
            group: f[3] ?? '',
            name: f[4] ?? '',
            version: f[5] ?? '',
            ext: f[6] ?? '',
            classifier: f[7] ?? '',
          },
          direct: bool(f[8]),
          project: f[9] ?? '',
          outputSets: list(f[10]),
          targets: [],
          unfetched: false,
        })
        break
      }
      case 'edge': {
        const parent = f[2] ?? ''
        const child = f[3] ?? ''
        if (parent !== child) {
          root(f[1] ?? '').edges.push([parent, child])
        }
        break
      }
      case 'classpath': {
        const key = f[1] ?? ''
        let byName = result.classpaths.get(key)
        if (!byName) {
          byName = new Map()
          result.classpaths.set(key, byName)
        }
        const name = f[2] ?? ''
        let cp = byName.get(name)
        if (!cp) {
          cp = []
          byName.set(name, cp)
        }
        if (f[3]) {
          cp.push({ coordId: f[3], outputSets: list(f[4]) })
        }
        break
      }
      case 'unfetched': {
        const node = root(f[1] ?? '').nodes.get(f[2] ?? '')
        if (node) {
          node.unfetched = true
        }
        break
      }
      case 'file': {
        const node = root(f[1] ?? '').nodes.get(f[2] ?? '')
        if (node && f[3]) {
          node.targets.push(f[3])
        }
        break
      }
      case 'scanned':
        if (f[1]) {
          scanned.add(f[1])
        }
        break
      case 'failure':
        if (f[1]) {
          result.failures.push({
            coord: f[1],
            detail: f[2] ?? '',
            config: f[3] ?? '',
            project: f[4] ?? '',
          })
        }
        break
      case 'unscannable':
        if (f[1] || f[3]) {
          result.unscannable.push({
            config: f[1] ?? '',
            detail: f[2] ?? '',
            project: f[3] ?? '',
          })
        }
        break
      default:
        break
    }
  }
  for (const key of excluded) {
    const p = result.projects.get(key)
    if (p) {
      result.projects.delete(key)
      result.excludedProjects.set(key, p)
    }
  }
  result.scannedConfigs = [...scanned].sort()
  return result
}
