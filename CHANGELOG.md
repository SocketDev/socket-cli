# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.1](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.1) - 2025-10-30

### Changed
- Updated @socketsecurity/lib to v2.9.0 with Socket.dev URL constants and enhanced error messages
- Updated @socketsecurity/sdk to v3.0.20
- Normalized lock behavior across codebase
- Fixed stub lookup path

## [2.0.0](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.0) - 2025-10-29

### Changed
- **BREAKING**: CLI now ships as single executable binary requiring no external Node.js installation

### Added
- GitLab merge request support for `socket fix`
- Persistent GHSA tracking to avoid duplicate fixes
- Markdown output support for `socket fix` and `socket optimize`
- `--reach-min-severity` flag to filter reachability analysis by vulnerability severity threshold

### Fixed
- Target directory handling in reachability analysis for scan commands

## [1.1.25](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.25) - 2025-10-10

### Added
- `--no-major-updates` flag
- `--show-affected-direct-dependencies` flag

### Fixed
- Provenance handling

## [1.1.24](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.24) - 2025-10-10

### Added
- `--minimum-release-age` flag for `socket fix`
- SOCKET_CLI_COANA_LOCAL_PATH environment variable

### Fixed
- Organization capabilities detection
- Enterprise plan filtering

## [1.1.23](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.23) - 2025-09-22

### Changed
- Renamed `--dont-apply-fixes` to `--no-apply-fixes` (old flag remains as alias)
- pnpm dlx operations no longer use `--ignore-scripts`

### Fixed
- Error handling in optimize command for pnpm

## [1.1.22](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.22) - 2025-09-20

### Changed
- Renamed `--only-compute` to `--dont-apply-fixes` for `socket fix` (old flag remains as alias)

### Fixed
- Interactive prompts in `socket optimize` with pnpm
- Git repository name sanitization

## [1.1.21](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.21) - 2025-09-20

### Added
- `--compact-header` flag

### Fixed
- Error handling in `socket optimize`

## [1.1.20](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.20) - 2025-09-19

### Added
- Terminal link support

### Fixed
- Windows package manager execution

## [1.1.13](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.13) - 2025-09-16

### Added
- `--output-file` flag for `socket fix`
- `--only-compute` flag for `socket fix`

## [1.1.9](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.9) - 2025-09-11

### Added
- `socket fix --id` now accepts CVE IDs and PURLs

### Fixed
- SOCKET_CLI_API_TIMEOUT environment variable lookup

## [1.1.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.7) - 2025-09-11

### Added
- `--no-spinner` flag

### Fixed
- Proxy support

## [1.1.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.4) - 2025-09-09

### Added
- `--report-level` flag for scan output control

## [1.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.1) - 2025-09-04

### Removed
- Legacy `--test` and `--test-script` flags from `socket fix`

## [1.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.0) - 2025-09-03

### Added
- Package versions in `socket npm` security reports

## [1.0.111](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.111) - 2025-09-03

### Added
- `--range-style` flag for `socket fix`

## [1.0.106](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.106) - 2025-09-02

### Added
- `--reach-skip-cache` flag

## [1.0.89](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.89) - 2025-08-15

### Added
- `socket scan create --reach` for manifest scanning

## [1.0.85](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.85) - 2025-08-01

### Added
- SOCKET_CLI_NPM_PATH environment variable

## [1.0.82](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.82) - 2025-07-30

### Added
- `--max-old-space-size` and `--max-semi-space-size` flags

## [1.0.73](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.73) - 2025-07-14

### Added
- Automatic `.socket.facts.json` detection

## [1.0.69](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.69) - 2025-07-10

### Added
- `--no-pr-check` flag for `socket fix`

## [1.0.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.0) - 2025-06-13

### Added
- Official v1.0.0 release
- Added `socket org deps` alias command

### Changed
- Moved dependencies command to a subcommand of organization
- Improved UX for threat-feed and audit-logs
- Removed Node 18 deprecation warnings
- Removed v1 preparation flags

## [0.15.64](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.64) - 2025-06-13

### Fixed
- Improved `socket fix` error handling when server rejects request

### Changed
- Final pre-v1.0.0 stability improvements

## [0.15.63](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.63) - 2025-06-12

### Added
- Enhanced debugging capabilities

## [0.15.62](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.62) - 2025-06-12

### Fixed
- Avoided double installing during `socket fix` operations

## [0.15.61](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.61) - 2025-06-11

### Fixed
- Memory management for `socket fix` with packument cache clearing

## [0.15.60](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.60) - 2025-06-10

### Changed
- Widened Node.js test matrix
- Removed Node 18 support due to native-ts compatibility

## [0.15.59](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.59) - 2025-06-09

### Changed
- Reduced Node version restrictions on CLI

## [0.15.57](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.57) - 2025-06-06

### Added
- Added `socket threat-feed` search flags

## [0.15.56](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.56) - 2025-05-07

### Added
- `socket manifest setup` for project configuration
- Enhanced debugging output and error handling

## [0.15.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.0) - 2025-05-07

### Added
- Enhanced `socket threat-feed` with new API endpoints
- `socket.json` configuration support
- Improved `socket fix` error handling

### Fixed
- Avoid double installing with `socket fix`
- CI/CD improvements reducing GitHub Action dependencies for `socket fix`

## [0.14.155](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.155) - 2025-05-07

### Added
- `SOCKET_CLI_API_BASE_URL` for base URL configuration
- `DISABLE_GITHUB_CACHE` environment variable
- `cdxgen` lifecycle logging and documentation hyperlinks

### Fixed
- Set `exitCode=1` when login steps fail
- Fixed Socket package URLs
- Band-aid fix for `socket analytics`
- Improved handling of non-SDK API calls

### Changed
- Enhanced JSON-safe API handling
- Updated `cdxgen` flags and configuration

## [0.14.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.0) - 2024-10-10

### Added
- `socket optimize` to apply Socket registry overrides
- Suggestion flows to `socket scan create`
- JSON/markdown output support for `socket repos list`
- Enhanced organization command with `--json` and `--markdown` flags
- `SOCKET_CLI_NO_API_TOKEN` environment variable support
- Improved test snapshot updating

### Fixed
- Spinner management in report flow and after API errors
- API error handling for non-SDK calls
- Package URL corrections

### Changed
- Added Node permissions for shadow-bin

## [0.13.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.13.0) - 2024-09-06

### Added
- `socket threat-feed` for security threat information

## [0.12.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.12.0) - 2024-08-30

### Added
- Diff Scan command for comparing scan results
- Analytics enhancements and data visualization
- Feature to save analytics data to local files

## [0.11.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.11.0) - 2024-08-05

### Added
- Organization listing capability

## [0.10.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.10.0) - 2024-07-17

### Added
- Analytics command with graphical data visualization
- Interactive charts and graphs

## [0.9.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.9.0) - 2023-12-01

### Added
- Automatic latest version fetching for `socket info`
- Package scoring integration
- Human-readable issue rendering with clickable links
- Enhanced package analysis with scores

### Changed
- Smart defaults for package version resolution
- Improved issue visualization and reporting

## [0.8.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.8.0) - 2023-08-10

### Added
- Configuration-based warnings from settings
- Enhanced `socket npm` installation safety checks

### Changed
- Dropped Node 14 support (EOL April 2023)
- Added Node 16 manual testing due to c8 segfault issues

## [0.7.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.7.1) - 2023-06-13

### Added
- Python report creation capabilities
- CLI login/logout functionality

### Fixed
- Lockfile handling to ensure saves on `socket npm install`
- Report creation issues
- Python uploads via CLI

### Changed
- Switched to base64 encoding for certain operations

## [0.6.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.6.0) - 2023-04-11

### Added
- Enhanced update notifier for npm wrapper
- TTY IPC to mitigate sub-shell prompts

## [0.5.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.5.0) - 2023-03-16

### Added
- npm/npx wrapper commands (`socket npm`, `socket npx`)
- npm provenance and publish action support

### Changed
- Reusable consistent flags across commands

## [0.4.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.4.0) - 2023-01-20

### Added
- Persistent authentication - CLI remembers API key for full duration
- Comprehensive TypeScript integration and type checks
- Enhanced development tooling and dependencies

## [0.3.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.3.0) - 2022-12-13

### Added
- Support for globbed input and ignores for package scanning
- `--strict` and `--all` flags to commands
- Configuration support using `@socketsecurity/config`

### Changed
- Improved error handling and messaging
- Stricter TypeScript configuration

### Fixed
- Improved tests

## [0.2.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.1) - 2022-11-23

### Added
- Update notifier to inform users of new CLI versions

## [0.2.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.0) - 2022-11-23

### Added
- New `socket report view` for viewing existing reports
- `--view` flag to `report create` for immediate viewing
- Enhanced report creation and viewing capabilities

### Changed
- Synced up report create command with report view functionality
- Synced up info command with report view
- Improved examples in `--help` output

### Fixed
- Updated documentation and README with new features

## [0.1.2](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.2) - 2022-11-17

### Added
- Node 19 testing support

### Changed
- Improved documentation

## [0.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.1) - 2022-11-07

### Changed
- Extended README documentation

### Fixed
- Removed accidental debug code

## [0.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.0) - 2022-11-07

### Added
- Initial Socket CLI release
- `socket info` for package security information
- `socket report create` for generating security reports
- Basic CLI infrastructure and configuration
