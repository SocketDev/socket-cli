/**
 * @fileoverview Main entry point for the Socket SDK.
 * Provides the SocketSdk class and utility functions for Socket security analysis API interactions.
 */

// Import from our modules.
import { DEFAULT_USER_AGENT, httpAgentNames, publicPolicy } from './constants'
import {
  normalizeBaseUrl,
  promiseWithResolvers,
  queryToSearchParams,
  resolveAbsPaths,
  resolveBasePath,
} from './utils'

// Re-export file upload functions.
export {
  createRequestBodyForFilepaths,
  createRequestBodyForJson,
  createUploadRequest,
} from './file-upload'
// Re-export HTTP client functions.
export {
  createDeleteRequest,
  createGetRequest,
  createRequestWithJson,
  getErrorResponseBody,
  getHttpModule,
  getResponse,
  getResponseJson,
  isResponseOk,
  ResponseError,
  reshapeArtifactForPublicPolicy,
} from './http-client'
// Re-export quota utility functions.
export {
  calculateTotalQuotaCost,
  getAllMethodRequirements,
  getMethodRequirements,
  getMethodsByPermissions,
  getMethodsByQuotaCost,
  getQuotaCost,
  getQuotaUsageSummary,
  getRequiredPermissions,
  hasQuotaForMethods,
} from './quota-utils'
// Re-export the main SocketSdk class.
export { SocketSdk } from './socket-sdk-class'
// Re-export types from modules.
export type {
  ALERT_ACTION,
  ALERT_TYPE,
  Agent,
  ArtifactPatches,
  BatchPackageFetchResultType,
  BatchPackageStreamOptions,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  CreateDependenciesSnapshotOptions,
  CreateOrgFullScanOptions,
  CreateScanFromFilepathsOptions,
  CustomResponseType,
  Entitlement,
  EntitlementsResponse,
  FileValidationCallback,
  FileValidationResult,
  GetOptions,
  GotOptions,
  HeadersRecord,
  PatchFile,
  PatchRecord,
  PatchViewResponse,
  QueryParams,
  RequestOptions,
  SecurityAlert,
  SendMethod,
  SendOptions,
  SocketArtifact,
  SocketArtifactAlert,
  SocketArtifactWithExtras,
  SocketId,
  SocketMetricSchema,
  SocketSdkArrayElement,
  SocketSdkData,
  SocketSdkErrorResult,
  SocketSdkGenericResult,
  SocketSdkOperations,
  SocketSdkOptions,
  SocketSdkResult,
  SocketSdkSuccessResult,
  StreamOrgFullScanOptions,
  UploadManifestFilesError,
  UploadManifestFilesOptions,
  UploadManifestFilesResponse,
  UploadManifestFilesReturnType,
  Vulnerability,
} from './types'
// Re-export strict types for v3 API.
export type {
  CreateFullScanOptions,
  DeleteRepositoryLabelResult,
  DeleteResult,
  FullScanItem,
  FullScanListData,
  FullScanListResult,
  FullScanResult,
  ListFullScansOptions,
  ListRepositoriesOptions,
  OrganizationItem,
  OrganizationsResult,
  RepositoriesListData,
  RepositoriesListResult,
  RepositoryItem,
  RepositoryLabelItem,
  RepositoryLabelResult,
  RepositoryLabelsListData,
  RepositoryLabelsListResult,
  RepositoryResult,
  StreamFullScanOptions,
  StrictErrorResult,
  StrictResult,
} from './types-strict'
// Re-export functions from modules.
export { createUserAgentFromPkgJson } from './user-agent'

// Re-export utility functions.
export {
  normalizeBaseUrl,
  promiseWithResolvers,
  queryToSearchParams,
  resolveAbsPaths,
  resolveBasePath,
}

// Re-export constants.
export { DEFAULT_USER_AGENT, httpAgentNames, publicPolicy }
