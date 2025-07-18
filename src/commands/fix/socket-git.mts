import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import { getPurlObject } from '../../utils/purl.mts'
import {
  getPkgFullNameFromPurl,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../utils/socket-url.mts'

import type { SocketArtifact } from '../../utils/alert/artifact.mts'

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

function formatBranchName(name: string): string {
  return name.replace(/[^-a-zA-Z0-9/._-]+/g, '+')
}

export type SocketBranchParser = (
  branch: string,
) => SocketBranchParseResult | null

export type SocketBranchParseResult = {
  fullName: string
  newVersion: string
  type: string
  workspace: string
  version: string
}

export type SocketBranchPatternOptions = {
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export function createSocketBranchParser(
  options?: SocketBranchPatternOptions | undefined,
): SocketBranchParser {
  const pattern = getSocketBranchPattern(options)
  return function parse(branch: string): SocketBranchParseResult | null {
    const match = pattern.exec(branch) as
      | [string, string, string, string, string, string]
      | null
    if (!match) {
      return null
    }
    const {
      1: type,
      2: workspace,
      3: fullName,
      4: version,
      5: newVersion,
    } = match
    return {
      fullName,
      newVersion: semver.coerce(newVersion.replaceAll('+', '.'))?.version,
      type,
      workspace,
      version: semver.coerce(version.replaceAll('+', '.'))?.version,
    } as SocketBranchParseResult
  }
}

export const genericSocketBranchParser = createSocketBranchParser()

export function getSocketBranchFullNameComponent(
  pkgName: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(
    typeof pkgName === 'string' && !pkgName.startsWith('pkg:')
      ? PackageURL.fromString(`pkg:unknown/${pkgName}`)
      : pkgName,
  )
  const branchMaybeNamespace = purlObj.namespace
    ? `${formatBranchName(purlObj.namespace)}--`
    : ''
  return `${branchMaybeNamespace}${formatBranchName(purlObj.name!)}`
}

export function getSocketBranchName(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const branchType = getSocketBranchPurlTypeComponent(purlObj)
  const branchWorkspace = getSocketBranchWorkspaceComponent(workspace)
  const branchFullName = getSocketBranchFullNameComponent(purlObj)
  const branchVersion = getSocketBranchPackageVersionComponent(purlObj.version!)
  const branchNewVersion = formatBranchName(newVersion)
  return `socket/${branchType}/${branchWorkspace}/${branchFullName}_${branchVersion}_${branchNewVersion}`
}

export function getSocketBranchPackageVersionComponent(
  version: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(
    typeof version === 'string' && !version.startsWith('pkg:')
      ? PackageURL.fromString(`pkg:unknown/unknown@${version}`)
      : version,
  )
  return formatBranchName(purlObj.version!)
}

export function getSocketBranchPattern(
  options?: SocketBranchPatternOptions | undefined,
): RegExp {
  const { newVersion, purl, workspace } = {
    __proto__: null,
    ...options,
  } as SocketBranchPatternOptions
  const purlObj = purl ? getPurlObject(purl) : null
  const escType = purlObj ? escapeRegExp(purlObj.type) : '[^/]+'
  const escWorkspace = workspace
    ? `${escapeRegExp(formatBranchName(workspace))}`
    : '.+'
  const escMaybeNamespace = purlObj?.namespace
    ? `${escapeRegExp(formatBranchName(purlObj.namespace))}--`
    : ''
  const escFullName = purlObj
    ? `${escMaybeNamespace}${escapeRegExp(formatBranchName(purlObj.name))}`
    : '[^/_]+'
  const escVersion = purlObj
    ? escapeRegExp(formatBranchName(purlObj.version!))
    : '[^_]+'
  const escNewVersion = newVersion
    ? escapeRegExp(formatBranchName(newVersion))
    : '[^_]+'
  return new RegExp(
    `^socket/(${escType})/(${escWorkspace})/(${escFullName})_(${escVersion})_(${escNewVersion})$`,
  )
}

export function getSocketBranchPurlTypeComponent(
  purl: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(purl)
  return formatBranchName(purlObj.type)
}

export function getSocketBranchWorkspaceComponent(
  workspace: string | undefined,
): string {
  return workspace ? formatBranchName(workspace) : 'root'
}

export function getSocketCommitMessage(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  return `socket: Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
}

export function getSocketPullRequestBody(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  const pkgOverviewUrl = getSocketDevPackageOverviewUrlFromPurl(purlObj)
  return `Bump [${fullName}](${pkgOverviewUrl}) from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}.`
}

export function getSocketPullRequestTitle(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  return `Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
}
