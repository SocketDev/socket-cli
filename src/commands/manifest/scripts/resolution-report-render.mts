import { GRADLE_DIALECT } from './resolution-report-gradle.mts'
import { SBT_DIALECT } from './resolution-report-ivy.mts'
import { MAVEN_DIALECT } from './resolution-report-maven.mts'
import { NUGET_DIALECT } from './resolution-report-nuget.mts'
import { moduleKey } from './resolution-report.mts'
import constants from '../../../constants.mts'
import { camelToKebab } from '../../../utils/strings.mts'

import type { BuildTool } from './build-tool.mts'
import type { ResolutionFailure, Unscannable } from './resolution-report.mts'

// Recognized from the build tool's message; drives wording AND whether the kind
// is blocking. An unrecognized message degrades to 'other' (blocking) — safe.
export type FailureCategory =
  | 'not-found'
  | 'no-matching-variant'
  | 'capability-conflict'
  | 'variant-ambiguity'
  | 'checksum-missing'
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

export type BuildOption = 'excludeConfigs' | 'ignoreUnresolved' | 'verbose'

// Where the invoking command lets the user set each build option, so a remedy
// names something they can actually set.
export type BuildOptionHints = {
  // Reachability scans only: reachability cannot install a dependency that
  // `ignoreUnresolved` lets through, so it must be told to continue too.
  continueOnInstallErrorsFlag?: string | undefined
  // Taken as flags; every other option is set in `socketJson`.
  flags: ReadonlySet<BuildOption>
  // Wizard that writes `socketJson`.
  setupCommand: string
  socketJson: string
}

export const DSI_SETUP_COMMAND =
  'socket manifest setup --dynamic-sbom-inference'

export const REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG =
  '--reach-continue-on-install-errors'

// The single-build manifest commands take every option as a flag.
export const FLAG_HINTS: BuildOptionHints = {
  flags: new Set<BuildOption>([
    'excludeConfigs',
    'ignoreUnresolved',
    'verbose',
  ]),
  setupCommand: 'socket manifest setup',
  socketJson: constants.SOCKET_JSON,
}

export type RenderedResolutionReport = {
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
// failed in the same projects: the lenient resolver reports both forms for one
// failure.
function dedupInfos<T extends { coord: string; projects: Set<string> }>(
  infos: T[],
): T[] {
  const placesOf = (i: T): string[] =>
    i.projects.size ? [...i.projects] : ['']
  const versioned = new Set<string>()
  for (const i of infos) {
    if (i.coord.split(':').length >= 3) {
      for (const project of placesOf(i)) {
        versioned.add(moduleKey(project, i.coord))
      }
    }
  }
  return infos
    .filter(
      i =>
        i.coord.split(':').length >= 3 ||
        !placesOf(i).every(p => versioned.has(moduleKey(p, i.coord))),
    )
    .sort((a, b) => (a.coord < b.coord ? -1 : a.coord > b.coord ? 1 : 0))
}

function firstLine(s: string): string {
  return (
    (s || '')
      .split('\n')
      .map(l => l.trim())
      .find(Boolean) ?? ''
  )
}

function fmtList(list: string[], limit: number): string {
  const shown = list.slice(0, limit).join(', ')
  return list.length > limit ? `${shown} (+${list.length - limit} more)` : shown
}

function flagText(option: BuildOption, value: string | true): string {
  const flag = `--${camelToKebab(option)}`
  return value === true ? flag : `${flag} '${value}'`
}

// Where a failure happened, for builds with several subprojects.
function inProjects(projects: string | Iterable<string>): string {
  const list = [...(typeof projects === 'string' ? [projects] : projects)]
    .filter(Boolean)
    .sort()
    .map(p => `\`${p}\``)
  return list.length ? ` (in ${fmtList(list, 3)})` : ''
}

function installErrorsHint(
  hints: BuildOptionHints,
  ignored: boolean,
): string[] {
  const flag = hints.continueOnInstallErrorsFlag
  if (!flag) {
    return []
  }
  return [
    ignored
      ? `Reachability analysis cannot install the ignored dependencies; pass ${flag} unless you already do.`
      : `If you ignore unresolved dependencies, also pass ${flag}: reachability analysis cannot install them.`,
  ]
}

// `excludableConfigs` is empty when excluding configurations cannot clear
// every blocking failure.
function proceedHint(
  hints: BuildOptionHints,
  tool: BuildTool,
  excludableConfigs: string[],
): string[] {
  const options: Array<[BuildOption, string | true]> = [
    ['ignoreUnresolved', true],
  ]
  if (excludableConfigs.length) {
    options.push(['excludeConfigs', excludableConfigs.join(',')])
  }
  const asFlags = options.filter(o => hints.flags.has(o[0]))
  const inSocketJson = options.filter(o => !hints.flags.has(o[0]))
  const setup = `\`${hints.setupCommand}\``
  if (!inSocketJson.length) {
    return asFlags.length === 1
      ? [`To proceed, re-run with ${flagText(...asFlags[0]!)}.`]
      : [
          'To proceed, re-run with either:',
          ...asFlags.map(o => `    ${flagText(...o)}`),
        ]
  }
  if (!asFlags.length) {
    return [
      `To proceed, set ${options.length > 1 ? 'either of these' : 'this'} under defaults.manifest.${tool} in ${hints.socketJson} (${setup} walks you through it):`,
      ...options.map(
        ([option, value]) => `    "${option}": ${JSON.stringify(value)}`,
      ),
    ]
  }
  return [
    'To proceed, either:',
    ...asFlags.map(o => `    re-run with ${flagText(...o)}`),
    ...inSocketJson.map(
      ([option, value]) =>
        `    set defaults.manifest.${tool}.${option} to ${JSON.stringify(value)} in ${hints.socketJson} (${setup})`,
    ),
  ]
}

// What resolved elsewhere is consulted only by module (group:name): a failed
// selector carries no classifier/type to relate it to one artifact.
export function renderResolutionReport(
  failures: ResolutionFailure[],
  scannedConfigs: string[],
  tool: BuildTool,
  opts: {
    hints?: BuildOptionHints | undefined
    ignoreUnresolved?: boolean | undefined
    resolvedModules?: ReadonlySet<string> | undefined
    unscannable?: Unscannable[] | undefined
  } = {},
): RenderedResolutionReport {
  const dialect = dialectFor(tool)
  const name = dialect.label
  const hints = opts.hints ?? FLAG_HINTS
  const unscannable = opts.unscannable ?? []
  const unscannableConfigs = new Set(
    unscannable.filter(u => u.config).map(u => u.config),
  )
  const specOf = new Map(dialect.categories.map(c => [c.key, c]))
  const isBlocking = (cat: FailureCategory): boolean =>
    specOf.get(cat)?.blocking ?? true

  // A non-blocking kind is only benign when its module resolved anyway: one
  // that resolved in no configuration of its project is missing from that
  // project's SBOM.
  const resolved = opts.resolvedModules
  const isFailureBlocking = (
    category: FailureCategory,
    f: ResolutionFailure,
  ): boolean =>
    isBlocking(category) ||
    (!!resolved && !resolved.has(moduleKey(f.project, f.coord)))

  // Aggregate by (coord, category, blocking): one module can fail with
  // different causes across configs, and block in only some projects. Keep
  // first-seen detail, union the configs and projects.
  type CoordInfo = {
    coord: string
    category: FailureCategory
    blocking: boolean
    detail: string
    configs: Set<string>
    projects: Set<string>
    // Some failure of this coord belongs to no configuration.
    configless: boolean
  }
  const byKey = new Map<string, CoordInfo>()
  for (const f of failures) {
    const category = dialect.classify(f.detail)
    const blocking = isFailureBlocking(category, f)
    const key = `${f.coord} ${category} ${blocking}`
    let info = byKey.get(key)
    if (!info) {
      info = {
        coord: f.coord,
        category,
        blocking,
        detail: f.detail,
        configs: new Set(),
        projects: new Set(),
        configless: false,
      }
      byKey.set(key, info)
    }
    if (f.config) {
      info.configs.add(f.config)
    } else {
      info.configless = true
    }
    if (f.project) {
      info.projects.add(f.project)
    }
  }
  const allInfos = [...byKey.values()]
  const isInfoBlocking = (info: CoordInfo): boolean => info.blocking

  // A whole-config throw is classified by the same cause rules as a per-dep
  // failure: ambiguity stays lenient, every other cause is fail-closed.
  const unscannableInfos = unscannable.map(u => {
    const category = dialect.classify(u.detail)
    return { ...u, category, blocking: isBlocking(category) }
  })
  const blockingUnscannable = unscannableInfos.filter(u => u.blocking)
  const nonBlockingUnscannable = unscannableInfos.filter(u => !u.blocking)
  const blockingUnscannableConfigs = blockingUnscannable.filter(u => u.config)
  const blockingUnscannableProjects = blockingUnscannable.filter(u => !u.config)

  const perDepBlockingConfigs = new Set<string>()
  for (const info of allInfos) {
    if (isInfoBlocking(info)) {
      for (const c of info.configs) {
        perDepBlockingConfigs.add(c)
      }
    }
  }
  const blockingConfigs = new Set([
    ...perDepBlockingConfigs,
    ...blockingUnscannableConfigs.map(u => u.config),
  ])
  const blockingFailed = [...blockingConfigs].sort()
  // A blocking failure outside any configuration leaves every configuration of
  // its project incomplete, so none can be reported as succeeded.
  const hasBlockingConfiglessFailure =
    blockingUnscannableProjects.length > 0 ||
    allInfos.some(i => i.configless && isInfoBlocking(i))
  // An un-scannable config was attempted but resolved nothing, so it didn't succeed.
  const succeeded = hasBlockingConfiglessFailure
    ? []
    : scannedConfigs
        .filter(c => !blockingConfigs.has(c) && !unscannableConfigs.has(c))
        .sort()

  const groups = dialect.categories.map(spec => ({
    spec,
    infos: dedupInfos(allInfos.filter(i => i.category === spec.key)),
  }))
  const blockingGroups = groups
    .map(g => ({ ...g, infos: g.infos.filter(isInfoBlocking) }))
    .filter(g => g.infos.length)
  const nonBlockingGroups = groups
    .map(g => ({ ...g, infos: g.infos.filter(i => !isInfoBlocking(i)) }))
    .filter(g => g.infos.length)
  const blockingCount = blockingGroups.reduce((n, g) => n + g.infos.length, 0)
  const hasBlockingFailures =
    blockingCount > 0 || blockingUnscannable.length > 0
  const willFail = hasBlockingFailures && !opts.ignoreUnresolved

  const out: string[] = []
  if (hasBlockingFailures) {
    if (blockingCount > 0) {
      const inConfigs = perDepBlockingConfigs.size
        ? ` in ${perDepBlockingConfigs.size} configuration(s)`
        : ''
      out.push(
        opts.ignoreUnresolved
          ? `Ignored ${blockingCount} unresolved dependency(ies)${inConfigs}:`
          : `Could not resolve ${blockingCount} dependency(ies)${inConfigs}:`,
      )
      for (const { infos, spec } of blockingGroups) {
        out.push('')
        out.push(spec.header ? spec.header(name) : '')
        for (const info of infos.slice(0, RESOLUTION_REPORT_ARTIFACT_LIMIT)) {
          const fl = firstLine(info.detail)
          const reasonSuffix = spec.showReason && fl ? `  [${fl}]` : ''
          out.push(
            `    - ${info.coord}${inProjects(info.projects)}${reasonSuffix}`,
          )
        }
        if (infos.length > RESOLUTION_REPORT_ARTIFACT_LIMIT) {
          out.push(
            `    … and ${infos.length - RESOLUTION_REPORT_ARTIFACT_LIMIT} more`,
          )
        }
      }
    }
    const pushUnscannable = (
      items: typeof blockingUnscannable,
      header: string,
      label: (u: (typeof blockingUnscannable)[number]) => string,
    ): void => {
      if (!items.length) {
        return
      }
      // Separate from the block above, but only if there is one — otherwise the
      // summary would lead with a blank line (a dangling ✗ under logger.fail).
      if (out.length) {
        out.push('')
      }
      out.push(header)
      for (const u of items.slice(0, RESOLUTION_REPORT_CONFIG_LIMIT)) {
        const fl = firstLine(u.detail)
        out.push(`    - ${label(u)}${fl ? `  [${fl}]` : ''}`)
      }
      if (items.length > RESOLUTION_REPORT_CONFIG_LIMIT) {
        out.push(
          `    … and ${items.length - RESOLUTION_REPORT_CONFIG_LIMIT} more`,
        )
      }
    }
    pushUnscannable(
      blockingUnscannableConfigs,
      opts.ignoreUnresolved
        ? `Ignored ${blockingUnscannableConfigs.length} configuration(s) that could not be scanned:`
        : `Could not scan ${blockingUnscannableConfigs.length} configuration(s) (reason from ${name}):`,
      u => `${u.config}${inProjects(u.project)}`,
    )
    pushUnscannable(
      blockingUnscannableProjects,
      opts.ignoreUnresolved
        ? `Ignored ${blockingUnscannableProjects.length} project(s) whose dependencies could not be resolved:`
        : `Could not resolve the dependencies of ${blockingUnscannableProjects.length} project(s) (reason from ${name}):`,
      u => `\`${u.project}\``,
    )
    if (succeeded.length || blockingFailed.length) {
      out.push('')
    }
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
      out.push('')
      out.push(
        ...proceedHint(
          hints,
          tool,
          hasBlockingConfiglessFailure ? [] : blockingFailed,
        ),
        ...installErrorsHint(hints, false),
      )
    } else if (hints.continueOnInstallErrorsFlag) {
      out.push('', ...installErrorsHint(hints, true))
    }
    out.push('')
    out.push(
      hints.flags.has('verbose')
        ? `Re-run with --verbose for ${name}'s full messages.`
        : `For ${name}'s full messages, ${verboseHint(hints, tool)}.`,
    )
  }

  const notices: string[] = []
  for (const { infos, spec } of nonBlockingGroups) {
    if (!spec.notice) {
      continue
    }
    const configCount = new Set(infos.flatMap(i => [...i.configs])).size
    notices.push(spec.notice(name, infos.length, configCount))
  }
  // A config-level throw whose cause classifies as variant ambiguity is surfaced, not failed: many
  // configurations are marked resolvable yet too underspecified to resolve.
  if (nonBlockingUnscannable.length) {
    const n = new Set(nonBlockingUnscannable.map(u => u.config)).size
    notices.push(
      hints.flags.has('verbose')
        ? `Could not scan ${n} configuration(s) — re-run with --verbose for ${name}'s messages.`
        : `Could not scan ${n} configuration(s); for ${name}'s messages, ${verboseHint(hints, tool)}.`,
    )
  }

  const detailLines = [`${name}'s full message for each unresolved dependency:`]
  for (const info of allInfos) {
    detailLines.push('')
    detailLines.push(`  ${info.coord}:`)
    for (const line of (info.detail || '(no message)').split('\n')) {
      detailLines.push(`    ${line}`)
    }
  }
  if (unscannable.length) {
    detailLines.push('')
    detailLines.push(`${name} resolutions that could not be scanned:`)
    for (const u of unscannable) {
      detailLines.push('')
      detailLines.push(
        `  ${u.config || 'all dependencies'}${inProjects(u.project)}:`,
      )
      for (const line of (u.detail || '(no message)').split('\n')) {
        detailLines.push(`    ${line}`)
      }
    }
  }

  return {
    summary: out.join('\n'),
    details: detailLines.join('\n'),
    hasBlockingFailures,
    nonBlockingNotice: notices.join('\n'),
  }
}

function dialectFor(tool: BuildTool): ResolutionDialect {
  switch (tool) {
    case 'dotnet':
      return NUGET_DIALECT
    case 'gradle':
      return GRADLE_DIALECT
    case 'sbt':
      return SBT_DIALECT
    case 'maven':
      return MAVEN_DIALECT
  }
}

export function renderResolutionErrorReport(
  failures: ResolutionFailure[],
  scannedConfigs: string[] = [],
  tool: BuildTool = 'gradle',
  opts: {
    hints?: BuildOptionHints | undefined
    ignoreUnresolved?: boolean | undefined
    resolvedModules?: ReadonlySet<string> | undefined
    unscannable?: Unscannable[] | undefined
  } = {},
): RenderedResolutionReport {
  return renderResolutionReport(failures, scannedConfigs, tool, opts)
}

export function verboseHint(hints: BuildOptionHints, tool: BuildTool): string {
  return hints.flags.has('verbose')
    ? 'pass --verbose'
    : `set defaults.manifest.${tool}.verbose to true in ${hints.socketJson}`
}
