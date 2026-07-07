import type {
  ResolutionFailure,
  UnscannableConfig,
} from './resolution-report.mts'

// Line-protocol the build-tool scripts emit to a records file (NOT stdout — sbt
// prints unsilenceable resolution noise there). One record per line, fields
// backslash-escaped (\\, \t, \n, \r) so a value can't break framing:
//
//   <tag>\t<field>\t<field>...
//
//   meta        tool  toolVersion  javaVersion
//   project     projectKey  group  name  version  dir
//   projectSrc  projectKey  path                         (--with-files only)
//   projectTgt  projectKey  path                         (--with-files only)
//   root        rootId  projectKey  config  prod(0|1)
//   node        rootId  coordId  group  name  version  ext  classifier  direct(0|1)
//   edge        rootId  parentCoordId  childCoordId
//   file        rootId  coordId  path                    (--with-files only)
//   scanned     config
//   failure     coord  detail  config
//   unscannable config  detail
//
// A `root` is one (subproject, configuration) resolution root; `coordId` is the
// coordinate key (`group:name:ext:classifier:version`, empty segments dropped),
// used opaquely as the per-root node key. Unknown tags are ignored.

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
  // --with-files only.
  targets: string[]
}

export type RawRoot = {
  rootId: string
  projectKey: string
  config: string
  prod: boolean
  nodes: Map<string, RawNode>
  edges: Array<[string, string]>
}

export type RawProject = {
  projectKey: string
  group: string
  name: string
  version: string
  dir: string
  sources: string[]
  targets: string[]
}

export type ParsedRecords = {
  tool: string
  toolVersion: string
  javaVersion: string
  projects: Map<string, RawProject>
  roots: Map<string, RawRoot>
  scannedConfigs: string[]
  failures: ResolutionFailure[]
  unscannable: UnscannableConfig[]
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

export function parseRecords(text: string): ParsedRecords {
  const result: ParsedRecords = {
    tool: '',
    toolVersion: '',
    javaVersion: '',
    projects: new Map(),
    roots: new Map(),
    scannedConfigs: [],
    failures: [],
    unscannable: [],
  }
  const scanned = new Set<string>()

  const root = (id: string): RawRoot => {
    let r = result.roots.get(id)
    if (!r) {
      r = {
        rootId: id,
        projectKey: '',
        config: '',
        prod: false,
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
        sources: [],
        targets: [],
      }
      result.projects.set(key, p)
    }
    return p
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
      case 'project': {
        const p = project(f[1] ?? '')
        p.group = f[2] ?? ''
        p.name = f[3] ?? ''
        p.version = f[4] ?? ''
        p.dir = f[5] ?? ''
        break
      }
      case 'projectSrc':
        if (f[2]) {
          project(f[1] ?? '').sources.push(f[2])
        }
        break
      case 'projectTgt':
        if (f[2]) {
          project(f[1] ?? '').targets.push(f[2])
        }
        break
      case 'root': {
        const r = root(f[1] ?? '')
        r.projectKey = f[2] ?? ''
        r.config = f[3] ?? ''
        r.prod = bool(f[4])
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
          targets: [],
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
          })
        }
        break
      case 'unscannable':
        if (f[1]) {
          result.unscannable.push({
            config: f[1],
            detail: f[2] ?? '',
          })
        }
        break
      default:
        break
    }
  }
  result.scannedConfigs = [...scanned].sort()
  return result
}
