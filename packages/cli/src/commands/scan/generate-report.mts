import { UNKNOWN_VALUE } from '@socketsecurity/lib-stable/constants/sentinels'

import {
  FOLD_SETTING_FILE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
} from '../../constants/cli.mts'
import {
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
} from '../../constants/reporting.mts'
import { getSocketDevPackageOverviewUrlFromPurl } from '../../util/socket/url.mts'

import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type { CResult } from '../../types.mts'
import type {
  ALERT_ACTION,
  SocketArtifact,
} from '../../util/alert/artifact.mts'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'

export type AlertKey = string
export type EcoMap = Map<string, ReportLeafNode | PackageMap>
export type FileMap = Map<
  string,
  ReportLeafNode | Map<AlertKey, ReportLeafNode>
>
export type PackageMap = Map<string, ReportLeafNode | VersionMap>
export type VersionMap = Map<string, ReportLeafNode | FileMap>

export type ViolationsMap = Map<string, EcoMap>

export interface ScanReport {
  orgSlug: string
  scanId: string
  options: {
    fold: FOLD_SETTING
    reportLevel: REPORT_LEVEL
  }
  healthy: boolean
  alerts: ViolationsMap
}

export type ReportLeafNode = {
  type: string
  policy: REPORT_LEVEL
  url: string
  manifest: string[]
}

function isReportLeaf(value: unknown): value is ReportLeafNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Map) &&
    'policy' in value
  )
}

export function addAlert(
  art: SocketArtifact,
  violations: ViolationsMap,
  fold: FOLD_SETTING,
  ecosystem: string,
  pkgName: string,
  version: string,
  alert: NonNullable<SocketArtifact['alerts']>[number],
  policyAction: REPORT_LEVEL,
): void {
  let ecoMap = violations.get(ecosystem)
  if (!ecoMap) {
    ecoMap = new Map()
    violations.set(ecosystem, ecoMap)
  }
  if (fold === FOLD_SETTING_PKG) {
    const existing = ecoMap.get(pkgName)
    if (
      !isReportLeaf(existing) ||
      isStricterPolicy(existing.policy, policyAction)
    ) {
      ecoMap.set(pkgName, createLeaf(art, alert, policyAction))
    }
    return
  }
  let pkgMap = ecoMap.get(pkgName)
  if (!pkgMap || isReportLeaf(pkgMap)) {
    pkgMap = new Map()
    ecoMap.set(pkgName, pkgMap)
  }
  if (fold === FOLD_SETTING_VERSION) {
    const existing = pkgMap.get(version)
    if (
      !isReportLeaf(existing) ||
      isStricterPolicy(existing.policy, policyAction)
    ) {
      pkgMap.set(version, createLeaf(art, alert, policyAction))
    }
    return
  }
  let verMap = pkgMap.get(version)
  if (!verMap || isReportLeaf(verMap)) {
    verMap = new Map()
    pkgMap.set(version, verMap)
  }
  const file = alert.file || UNKNOWN_VALUE
  if (fold === FOLD_SETTING_FILE) {
    const existing = verMap.get(file)
    if (
      !isReportLeaf(existing) ||
      isStricterPolicy(existing.policy, policyAction)
    ) {
      verMap.set(file, createLeaf(art, alert, policyAction))
    }
    return
  }
  let fileMap = verMap.get(file)
  if (!fileMap || isReportLeaf(fileMap)) {
    fileMap = new Map()
    verMap.set(file, fileMap)
  }
  const key = `${alert.type} at ${alert.start}:${alert.end}`
  const existing = fileMap.get(key)
  if (
    !isReportLeaf(existing) ||
    isStricterPolicy(existing.policy, policyAction)
  ) {
    fileMap.set(key, createLeaf(art, alert, policyAction))
  }
}

export function createLeaf(
  art: SocketArtifact,
  alert: NonNullable<SocketArtifact['alerts']>[number],
  policyAction: REPORT_LEVEL,
): ReportLeafNode {
  const leaf: ReportLeafNode = {
    type: alert.type,
    policy: policyAction,
    url: getSocketDevPackageOverviewUrlFromPurl(art),
    manifest: art.manifestFiles?.map((o: { file: string }) => o.file) ?? [],
  }
  return leaf
}

function isAlertAction(value: string | undefined): value is ALERT_ACTION {
  return (
    value === REPORT_LEVEL_ERROR ||
    value === REPORT_LEVEL_WARN ||
    value === REPORT_LEVEL_MONITOR ||
    value === REPORT_LEVEL_IGNORE
  )
}

// Note: The returned cResult will only be ok:false when the generation
//       failed. It won't reflect the healthy state.
export function generateReport(
  scan: SocketArtifact[],
  {
    fold,
    orgSlug,
    reportLevel,
    scanId,
    short,
    spinner,
  }: {
    fold: FOLD_SETTING
    orgSlug: string
    reportLevel: REPORT_LEVEL
    scanId: string
    short?: boolean | undefined
    spinner?: SpinnerInstance | undefined
  },
): CResult<ScanReport | { healthy: boolean }> {
  const now = Date.now()

  spinner?.start('Generating report…')

  // Create an object that includes:
  //   healthy: boolean
  //   worst violation level;
  //   per eco
  //     per package
  //       per version
  //         per offending file
  //           reported issue -> policy action

  // In the context of a report;
  // - the alert.severity is irrelevant
  // - the report defaults to healthy:true with no alerts
  // - the appearance of an alert will trigger its resolved action;
  //   - error: healthy will end up as false, add alerts to report
  //   - warn: healthy unchanged, add alerts to report
  //   - monitor/ignore: no action unless reportLevel asks for them
  //   - missing action: skip the alert (do not fail the report)

  // Note: the server will emit alerts for license policy violations but
  //       those are only included if you set the flag when requesting the scan
  //       data. The alerts map to a single security policy key that determines
  //       what to do with any violation, regardless of the concrete license.
  //       That rule is called "License Policy Violation".
  // The license policy part is implicitly handled here. Either they are
  // included and may show up, or they are not and won't show up.

  const violations = new Map()

  let healthy = true

  // Note: reportLevel: error > warn > monitor > ignore > defer
  for (let i = 0, { length } = scan; i < length; i += 1) {
    const artifact = scan[i]!
    const {
      alerts,
      name: pkgName = UNKNOWN_VALUE,
      type: ecosystem,
      version = UNKNOWN_VALUE,
    } = artifact

    // oxlint-disable-next-line socket/prefer-cached-for-loop -- call result is consumed, not a standalone statement
    alerts?.forEach((alert: NonNullable<SocketArtifact['alerts']>[number]) => {
      const action = alert.action
      if (!isAlertAction(action)) {
        return
      }
      switch (action) {
        case REPORT_LEVEL_ERROR: {
          healthy = false
          if (!short) {
            addAlert(
              artifact,
              violations,
              fold,
              ecosystem,
              pkgName,
              version,
              alert,
              action,
            )
          }
          break
        }
        case REPORT_LEVEL_WARN: {
          if (!short && reportLevel !== REPORT_LEVEL_ERROR) {
            addAlert(
              artifact,
              violations,
              fold,
              ecosystem,
              pkgName,
              version,
              alert,
              action,
            )
          }
          break
        }
        case REPORT_LEVEL_MONITOR: {
          if (
            !short &&
            reportLevel !== REPORT_LEVEL_WARN &&
            reportLevel !== REPORT_LEVEL_ERROR
          ) {
            addAlert(
              artifact,
              violations,
              fold,
              ecosystem,
              pkgName,
              version,
              alert,
              action,
            )
          }
          break
        }

        case REPORT_LEVEL_IGNORE: {
          if (
            !short &&
            reportLevel !== REPORT_LEVEL_MONITOR &&
            reportLevel !== REPORT_LEVEL_WARN &&
            reportLevel !== REPORT_LEVEL_ERROR
          ) {
            addAlert(
              artifact,
              violations,
              fold,
              ecosystem,
              pkgName,
              version,
              alert,
              action,
            )
          }
          break
        }

        default: {
          // This value was not emitted from the Socket API at the time of writing.
        }
      }
    })
  }

  spinner?.successAndStop(`Generated reported in ${Date.now() - now} ms`)

  if (short) {
    return {
      ok: true,
      data: { healthy },
    }
  }

  const report = {
    healthy,
    orgSlug,
    scanId,
    options: { fold, reportLevel },
    alerts: violations,
  }

  if (!healthy) {
    return {
      ok: true,
      message:
        'The report contains at least one alert that violates the policies set by your organization',
      data: report,
    }
  }

  return {
    ok: true,
    data: report,
  }
}

export function isStricterPolicy(was: REPORT_LEVEL, is: REPORT_LEVEL): boolean {
  // error > warn > monitor > ignore > defer > {unknown}
  if (was === REPORT_LEVEL_ERROR) {
    return false
  }
  if (is === REPORT_LEVEL_ERROR) {
    return true
  }
  if (was === REPORT_LEVEL_WARN) {
    return false
  }
  if (is === REPORT_LEVEL_WARN) {
    return true
  }
  if (was === REPORT_LEVEL_MONITOR) {
    return false
  }
  if (is === REPORT_LEVEL_MONITOR) {
    return true
  }
  if (was === REPORT_LEVEL_IGNORE) {
    return false
  }
  if (is === REPORT_LEVEL_IGNORE) {
    return true
  }
  if (was === REPORT_LEVEL_DEFER) {
    return false
  }
  if (is === REPORT_LEVEL_DEFER) {
    return false
  }
  // unreachable?
  return false
}
