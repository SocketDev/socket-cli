/**
 * @fileoverview Configuration constants and enums for the Socket SDK.
 * Provides default values, HTTP agents, and public policy configurations for API interactions.
 */

import rootPkgJson from '../package.json' with { type: 'json' }
import { createUserAgentFromPkgJson } from './user-agent'

import type { ALERT_ACTION, ALERT_TYPE } from './types'

// Re-export Socket.dev URL constants from @socketsecurity/lib
export {
  SOCKET_API_TOKENS_URL,
  SOCKET_CONTACT_URL,
  SOCKET_DASHBOARD_URL,
} from '@socketsecurity/lib/constants/socket'

export const DEFAULT_USER_AGENT = createUserAgentFromPkgJson(rootPkgJson)

// Default timeout for HTTP requests (30 seconds)
export const DEFAULT_HTTP_TIMEOUT = 30_000

// Default number of retries for failed requests
export const DEFAULT_RETRIES = 3

// Default delay before first retry (milliseconds)
export const DEFAULT_RETRY_DELAY = 1000

// Maximum timeout for HTTP requests (5 minutes)
export const MAX_HTTP_TIMEOUT = 5 * 60 * 1000

// Minimum timeout for HTTP requests (5 seconds)
export const MIN_HTTP_TIMEOUT = 5000

// Maximum response body size (10MB)
export const MAX_RESPONSE_SIZE = 10 * 1024 * 1024

// Maximum response body size for streaming (100MB)
export const MAX_STREAM_SIZE = 100 * 1024 * 1024

// Public blob store URL for patch downloads
export const SOCKET_PUBLIC_BLOB_STORE_URL = 'https://socketusercontent.com'

// https://github.com/sindresorhus/got/blob/v14.4.6/documentation/2-options.md#agent
// Valid HTTP agent names for Got-style agent configuration compatibility.
export const httpAgentNames = new Set(['http', 'https', 'http2'])

// Public security policy.
export const publicPolicy = new Map<ALERT_TYPE, ALERT_ACTION>([
  // error (1):
  ['malware', 'error'],
  // warn (7):
  ['criticalCVE', 'warn'],
  ['didYouMean', 'warn'],
  ['gitDependency', 'warn'],
  ['httpDependency', 'warn'],
  ['licenseSpdxDisj', 'warn'],
  ['obfuscatedFile', 'warn'],
  ['troll', 'warn'],
  // monitor (7):
  ['deprecated', 'monitor'],
  ['mediumCVE', 'monitor'],
  ['mildCVE', 'monitor'],
  ['shrinkwrap', 'monitor'],
  ['telemetry', 'monitor'],
  ['unpopularPackage', 'monitor'],
  ['unstableOwnership', 'monitor'],
  // ignore (85):
  ['ambiguousClassifier', 'ignore'],
  ['badEncoding', 'ignore'],
  ['badSemver', 'ignore'],
  ['badSemverDependency', 'ignore'],
  ['bidi', 'ignore'],
  ['binScriptConfusion', 'ignore'],
  ['chromeContentScript', 'ignore'],
  ['chromeHostPermission', 'ignore'],
  ['chromePermission', 'ignore'],
  ['chromeWildcardHostPermission', 'ignore'],
  ['chronoAnomaly', 'ignore'],
  ['compromisedSSHKey', 'ignore'],
  ['copyleftLicense', 'ignore'],
  ['cve', 'ignore'],
  ['debugAccess', 'ignore'],
  ['deprecatedLicense', 'ignore'],
  ['deprecatedException', 'ignore'],
  ['dynamicRequire', 'ignore'],
  ['emptyPackage', 'ignore'],
  ['envVars', 'ignore'],
  ['explicitlyUnlicensedItem', 'ignore'],
  ['extraneousDependency', 'ignore'],
  ['fileDependency', 'ignore'],
  ['filesystemAccess', 'ignore'],
  ['floatingDependency', 'ignore'],
  ['gitHubDependency', 'ignore'],
  ['gptAnomaly', 'ignore'],
  ['gptDidYouMean', 'ignore'],
  ['gptMalware', 'ignore'],
  ['gptSecurity', 'ignore'],
  ['hasNativeCode', 'ignore'],
  ['highEntropyStrings', 'ignore'],
  ['homoglyphs', 'ignore'],
  ['installScripts', 'ignore'],
  ['invalidPackageJSON', 'ignore'],
  ['invisibleChars', 'ignore'],
  ['licenseChange', 'ignore'],
  ['licenseException', 'ignore'],
  ['longStrings', 'ignore'],
  ['majorRefactor', 'ignore'],
  ['manifestConfusion', 'ignore'],
  ['minifiedFile', 'ignore'],
  ['miscLicenseIssues', 'ignore'],
  ['missingAuthor', 'ignore'],
  ['missingDependency', 'ignore'],
  ['missingLicense', 'ignore'],
  ['missingTarball', 'ignore'],
  ['mixedLicense', 'ignore'],
  ['modifiedException', 'ignore'],
  ['modifiedLicense', 'ignore'],
  ['networkAccess', 'ignore'],
  ['newAuthor', 'ignore'],
  ['noAuthorData', 'ignore'],
  ['noBugTracker', 'ignore'],
  ['noLicenseFound', 'ignore'],
  ['noREADME', 'ignore'],
  ['noRepository', 'ignore'],
  ['noTests', 'ignore'],
  ['noV1', 'ignore'],
  ['noWebsite', 'ignore'],
  ['nonOSILicense', 'ignore'],
  ['nonSPDXLicense', 'ignore'],
  ['nonpermissiveLicense', 'ignore'],
  ['notice', 'ignore'],
  ['obfuscatedRequire', 'ignore'],
  ['peerDependency', 'ignore'],
  ['potentialVulnerability', 'ignore'],
  ['semverAnomaly', 'ignore'],
  ['shellAccess', 'ignore'],
  ['shellScriptOverride', 'ignore'],
  ['socketUpgradeAvailable', 'ignore'],
  ['suspiciousStarActivity', 'ignore'],
  ['suspiciousString', 'ignore'],
  ['trivialPackage', 'ignore'],
  ['typeModuleCompatibility', 'ignore'],
  ['uncaughtOptionalDependency', 'ignore'],
  ['unclearLicense', 'ignore'],
  ['unidentifiedLicense', 'ignore'],
  ['unmaintained', 'ignore'],
  ['unpublished', 'ignore'],
  ['unresolvedRequire', 'ignore'],
  ['unsafeCopyright', 'ignore'],
  ['unusedDependency', 'ignore'],
  ['urlStrings', 'ignore'],
  ['usesEval', 'ignore'],
  ['zeroWidth', 'ignore'],
])
