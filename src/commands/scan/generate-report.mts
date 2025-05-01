import type { CResult } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { components } from '@socketsecurity/sdk/types/api'

type AlertAction = 'defer' | 'ignore' | 'monitor' | 'error' | 'warn'
type AlertKey = string

type FileMap = Map<string, ReportLeafNode | Map<AlertKey, ReportLeafNode>>
type VersionMap = Map<string, ReportLeafNode | FileMap>
type PackageMap = Map<string, ReportLeafNode | VersionMap>
type EcoMap = Map<string, ReportLeafNode | PackageMap>
export type ViolationsMap = Map<string, EcoMap>

export interface ShortScanReport {
  healthy: boolean
}
export interface ScanReport {
  orgSlug: string
  scanId: string
  options: { fold: string; reportLevel: string }
  healthy: boolean
  alerts: ViolationsMap
}

export type ReportLeafNode = {
  type: string
  policy: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
  url: string
  manifest: string[]
}

// Note: The returned cresult will only be ok:false when the generation
//       failed. It won't reflect the healthy state.
export function generateReport(
  scan: Array<components['schemas']['SocketArtifact']>,
  securityPolicy: SocketSdkReturnType<'getOrgSecurityPolicy'>['data'],
  {
    fold,
    orgSlug,
    reportLevel,
    scanId,
    short,
    spinner
  }: {
    fold: 'pkg' | 'version' | 'file' | 'none'
    orgSlug: string
    reportLevel: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
    scanId: string
    short?: boolean | undefined
    spinner?: Spinner | undefined
  }
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
        name: pkgName = '<unknown>',
        type: ecosystem,
        version = '<unknown>'
      } = artifact

      alerts?.forEach(
        (
          alert: NonNullable<
            components['schemas']['SocketArtifact']['alerts']
          >[number]
        ) => {
          const alertName = alert.type as keyof typeof securityRules // => policy[type]
          const action = securityRules[alertName]?.action || ''
          switch (action) {
            case 'error': {
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
                  action
                )
              }
              break
            }
            case 'warn': {
              if (!short && reportLevel !== 'error') {
                addAlert(
                  artifact,
                  violations,
                  fold,
                  ecosystem,
                  pkgName,
                  version,
                  alert,
                  action
                )
              }
              break
            }
            case 'monitor': {
              if (!short && reportLevel !== 'warn' && reportLevel !== 'error') {
                addAlert(
                  artifact,
                  violations,
                  fold,
                  ecosystem,
                  pkgName,
                  version,
                  alert,
                  action
                )
              }
              break
            }

            case 'ignore': {
              if (
                !short &&
                reportLevel !== 'warn' &&
                reportLevel !== 'error' &&
                reportLevel !== 'monitor'
              ) {
                addAlert(
                  artifact,
                  violations,
                  fold,
                  ecosystem,
                  pkgName,
                  version,
                  alert,
                  action
                )
              }
              break
            }

            case 'defer': {
              // Not sure but ignore for now. Defer to later ;)
              if (!short && reportLevel === 'defer') {
                addAlert(
                  artifact,
                  violations,
                  fold,
                  ecosystem,
                  pkgName,
                  version,
                  alert,
                  action
                )
              }
              break
            }

            default: {
              // This value was not emitted from the api at the time of writing.
            }
          }
        }
      )
    })
  }

  spinner?.successAndStop(`Generated reported in ${Date.now() - now} ms`)

  if (short) {
    return {
      ok: true,
      data: { healthy }
    }
  }

  const report = {
    healthy,
    orgSlug,
    scanId,
    options: { fold, reportLevel },
    alerts: violations
  }

  if (!healthy) {
    return {
      ok: true,
      message:
        'The report contains at least one alert that violates the policies set by your organization',
      data: report
    }
  }

  return {
    ok: true,
    data: report
  }
}

function createLeaf(
  art: components['schemas']['SocketArtifact'],
  alert: NonNullable<components['schemas']['SocketArtifact']['alerts']>[number],
  policyAction: AlertAction
): ReportLeafNode {
  const leaf: ReportLeafNode = {
    type: alert.type,
    policy: policyAction,
    url: `https://socket.dev/${art.type}/package/${art.name}/${art.version}`,
    manifest: art.manifestFiles?.map(obj => obj.file) ?? []
  }
  return leaf
}

function addAlert(
  art: components['schemas']['SocketArtifact'],
  violations: ViolationsMap,
  foldSetting: 'pkg' | 'version' | 'file' | 'none',
  ecosystem: string,
  pkgName: string,
  version: string,
  alert: NonNullable<components['schemas']['SocketArtifact']['alerts']>[number],
  policyAction: AlertAction
): void {
  if (!violations.has(ecosystem)) {
    violations.set(ecosystem, new Map())
  }
  const ecomap: EcoMap = violations.get(ecosystem)!
  if (foldSetting === 'pkg') {
    const existing = ecomap.get(pkgName) as ReportLeafNode | undefined
    if (!existing || isStricterPolicy(existing.policy, policyAction)) {
      ecomap.set(pkgName, createLeaf(art, alert, policyAction))
    }
  } else {
    if (!ecomap.has(pkgName)) {
      ecomap.set(pkgName, new Map())
    }
    const pkgmap = ecomap.get(pkgName) as PackageMap
    if (foldSetting === 'version') {
      const existing = pkgmap.get(version) as ReportLeafNode | undefined
      if (!existing || isStricterPolicy(existing.policy, policyAction)) {
        pkgmap.set(version, createLeaf(art, alert, policyAction))
      }
    } else {
      if (!pkgmap.has(version)) {
        pkgmap.set(version, new Map())
      }
      const file = alert.file || '<unknown>'
      const vermap = pkgmap.get(version) as VersionMap

      if (foldSetting === 'file') {
        const existing = vermap.get(file) as ReportLeafNode | undefined
        if (!existing || isStricterPolicy(existing.policy, policyAction)) {
          vermap.set(file, createLeaf(art, alert, policyAction))
        }
      } else {
        if (!vermap.has(file)) {
          vermap.set(file, new Map())
        }
        const key = `${alert.type} at ${alert.start}:${alert.end}`
        const filemap: FileMap = vermap.get(file) as FileMap
        const existing = filemap.get(key) as ReportLeafNode | undefined
        if (!existing || isStricterPolicy(existing.policy, policyAction)) {
          filemap.set(key, createLeaf(art, alert, policyAction))
        }
      }
    }
  }
}

function isStricterPolicy(
  was: 'error' | 'warn' | 'monitor' | 'ignore' | 'defer',
  is: 'error' | 'warn' | 'monitor' | 'ignore' | 'defer'
): boolean {
  // error > warn > monitor > ignore > defer > {unknown}
  if (was === 'error') {
    return false
  }
  if (is === 'error') {
    return true
  }
  if (was === 'warn') {
    return false
  }
  if (is === 'warn') {
    return false
  }
  if (was === 'monitor') {
    return false
  }
  if (is === 'monitor') {
    return false
  }
  if (was === 'ignore') {
    return false
  }
  if (is === 'ignore') {
    return false
  }
  if (was === 'defer') {
    return false
  }
  if (is === 'defer') {
    return false
  }
  // unreachable?
  return false
}
