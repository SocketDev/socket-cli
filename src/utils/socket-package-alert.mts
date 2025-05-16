import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import { isArtifactAlertCve } from './alert/artifact.mts'
import { ALERT_FIX_TYPE } from './alert/fix.mts'
import { ALERT_SEVERITY } from './alert/severity.mts'
import { ColorOrMarkdown } from './color-or-markdown.mts'
import { getSocketDevPackageOverviewUrl } from './socket-url.mts'
import { getTranslations } from './translations.mts'
import constants from '../constants.mts'
import { findSocketYmlSync } from './config.mts'
import { createEnum } from './objects.mts'
import { idToPurl } from './spec.mts'

import type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert
} from './alert/artifact.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export const ALERT_SEVERITY_COLOR = createEnum({
  critical: 'magenta',
  high: 'red',
  middle: 'yellow',
  low: 'white'
})

export const ALERT_SEVERITY_ORDER = createEnum({
  critical: 0,
  high: 1,
  middle: 2,
  low: 3,
  none: 4
})

export type SocketPackageAlert = {
  name: string
  version: string
  key: string
  type: string
  blocked: boolean
  critical: boolean
  fixable: boolean
  raw: CompactSocketArtifactAlert
  upgradable: boolean
}

export type AlertsByPkgId = Map<string, SocketPackageAlert[]>

const { CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER, NPM } = constants

const MIN_ABOVE_THE_FOLD_COUNT = 3

const MIN_ABOVE_THE_FOLD_ALERT_COUNT = 1

const format = new ColorOrMarkdown(false)

function alertsHaveBlocked(alerts: SocketPackageAlert[]): boolean {
  return alerts.find(a => a.blocked) !== undefined
}

function alertsHaveSeverity(
  alerts: SocketPackageAlert[],
  severity: `${keyof typeof ALERT_SEVERITY}`
): boolean {
  return alerts.find(a => a.raw.severity === severity) !== undefined
}

function alertSeverityComparator(
  a: SocketPackageAlert,
  b: SocketPackageAlert
): number {
  return getAlertSeverityOrder(a) - getAlertSeverityOrder(b)
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

function getAlertsSeverityOrder(alerts: SocketPackageAlert[]): number {
  return alertsHaveBlocked(alerts) ||
    alertsHaveSeverity(alerts, ALERT_SEVERITY.critical)
    ? 0
    : alertsHaveSeverity(alerts, ALERT_SEVERITY.high)
      ? 1
      : alertsHaveSeverity(alerts, ALERT_SEVERITY.middle)
        ? 2
        : alertsHaveSeverity(alerts, ALERT_SEVERITY.low)
          ? 3
          : 4
}

export type RiskCounts = {
  critical: number
  high: number
  middle: number
  low: number
}

function getHiddenRiskCounts(hiddenAlerts: SocketPackageAlert[]): RiskCounts {
  const riskCounts = {
    critical: 0,
    high: 0,
    middle: 0,
    low: 0
  }
  for (const alert of hiddenAlerts) {
    switch (getAlertSeverityOrder(alert)) {
      case ALERT_SEVERITY_ORDER.critical:
        riskCounts.critical += 1
        break
      case ALERT_SEVERITY_ORDER.high:
        riskCounts.high += 1
        break
      case ALERT_SEVERITY_ORDER.middle:
        riskCounts.middle += 1
        break
      case ALERT_SEVERITY_ORDER.low:
        riskCounts.low += 1
        break
    }
  }
  return riskCounts
}

function getHiddenRisksDescription(riskCounts: RiskCounts): string {
  const descriptions: string[] = []
  if (riskCounts.critical) {
    descriptions.push(`${riskCounts.critical} ${getSeverityLabel('critical')}`)
  }
  if (riskCounts.high) {
    descriptions.push(`${riskCounts.high} ${getSeverityLabel('high')}`)
  }
  if (riskCounts.middle) {
    descriptions.push(`${riskCounts.middle} ${getSeverityLabel('middle')}`)
  }
  if (riskCounts.low) {
    descriptions.push(`${riskCounts.low} ${getSeverityLabel('low')}`)
  }
  return `(${descriptions.join('; ')})`
}

function getSeverityLabel(severity: `${keyof typeof ALERT_SEVERITY}`): string {
  return severity === 'middle' ? 'moderate' : severity
}

export type AlertIncludeFilter = {
  actions?: ALERT_ACTION[] | undefined
  blocked?: boolean | undefined
  critical?: boolean | undefined
  cve?: boolean | undefined
  existing?: boolean | undefined
  unfixable?: boolean | undefined
  upgradable?: boolean | undefined
}

export type AddSocketArtifactAlertToAlertsMapOptions = {
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
    actions: undefined,
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ..._include
  } as AlertIncludeFilter

  const name = resolvePackageName(artifact)
  const { version } = artifact
  const pkgId = `${name}@${version}`
  const major = semver.major(version)
  const socketYml = findSocketYmlSync()
  const enabledState = {
    __proto__: null,
    ...socketYml?.parsed.issueRules
  } as Partial<Record<ALERT_TYPE, boolean>>
  let sockPkgAlerts: SocketPackageAlert[] = []
  for (const alert of artifact.alerts) {
    const action = alert.action ?? ''
    const enabledFlag = enabledState[alert.type]
    if (
      (action === 'ignore' && enabledFlag !== true) ||
      enabledFlag === false
    ) {
      continue
    }
    const blocked = action === 'error'
    const critical = alert.severity === ALERT_SEVERITY.critical
    const cve = isArtifactAlertCve(alert)
    const fixType = alert.fix?.type ?? ''
    const fixableCve = fixType === ALERT_FIX_TYPE.cve
    const fixableUpgrade = fixType === ALERT_FIX_TYPE.upgrade
    const fixable = fixableCve || fixableUpgrade
    const upgradable = fixableUpgrade && !hasOwn(overrides, name)
    if (
      (include.blocked && blocked) ||
      (include.critical && critical) ||
      (include.cve && cve) ||
      (include.unfixable && !fixable) ||
      (include.upgradable && upgradable)
    ) {
      sockPkgAlerts.push({
        name,
        version,
        key: alert.key,
        type: alert.type,
        blocked,
        critical,
        fixable,
        raw: alert,
        upgradable
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

export type CveExcludeFilter = {
  upgradable?: boolean | undefined
}

export type CveInfoByAlertKey = Map<
  string,
  {
    firstPatchedVersionIdentifier: string
    vulnerableVersionRange: string
  }
>

export type CveInfoByPkgName = Map<string, CveInfoByAlertKey>

export type GetCveInfoByPackageOptions = {
  exclude?: CveExcludeFilter | undefined
  limit?: number | undefined
}

export function getCveInfoFromAlertsMap(
  alertsMap: AlertsByPkgId,
  options?: GetCveInfoByPackageOptions | undefined
): CveInfoByPkgName | null {
  const { exclude: _exclude, limit = Infinity } = {
    __proto__: null,
    ...options
  } as GetCveInfoByPackageOptions
  const exclude = {
    __proto__: null,
    upgradable: true,
    ..._exclude
  } as CveExcludeFilter

  let count = 0
  let infoByPkgName: CveInfoByPkgName | null = null
  alertsMapLoop: for (const [pkgId, sockPkgAlerts] of alertsMap) {
    const purlObj = PackageURL.fromString(idToPurl(pkgId))
    const name = resolvePackageName(purlObj)
    for (const sockPkgAlert of sockPkgAlerts) {
      const alert = sockPkgAlert.raw
      if (
        alert.fix?.type !== ALERT_FIX_TYPE.cve ||
        (exclude.upgradable && getManifestData(NPM, name))
      ) {
        continue
      }
      if (!infoByPkgName) {
        infoByPkgName = new Map()
      }
      let infos = infoByPkgName.get(name)
      if (!infos) {
        infos = new Map()
        infoByPkgName.set(name, infos)
      }
      const { key } = alert
      if (!infos.has(key)) {
        const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
          alert.props
        try {
          infos.set(key, {
            firstPatchedVersionIdentifier,
            vulnerableVersionRange: new semver.Range(
              // Replace ', ' in a range like '>= 1.0.0, < 1.8.2' with ' ' so that
              // semver.Range will parse it without erroring.
              vulnerableVersionRange.replace(/, +/g, ' ')
            ).format()
          })
          if (++count >= limit) {
            break alertsMapLoop
          }
        } catch (e) {
          debugLog('getCveInfoFromAlertsMap', {
            firstPatchedVersionIdentifier,
            vulnerableVersionRange
          })
          debugLog(e)
        }
      }
    }
  }
  return infoByPkgName
}

export type LogAlertsMapOptions = {
  hideAt?: `${keyof typeof ALERT_SEVERITY}` | 'none' | undefined
  output?: NodeJS.WriteStream | undefined
}

export function logAlertsMap(
  alertsMap: AlertsByPkgId,
  options: LogAlertsMapOptions
) {
  const { hideAt = 'middle', output = process.stderr } = {
    __proto__: null,
    ...options
  } as LogAlertsMapOptions

  const translations = getTranslations()
  const sortedEntries = [...alertsMap.entries()].sort(
    (a, b) => getAlertsSeverityOrder(a[1]) - getAlertsSeverityOrder(b[1])
  )

  const aboveTheFoldPkgIds = new Set<string>()
  const viewableAlertsByPkgId = new Map<string, SocketPackageAlert[]>()
  const hiddenAlertsByPkgId = new Map<string, SocketPackageAlert[]>()

  for (let i = 0, { length } = sortedEntries; i < length; i += 1) {
    const { 0: pkgId, 1: alerts } = sortedEntries[i]!
    const hiddenAlerts: typeof alerts = []
    const viewableAlerts = alerts.filter(a => {
      const keep =
        a.blocked || getAlertSeverityOrder(a) < ALERT_SEVERITY_ORDER[hideAt]
      if (!keep) {
        hiddenAlerts.push(a)
      }
      return keep
    })
    if (hiddenAlerts.length) {
      hiddenAlertsByPkgId.set(pkgId, hiddenAlerts.sort(alertSeverityComparator))
    }
    if (!viewableAlerts.length) {
      continue
    }
    viewableAlerts.sort(alertSeverityComparator)
    viewableAlertsByPkgId.set(pkgId, viewableAlerts)
    if (
      viewableAlerts.find(
        (a: SocketPackageAlert) =>
          a.blocked || getAlertSeverityOrder(a) < ALERT_SEVERITY_ORDER.middle
      )
    ) {
      aboveTheFoldPkgIds.add(pkgId)
    }
  }

  // If MIN_ABOVE_THE_FOLD_COUNT is NOT met add more from viewable pkg ids.
  for (const { 0: pkgId } of viewableAlertsByPkgId.entries()) {
    if (aboveTheFoldPkgIds.size >= MIN_ABOVE_THE_FOLD_COUNT) {
      break
    }
    aboveTheFoldPkgIds.add(pkgId)
  }
  // If MIN_ABOVE_THE_FOLD_COUNT is STILL NOT met add more from hidden pkg ids.
  for (const { 0: pkgId, 1: hiddenAlerts } of hiddenAlertsByPkgId.entries()) {
    if (aboveTheFoldPkgIds.size >= MIN_ABOVE_THE_FOLD_COUNT) {
      break
    }
    aboveTheFoldPkgIds.add(pkgId)
    const viewableAlerts = viewableAlertsByPkgId.get(pkgId) ?? []
    if (viewableAlerts.length < MIN_ABOVE_THE_FOLD_ALERT_COUNT) {
      const neededCount = MIN_ABOVE_THE_FOLD_ALERT_COUNT - viewableAlerts.length
      let removedHiddenAlerts: SocketPackageAlert[] | undefined
      if (hiddenAlerts.length - neededCount > 0) {
        removedHiddenAlerts = hiddenAlerts.splice(
          0,
          MIN_ABOVE_THE_FOLD_ALERT_COUNT
        )
      } else {
        removedHiddenAlerts = hiddenAlerts
        hiddenAlertsByPkgId.delete(pkgId)
      }
      viewableAlertsByPkgId.set(pkgId, [
        ...viewableAlerts,
        ...removedHiddenAlerts
      ])
    }
  }

  const mentionedPkgIdsWithHiddenAlerts = new Set<string>()
  for (
    let i = 0,
      prevAboveTheFold = true,
      entries = [...viewableAlertsByPkgId.entries()],
      { length } = entries;
    i < length;
    i += 1
  ) {
    const { 0: pkgId, 1: alerts } = entries[i]!
    const lines = new Set<string>()
    for (const alert of alerts) {
      const { type } = alert
      const severity = alert.raw.severity ?? ''
      const attributes = [
        ...(severity
          ? [colors[ALERT_SEVERITY_COLOR[severity]](getSeverityLabel(severity))]
          : []),
        ...(alert.blocked ? [colors.bold(colors.red('blocked'))] : []),
        ...(alert.fixable ? ['fixable'] : [])
      ]
      const maybeAttributes = attributes.length
        ? ` ${colors.italic(`(${attributes.join('; ')})`)}`
        : ''
      // Based data from { pageProps: { alertTypes } } of:
      // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
      const info = (translations.alerts as any)[type]
      const title = info?.title ?? type
      const maybeDesc = info?.description ? ` - ${info.description}` : ''
      const content = `${title}${maybeAttributes}${maybeDesc}`
      // TODO: emoji seems to mis-align terminals sometimes
      lines.add(`  ${content}`)
    }
    const purlObj = PackageURL.fromString(idToPurl(pkgId))
    const hyperlink = format.hyperlink(
      pkgId,
      getSocketDevPackageOverviewUrl(
        NPM,
        resolvePackageName(purlObj),
        purlObj.version
      )
    )
    const isAboveTheFold = aboveTheFoldPkgIds.has(pkgId)
    if (isAboveTheFold) {
      aboveTheFoldPkgIds.add(pkgId)
      output.write(`${i ? '\n' : ''}${hyperlink}:\n`)
    } else {
      output.write(`${prevAboveTheFold ? '\n' : ''}${hyperlink}:\n`)
    }
    for (const line of lines) {
      output.write(`${line}\n`)
    }
    const hiddenAlerts = hiddenAlertsByPkgId.get(pkgId) ?? []
    const { length: hiddenAlertsCount } = hiddenAlerts
    if (hiddenAlertsCount) {
      mentionedPkgIdsWithHiddenAlerts.add(pkgId)
      if (hiddenAlertsCount === 1) {
        output.write(
          `  ${colors.dim(`+1 Hidden ${getSeverityLabel(hiddenAlerts[0]!.raw.severity ?? 'low')} risk alert`)}\n`
        )
      } else {
        output.write(
          `  ${colors.dim(`+${hiddenAlertsCount} Hidden alerts ${colors.italic(getHiddenRisksDescription(getHiddenRiskCounts(hiddenAlerts)))}`)}\n`
        )
      }
    }
    prevAboveTheFold = isAboveTheFold
  }

  const additionalHiddenCount =
    hiddenAlertsByPkgId.size - mentionedPkgIdsWithHiddenAlerts.size
  if (additionalHiddenCount) {
    const totalRiskCounts = {
      critical: 0,
      high: 0,
      middle: 0,
      low: 0
    }
    for (const { 0: pkgId, 1: alerts } of hiddenAlertsByPkgId.entries()) {
      if (mentionedPkgIdsWithHiddenAlerts.has(pkgId)) {
        continue
      }
      const riskCounts = getHiddenRiskCounts(alerts)
      totalRiskCounts.critical += riskCounts.critical
      totalRiskCounts.high += riskCounts.high
      totalRiskCounts.middle += riskCounts.middle
      totalRiskCounts.low += riskCounts.low
    }
    output.write(
      `${aboveTheFoldPkgIds.size ? '\n' : ''}${colors.dim(`${aboveTheFoldPkgIds.size ? '+' : ''}${additionalHiddenCount} Packages with hidden alerts ${colors.italic(getHiddenRisksDescription(totalRiskCounts))}`)}\n`
    )
  }
  output.write('\n')
}
