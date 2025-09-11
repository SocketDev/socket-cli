# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.8](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.8) - 2025-09-04

### Changed
- Made insufficient permissions errors more helpful

## [1.1.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.7) - 2025-09-11

### Added
- Control spinner display with new `--no-spinner` flag

### Fixed
- Configurable proxy handling for requests

## [1.1.6](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.6) - 2025-09-10

### Fixed
- GraphQL cache handling for PR operations

## [1.1.5](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.5) - 2025-09-10

### Fixed
- Fixed reachability analysis spinner behavior in certain scenarios
- Improved `--cwd` current working directory override handling

## [1.1.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.4) - 2025-09-09

### Added
- Track release changes with CHANGELOG.md
- Enhanced development workflow with contributor guidance
- Control scan output detail with `--report-level` flag

## [1.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.1) - 2025-09-04

### Changed
- Faster command completion with improved tab functionality
- Smoother user experience with better loading indicators

### Removed
- Removed legacy `--test` and `--test-script` flags from `socket fix`
- Continued cleanup of legacy `socket fix` code

## [1.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.0) - 2025-09-03

### Added
- See package versions directly in `socket npm` security reports

### Changed
- Clearer feedback for repeat `socket npm` installations
- More reliable handling of scan timeouts
- Streamlined repeat installs by hiding redundant audit info

### Fixed
- More reliable file system operations
- Better configuration value handling

### Removed
- Cleaned up legacy `socket fix` code

## [1.0.111](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.111) - 2025-09-03

### Added
- Reimplemented `--range-style` flag for `socket fix`

### Fixed
- Fixed reachability analysis and `socket fix` in CI environments

## [1.0.110](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.110) - 2025-09-03

### Changed
- Enhanced reachability analysis and `socket fix` for better output handling

## [1.0.109](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.109) - 2025-09-03

### Changed
- Avoid setting `NODE_ENV` when built

## [1.0.108](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.108) - 2025-09-03

### Changed
- Made shadow bin runs more silent

## [1.0.107](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.107) - 2025-09-02

### Fixed
- Fixed build regression

## [1.0.106](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.106) - 2025-09-02

### Added
- Added `--reach-skip-cache` flag to disable reachability analysis configuration caching

## [1.0.104](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.104) - 2025-08-29

### Fixed
- Improved GHSA resolving functionality

## [1.0.103](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.103) - 2025-08-29

### Fixed
- Fixed GHSA resolving issues

## [1.0.102](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.102) - 2025-08-29

### Fixed
- Fixed `cmdFlagValueToArray` function

## [1.0.100](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.100) - 2025-08-29

### Added
- Added more debug information for GHSA details

## [1.0.96](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.96) - 2025-08-27

### Changed
- Improved `--org` flag usage with reachability analysis

## [1.0.89](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.89) - 2025-08-15

### Added
- Added support for uploading all manifest files when running `socket scan create --reach`

## [1.0.85](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.85) - 2025-08-01

### Added
- Added support for `SOCKET_CLI_NPM_PATH` environment variable

## [1.0.82](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.82) - 2025-07-30

### Added
- Added support for `--max-old-space-size` and `--max-semi-space-size` flags

## [1.0.80](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.80) - 2025-07-29

### Changed
- Add back logging of local files found in `socket scan create`

## [1.0.73](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.73) - 2025-07-14

### Added
- Added support for finding `.socket.facts.json` files

## [1.0.69](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.69) - 2025-07-10

### Added
- Added `--no-pr-check` flag to `socket fix`

## [1.0.10](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.10) - 2025-06-28

### Changed
- Various improvements and optimizations

## [1.0.9](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.9) - 2025-06-28

### Changed
- Bug fixes and performance improvements

## [1.0.8](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.8) - 2025-06-27

### Changed
- Internal improvements and optimizations

## [1.0.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.7) - 2025-06-25

### Changed
- Code quality improvements

## [1.0.6](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.6) - 2025-06-25

### Changed
- Minor bug fixes and improvements

## [1.0.5](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.5) - 2025-06-25

### Changed
- Performance optimizations

## [1.0.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.4) - 2025-06-25

### Changed
- Bug fixes and stability improvements

## [1.0.3](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.3) - 2025-06-25

### Added
- Load npm config as part of `socket fix`

## [1.0.2](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.2) - 2025-06-25

### Added
- Added spinner to reachability scan

## [1.0.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.1) - 2025-06-24

### Added
- Package manager version logging to info
- Organization persistence when selecting orgs

### Changed
- Made `socket fix` command reuse implementations for better efficiency
- Normalized options passed to `socket fix`
- Improved banner spacing logic
- Enhanced default org feedback and call-to-action

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
