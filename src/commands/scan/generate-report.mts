import constants, { UNKNOWN_VALUE } from '../../constants.mts'
import { getSocketDevPackageOverviewUrlFromPurl } from '../../utils/socket-url.mts'

import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type AlertKey = string
type EcoMap = Map<string, ReportLeafNode | PackageMap>
type FileMap = Map<string, ReportLeafNode | Map<AlertKey, ReportLeafNode>>
type PackageMap = Map<string, ReportLeafNode | VersionMap>
type VersionMap = Map<string, ReportLeafNode | FileMap>

export type ViolationsMap = Map<string, EcoMap>

export interface ShortScanReport {
  healthy: boolean
}
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

// Note: The returned cResult will only be ok:false when the generation
//       failed. It won't reflect the healthy state.
export function generateReport(
  scan: SocketArtifact[],
  securityPolicy: SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data'],
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
    spinner?: Spinner | undefined
  },
): CResult<ScanReport | { healthy: boolean }> {
  const now = Date.now()

  spinner?.start('Generating report...')

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
  // - the securityPolicyDefault is irrelevant
  // - the report defaults to healthy:true with no alerts
  // - the appearance of an alert will trigger the policy action;
  //   - error: healthy will end up as false, add alerts to report
  //   - warn: healthy unchanged, add alerts to report
  //   - monitor/ignore: no action
  //   - defer: unknown (no action)

  // Note: the server will emit alerts for license policy violations but
  //       those are only included if you set the flag when requesting the scan
  //       data. The alerts map to a single security policy key that determines
  //       what to do with any violation, regardless of the concrete license.
  //       That rule is called "License Policy Violation".
  // The license policy part is implicitly handled here. Either they are
  // included and may show up, or they are not and won't show up.

  const violations = new Map()

  let healthy = true

  const securityRules = securityPolicy.securityPolicyRules
  if (securityRules) {
    // Note: reportLevel: error > warn > monitor > ignore > defer
    scan.forEach(artifact => {
      const {
        alerts,
        name: pkgName = UNKNOWN_VALUE,
        type: ecosystem,
        version = UNKNOWN_VALUE,
      } = artifact

      alerts?.forEach(
        (alert: NonNullable<SocketArtifact['alerts']>[number]) => {
          const alertName = alert.type as keyof typeof securityRules // => policy[type]
          const action = securityRules[alertName]?.action || ''
          switch (action) {
            case constants.REPORT_LEVEL_ERROR: {
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
            case constants.REPORT_LEVEL_WARN: {
              if (!short && reportLevel !== constants.REPORT_LEVEL_ERROR) {
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
            case constants.REPORT_LEVEL_MONITOR: {
              if (
                !short &&
                reportLevel !== constants.REPORT_LEVEL_WARN &&
                reportLevel !== constants.REPORT_LEVEL_ERROR
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

            case constants.REPORT_LEVEL_IGNORE: {
              if (
                !short &&
                reportLevel !== constants.REPORT_LEVEL_MONITOR &&
                reportLevel !== constants.REPORT_LEVEL_WARN &&
                reportLevel !== constants.REPORT_LEVEL_ERROR
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

            case constants.REPORT_LEVEL_DEFER: {
              // Not sure but ignore for now. Defer to later ;)
              if (!short && reportLevel === constants.REPORT_LEVEL_DEFER) {
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
        },
      )
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

function createLeaf(
  art: SocketArtifact,
  alert: NonNullable<SocketArtifact['alerts']>[number],
  policyAction: REPORT_LEVEL,
): ReportLeafNode {
  const leaf: ReportLeafNode = {
    type: alert.type,
    policy: policyAction,
    url: getSocketDevPackageOverviewUrlFromPurl(art),
    manifest: art.manifestFiles?.map(o => o.file) ?? [],
  }
  return leaf
}

function addAlert(
  art: SocketArtifact,
  violations: ViolationsMap,
  fold: FOLD_SETTING,
  ecosystem: string,
  pkgName: string,
  version: string,
  alert: NonNullable<SocketArtifact['alerts']>[number],
  policyAction: REPORT_LEVEL,
): void {
  if (!violations.has(ecosystem)) {
    violations.set(ecosystem, new Map())
  }
  const ecoMap: EcoMap = violations.get(ecosystem)!
  if (fold === constants.FOLD_SETTING_PKG) {
    const existing = ecoMap.get(pkgName) as ReportLeafNode | undefined
    if (!existing || isStricterPolicy(existing.policy, policyAction)) {
      ecoMap.set(pkgName, createLeaf(art, alert, policyAction))
    }
  } else {
    if (!ecoMap.has(pkgName)) {
      ecoMap.set(pkgName, new Map())
    }
    const pkgMap = ecoMap.get(pkgName) as PackageMap
    if (fold === constants.FOLD_SETTING_VERSION) {
      const existing = pkgMap.get(version) as ReportLeafNode | undefined
      if (!existing || isStricterPolicy(existing.policy, policyAction)) {
        pkgMap.set(version, createLeaf(art, alert, policyAction))
      }
    } else {
      if (!pkgMap.has(version)) {
        pkgMap.set(version, new Map())
      }
      const file = alert.file || UNKNOWN_VALUE
      const verMap = pkgMap.get(version) as VersionMap

      if (fold === constants.FOLD_SETTING_FILE) {
        const existing = verMap.get(file) as ReportLeafNode | undefined
        if (!existing || isStricterPolicy(existing.policy, policyAction)) {
          verMap.set(file, createLeaf(art, alert, policyAction))
        }
      } else {
        if (!verMap.has(file)) {
          verMap.set(file, new Map())
        }
        const key = `${alert.type} at ${alert.start}:${alert.end}`
        const fileMap: FileMap = verMap.get(file) as FileMap
        const existing = fileMap.get(key) as ReportLeafNode | undefined
        if (!existing || isStricterPolicy(existing.policy, policyAction)) {
          fileMap.set(key, createLeaf(art, alert, policyAction))
        }
      }
    }
  }
}

function isStricterPolicy(was: REPORT_LEVEL, is: REPORT_LEVEL): boolean {
  // error > warn > monitor > ignore > defer > {unknown}
  if (was === constants.REPORT_LEVEL_ERROR) {
    return false
  }
  if (is === constants.REPORT_LEVEL_ERROR) {
    return true
  }
  if (was === constants.REPORT_LEVEL_WARN) {
    return false
  }
  if (is === constants.REPORT_LEVEL_WARN) {
    return false
  }
  if (was === constants.REPORT_LEVEL_MONITOR) {
    return false
  }
  if (is === constants.REPORT_LEVEL_MONITOR) {
    return false
  }
  if (was === constants.REPORT_LEVEL_IGNORE) {
    return false
  }
  if (is === constants.REPORT_LEVEL_IGNORE) {
    return false
  }
  if (was === constants.REPORT_LEVEL_DEFER) {
    return false
  }
  if (is === constants.REPORT_LEVEL_DEFER) {
    return false
  }
  // unreachable?
  return false
}
