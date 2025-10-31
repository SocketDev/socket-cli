# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.6](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.6) - 2025-10-31

### Fixed
- Shadow npm spawn mechanism now properly uses spawnNode abstraction for SEA binary compatibility
- IPC handshake structure for shadow npm processes with correct parent_pid and subprocess fields

## [2.0.5](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.5) - 2025-10-30

### Fixed
- Bootstrap bundle now executes correctly with esbuild minification fix

## [2.0.4](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.4) - 2025-10-30

### Fixed
- Provenance workflow now pins latest socketbin package versions instead of placeholder versions

## [2.0.3](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.3) - 2025-10-30

### Fixed
- Stub binary now correctly locates the `socket` executable in @socketsecurity/cli package

## [2.0.2](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.2) - 2025-10-30

### Changed
- Updated @socketsecurity/lib to v2.9.0 with Socket.dev URL constants
- Updated @socketsecurity/sdk to v3.0.21

### Fixed
- Bootstrap path resolution in binary builders

## [2.0.1](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.1) - 2025-10-30

### Changed
- Updated dependencies for improved stability

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
