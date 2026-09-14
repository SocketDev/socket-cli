import { GRADLE_DIALECT } from './resolution-report-gradle.mts'
import { SBT_DIALECT } from './resolution-report-ivy.mts'
import { MAVEN_DIALECT } from './resolution-report-maven.mts'

import type { BuildTool } from './build-tool.mts'
import type {
  ResolutionFailure,
  UnscannableConfig,
} from './resolution-report.mts'

// Recognized from the build tool's message; drives wording AND whether the kind
// is blocking. An unrecognized message degrades to 'other' (blocking) — safe.
export type FailureCategory =
  | 'not-found'
  | 'no-matching-variant'
  | 'capability-conflict'
  | 'variant-ambiguity'
  | 'repository-or-network'
  | 'config-problem'
  | 'other'

export type FailureCategorySpec = {
  key: FailureCategory
  // Whether failures of this kind fail the run (fail-closed unless
  // --ignore-unresolved). A non-blocking kind never affects the exit code and
  // is surfaced only as a one-line `notice`.
  blocking: boolean
  header?: ((toolLabel: string) => string) | undefined
  showReason?: boolean | undefined
  notice?:
    | ((toolLabel: string, depCount: number, configCount: number) => string)
    | undefined
}

// Per-resolver classify + render/score policy.
export type ResolutionDialect = {
  label: string
  classify: (detail: string) => FailureCategory
  categories: FailureCategorySpec[]
}

export type RenderedResolutionReport = {
  readonly __proto__: null
  // Failure report for blocking kinds; empty when nothing blocks.
  summary: string
  // Build tool's own full messages for all kinds; surfaced at --verbose.
  details: string
  // Caller fails the run iff this is true and not --ignore-unresolved.
  hasBlockingFailures: boolean
  // One-liner(s) for non-blocking kinds; empty when none.
  nonBlockingNotice: string
}

const RESOLUTION_REPORT_ARTIFACT_LIMIT = 15
const RESOLUTION_REPORT_CONFIG_LIMIT = 20

// Drop a bare "group:name" when a versioned "group:name:v" of the same module
// is also present: the lenient resolver reports both forms for one failure.
function dedupCoords(coords: Iterable<string>): string[] {
  const set = new Set(coords)
  const versioned = new Set<string>()
  for (const c of set) {
    const p = c.split(':')
    if (p.length >= 3) {
      versioned.add(`${p[0]}:${p[1]}`)
    }
  }
  return [...set]
    .filter(c => c.split(':').length >= 3 || !versioned.has(c))
    .toSorted()
}

function fmtList(list: string[], limit: number): string {
  const shown = list.slice(0, limit).join(', ')
  return list.length > limit ? `${shown} (+${list.length - limit} more)` : shown
}

function firstLine(s: string): string {
  return (
    (s || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(Boolean) ?? ''
  )
}

// Severity is per-kind; the exit-code decision lives in the caller. We do NOT
// cross-reference what resolved elsewhere: the failed selector carries no
// classifier/type, so relating a failed and a succeeded dep is unsound.
export function renderResolutionReport(
  failures: ResolutionFailure[],
  scannedConfigs: string[],
  dialect: ResolutionDialect,
  opts: {
    ignoreUnresolved?: boolean | undefined
    unscannable?: UnscannableConfig[] | undefined
  } = {},
): RenderedResolutionReport {
  const name = dialect.label
  const unscannable = opts.unscannable ?? []
  const unscannableConfigs = new Set(unscannable.map(u => u.config))
  const specOf = new Map(dialect.categories.map(c => [c.key, c]))
  const isBlocking = (cat: FailureCategory): boolean =>
    specOf.get(cat)?.blocking ?? true

  // Aggregate by (coord, category): one module can fail with different causes
  // across configs. Keep first-seen detail, union the configs.
  const byKey = new Map<string, CoordInfo>()
  const keyOf = (coord: string, category: FailureCategory): string =>
    `${coord} ${category}`
  aggregateResolutionFailures(failures, dialect, byKey, keyOf)
  const allInfos = [...byKey.values()]

  // A whole-config throw is classified by the same cause rules as a per-dep
  // failure: ambiguity stays lenient, every other cause is fail-closed.
  const unscannableInfos = unscannable.map(u => {
    const category = dialect.classify(u.detail)
    return {
      __proto__: null,
      ...u,
      category,
      blocking: isBlocking(category),
    }
  })
  const blockingUnscannable = unscannableInfos.filter(u => u.blocking)
  const nonBlockingUnscannable = unscannableInfos.filter(u => !u.blocking)

  const perDepBlockingConfigs = collectBlockingConfigs(allInfos, isBlocking)
  const blockingConfigs = new Set([
    ...perDepBlockingConfigs,
    ...blockingUnscannable.map(u => u.config),
  ])
  const blockingFailed = [...blockingConfigs].toSorted()
  // An un-scannable config was attempted but resolved nothing, so it didn't succeed.
  const succeeded = scannedConfigs
    .filter(c => !blockingConfigs.has(c) && !unscannableConfigs.has(c))
    .toSorted()

  const groups = dialect.categories
    .map(spec => ({
      __proto__: null,
      spec,
      infos: dedupCoords(
        allInfos.filter(i => i.category === spec.key).map(i => i.coord),
      ).map(c => byKey.get(keyOf(c, spec.key))!),
    }))
    .filter(g => g.infos.length)
  const blockingGroups = groups.filter(g => g.spec.blocking)
  const nonBlockingGroups = groups.filter(g => !g.spec.blocking)
  const blockingCount = blockingGroups.reduce((n, g) => n + g.infos.length, 0)
  const hasBlockingFailures =
    blockingCount > 0 || blockingUnscannable.length > 0
  const willFail = hasBlockingFailures && !opts.ignoreUnresolved

  function buildSummary(): string[] {
    const out: string[] = []
    if (!hasBlockingFailures) {
      return out
    }
    if (blockingCount > 0) {
      out.push(
        opts.ignoreUnresolved
          ? `Ignored ${blockingCount} unresolved dependency(ies) in ${perDepBlockingConfigs.size} configuration(s):`
          : `Could not resolve ${blockingCount} dependency(ies) in ${perDepBlockingConfigs.size} configuration(s):`,
      )
      appendBlockingDependencyGroups(out, blockingGroups, name)
    }
    appendUnscannableConfigs(out, blockingUnscannable, {
      name,
      ignoreUnresolved: opts.ignoreUnresolved,
    })
    out.push('')
    if (succeeded.length) {
      out.push(
        `Resolution succeeded in: ${fmtList(succeeded, RESOLUTION_REPORT_CONFIG_LIMIT)}`,
      )
    }
    if (blockingFailed.length) {
      out.push(
        `Resolution failed in: ${fmtList(blockingFailed, RESOLUTION_REPORT_CONFIG_LIMIT)}`,
      )
    }
    if (willFail) {
      out.push('', 'To proceed, re-run with either:', '    --ignore-unresolved')
      if (blockingFailed.length) {
        out.push(`    --exclude-configs '${blockingFailed.join(',')}'`)
      }
    }
    out.push('', `Re-run with --verbose for ${name}'s full messages.`)
    return out
  }

  const notices: string[] = []
  for (const { infos, spec } of nonBlockingGroups) {
    if (!spec.notice) {
      continue
    }
    const configCount = new Set(infos.flatMap(i => [...i.configs])).size
    notices.push(spec.notice(name, infos.length, configCount))
  }
  // A config-level throw whose cause classifies as variant ambiguity is surfaced, not failed —
  // matching the deliberately-lenient per-dep variant-ambiguity policy.
  if (nonBlockingUnscannable.length) {
    const n = new Set(nonBlockingUnscannable.map(u => u.config)).size
    notices.push(
      `Could not scan ${n} configuration(s) — re-run with --verbose for ${name}'s messages.`,
    )
  }

  const details = renderResolutionDetails(name, allInfos, unscannable)

  const result = {
    __proto__: null,
    summary: buildSummary().join('\n'),
    details,
    hasBlockingFailures,
    nonBlockingNotice: notices.join('\n'),
  }
  return result
}

function dialectFor(tool: BuildTool): ResolutionDialect {
  switch (tool) {
    case 'sbt':
      return SBT_DIALECT
    case 'maven':
      return MAVEN_DIALECT
    case 'gradle':
    default:
      return GRADLE_DIALECT
  }
}

export function renderResolutionErrorReport(
  failures: ResolutionFailure[],
  scannedConfigs: string[],
  tool: BuildTool,
  opts: {
    ignoreUnresolved?: boolean | undefined
    unscannable?: UnscannableConfig[] | undefined
  } = {},
): RenderedResolutionReport {
  return renderResolutionReport(
    failures,
    scannedConfigs,
    dialectFor(tool),
    opts,
  )
}

export type CoordInfo = {
  coord: string
  category: FailureCategory
  detail: string
  configs: Set<string>
}

export function appendBlockingDependencyGroups(
  out: string[],
  blockingGroups: Array<{ infos: CoordInfo[]; spec: FailureCategorySpec }>,
  name: string,
): void {
  for (const { infos, spec } of blockingGroups) {
    out.push('')
    out.push(spec.header ? spec.header(name) : '')
    const shownInfos = infos.slice(0, RESOLUTION_REPORT_ARTIFACT_LIMIT)
    for (let i = 0, { length } = shownInfos; i < length; i += 1) {
      const info = shownInfos[i]!
      const fl = firstLine(info.detail)
      const reasonSuffix = spec.showReason && fl ? `  [${fl}]` : ''
      out.push(`    - ${info.coord}${reasonSuffix}`)
    }
    if (infos.length > RESOLUTION_REPORT_ARTIFACT_LIMIT) {
      out.push(
        `    … and ${infos.length - RESOLUTION_REPORT_ARTIFACT_LIMIT} more`,
      )
    }
  }
}

export function appendUnscannableConfigs(
  out: string[],
  blockingUnscannable: UnscannableConfig[],
  config: { name: string; ignoreUnresolved?: boolean | undefined },
): void {
  const { name } = config
  if (blockingUnscannable.length) {
    // Separate from the per-dep block above, but only if there is one — otherwise
    // the summary would lead with a blank line (a dangling ✗ under logger.fail).
    if (out.length) {
      out.push('')
    }
    out.push(
      config.ignoreUnresolved
        ? `Ignored ${blockingUnscannable.length} configuration(s) that could not be scanned:`
        : `Could not scan ${blockingUnscannable.length} configuration(s) (reason from ${name}):`,
    )
    const shownUnscannable = blockingUnscannable.slice(
      0,
      RESOLUTION_REPORT_CONFIG_LIMIT,
    )
    for (let i = 0, { length } = shownUnscannable; i < length; i += 1) {
      const u = shownUnscannable[i]!
      const fl = firstLine(u.detail)
      out.push(`    - ${u.config}${fl ? `  [${fl}]` : ''}`)
    }
    if (blockingUnscannable.length > RESOLUTION_REPORT_CONFIG_LIMIT) {
      out.push(
        `    … and ${blockingUnscannable.length - RESOLUTION_REPORT_CONFIG_LIMIT} more`,
      )
    }
  }
}

export function renderResolutionDetails(
  name: string,
  allInfos: CoordInfo[],
  unscannable: UnscannableConfig[],
): string {
  const detailLines = [`${name}'s full message for each unresolved dependency:`]
  for (let i = 0, { length } = allInfos; i < length; i += 1) {
    const info = allInfos[i]!
    detailLines.push('')
    detailLines.push(`  ${info.coord}:`)
    const infoLines = (info.detail || '(no message)').split(/\r?\n/)
    for (let j = 0, { length: lineCount } = infoLines; j < lineCount; j += 1) {
      detailLines.push(`    ${infoLines[j]}`)
    }
  }
  if (unscannable.length) {
    detailLines.push('')
    detailLines.push(`${name} configurations that could not be scanned:`)
    for (
      let configIndex = 0, { length: configCount } = unscannable;
      configIndex < configCount;
      configIndex += 1
    ) {
      const u = unscannable[configIndex]!
      detailLines.push('')
      detailLines.push(`  ${u.config}:`)
      const uLines = (u.detail || '(no message)').split(/\r?\n/)
      for (let j = 0, { length: lineCount } = uLines; j < lineCount; j += 1) {
        detailLines.push(`    ${uLines[j]}`)
      }
    }
  }

  return detailLines.join('\n')
}

export function aggregateResolutionFailures(
  failures: ResolutionFailure[],
  dialect: ResolutionDialect,
  byKey: Map<string, CoordInfo>,
  keyOf: (coord: string, category: FailureCategory) => string,
): void {
  for (let i = 0, { length } = failures; i < length; i += 1) {
    const f = failures[i]!
    const category = dialect.classify(f.detail)
    const key = keyOf(f.coord, category)
    let info = byKey.get(key)
    if (!info) {
      info = { coord: f.coord, category, detail: f.detail, configs: new Set() }
      byKey.set(key, info)
    }
    if (f.config) {
      info.configs.add(f.config)
    }
  }
}

export function collectBlockingConfigs(
  allInfos: CoordInfo[],
  isBlocking: (category: FailureCategory) => boolean,
): Set<string> {
  const perDepBlockingConfigs = new Set<string>()
  for (let i = 0, { length } = allInfos; i < length; i += 1) {
    const info = allInfos[i]!
    if (isBlocking(info.category)) {
      for (const c of info.configs) {
        perDepBlockingConfigs.add(c)
      }
    }
  }
  return perDepBlockingConfigs
}
