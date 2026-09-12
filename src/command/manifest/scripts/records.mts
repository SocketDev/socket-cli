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

export function recordField(fields: string[], index: number): string {
  return fields[index] ?? ''
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

export function applyOutcomeRecord(
  fields: string[],
  result: ParsedRecords,
  scanned: Set<string>,
): void {
  switch (fields[0]) {
    case 'file': {
      const node = getOrCreateRoot(result, recordField(fields, 1)).nodes.get(
        recordField(fields, 2),
      )
      if (node && fields[3]) {
        node.targets.push(fields[3])
      }
      break
    }
    case 'scanned':
      if (fields[1]) {
        scanned.add(fields[1])
      }
      break
    case 'failure':
      if (fields[1]) {
        result.failures.push({
          coord: fields[1],
          detail: recordField(fields, 2),
          config: recordField(fields, 3),
        })
      }
      break
    case 'unscannable':
      if (fields[1]) {
        result.unscannable.push({
          config: fields[1],
          detail: recordField(fields, 2),
        })
      }
      break
  }
}

export function applyStructureRecord(
  fields: string[],
  result: ParsedRecords,
): void {
  switch (fields[0]) {
    case 'meta':
      result.tool = recordField(fields, 1)
      result.toolVersion = recordField(fields, 2)
      result.javaVersion = recordField(fields, 3)
      break
    case 'project': {
      const project = getOrCreateProject(result, recordField(fields, 1))
      project.group = recordField(fields, 2)
      project.name = recordField(fields, 3)
      project.version = recordField(fields, 4)
      project.dir = recordField(fields, 5)
      break
    }
    case 'projectSrc': {
      if (fields[2]) {
        getOrCreateProject(result, recordField(fields, 1)).sources.push(
          fields[2],
        )
      }
      break
    }
    case 'projectTgt': {
      if (fields[2]) {
        getOrCreateProject(result, recordField(fields, 1)).targets.push(
          fields[2],
        )
      }
      break
    }
    case 'root': {
      const root = getOrCreateRoot(result, recordField(fields, 1))
      root.projectKey = recordField(fields, 2)
      root.config = recordField(fields, 3)
      root.prod = bool(fields[4])
      break
    }
    case 'node': {
      const root = getOrCreateRoot(result, recordField(fields, 1))
      const coordId = recordField(fields, 2)
      root.nodes.set(coordId, {
        coordId,
        coord: {
          group: recordField(fields, 3),
          name: recordField(fields, 4),
          version: recordField(fields, 5),
          ext: recordField(fields, 6),
          classifier: recordField(fields, 7),
        },
        direct: bool(fields[8]),
        targets: [],
      })
      break
    }
    case 'edge': {
      const parent = recordField(fields, 2)
      const child = recordField(fields, 3)
      if (parent !== child) {
        getOrCreateRoot(result, recordField(fields, 1)).edges.push([
          parent,
          child,
        ])
      }
      break
    }
  }
}

export function getOrCreateProject(
  result: ParsedRecords,
  key: string,
): RawProject {
  let project = result.projects.get(key)
  if (!project) {
    project = {
      projectKey: key,
      group: '',
      name: '',
      version: '',
      dir: '',
      sources: [],
      targets: [],
    }
    result.projects.set(key, project)
  }
  return project
}

export function getOrCreateRoot(result: ParsedRecords, id: string): RawRoot {
  let root = result.roots.get(id)
  if (!root) {
    root = {
      rootId: id,
      projectKey: '',
      config: '',
      prod: false,
      nodes: new Map(),
      edges: [],
    }
    result.roots.set(id, root)
  }
  return root
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

  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rawLine = lines[i]!
    if (!rawLine) {
      continue
    }
    const f = rawLine.split('\t').map(unescapeField)
    applyStructureRecord(f, result)
    applyOutcomeRecord(f, result, scanned)
  }
  result.scannedConfigs = [...scanned].toSorted()
  return result
}
