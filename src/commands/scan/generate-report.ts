import { SocketSdkReturnType } from '@socketsecurity/sdk'
import { components } from '@socketsecurity/sdk/types/api'

import constants from '../../constants'

type AlertAction = 'defer' | 'ignore' | 'monitor' | 'error' | 'warn'
type AlertKey = string

type FileMap = Map<string, AlertAction | Map<AlertKey, AlertAction>>
type VersionMap = Map<string, AlertAction | FileMap>
type PackageMap = Map<string, AlertAction | VersionMap>
type ViolationsMap = Map<string, PackageMap>

export function generateReport(
  scan: Array<components['schemas']['SocketArtifact']>,
  _licensePolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>,
  securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>,
  {
    fold,
    reportLevel
  }: {
    fold: 'pkg' | 'version' | 'file' | 'none'
    reportLevel: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
  }
) {
  const now = Date.now()

  // Lazily access constants.spinner.
  const { spinner } = constants
  spinner.start('Generating report...')

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

  const violations = new Map()

  let healthy = true

  const securityRules: SocketSdkReturnType<'getOrgSecurityPolicy'>['data']['securityPolicyRules'] =
    securityPolicy?.data.securityPolicyRules
  if (securityPolicy && securityRules) {
    // Note: reportLevel: error > warn > monitor > ignore > defer
    scan.forEach(art => {
      const {
        alerts,
        name: pkgName = '<unknown>',
        type: ecosystem,
        version = '<unknown>'
      } = art
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
              addAlert(
                violations,
                fold,
                ecosystem,
                pkgName,
                version,
                alert,
                action
              )
              break
            }
            case 'warn': {
              if (reportLevel !== 'error') {
                addAlert(
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
              if (reportLevel !== 'warn' && reportLevel !== 'error') {
                addAlert(
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
                reportLevel !== 'warn' &&
                reportLevel !== 'error' &&
                reportLevel !== 'monitor'
              ) {
                addAlert(
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
              if (reportLevel === 'defer') {
                addAlert(
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

  spinner.successAndStop(`Generated reported in ${Date.now() - now} ms`)

  const report = {
    healthy,
    alerts: violations
  }

  return report
}

function addAlert(
  violations: ViolationsMap,
  foldSetting: 'pkg' | 'version' | 'file' | 'none',
  ecosystem: string,
  pkgName: string,
  version: string,
  alert: NonNullable<components['schemas']['SocketArtifact']['alerts']>[number],
  policyAction: AlertAction
) {
  if (!violations.has(ecosystem)) {
    violations.set(ecosystem, new Map())
  }
  const ecomap = violations.get(ecosystem)!
  if (!ecomap.has(pkgName)) ecomap.set(pkgName, new Map())

  if (foldSetting === 'pkg') {
    if (policyAction === 'error') ecomap.set(pkgName, 'error')
    else if (!ecomap.get(pkgName)) ecomap.set(pkgName, 'warn')
  } else {
    const pkgmap = ecomap.get(pkgName) as VersionMap
    if (!pkgmap.has(version)) pkgmap.set(version, new Map())

    if (foldSetting === 'version') {
      if (policyAction === 'error') pkgmap.set(version, 'error')
      else if (!pkgmap.get(version)) pkgmap.set(version, 'warn')
    } else {
      const file = alert.file || '<unknown>'
      const vermap = pkgmap.get(version) as FileMap
      if (!vermap.has(file)) vermap.set(file, new Map())

      if (foldSetting === 'file') {
        if (policyAction === 'error') vermap.set(file, 'error')
        else if (!vermap.get(file)) vermap.set(file, 'warn')
      } else {
        const filemap = vermap.get(file) as Map<AlertKey, AlertAction>
        filemap.set(
          `${alert.type} at ${alert.start}:${alert.end}`,
          policyAction
        )
      }
    }
  }
}
