import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import {
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  isArtifactAlertCve
} from './alert/artifact'
import { ALERT_FIX_TYPE } from './alert/fix'
import { uxLookup } from './alert/rules'
import { ALERT_SEVERITY } from './alert/severity'
import { ColorOrMarkdown } from './color-or-markdown'
import { getSocketDevPackageOverviewUrl } from './socket-url'
import { getTranslations } from './translations'
import constants from '../constants'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type SocketPackageAlert = {
  key: string
  type: string
  block: boolean
  critical: boolean
  display: boolean
  fixable: boolean
  raw: CompactSocketArtifactAlert
  upgrade: boolean
}

export type AlertsByPkgId = Map<string, SocketPackageAlert[]>

const { CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER, NPM } = constants

const format = new ColorOrMarkdown(false)

type AlertIncludeFilter = {
  critical?: boolean | undefined
  cve?: boolean | undefined
  existing?: boolean | undefined
  unfixable?: boolean | undefined
  upgrade?: boolean | undefined
}

type AddSocketArtifactAlertToAlertsMapOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  overrides?: { [key: string]: string } | undefined
  spinner?: Spinner | undefined
}

export async function addArtifactToAlertsMap<T extends AlertsByPkgId>(
  artifact: CompactSocketArtifact,
  alertsByPkgId: T,
  options?: AddSocketArtifactAlertToAlertsMapOptions | undefined
): Promise<T> {
  // Make TypeScript happy.
  if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
    return alertsByPkgId
  }
  const {
    consolidate = false,
    include: _include,
    overrides
  } = {
    __proto__: null,
    ...options
  } as AddSocketArtifactAlertToAlertsMapOptions

  const include = {
    __proto__: null,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgrade: false,
    ..._include
  } as AlertIncludeFilter

  const name = resolvePackageName(artifact)
  const { version } = artifact
  const pkgId = `${name}@${version}`
  const major = semver.major(version)
  let sockPkgAlerts = []
  for (const alert of artifact.alerts) {
    // eslint-disable-next-line no-await-in-loop
    const ux = await uxLookup({
      package: { name, version },
      alert: { type: alert.type }
    })
    const fixType = alert.fix?.type ?? ''
    const critical = alert.severity === ALERT_SEVERITY.critical
    const cve = isArtifactAlertCve(alert)
    const fixableCve = fixType === ALERT_FIX_TYPE.cve
    const fixableUpgrade = fixType === ALERT_FIX_TYPE.upgrade
    const fixable = fixableCve || fixableUpgrade
    const upgrade = fixableUpgrade && !hasOwn(overrides, name)
    if (
      (include.cve && cve) ||
      (include.unfixable && !fixable) ||
      (include.critical && critical) ||
      (include.upgrade && upgrade)
    ) {
      sockPkgAlerts.push({
        name,
        version,
        key: alert.key,
        type: alert.type,
        block: ux.block,
        critical,
        display: ux.display,
        fixable,
        raw: alert,
        upgrade
      })
    }
  }
  if (!sockPkgAlerts.length) {
    return alertsByPkgId
  }
  if (consolidate) {
    const highestForCve = new Map<
      number,
      { alert: SocketPackageAlert; version: string }
    >()
    const highestForUpgrade = new Map<
      number,
      { alert: SocketPackageAlert; version: string }
    >()
    const unfixableAlerts: SocketPackageAlert[] = []
    for (const sockPkgAlert of sockPkgAlerts) {
      const alert = sockPkgAlert.raw
      const fixType = alert.fix?.type ?? ''
      if (fixType === ALERT_FIX_TYPE.cve) {
        const patchedVersion =
          alert.props[CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER]
        const patchedMajor = semver.major(patchedVersion)
        const oldHighest = highestForCve.get(patchedMajor)
        const highest = oldHighest?.version ?? '0.0.0'
        if (semver.gt(patchedVersion, highest)) {
          highestForCve.set(patchedMajor, {
            alert: sockPkgAlert,
            version: patchedVersion
          })
        }
      } else if (fixType === ALERT_FIX_TYPE.upgrade) {
        const oldHighest = highestForUpgrade.get(major)
        const highest = oldHighest?.version ?? '0.0.0'
        if (semver.gt(version, highest)) {
          highestForUpgrade.set(major, { alert: sockPkgAlert, version })
        }
      } else {
        unfixableAlerts.push(sockPkgAlert)
      }
    }
    sockPkgAlerts = [
      ...unfixableAlerts,
      ...[...highestForCve.values()].map(d => d.alert),
      ...[...highestForUpgrade.values()].map(d => d.alert)
    ]
  }
  if (sockPkgAlerts.length) {
    sockPkgAlerts.sort((a, b) => naturalCompare(a.type, b.type))
    alertsByPkgId.set(pkgId, sockPkgAlerts)
  }
  return alertsByPkgId
}

type CveExcludeFilter = {
  upgrade?: boolean | undefined
}

type CveInfoByPkgId = Map<
  string,
  Array<{
    firstPatchedVersionIdentifier: string
    vulnerableVersionRange: string
  }>
>

type GetCveInfoByPackageOptions = {
  exclude?: CveExcludeFilter | undefined
}

export function getCveInfoByAlertsMap(
  alertsMap: AlertsByPkgId,
  options?: GetCveInfoByPackageOptions | undefined
): CveInfoByPkgId | null {
  const exclude = {
    upgrade: true,
    ...({ __proto__: null, ...options } as GetCveInfoByPackageOptions).exclude
  }
  let infoByPkg: CveInfoByPkgId | null = null
  for (const [pkgId, sockPkgAlerts] of alertsMap) {
    const purlObj = PackageURL.fromString(`pkg:npm/${pkgId}`)
    const name = resolvePackageName(purlObj)
    for (const sockPkgAlert of sockPkgAlerts) {
      const alert = sockPkgAlert.raw
      if (
        alert.fix?.type !== ALERT_FIX_TYPE.cve ||
        (exclude.upgrade && getManifestData(NPM, name))
      ) {
        continue
      }
      if (!infoByPkg) {
        infoByPkg = new Map()
      }
      let infos = infoByPkg.get(name)
      if (!infos) {
        infos = []
        infoByPkg.set(name, infos)
      }
      const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
        alert.props
      infos.push({
        firstPatchedVersionIdentifier,
        vulnerableVersionRange: new semver.Range(
          vulnerableVersionRange
        ).format()
      })
    }
  }
  return infoByPkg
}

enum ALERT_SEVERITY_COLOR {
  critical = 'magenta',
  high = 'red',
  middle = 'yellow',
  low = 'white'
}

const enum ALERT_SEVERITY_ORDER {
  critical = 0,
  high = 1,
  middle = 2,
  low = 3,
  none = 4
}

function alertsHaveSeverity(
  alerts: SocketPackageAlert[],
  severity: `${ALERT_SEVERITY}`
): boolean {
  return alerts.find(a => a.raw.severity === severity) !== undefined
}

function alertSeverityComparator(
  a: SocketPackageAlert,
  b: SocketPackageAlert
): number {
  return getAlertSeverityOrder(a) - getAlertSeverityOrder(b)
}

function getAlertsSeverityOrder(alerts: SocketPackageAlert[]): number {
  return alertsHaveSeverity(alerts, ALERT_SEVERITY.critical)
    ? 0
    : alertsHaveSeverity(alerts, ALERT_SEVERITY.high)
      ? 1
      : alertsHaveSeverity(alerts, ALERT_SEVERITY.middle)
        ? 2
        : alertsHaveSeverity(alerts, ALERT_SEVERITY.low)
          ? 3
          : 4
}

function getAlertSeverityOrder(alert: SocketPackageAlert): number {
  const { severity } = alert.raw
  return severity === ALERT_SEVERITY.critical
    ? 0
    : severity === ALERT_SEVERITY.high
      ? 1
      : severity === ALERT_SEVERITY.middle
        ? 2
        : severity === ALERT_SEVERITY.low
          ? 3
          : 4
}

type RiskCounts = {
  middle: number
  low: number
}

function getHiddenRiskCounts(hiddenAlerts: SocketPackageAlert[]): RiskCounts {
  let hiddenMidCount = 0
  let hiddenLowCount = 0
  for (const alert of hiddenAlerts) {
    const order = getAlertSeverityOrder(alert)
    if (order === ALERT_SEVERITY_ORDER.middle) {
      hiddenMidCount += 1
    } else if (order === ALERT_SEVERITY_ORDER.low) {
      hiddenLowCount += 1
    }
  }
  return {
    middle: hiddenMidCount,
    low: hiddenLowCount
  }
}

function getHiddenRisksDescription(riskCounts: RiskCounts): string {
  const descriptions: string[] = []
  if (riskCounts.middle) {
    descriptions.push(`${riskCounts.middle} moderate`)
  }
  if (riskCounts.low) {
    descriptions.push(`${riskCounts.low} low`)
  }
  return `(${descriptions.join('; ')})`
}

type LogAlertsMapOptions = {
  output?: NodeJS.WriteStream | undefined
}

export function logAlertsMap(
  alertsMap: AlertsByPkgId,
  options: LogAlertsMapOptions
) {
  const { output = process.stderr } = {
    __proto__: null,
    ...options
  } as LogAlertsMapOptions
  const translations = getTranslations()
  const sortedEntries = [...alertsMap.entries()].sort(
    (a, b) => getAlertsSeverityOrder(a[1]) - getAlertsSeverityOrder(b[1])
  )
  const hiddenEntries: typeof sortedEntries = []
  for (let i = 0, { length } = sortedEntries; i < length; i += 1) {
    const { 0: pkgId, 1: alerts } = sortedEntries[i]!
    const hiddenAlerts: typeof alerts = []
    const filteredAlerts = alerts.filter(a => {
      const keep = getAlertSeverityOrder(a) <= ALERT_SEVERITY_ORDER.high
      if (!keep) {
        hiddenAlerts.push(a)
      }
      return keep
    })
    if (hiddenAlerts.length) {
      hiddenEntries.push([pkgId, hiddenAlerts.sort(alertSeverityComparator)])
    }
    if (!filteredAlerts.length) {
      continue
    }
    const lines = new Set()
    const sortedAlerts = filteredAlerts.sort(alertSeverityComparator)
    for (const alert of sortedAlerts) {
      const { type } = alert
      const severity = alert.raw.severity ?? ''
      const attributes = [
        ...(severity ? [colors[ALERT_SEVERITY_COLOR[severity]](severity)] : []),
        ...(alert.fixable ? ['fixable'] : []),
        ...(alert.block ? [] : ['non-blocking'])
      ]
      const maybeAttributes = attributes.length
        ? ` ${colors.italic(`(${attributes.join('; ')})`)}`
        : ''
      // Based data from { pageProps: { alertTypes } } of:
      // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
      const info = (translations.alerts as any)[type]
      const title = info?.title ?? type
      const maybeDesc = info?.description ? ` - ${info.description}` : ''
      // TODO: emoji seems to mis-align terminals sometimes
      lines.add(`  ${title}${maybeAttributes}${maybeDesc}`)
    }

    const purlObj = PackageURL.fromString(`pkg:npm/${pkgId}`)
    output.write(
      `${i ? '\n' : ''}${format.hyperlink(
        pkgId,
        getSocketDevPackageOverviewUrl(
          NPM,
          resolvePackageName(purlObj),
          purlObj.version
        )
      )} contains risks${hiddenAlerts.length ? colors.italic(` ${getHiddenRisksDescription(getHiddenRiskCounts(alerts))}`) : ''}:\n`
    )
    for (const line of lines) {
      output.write(`${line}\n`)
    }
  }
  const { length: hiddenEntriesCount } = hiddenEntries
  if (hiddenEntriesCount) {
    const totalRiskCounts = {
      middle: 0,
      low: 0
    }
    for (const { 1: alerts } of hiddenEntries) {
      const riskCounts = getHiddenRiskCounts(alerts)
      totalRiskCounts.middle += riskCounts.middle
      totalRiskCounts.low += riskCounts.low
    }
    output.write(
      `\n${hiddenEntriesCount} packages hidden containing risks ${colors.italic(getHiddenRisksDescription(totalRiskCounts))}\n\n`
    )
  }
}
