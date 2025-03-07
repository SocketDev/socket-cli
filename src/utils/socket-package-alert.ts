import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import {
  CompactSocketArtifact,
  isArtifactAlertCve,
  isArtifactAlertCveFixable,
  isArtifactAlertUpgrade
} from './alert/artifact'
import { uxLookup } from './alert/rules'
import { SEVERITY } from './alert/severity'
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
  raw: any
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

export async function addArtifactToAlertsMap(
  artifact: CompactSocketArtifact,
  alertsByPkgId: AlertsByPkgId,
  options?: AddSocketArtifactAlertToAlertsMapOptions | undefined
) {
  // Make TypeScript happy.
  if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
    return
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
    const critical = alert.severity === SEVERITY.critical
    const cve = isArtifactAlertCve(alert)
    const fixableCve = isArtifactAlertCveFixable(alert)
    const fixableUpgrade = isArtifactAlertUpgrade(alert)
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
    return
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
      if (isArtifactAlertCveFixable(sockPkgAlert.raw)) {
        const patchedVersion =
          sockPkgAlert.raw.props[
            CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER
          ]
        const patchedMajor = semver.major(patchedVersion)
        const oldHighest = highestForCve.get(patchedMajor)
        const highest = oldHighest?.version ?? '0.0.0'
        if (semver.gt(patchedVersion, highest)) {
          highestForCve.set(patchedMajor, {
            alert: sockPkgAlert,
            version: patchedVersion
          })
        }
      } else if (isArtifactAlertUpgrade(sockPkgAlert.raw)) {
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
  if (!sockPkgAlerts.length) {
    return
  }
  sockPkgAlerts.sort((a, b) => naturalCompare(a.type, b.type))
  alertsByPkgId.set(pkgId, sockPkgAlerts)
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
  for (const [pkgId, alerts] of alertsMap) {
    const purlObj = PackageURL.fromString(`pkg:npm/${pkgId}`)
    const name = resolvePackageName(purlObj)
    for (const alert of alerts) {
      if (
        !isArtifactAlertCveFixable(alert.raw) ||
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
        alert.raw.props
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
  for (const [pkgId, alerts] of alertsMap) {
    const purlObj = PackageURL.fromString(`pkg:npm/${pkgId}`)
    const lines = new Set()
    for (const alert of alerts) {
      const { type } = alert
      const attributes = [
        ...(alert.fixable ? ['fixable'] : []),
        ...(alert.block ? [] : ['non-blocking'])
      ]
      const maybeAttributes = attributes.length
        ? ` (${attributes.join('; ')})`
        : ''
      // Based data from { pageProps: { alertTypes } } of:
      // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
      const info = (translations.alerts as any)[type]
      const title = info?.title ?? type
      const maybeDesc = info?.description ? ` - ${info.description}` : ''
      // TODO: emoji seems to mis-align terminals sometimes
      lines.add(`  ${title}${maybeAttributes}${maybeDesc}`)
    }
    output.write(
      `(socket) ${format.hyperlink(
        pkgId,
        getSocketDevPackageOverviewUrl(
          NPM,
          resolvePackageName(purlObj),
          purlObj.version
        )
      )} contains risks:\n`
    )
    for (const line of lines) {
      output.write(`${line}\n`)
    }
  }
}
