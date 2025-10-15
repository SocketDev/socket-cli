/** @fileoverview Centralized error and info messages for Socket CLI. Provides consistent message templates for common operations and error scenarios. */

/**
 * Authentication and authorization messages
 */
export const AUTH_MESSAGES = {
  NO_TOKEN: 'This command requires a Socket API token for access',
  INVALID_TOKEN: 'Invalid API token',
  UNAUTHORIZED: 'Unauthorized',
  INSUFFICIENT_PERMISSIONS: 'Insufficient permissions',
  FORBIDDEN: 'User does not have access',
}

/**
 * Input validation messages
 */
export const INPUT_MESSAGES = {
  NO_ORG_SLUG: 'Unable to determine organization slug',
  NO_REPO_NAME: 'Missing repository name in command',
  NO_PACKAGE: 'Expecting at least one package',
  INVALID_TIME_FILTER: 'The time filter must either be 7, 30 or 90',
  INVALID_FORMAT: 'The json and markdown flags cannot be both set, pick one',
  MISSING_PARAM: (param: string) => `Missing required parameter: ${param}`,
  INVALID_PARAM: (param: string, reason?: string) =>
    `Invalid ${param}${reason ? `: ${reason}` : ''}`,
}

/**
 * SDK and API operation messages
 */
export const SDK_MESSAGES = {
  SETUP_FAILED: 'Failed to setup SDK',
  MISSING_CONFIG: 'Invalid configuration',
  API_ERROR: 'API request failed',
  NETWORK_ERROR: 'Network error',
  CONNECTION_TIMEOUT: 'Connection timeout',
}

/**
 * Resource operation messages
 */
export const RESOURCE_MESSAGES = {
  NOT_FOUND: (resource: string) => `${resource} not found`,
  ALREADY_EXISTS: (resource: string) => `${resource} already exists`,
  CREATED: (resource: string) => `${resource} created successfully`,
  UPDATED: (resource: string) => `${resource} updated successfully`,
  DELETED: (resource: string) => `${resource} deleted successfully`,
  FAILED_TO_CREATE: (resource: string) => `Failed to create ${resource}`,
  FAILED_TO_UPDATE: (resource: string) => `Failed to update ${resource}`,
  FAILED_TO_DELETE: (resource: string) => `Failed to delete ${resource}`,
  FAILED_TO_FETCH: (resource: string) => `Failed to fetch ${resource}`,
}

/**
 * Repository-specific messages
 */
export const REPO_MESSAGES = {
  NO_REPOS_FOUND: 'No repositories found',
  REPO_NOT_FOUND: 'Repository not found',
  REPO_CREATED: (name: string) => `Repository \`${name}\` created successfully`,
  REPO_UPDATED: (name: string) => `Repository \`${name}\` updated successfully`,
  REPO_DELETED: (name: string) => `Repository \`${name}\` deleted successfully`,
}

/**
 * Scan-specific messages
 */
export const SCAN_MESSAGES = {
  NO_SCANS_FOUND: 'No scans found',
  SCAN_NOT_FOUND: 'Scan not found',
  SCAN_CREATED: (id: string) => `Scan \`${id}\` created successfully`,
  SCAN_DELETED: (id: string) => `Scan \`${id}\` deleted successfully`,
  SCAN_IN_PROGRESS: 'Scan in progress',
  SCAN_COMPLETE: 'Scan complete',
}

/**
 * Package-specific messages
 */
export const PACKAGE_MESSAGES = {
  NO_PACKAGE_FOUND: 'Package not found',
  NO_GHSA_FOUND: 'No GHSAs found',
  NO_CVE_FOUND: 'CVE not found',
  INVALID_PURL: 'Invalid package URL (purl)',
  INVALID_GHSA: (ghsa: string) => `Invalid GHSA format: ${ghsa}`,
  INVALID_CVE: (cve: string) => `Invalid CVE format: ${cve}`,
  NO_CAPABILITIES: 'No capabilities were found in the package.',
  MISSING_RESPONSE: (purl: string) =>
    `No response or non-canonical purl: ${purl}`,
}

/**
 * Organization-specific messages
 */
export const ORG_MESSAGES = {
  NO_ORGS_FOUND: 'No organizations found',
  ORG_NOT_FOUND: 'Organization not found',
  DATA_NOT_AVAILABLE: (scope: 'org' | 'repo') =>
    `The analytics data for this ${scope === 'org' ? 'organization' : 'repository'} is not yet available.`,
}

/**
 * File operation messages
 */
export const FILE_MESSAGES = {
  FILE_NOT_FOUND: (path: string) => `File not found: ${path}`,
  FILE_READ_ERROR: (path: string) => `Failed to read file: ${path}`,
  FILE_WRITE_ERROR: (path: string) => `Failed to write file: ${path}`,
  FILE_WRITE_FAILURE: 'File Write Failure',
  DIRECTORY_NOT_FOUND: (path: string) => `Directory not found: ${path}`,
  NO_SOCKET_DIR: 'No .socket directory found',
}

/**
 * Configuration messages
 */
export const CONFIG_MESSAGES = {
  UNSUPPORTED_OPERATION: 'Unsupported',
  MISSING_ENV_VAR: (vars: string) => `Missing environment variables: ${vars}`,
  INVALID_CONFIG: 'Invalid configuration',
  CONFIG_UPDATED: 'Configuration updated',
  SOURCE_NOT_FOUND: 'Source not found.',
}

/**
 * General operation messages
 */
export const GENERAL_MESSAGES = {
  SUCCESS: 'OK',
  OPERATION_FAILED: (operation: string) => `Failed to ${operation}`,
  OPERATION_SUCCESS: (operation: string) => `Successfully ${operation}`,
  LEGACY_FLAGS_DEPRECATED: (guideUrl: string) =>
    `Legacy flags are no longer supported. See the ${guideUrl}.`,
}

/**
 * Validation helpers
 */
export const VALIDATION_MESSAGES = {
  ENUM_INVALID: (name: string, options: string[]) =>
    `${name} must be one of: ${options.join(', ')}`,
  STRING_REQUIRED: (name: string) => `${name} is required`,
  STRING_EMPTY: (name: string) => `${name} cannot be empty`,
  NUMBER_INVALID: (name: string) => `${name} must be a number`,
  NUMBER_OUT_OF_RANGE: (name: string, min: number, max: number) =>
    `${name} must be between ${min} and ${max}`,
}
