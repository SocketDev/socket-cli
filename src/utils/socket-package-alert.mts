import semver from 'semver'
import colors from 'yoctocolors-cjs'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import { isArtifactAlertCve } from './alert/artifact.mts'
import { ALERT_FIX_TYPE } from './alert/fix.mts'
import { ALERT_SEVERITY } from './alert/severity.mts'
import { ColorOrMarkdown } from './color-or-markdown.mts'
import { findSocketYmlSync } from './config.mts'
import { createEnum } from './objects.mts'
import { getPurlObject } from './purl.mts'
import { getMajor } from './semver.mts'
import { getSocketDevPackageOverviewUrl } from './socket-url.mts'
import { getTranslations } from './translations.mts'

import type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  CveProps,
} from './alert/artifact.mts'
import type { PURL_Type } from './ecosystem.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export const ALERT_SEVERITY_COLOR = createEnum({
  critical: 'magenta',
  high: 'red',
  middle: 'yellow',
  low: 'white',
})

export const ALERT_SEVERITY_ORDER = createEnum({
  critical: 0,
  high: 1,
  middle: 2,
  low: 3,
  none: 4,
})

export type SocketPackageAlert = {
  name: string
  version: string
  key: string
  type: string
  blocked: boolean
  critical: boolean
  ecosystem: PURL_Type
  fixable: boolean
  raw: CompactSocketArtifactAlert
  upgradable: boolean
}

export type AlertsByPurl = Map<string, SocketPackageAlert[]>

const MIN_ABOVE_THE_FOLD_COUNT = 3

const MIN_ABOVE_THE_FOLD_ALERT_COUNT = 1

const format = new ColorOrMarkdown(false)

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
    low: 0,
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

export type AlertIncludeFilter = {
  actions?: ALERT_ACTION[] | undefined
  blocked?: boolean | undefined
  critical?: boolean | undefined
  cve?: boolean | undefined
  existing?: boolean | undefined
  unfixable?: boolean | undefined
  upgradable?: boolean | undefined
}

export type AddArtifactToAlertsMapOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  overrides?: { [key: string]: string } | undefined
  spinner?: Spinner | undefined
}

export async function addArtifactToAlertsMap<T extends AlertsByPurl>(
  artifact: CompactSocketArtifact,
  alertsByPurl: T,
  options?: AddArtifactToAlertsMapOptions | undefined,
): Promise<T> {
  // Make TypeScript happy.
  if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
    return alertsByPurl
  }
  const {
    consolidate = false,
    include: _include,
    overrides,
  } = {
    __proto__: null,
    ...options,
  } as AddArtifactToAlertsMapOptions

  const socketYml = findSocketYmlSync()
  const localRules = socketYml?.parsed.issueRules

  const include = {
    __proto__: null,
    actions: localRules ? undefined : 'error,monitor,warn',
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ..._include,
  } as AlertIncludeFilter

  const name = resolvePackageName(
    artifact as {
      name: string
      namespace?: string | undefined
    },
  )
  const { type: ecosystem, version } = artifact
  const enabledState = {
    __proto__: null,
    ...localRules,
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
        ecosystem,
        fixable,
        raw: alert,
        upgradable,
      })
    }
  }
  if (!sockPkgAlerts.length) {
    return alertsByPurl
  }
  const purl = `pkg:${ecosystem}/${name}@${version}`
  const major = getMajor(version)!
  if (consolidate) {
    type HighestVersionByMajor = Map<
      number,
      { alert: SocketPackageAlert; version: string }
    >
    const highestForCve: HighestVersionByMajor = new Map()
    const highestForUpgrade: HighestVersionByMajor = new Map()
    const unfixableAlerts: SocketPackageAlert[] = []
    for (const sockPkgAlert of sockPkgAlerts) {
      const alert = sockPkgAlert.raw
      const fixType = alert.fix?.type ?? ''
      if (fixType === ALERT_FIX_TYPE.cve) {
        // An alert with alert.fix.type of 'cve' should have a
        // alert.props.firstPatchedVersionIdentifier property value.
        // We're just being cautious.
        const firstPatchedVersionIdentifier = (alert.props as CveProps)
          ?.firstPatchedVersionIdentifier
        const patchedMajor = firstPatchedVersionIdentifier
          ? getMajor(firstPatchedVersionIdentifier)
          : null
        if (typeof patchedMajor === 'number') {
          // Consolidate to the highest "first patched version" by each major
          // version number.
          const highest = highestForCve.get(patchedMajor)?.version ?? '0.0.0'
          if (semver.gt(firstPatchedVersionIdentifier!, highest)) {
            highestForCve.set(patchedMajor, {
              alert: sockPkgAlert,
              version: firstPatchedVersionIdentifier!,
            })
          }
        } else {
          unfixableAlerts.push(sockPkgAlert)
        }
      } else if (fixType === ALERT_FIX_TYPE.upgrade) {
        // For Socket Optimize upgrades we assume the highest version available
        // is compatible. This may change in the future.
        const highest = highestForUpgrade.get(major)?.version ?? '0.0.0'
        if (semver.gt(version, highest)) {
          highestForUpgrade.set(major, { alert: sockPkgAlert, version })
        }
      } else {
        unfixableAlerts.push(sockPkgAlert)
      }
    }
    sockPkgAlerts = [
      // Sort CVE alerts by severity: critical, high, middle, then low.
      ...Array.from(highestForCve.values())
        .map(d => d.alert)
        .sort(alertSeverityComparator),
      ...Array.from(highestForUpgrade.values()).map(d => d.alert),
      ...unfixableAlerts,
    ]
  } else {
    sockPkgAlerts.sort((a, b) => naturalCompare(a.type, b.type))
  }
  if (sockPkgAlerts.length) {
    alertsByPurl.set(purl, sockPkgAlerts)
  }
  return alertsByPurl
}

export function alertsHaveBlocked(alerts: SocketPackageAlert[]): boolean {
  return alerts.find(a => a.blocked) !== undefined
}

export function alertsHaveSeverity(
  alerts: SocketPackageAlert[],
  severity: `${keyof typeof ALERT_SEVERITY}`,
): boolean {
  return alerts.find(a => a.raw.severity === severity) !== undefined
}

export function alertSeverityComparator(
  a: SocketPackageAlert,
  b: SocketPackageAlert,
): number {
  // Put the most severe first.
  return getAlertSeverityOrder(a) - getAlertSeverityOrder(b)
}

export function getAlertSeverityOrder(alert: SocketPackageAlert): number {
  // The more severe, the lower the sort number.
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

export function getAlertsSeverityOrder(alerts: SocketPackageAlert[]): number {
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

export type CveInfoByPartialPurl = Map<string, CveInfoByAlertKey>

export type GetCveInfoByPackageOptions = {
  exclude?: CveExcludeFilter | undefined
}

export function getCveInfoFromAlertsMap(
  alertsMap: AlertsByPurl,
  options?: GetCveInfoByPackageOptions | undefined,
): CveInfoByPartialPurl | null {
  const { exclude: exclude_ } = {
    __proto__: null,
    ...options,
  } as GetCveInfoByPackageOptions
  const exclude = {
    __proto__: null,
    ...exclude_,
  } as CveExcludeFilter

  let infoByPartialPurl: CveInfoByPartialPurl | null = null
  // eslint-disable-next-line no-unused-labels
  alertsMapLoop: for (const { 0: purl, 1: sockPkgAlerts } of alertsMap) {
    const purlObj = getPurlObject(purl)
    const partialPurl = new PackageURL(
      purlObj.type,
      purlObj.namespace,
      purlObj.name,
    ).toString()
    const name = resolvePackageName(purlObj)
    sockPkgAlertsLoop: for (const sockPkgAlert of sockPkgAlerts) {
      const alert = sockPkgAlert.raw
      if (
        alert.fix?.type !== ALERT_FIX_TYPE.cve ||
        (exclude.upgradable &&
          getManifestData(sockPkgAlert.ecosystem as any, name))
      ) {
        continue sockPkgAlertsLoop
      }
      if (!infoByPartialPurl) {
        infoByPartialPurl = new Map()
      }
      let infos = infoByPartialPurl.get(partialPurl)
      if (!infos) {
        infos = new Map()
        infoByPartialPurl.set(partialPurl, infos)
      }
      const { key } = alert
      if (!infos.has(key)) {
        // An alert with alert.fix.type of 'cve' should have a
        // alert.props.firstPatchedVersionIdentifier property value.
        // We're just being cautious.
        const firstPatchedVersionIdentifier = (alert.props as CveProps)
          ?.firstPatchedVersionIdentifier
        const vulnerableVersionRange = (alert.props as CveProps)
          ?.vulnerableVersionRange
        let error: unknown
        if (firstPatchedVersionIdentifier && vulnerableVersionRange) {
          try {
            infos.set(key, {
              firstPatchedVersionIdentifier,
              vulnerableVersionRange: new semver.Range(
                // Replace ', ' in a range like '>= 1.0.0, < 1.8.2' with ' ' so that
                // semver.Range will parse it without erroring.
                vulnerableVersionRange
                  .replace(/, +/g, ' ')
                  .replace(/; +/g, ' || '),
              ).format(),
            })
            continue sockPkgAlertsLoop
          } catch (e) {
            error = e
          }
        }
        debugFn('error', 'fail: invalid SocketPackageAlert')
        debugDir('inspect', { alert, error })
      }
    }
  }
  return infoByPartialPurl
}

export function getSeverityLabel(
  severity: `${keyof typeof ALERT_SEVERITY}`,
): string {
  return severity === 'middle' ? 'moderate' : severity
}

export type LogAlertsMapOptions = {
  hideAt?: `${keyof typeof ALERT_SEVERITY}` | 'none' | undefined
  output?: NodeJS.WriteStream | undefined
}

export function logAlertsMap(
  alertsMap: AlertsByPurl,
  options: LogAlertsMapOptions,
) {
  const { hideAt = 'middle', output = process.stderr } = {
    __proto__: null,
    ...options,
  } as LogAlertsMapOptions

  const translations = getTranslations()
  const sortedEntries = Array.from(alertsMap.entries()).sort(
    (a, b) => getAlertsSeverityOrder(a[1]) - getAlertsSeverityOrder(b[1]),
  )

  const aboveTheFoldPurls = new Set<string>()
  const viewableAlertsByPurl = new Map<string, SocketPackageAlert[]>()
  const hiddenAlertsByPurl = new Map<string, SocketPackageAlert[]>()

  for (let i = 0, { length } = sortedEntries; i < length; i += 1) {
    const { 0: purl, 1: alerts } = sortedEntries[i]!
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
      hiddenAlertsByPurl.set(purl, hiddenAlerts.sort(alertSeverityComparator))
    }
    if (!viewableAlerts.length) {
      continue
    }
    viewableAlerts.sort(alertSeverityComparator)
    viewableAlertsByPurl.set(purl, viewableAlerts)
    if (
      viewableAlerts.find(
        (a: SocketPackageAlert) =>
          a.blocked || getAlertSeverityOrder(a) < ALERT_SEVERITY_ORDER.middle,
      )
    ) {
      aboveTheFoldPurls.add(purl)
    }
  }

  // If MIN_ABOVE_THE_FOLD_COUNT is NOT met add more from viewable pkg ids.
  for (const { 0: purl } of viewableAlertsByPurl.entries()) {
    if (aboveTheFoldPurls.size >= MIN_ABOVE_THE_FOLD_COUNT) {
      break
    }
    aboveTheFoldPurls.add(purl)
  }
  // If MIN_ABOVE_THE_FOLD_COUNT is STILL NOT met add more from hidden pkg ids.
  for (const { 0: purl, 1: hiddenAlerts } of hiddenAlertsByPurl.entries()) {
    if (aboveTheFoldPurls.size >= MIN_ABOVE_THE_FOLD_COUNT) {
      break
    }
    aboveTheFoldPurls.add(purl)
    const viewableAlerts = viewableAlertsByPurl.get(purl) ?? []
    if (viewableAlerts.length < MIN_ABOVE_THE_FOLD_ALERT_COUNT) {
      const neededCount = MIN_ABOVE_THE_FOLD_ALERT_COUNT - viewableAlerts.length
      let removedHiddenAlerts: SocketPackageAlert[] | undefined
      if (hiddenAlerts.length - neededCount > 0) {
        removedHiddenAlerts = hiddenAlerts.splice(
          0,
          MIN_ABOVE_THE_FOLD_ALERT_COUNT,
        )
      } else {
        removedHiddenAlerts = hiddenAlerts
        hiddenAlertsByPurl.delete(purl)
      }
      viewableAlertsByPurl.set(purl, [
        ...viewableAlerts,
        ...removedHiddenAlerts,
      ])
    }
  }

  const mentionedPurlsWithHiddenAlerts = new Set<string>()
  for (
    let i = 0,
      prevAboveTheFold = true,
      entries = Array.from(viewableAlertsByPurl.entries()),
      { length } = entries;
    i < length;
    i += 1
  ) {
    const { 0: purl, 1: alerts } = entries[i]!
    const lines = new Set<string>()
    for (const alert of alerts) {
      const { type } = alert
      const severity = alert.raw.severity ?? ''
      const attributes = [
        ...(severity
          ? [colors[ALERT_SEVERITY_COLOR[severity]](getSeverityLabel(severity))]
          : []),
        ...(alert.blocked ? [colors.bold(colors.red('blocked'))] : []),
        ...(alert.fixable ? ['fixable'] : []),
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
      // TODO: An added emoji seems to mis-align terminals sometimes.
      lines.add(`  ${content}`)
    }
    const purlObj = getPurlObject(purl)
    const pkgName = resolvePackageName(purlObj)
    const hyperlink = format.hyperlink(
      pkgName,
      getSocketDevPackageOverviewUrl(purlObj.type, pkgName, purlObj.version),
    )
    const isAboveTheFold = aboveTheFoldPurls.has(purl)
    if (isAboveTheFold) {
      aboveTheFoldPurls.add(purl)
      output.write(`${i ? '\n' : ''}${hyperlink}:\n`)
    } else {
      output.write(`${prevAboveTheFold ? '\n' : ''}${hyperlink}:\n`)
    }
    for (const line of lines) {
      output.write(`${line}\n`)
    }
    const hiddenAlerts = hiddenAlertsByPurl.get(purl) ?? []
    const { length: hiddenAlertsCount } = hiddenAlerts
    if (hiddenAlertsCount) {
      mentionedPurlsWithHiddenAlerts.add(purl)
      if (hiddenAlertsCount === 1) {
        output.write(
          `  ${colors.dim(`+1 Hidden ${getSeverityLabel(hiddenAlerts[0]!.raw.severity ?? 'low')} risk alert`)}\n`,
        )
      } else {
        output.write(
          `  ${colors.dim(`+${hiddenAlertsCount} Hidden alerts ${colors.italic(getHiddenRisksDescription(getHiddenRiskCounts(hiddenAlerts)))}`)}\n`,
        )
      }
    }
    prevAboveTheFold = isAboveTheFold
  }

  const additionalHiddenCount =
    hiddenAlertsByPurl.size - mentionedPurlsWithHiddenAlerts.size
  if (additionalHiddenCount) {
    const totalRiskCounts = {
      critical: 0,
      high: 0,
      middle: 0,
      low: 0,
    }
    for (const { 0: purl, 1: alerts } of hiddenAlertsByPurl.entries()) {
      if (mentionedPurlsWithHiddenAlerts.has(purl)) {
        continue
      }
      const riskCounts = getHiddenRiskCounts(alerts)
      totalRiskCounts.critical += riskCounts.critical
      totalRiskCounts.high += riskCounts.high
      totalRiskCounts.middle += riskCounts.middle
      totalRiskCounts.low += riskCounts.low
    }
    output.write(
      `${aboveTheFoldPurls.size ? '\n' : ''}${colors.dim(`${aboveTheFoldPurls.size ? '+' : ''}${additionalHiddenCount} Packages with hidden alerts ${colors.italic(getHiddenRisksDescription(totalRiskCounts))}`)}\n`,
    )
  }
  output.write('\n')
}
