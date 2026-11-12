/**
 * Unit tests for the maven-compat fixture's record assertions.
 *
 * The fixture proves the Maven extension emits a sibling module's jar and
 * test-jar under their own coordinates, each naming the module as its project,
 * that it records every resolved edge, and that it marks a node prod by the
 * scope Maven kept it with.
 * The fixture itself needs Maven and a JDK, so these run its assertions over
 * synthetic records instead.
 *
 * Implementation: src/commands/manifest/scripts/test/maven-compat/assert-records.py
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ASSERT_RECORDS_PATH = path.join(
  __dirname,
  '../src/commands/manifest/scripts/test/maven-compat/assert-records.py',
)

/** A `root` row: the assertions read the id (field 2), project (field 3) and prod-ness (field 5). */
function rootRow(
  rootId: string,
  projectKey: string,
  options: { prod: boolean },
): string {
  return ['root', rootId, projectKey, '', options.prod ? '1' : '0'].join('\t')
}

/**
 * A `node` row: root id in field 2, coordinate in field 3, directness in field
 * 9, the build project it resolves to in field 10.
 */
function nodeRow(
  rootId: string,
  coordId: string,
  options: { direct: boolean; project: string },
): string {
  return [
    'node',
    rootId,
    coordId,
    '',
    '',
    '',
    '',
    '',
    options.direct ? '1' : '0',
    options.project,
  ].join('\t')
}

/** A `file` row: coordinate in field 3, materialized path in field 4. */
function fileRow(rootId: string, coordId: string, filePath: string): string {
  return ['file', rootId, coordId, filePath].join('\t')
}

/** An `edge` row: root id in field 2, parent coord in field 3, child coord in field 4. */
function edgeRow(rootId: string, parent: string, child: string): string {
  return ['edge', rootId, parent, child].join('\t')
}

const TOOL = 'demo.ext:tool:jar:1.0'
const HARNESS = 'demo.ext:harness:jar:1.0'
const HARNESS_CORE = 'demo.ext:harness-core:jar:1.0'
const SHARED = 'demo.ext:shared:jar:1.0'
const CONFLICT_PROD = 'demo.ext:conflict-prod:jar:1.0'
const CONFLICT_TEST = 'demo.ext:conflict-test:jar:1.0'
const DUP_IO = 'demo.ext:dup-io:jar:1.0'
const DUP_UTIL = 'demo.ext:dup-util:jar:1.0'
const MED_IO = 'demo.ext:med-io:jar:1.0'
const MED_UTIL = 'demo.ext:med-util:jar:1.0'
const CONTAINER_LIB = 'demo.ext:container-lib:jar:1.0'
const CONTAINER_API = 'demo.ext:container-api:jar:1.0'
const MID_JAR = 'demo:mid:jar:1.0'
// The reactor module each sibling artifact's coordinate resolves to, by artifactId.
const SIBLING_PROJECTS: Record<string, string> = {
  __proto__: null,
  lib: 'demo:lib:1.0',
  mid: 'demo:mid:1.0',
} as unknown as Record<string, string>
const LIB_JAR = 'demo:lib:jar:1.0'
const LIB_TESTS = 'demo:lib:test-jar:tests:1.0'
const MGD_TEST = 'demo.ext:mgd-test:jar:1.0'
const MANAGED = 'demo.ext:managed:jar:1.0'

const DEV_NODES = new Set([
  CONFLICT_TEST,
  CONTAINER_API,
  HARNESS,
  HARNESS_CORE,
  LIB_TESTS,
  MGD_TEST,
])

type Edge = { child: string; module: string; parent: string }

const EDGES = {
  conflictProdShared: { module: 'app', parent: CONFLICT_PROD, child: SHARED },
  conflictTestShared: { module: 'app', parent: CONFLICT_TEST, child: SHARED },
  containerLibApi: {
    module: 'app',
    parent: CONTAINER_LIB,
    child: CONTAINER_API,
  },
  dupIoUtil: { module: 'app', parent: DUP_IO, child: DUP_UTIL },
  harnessCore: { module: 'app', parent: HARNESS, child: HARNESS_CORE },
  medIoUtil: { module: 'mid', parent: MED_IO, child: MED_UTIL },
  mgdTestManaged: { module: 'app', parent: MGD_TEST, child: MANAGED },
  midLib: { module: 'app', parent: MID_JAR, child: LIB_JAR },
} satisfies Record<string, Edge>

function rootIdOf(module: string, prodRoot: boolean): string {
  return `${module}-${prodRoot ? 'compile' : 'test'}`
}

type RecordsOptions = {
  dev?: string[]
  extraNodes?: string[]
  libProject?: string
  omitEdges?: Edge[]
  omitNodes?: string[]
  prod?: string[]
  toggleDirect?: string[]
}

/**
 * Records in the extension's root layout: per module, a compile root with the
 * nodes Maven kept with a prod scope and a test root with the whole
 * resolution. `dev`, `extraNodes`, `libProject`, `omitEdges`, `omitNodes`,
 * `prod` and `toggleDirect` alter it into outputs the assertions must reject.
 */
function buildRecords({
  dev = [],
  extraNodes = [],
  libProject = 'demo:lib:1.0',
  omitEdges = [],
  omitNodes = [],
  prod = [],
  toggleDirect = [],
}: RecordsOptions = {}): string {
  // Coordinate and directness of each module's nodes.
  const modules: Array<[string, Array<[string, boolean]>]> = [
    [
      'app',
      [
        [TOOL, true],
        [HARNESS, true],
        [HARNESS_CORE, false],
        [CONFLICT_TEST, true],
        [CONFLICT_PROD, true],
        [SHARED, false],
        [DUP_UTIL, true],
        [DUP_IO, true],
        [CONTAINER_API, true],
        [CONTAINER_LIB, true],
        [MGD_TEST, true],
        [MANAGED, false],
        [MID_JAR, true],
        [LIB_JAR, false],
        [LIB_TESTS, true],
        ...extraNodes.map(coord => [coord, true] as [string, boolean]),
      ],
    ],
    [
      'mid',
      [
        [MED_UTIL, true],
        [MED_IO, true],
        [LIB_JAR, true],
      ],
    ],
  ]
  const isProd = (coord: string) =>
    prod.includes(coord) || (!DEV_NODES.has(coord) && !dev.includes(coord))
  const rows = [['meta', 'maven'].join('\t')]
  for (const { 0: module, 1: nodes } of modules) {
    for (const prodRoot of [true, false]) {
      const rootId = rootIdOf(module, prodRoot)
      const inRoot = (coord: string) =>
        !omitNodes.includes(coord) && (!prodRoot || isProd(coord))
      rows.push(rootRow(rootId, `demo:${module}:1.0`, { prod: prodRoot }))
      for (const { 0: coord, 1: direct } of nodes) {
        if (inRoot(coord)) {
          const project = coord.startsWith('demo:lib:')
            ? libProject
            : (SIBLING_PROJECTS[coord.split(':')[1] ?? ''] ?? '')
          rows.push(
            nodeRow(rootId, coord, {
              direct: direct !== toggleDirect.includes(coord),
              project,
            }),
          )
        }
      }
      for (const edge of Object.values(EDGES)) {
        if (
          edge.module === module &&
          !omitEdges.includes(edge) &&
          inRoot(edge.parent) &&
          inRoot(edge.child)
        ) {
          rows.push(edgeRow(rootId, edge.parent, edge.child))
        }
      }
    }
  }
  rows.push(fileRow(rootIdOf('app', true), TOOL, '/repo/tool-1.0.jar'))
  rows.push(fileRow(rootIdOf('app', false), HARNESS, '/repo/harness-1.0.jar'))
  return `${rows.join('\n')}\n`
}

describe('maven-compat assert-records.py', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'maven-compat-assert-'))
  })

  afterEach(() => {
    rmSync(workDir, { force: true, recursive: true })
  })

  function assertRecords(options?: RecordsOptions): {
    status: number | null
    output: string
  } {
    const recordsPath = path.join(workDir, 'records.tsv')
    writeFileSync(recordsPath, buildRecords(options))

    const result = spawnSync('python3', [ASSERT_RECORDS_PATH, recordsPath], {
      cwd: workDir,
      encoding: 'utf8',
    })
    return { output: `${result.stdout}${result.stderr}`, status: result.status }
  }

  it('accepts the extension output', () => {
    const { output, status } = assertRecords()

    expect(output).toContain('PASS')
    expect(status).toBe(0)
  })

  it.for([
    {
      name: 'a sibling emitted under its bare id',
      options: { extraNodes: ['demo:lib:1.0'] },
      message: 'sibling demo:lib emitted under its bare id',
    },
    {
      name: "a missing edge onto the sibling's jar",
      options: { omitEdges: [EDGES.midLib] },
      message: "edge demo:mid -> demo:lib's jar missing from app",
    },
    {
      name: 'a missing sibling jar',
      options: { omitNodes: [LIB_JAR] },
      message: "sibling demo:lib's jar or test-jar missing",
    },
    {
      name: 'a missing sibling test-jar',
      options: { omitNodes: [LIB_TESTS] },
      message: "sibling demo:lib's jar or test-jar missing",
    },
    {
      name: 'sibling artifacts that do not name their project',
      options: { libProject: '' },
      message:
        "sibling demo:lib's artifacts do not name demo:lib:1.0 as their project",
    },
    {
      name: 'a sibling jar left dev',
      options: { dev: [LIB_JAR] },
      message: "sibling demo:lib's jar not in app's prod root",
    },
    {
      name: 'a sibling test-jar in a prod root',
      options: { prod: [LIB_TESTS] },
      message: "sibling demo:lib's test-jar wrongly in a prod root",
    },
    {
      name: 'a sibling jar marked direct',
      options: { toggleDirect: [LIB_JAR] },
      message: "sibling demo:lib's jar wrongly direct in app",
    },
    {
      name: 'a sibling test-jar not marked direct',
      options: { toggleDirect: [LIB_TESTS] },
      message: "sibling demo:lib's test-jar not direct in app",
    },
    {
      name: 'a compile-scoped node kept under a test parent left dev',
      options: { dev: [SHARED] },
      message: 'scope-conflict demo.ext:shared not in a prod root',
    },
    {
      name: 'a missing edge onto a node kept under another parent',
      options: { omitEdges: [EDGES.conflictProdShared] },
      message:
        'edge demo.ext:conflict-prod -> demo.ext:shared missing from a prod root',
    },
    {
      name: 'a missing edge onto a direct dependency',
      options: { omitEdges: [EDGES.dupIoUtil] },
      message: 'edge demo.ext:dup-io -> demo.ext:dup-util missing',
    },
    {
      name: 'a missing mediated edge',
      options: { omitEdges: [EDGES.medIoUtil] },
      message: 'edge demo.ext:med-io -> demo.ext:med-util missing from mid',
    },
    {
      name: 'a missing edge from a prod node onto a provided one',
      options: { omitEdges: [EDGES.containerLibApi] },
      message: 'edge demo.ext:container-lib -> demo.ext:container-api missing',
    },
    {
      name: 'a missing end of an edge',
      options: { omitNodes: [CONFLICT_PROD] },
      message: 'missing demo.ext:conflict-prod:jar',
    },
    {
      name: 'a test parent of a managed-scope node in a prod root',
      options: { prod: [MGD_TEST] },
      message: 'test dep demo.ext:mgd-test wrongly in a prod root',
    },
    {
      name: 'a missing edge onto a managed-scope node',
      options: { omitEdges: [EDGES.mgdTestManaged] },
      message: 'edge demo.ext:mgd-test -> demo.ext:managed missing',
    },
    {
      name: 'a managed-scope node left dev',
      options: { dev: [MANAGED] },
      message: 'managed-scope demo.ext:managed not in a prod root',
    },
    {
      name: 'a provided dependency in a prod root',
      options: { prod: [CONTAINER_API] },
      message: 'provided demo.ext:container-api wrongly in a prod root',
    },
    {
      name: 'a compile dependency of a provided one left dev',
      options: { dev: [CONTAINER_LIB] },
      message: 'demo.ext:container-lib not in a prod root',
    },
  ] satisfies Array<{
    name: string
    options: RecordsOptions
    message: string
  }>)('rejects $name', ({ message, options }) => {
    const { output, status } = assertRecords(options)

    expect(output).toContain(message)
    expect(status).not.toBe(0)
  })
})
