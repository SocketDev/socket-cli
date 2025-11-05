# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.1.3](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.1.3) - 2025-11-04

### Fixed

- Updated OpenAPI type generation script to automatically preserve SDK v3 method name aliases during automated syncs

### Changed

- Updated `@socketsecurity/lib` to v3.2.4

## [3.1.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.1.2) - 2025-11-02

### Fixed

- Add type aliases in `operations` interface to map SDK v3 method names to OpenAPI operation names for TypeScript compatibility
- Update `FileValidationCallback` to use `createFullScan` instead of `createOrgFullScan`

## [3.1.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.1.1) - 2025-11-02

### Fixed

- Use standard `.js` extension for CommonJS output instead of `.mjs`
- Remove `"type": "module"` from package.json to properly indicate CommonJS format

## [3.1.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.1.0) - 2025-11-02

### Fixed

- Changed SDK output format from ESM to CJS to resolve Node.js built-in module bundling issues when bundling CJS dependencies into ESM output
- SDK now correctly handles `@socketsecurity/lib` bundling without creating broken `__require()` wrappers that caused "Dynamic require of 'async_hooks' is not supported" errors in isolated environments

## [3.0.31](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.31) - 2025-11-02

### Added

- Bundle dependencies validation to prevent `link:` dependencies in production

### Fixed

- Build process now correctly bundles `@socketsecurity/lib` instead of marking it as external

### Changed

- Updated `@socketsecurity/lib` to v3.1.3
- Updated `@socketregistry/packageurl-js` to v1.3.5

## [3.0.30](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.30) - 2025-11-01

### Added

- Validation guard against `link:` dependencies in package.json
- Pre-commit and pre-push hooks for development workflow

### Fixed

- Build output now uses relative paths instead of absolute paths for better portability

### Changed

- Updated `@socketsecurity/lib` to v3.0.6
- Updated `@socketregistry/packageurl-js` to v1.3.3

## [3.0.29](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.29) - 2025-11-01

### Changed

- Moved `@socketsecurity/lib` and `@socketregistry/packageurl-js` to devDependencies (bundled SDK has no runtime dependencies)

## [3.0.28](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.28) - 2025-11-01

### Changed

- Updated `@socketsecurity/lib` to v3.0.3

## [3.0.27](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.27) - 2025-10-31

### Changed

- Updated `@socketsecurity/lib` to v2.10.4

## [3.0.26](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.26) - 2025-10-31

### Changed

- Updated `@socketsecurity/lib` to v2.10.3

## [3.0.25](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.25) - 2025-10-31

### Changed

- Updated `@socketsecurity/lib` to v2.10.2

## [3.0.24](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.24) - 2025-10-31

### Changed

- Updated `@socketsecurity/lib` to v2.10.1

## [3.0.23](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.23) - 2025-10-30

### Changed

- Updated `@socketsecurity/lib` to v2.10.0

## [3.0.22](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.22) - 2025-10-30

### Changed

- Updated `@socketsecurity/lib` to v2.9.1

## [3.0.21](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.21) - 2025-10-30

### Changed

- Consolidated Socket.dev URL constants (`SOCKET_CONTACT_URL`, `SOCKET_DASHBOARD_URL`, `SOCKET_API_TOKENS_URL`) to use standardized exports from `@socketsecurity/lib` instead of duplicating them locally

## [3.0.20](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.20) - 2025-10-30

### Changed

- Updated `@socketsecurity/lib` to v2.9.0

## [3.0.19](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.19) - 2025-10-30

### Changed

- Updated `@socketsecurity/lib` to v2.8.4

## [3.0.18](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.18) - 2025-10-30

### Changed

- Updated `@socketsecurity/lib` to v2.8.3

## [3.0.17](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.17) - 2025-10-29

### Changed

- Updated `@socketsecurity/lib` to v2.8.2

## [3.0.16](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.16) - 2025-10-29

### Changed

- Updated OpenAPI types with new alert filtering capabilities:
  - Added `github_installation_id` query parameter to diff scan endpoints for GitHub installation-specific settings
  - Added KEV (Known Exploited Vulnerability) filter support (`filters.alertKEV`)
  - Added EPSS (Exploit Prediction Scoring System) severity filter support (`filters.alertEPSS`)
  - Updated aggregation fields to include `alertKEV` and `alertEPSS` options

## [3.0.15](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.15) - 2025-10-29

### Changed

- Updated `@socketsecurity/lib` to v2.8.1

## [3.0.14](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.14) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.7.0

## [3.0.13](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.13) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.6.0

## [3.0.12](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.12) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.5.0

## [3.0.11](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.11) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.4.0

## [3.0.10](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.10) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.3.0

## [3.0.9](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.9) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.2.0

## [3.0.8](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.8) - 2025-10-28

### Changed

- Updated `@socketsecurity/lib` to v2.1.0

## [3.0.7](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.7) - 2025-10-27

### Changed

- Updated `@socketsecurity/lib` to v2.0.0
- Added comprehensive getting started guide

## [3.0.6](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.6) - 2025-10-24

### Fixed

- Externalized `@socketsecurity/lib` dependency to prevent dynamic require errors in bundled applications

### Changed

- Updated `@socketsecurity/lib` to v1.3.3

## [3.0.5](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.5) - 2025-10-24

### Fixed

- Cleanup package.json files entries

## [3.0.4](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.4) - 2025-10-24

### Fixed

- Include `.mjs` files in published npm package to fix import errors

## [3.0.3](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.3) - 2025-10-24

### Fixed

- Updated `@socketsecurity/lib` to v1.3.2 to fix broken v1.3.1 release

## [3.0.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.2) - 2025-10-24

### Fixed

- Upgraded `@socketsecurity/lib` to v1.3.1 to resolve dependency compatibility issue

## [3.0.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.1) - 2025-10-23

### Fixed

- Export `FileValidationCallback` and `FileValidationResult` types for consumers implementing file validation callbacks

## [3.0.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v3.0.0) - 2025-10-23

### ⚠️ BREAKING CHANGES

#### Removed Deprecated Methods

The following methods mapped to deprecated `/report/*` backend endpoints and have been removed:

- **`createScan()`** - Use `createFullScan()` instead
- **`deleteScan()`** - Use `deleteFullScan()` instead
- **`getScan()`** - Use `getFullScan()` instead
- **`listScans()`** - Use `listFullScans()` instead

#### Method Renames (Following REST Conventions)

**Full Scans (Modern API):**
- `getOrgFullScanList()` → `listFullScans()` with `ListFullScansOptions`
- `createOrgFullScan()` → `createFullScan()` with `CreateFullScanOptions`
- `getOrgFullScanBuffered()` → `getFullScan()`
- `deleteOrgFullScan()` → `deleteFullScan()`
- `streamOrgFullScan()` → `streamFullScan()` with `StreamFullScanOptions`
- `getOrgFullScanMetadata()` → `getFullScanMetadata()`

**Organizations:**
- `getOrganizations()` → `listOrganizations()`

**Repositories:**
- `getOrgRepoList()` → `listRepositories()` with `ListRepositoriesOptions`
- `getOrgRepo()` → `getRepository()`
- `createOrgRepo()` → `createRepository()`
- `updateOrgRepo()` → `updateRepository()`
- `deleteOrgRepo()` → `deleteRepository()`

#### Type System Improvements

Strict types now mark guaranteed API fields as required instead of optional, improving IntelliSense autocomplete.

### Added

- **File Validation Callback:** New `onFileValidation` option in `SocketSdkOptions` allows customizing error handling when unreadable files are detected. File-upload methods (`uploadManifestFiles()`, `createFullScan()`, `createDependenciesSnapshot()`) now automatically validate file readability, preventing ENOENT errors from Yarn Berry PnP virtual filesystems and pnpm symlink issues.

### Changed

- File-upload methods automatically skip unreadable files with warnings instead of failing

See [docs/migration-v3.md](./docs/migration-v3.md) and [docs/when-to-use-what.md](./docs/when-to-use-what.md) for migration guidance.

## [2.0.7](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.7) - 2025-10-22

### Changed
- Sync with openapi definition

## [2.0.6](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.6) - 2025-10-22

### Fixed
- TypeScript lint compliance for array type syntax in `SocketSdkArrayElement` type helper

## [2.0.5](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.5) - 2025-10-22

### Added
- `SocketSdkData<T>` type helper for extracting data from SDK operation results
- `SocketSdkArrayElement<T, K>` type helper for extracting array element types from SDK operations

## [2.0.4](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.4) - 2025-10-22

### Added
- Support for `Retry-After` header in rate limit responses (HTTP 429)
  - Automatically respects server-specified retry delays
  - Parses both delay-seconds (numeric) and HTTP-date formats
  - Uses server delay instead of exponential backoff when available

## [2.0.3](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.3) - 2025-10-22

### Fixed
- Improved TypeScript module resolution with explicit type exports instead of wildcard re-exports

## [2.0.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.2) - 2025-10-22

### Fixed
- Ensured expected dist/ files are produced and refined package.json exports

## [2.0.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.1) - 2025-10-21

### Changed
- Use `@socketsecurity/lib` under the hood
- Synced OpenAPI type definitions with latest API specification
  - Added documentation for `scan_type` query parameter on manifest upload endpoint (used for categorizing multiple SBOM heads per repository branch)
  - Improved TypeScript helper types (`OpReturnType`, `OpErrorType`) for better type inference and error handling

## [2.0.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v2.0.0) - 2025-10-10

### Changed
- **BREAKING**: Migrated to ESM-only module format
  - Package is now ESM-only (`"type": "module"` in package.json)
  - All output files use `.mjs` extension for JavaScript
  - TypeScript declaration files use `.d.mts` extension
  - CommonJS (`require()`) is no longer supported
- Simplified build process for ESM-only output
- Updated TypeScript configuration to use ESM module resolution
- Improved code splitting for better tree-shaking with ESM

### Removed
- **BREAKING**: Removed CommonJS support and exports
- Removed CommonJS-specific build configurations

### Migration Guide
To migrate from v1.x to v2.0:
1. Ensure your project supports ESM modules (Node.js 14+ with `"type": "module"` or `.mjs` extensions)
2. Update imports from CommonJS `require()` to ESM `import` statements:
   ```javascript
   // Before (v1.x)
   const { SocketSdk } = require('@socketsecurity/sdk');

   // After (v2.0)
   import { SocketSdk } from '@socketsecurity/sdk';
   ```
3. If your project still requires CommonJS, consider staying on v1.x or using a transpiler

## [1.11.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.11.2) - 2025-10-07

### Fixed
- Fixed typos in requirements.json
- Updated @socketsecurity/registry to fix bugs related to inlined runtime-dependent expressions

## [1.11.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.11.1) - 2025-10-06

### Added
- Performance optimizations with memoization for `normalizeBaseUrl` and quota utility functions
- Performance tracking to HTTP client functions
- Comprehensive error handling tests for SDK methods across organization, scanning, and batch APIs
- Reusable assertion helpers for SDK tests

### Changed
- Improved test coverage and reliability with additional test cases
- Streamlined documentation (README, TESTING.md, QUOTA.md, EXAMPLES.md) for better clarity and discoverability

## [1.11.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.11.0) - 2025-10-04

### Added
- Optional TTL caching for API responses with configurable cache duration
- New `cache` option (default: false) to enable response caching
- New `cacheTtl` option (default: 5 minutes) to customize cache duration

## [1.10.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.10.1) - 2025-10-04

### Added
- Automatic retry with exponential backoff to all HTTP API calls for improved reliability on transient failures

## [1.10.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.10.0) - 2025-10-04

### Added
- Added `PromiseQueue` utility for controlled concurrency in async operations
- HTTP retry logic with exponential backoff for improved reliability on transient failures
- Added option type interfaces: `CreateDependenciesSnapshotOptions`, `CreateOrgFullScanOptions`, `CreateScanFromFilepathsOptions`, `StreamOrgFullScanOptions`, `UploadManifestFilesOptions`

### Changed
- **BREAKING**: Refactored SDK methods to use options objects instead of positional parameters for better API clarity:
  - `createDependenciesSnapshot(filepaths, options)` - replaced `repo` and `branch` positional parameters with options object
  - `createOrgFullScan(orgSlug, filepaths, options)` - replaced positional parameters with options object
  - `createScanFromFilepaths(filepaths, options)` - replaced positional parameters with options object
  - `streamOrgFullScan(orgSlug, fullScanId, options)` - replaced positional parameters with options object
  - `uploadManifestFiles(orgSlug, filepaths, options)` - replaced positional parameters with options object
- Improved type safety by replacing `any` types with `unknown` or `never` where appropriate
- Enhanced code style with numeric separators for better readability of large numbers
- Improved coverage reporting accuracy with c8 ignore comments
- Updated `@socketsecurity/registry` dependency to 1.4.0

### Fixed
- Fixed import assertion syntax for JSON imports to use standard import syntax
- Fixed HTTP retry test mocks to correctly match PUT method requests
- Fixed critical issues in type handling and URL search parameter conversions

## [1.9.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.9.2) - 2025-10-04

### Changed
- Improved TypeScript type definitions - All optional properties now include explicit `| undefined` type annotations for better type narrowing and null safety

## [1.9.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.9.1) - 2025-10-03

### Changed
- Disabled TypeScript declaration map generation to reduce package size

## [1.9.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.9.0) - 2025-10-03

### Changed
- **BREAKING**: Improved `SocketSdkResult` type compatibility - success and error results now have symmetric properties (`data`, `error`, `cause`) with explicit `undefined` types for better TypeScript narrowing
- **BREAKING**: Removed `CResult` type (CLI-specific) in favor of SDK-appropriate `SocketSdkGenericResult` type for `getApi()` and `sendApi()` methods
- Updated `getApi()` and `sendApi()` to use `SocketSdkGenericResult` with consistent HTTP status codes instead of CLI exit codes
- All result types now use `success` discriminant with `status` (HTTP code), `data`, `error`, and `cause` properties on both branches

### Migration Guide
- If using `getApi()` or `sendApi()` with `throws: false`, update from `CResult` to `SocketSdkGenericResult`
- Change `.ok` checks to `.success`
- Change `.code` to `.status` (now contains HTTP status code)
- Change `.message` to `.error`
- Both success and error branches now have all properties - check discriminant first with `if (result.success)`

## [1.8.6](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.6) - 2025-10-02

### Changed
- Reduced package size by excluding source map files (.js.map) from published package

## [1.8.5](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.5) - 2025-10-02

### Changed
- Synced with OpenAPI definition
  - Added new `/openapi.json` endpoint for retrieving API specification in JSON format
  - Updated repo label filter descriptions to document empty string ("") usage for repositories with no labels
  - Added 'dual' threat category type

## [1.8.4](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.4) - 2025-10-01

### Fixed
- Fixed registry constant import paths to use correct casing (SOCKET_PUBLIC_API_TOKEN, UNKNOWN_ERROR)

## [1.8.3](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.3) - 2025-09-30

### Changed
- Synced with OpenAPI definition

## [1.8.2](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.2) - 2025-09-29

### Fixed
- Fixed publishing workflow to ensure dist folder is built before npm publish
- Changed prepublishOnly script to prevent accidental local publishing

## [1.8.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.1) - 2025-09-29

### Changed
- Update test infrastructure and build configuration

## [1.8.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.8.0) - 2025-09-27

### Added
- Quota utility functions for API cost management in `quota-utils.ts`
- New exported functions: `checkQuota`, `formatQuotaReport`, `getEstimatedCost`, `getMethodCost`, `getQuotaSummary`, `isWithinQuota`
- Example files demonstrating quota usage patterns

### Changed
- Improved error handling for quota utilities

## [1.7.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.7.0) - 2025-09-26

### Added
- `getApi` method for raw GET requests with configurable response handling
- `sendApi` method for POST/PUT requests with JSON body support
- `CResult` type pattern for non-throwing API operations
- `CustomResponseType` type export for response type options
- Support for custom response types (`response`, `text`, `json`) in `getApi`
- Enhanced error handling with detailed error context from `error.details` field
- Socket API `error.details` parsing for richer error information
- `getEntitlements` method for retrieving organization entitlements
- `getEnabledEntitlements` method for getting enabled entitlement keys
- `viewPatch` method for retrieving patch details by UUID
- `streamPatchesFromScan` method for streaming patches from scan results
- `Entitlement` and `EntitlementsResponse` types for entitlements API
- `PatchFile`, `Vulnerability`, `SecurityAlert`, `PatchRecord`, `PatchViewResponse`, and `ArtifactPatches` types for patches API
- Support for NDJSON streaming responses in patches API
- Comprehensive test coverage improvements (484 total tests, 99.92% line coverage, 99.39% branch coverage)
- Enhanced error handling tests for JSON parsing edge cases in streaming
- Additional coverage tests for invalid JSON line handling in NDJSON streams

### Changed
- Improved error message formatting and JSON parsing error handling
- Enhanced type safety with better generic constraints
- Renamed option types to `GetOptions` and `SendOptions` for consistency
- Reorganized test files into focused, functionality-based modules
- Raised coverage thresholds to match achieved levels (100% statements, functions, lines)
- Removed duplicate tests while maintaining coverage integrity
- Renamed `getIssuesByNPMPackage` to `getIssuesByNpmPackage` for consistent naming convention
- Improved method alphabetical ordering in source code
- Enhanced test coverage from 99.77% to 99.92% line coverage
- Improved branch coverage from 99.08% to 99.39%

## [1.6.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.6.1) - 2025-09-24

### Changed
- Updated to use trusted publisher for npm package provenance

## [1.6.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.6.0) - 2025-09-24

### Changed
- **BREAKING:** Converted to single CommonJS export type, removing dual ESM/CJS support

## [1.5.1](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.5.1) - 2025-09-24

### Fixed
- Added missing setup-script to provenance workflow

## [1.5.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.5.0) - 2025-09-23

### Added
- `getOrgFullScanBuffered` method for buffered full scan retrieval

### Changed
- **BREAKING:** Renamed `getOrgFullScan` to `streamOrgFullScan` for clarity

### Fixed
- Added missing `getResponseJson` call to `createScanFromFilepaths`
- Improved handling of empty response bodies

## [1.4.93](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.93) - 2025-09-15

### Fixed
- Fixed malformed part header issue for upload of manifest files

## [1.4.91](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.91) - 2025-09-11

### Changed
- Improved URL handling

## [1.4.90](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.90) - 2025-09-11

### Fixed
- Improved error handling

## [1.4.84](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.84) - 2025-09-03

### Added
- Filter alerts by action

### Changed
- Improved JSON parsing

## [1.4.82](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.82) - 2025-09-02

### Changed
- Improved public policy handling

## [1.4.81](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.81) - 2025-09-02

### Added
- Add public security policy support

## [1.4.79](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.79) - 2025-08-27

### Fixed
- Fixed ESM module compatibility

## [1.4.77](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.77) - 2025-08-25

### Added
- Add timeout option for API requests

## [1.4.73](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.73) - 2025-08-08

### Fixed
- Fixed crates ecosystem support

## [1.4.72](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.72) - 2025-08-08

### Fixed
- Fixed rubygems ecosystem support

## [1.4.71](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.71) - 2025-08-08

### Added
- Support for crate and rubygem ecosystems

## [1.4.68](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.68) - 2025-08-02

### Changed
- Improved type definitions
- Memory usage optimizations

## [1.4.66](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.66) - 2025-07-29

### Fixed
- Fixed file upload timing issue
- Fixed multipart form data formatting

## [1.4.64](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.64) - 2025-07-22

### Changed
- Improved method signatures

## [1.4.62](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.62) - 2025-07-21

### Fixed
- Fixed query parameter handling for empty values

## [1.4.61](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.61) - 2025-07-21

### Changed
- Improved query parameter normalization

## [1.4.60](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.60) - 2025-07-21

### Changed
- Renamed result type for clarity

## [1.4.59](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.59) - 2025-07-20

### Added
- Add alias types for improved developer experience

## [1.4.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.4.0) - 2025-05-01

### Added
- Full scans feature support
- Audit log and repos features
- Organization security policy support (getOrgSecurityPolicy)

### Changed
- Improved TypeScript type exports
- Enhanced ESM and CJS dual package support

## [1.3.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.3.0) - 2025-03-01

### Added
- Support for multiple ecosystem types
- Enhanced error handling and reporting

### Changed
- Improved API client architecture
- Better TypeScript type definitions

## [1.2.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.2.0) - 2025-01-15

### Added
- File upload support for manifest files
- Request body creation for file paths

### Changed
- Enhanced multipart form data handling
- Improved streaming support

## [1.1.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.1.0) - 2024-11-01

### Added
- Query parameter normalization
- Enhanced search parameter handling

### Changed
- Improved URL parsing and handling
- Better error messages

## [1.0.0](https://github.com/SocketDev/socket-sdk-js/releases/tag/v1.0.0) - 2024-09-01

### Added
- Initial release of Socket SDK for JavaScript
- Full Socket API client implementation
- TypeScript support with comprehensive type definitions
- Dual ESM/CJS package support
