# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![npm version](https://img.shields.io/npm/v/socket.svg)](https://www.npmjs.com/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)

Command-line interface for Socket.dev supply chain security analysis. Provides security scanning, package manager wrapping, dependency analysis, and CI/CD integration across 11 language ecosystems.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Command Pattern Architecture](#command-pattern-architecture)
  - [Command Organization](#command-organization)
- [Socket Firewall Architecture](#socket-firewall-architecture)
- [Build System](#build-system)
  - [Build Commands](#build-commands)
- [Update Mechanism](#update-mechanism)
- [Utility Modules](#utility-modules)
- [Core Concepts](#core-concepts)
  - [Error Handling](#error-handling)
  - [Output Modes](#output-modes)
  - [Configuration](#configuration)
- [Language Ecosystem Support](#language-ecosystem-support)
- [Testing](#testing)
- [Development Workflow](#development-workflow)
- [Key Statistics](#key-statistics)
- [Performance Features](#performance-features)
- [API Integration](#api-integration)
- [Security Features](#security-features)
- [CI/CD Integration](#cicd-integration)
- [Documentation](#documentation)
- [Module Reference](#module-reference)
  - [Command Modules (src/commands/)](#command-modules-srccommands)
  - [Utility Modules (src/utils/)](#utility-modules-srcutils)
- [Constants (src/constants/)](#constants-srcconstants)
- [Installation](#installation)
- [License](#license)
- [Contributing](#contributing)
- [Support](#support)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Socket CLI                              │
│                                                                 │
│  Entry Points:                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │  socket  │  │socket-npm│  │socket-npx│                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       └─────────────┴─────────────┘                             │
│                     │                                            │
│              ┌──────▼──────┐                                    │
│              │ cli-entry   │ Main entry with error handling     │
│              └──────┬──────┘                                    │
│                     │                                            │
│         ┌───────────▼───────────┐                              │
│         │  meowWithSubcommands  │ Command routing              │
│         └───────────┬───────────┘                              │
│                     │                                            │
│      ┌──────────────┼──────────────┐                           │
│      │              │              │                            │
│  ┌───▼───┐     ┌───▼───┐     ┌───▼────┐                       │
│  │ scan  │     │  npm  │     │ config │  ... 36 commands       │
│  └───┬───┘     └───┬───┘     └───┬────┘                       │
│      │             │             │                              │
│  ┌───▼────┐    ┌───▼────┐    ┌───▼─────┐                      │
│  │ handle │    │  sfw   │    │ getters │  Handlers & business  │
│  └───┬────┘    └───┬────┘    └───┬─────┘  logic               │
│      │             │             │                              │
│  ┌───▼────┐    ┌───▼────┐    ┌───▼─────┐                      │
│  │ output │    │firewall│    │ setters │  Output formatters   │
│  └────────┘    └────────┘    └─────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │                  │                  │
    ┌────▼────┐        ┌────▼────┐       ┌────▼────┐
    │Socket   │        │ Package │       │  Local  │
    │ API/SDK │        │Registries│       │ FS/Git  │
    └─────────┘        └─────────┘       └─────────┘
```

## Command Pattern Architecture

Commands use two patterns based on complexity:

**Complex commands** (with subcommands or >200 lines) use a 3-layer pattern:

```
cmd-{name}.mts       Command definition, flags, CLI interface
     │
     ├─> handle-{name}.mts    Business logic, orchestration
     │        │
     │        ├─> fetch-{name}.mts     API calls (optional)
     │        ├─> validate-{name}.mts  Input validation (optional)
     │        └─> process logic
     │
     └─> output-{name}.mts    Output formatting (JSON/Markdown/Text)

Example: scan create command
├── cmd-scan-create.mts           (CLI flags, help text)
├── handle-create-new-scan.mts    (main logic)
├── fetch-create-org-full-scan.mts (Socket API calls)
└── output-create-new-scan.mts    (format output)
```

**Simple commands** (single purpose, <200 lines) use a consolidated single-file pattern:
- Examples: `whoami`, `logout`, `login`
- All logic in one `cmd-*.mts` file

### Command Organization

```
src/commands/
├── scan/              Security scanning (11 subcommands)
│   ├── cmd-scan-create.mts
│   ├── cmd-scan-report.mts
│   ├── cmd-scan-reach.mts   Reachability analysis
│   └── ... (8 more)
├── organization/      Org management (5 subcommands)
├── npm/              npm wrapper with Socket Firewall
├── npx/              npx wrapper with Socket Firewall
├── raw-npm/          Raw npm passthrough (no firewall)
├── raw-npx/          Raw npx passthrough (no firewall)
├── pnpm/             pnpm wrapper
├── yarn/             yarn wrapper
├── pip/              Python pip wrapper
├── pycli/            Python CLI integration
├── sfw/              Socket Firewall management
├── cargo/            Rust cargo wrapper
├── gem/              Ruby gem wrapper
├── go/               Go module wrapper
├── bundler/          Ruby bundler wrapper
├── nuget/            .NET NuGet wrapper
├── uv/               Python uv wrapper
├── optimize/         Apply Socket registry overrides
├── patch/            Manage custom patches
└── ... (25 more commands)
```

## Socket Firewall Architecture

Package manager wrapping uses Socket Firewall (sfw) for security scanning:

```
┌─────────────────────────────────────────────────────────────┐
│                Socket Firewall (sfw)                        │
│                                                             │
│  User runs: socket npm install express                     │
│                     │                                       │
│              ┌──────▼──────┐                               │
│              │  npm-cli    │  Entry dispatcher              │
│              └──────┬──────┘                               │
│                     │                                       │
│          ┌──────────▼──────────┐                           │
│          │     spawnSfw()      │  Socket Firewall spawn    │
│          └──────────┬──────────┘                           │
│                     │                                       │
│     ┌───────────────┼───────────────┐                      │
│     │               │               │                      │
│  ┌──▼──┐      ┌─────▼─────┐   ┌────▼────┐                │
│  │ DLX │      │ Security  │   │Registry │                 │
│  │Spawn│      │ Scanning  │   │Override │                 │
│  └──┬──┘      └─────┬─────┘   └────┬────┘                │
│     │               │               │                      │
│  ┌──▼───────────────▼───────────────▼────┐                │
│  │    Package manager with Socket        │                │
│  │    security scanning integration       │                │
│  └────────────────────────────────────────┘                │
│                                                             │
│  Features:                                                  │
│  - Pre-install security scanning                           │
│  - Blocking on critical vulnerabilities                    │
│  - Registry override injection                             │
│  - SEA and DLX execution modes                             │
│  - VFS extraction for bundled tools                        │
└─────────────────────────────────────────────────────────────┘
```

## Build System

Multi-target build system supporting npm distribution and standalone executables:

```
Build Pipeline
├── Source Build (esbuild)
│   ├── TypeScript compilation (.mts → .js)
│   ├── Bundle external dependencies
│   ├── Code injection (constants/env vars)
│   └── Output: dist/*.js (273,000+ lines bundled)
│
├── SEA Build (Single Executable Application)
│   ├── Download node-smol binaries
│   ├── Generate SEA config with update-config
│   ├── Create V8 snapshot blob
│   ├── Inject blob + VFS into node-smol
│   └── Output: dist/sea/socket-{platform}-{arch}
│
└── Targets
    ├── darwin-arm64  (macOS Apple Silicon)
    ├── darwin-x64    (macOS Intel)
    ├── linux-arm64      (Linux ARM64)
    ├── linux-arm64-musl (Alpine Linux ARM64)
    ├── linux-x64        (Linux AMD64)
    ├── linux-x64-musl   (Alpine Linux)
    ├── win32-arm64   (Windows ARM64)
    └── win32-x64     (Windows AMD64)

Build Artifacts
├── dist/index.js              CLI entry point
├── dist/cli.js                Bundled CLI (all commands + utilities)
└── dist/sea/socket-*          Platform-specific binaries
```

### Build Commands

```bash
pnpm build                 # Smart incremental build
pnpm build --force         # Force rebuild all
pnpm build --watch         # Watch mode for development
pnpm build:sea             # Build SEA binaries (all platforms)
```

## Update Mechanism

Dual update system based on installation method:

```
┌─────────────────────────────────────────────────────────────┐
│                  Update Architecture                        │
│                                                             │
│  SEA Binary Installation                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ node-smol C stub checks GitHub releases on exit    │    │
│  │ Embedded update-config.json (1112 bytes)           │    │
│  │ Tag pattern: socket-cli-*                          │    │
│  │ Update: socket self-update (handled by stub)       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  npm/pnpm/yarn Installation                                 │
│  ┌────────────────────────────────────────────────────┐    │
│  │ TypeScript manager.mts checks npm registry         │    │
│  │ Package: socket                                    │    │
│  │ Notification shown on CLI exit (non-blocking)      │    │
│  │ Update: npm update -g socket                       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  Environment Variables                                      │
│  - SOCKET_CLI_SKIP_UPDATE_CHECK=1  Disable checks          │
└─────────────────────────────────────────────────────────────┘
```

## Utility Modules

```
src/utils/
├── alert/               Alert translations and formatting
├── cli/                 CLI framework (meow integration)
├── coana/               Coana reachability analysis
├── command/             Command execution utilities
├── data/                Data manipulation (maps, objects, strings)
├── dlx/                 Download and execute (cdxgen, etc)
├── ecosystem/           Multi-ecosystem support (11 languages)
├── error/               Error types and handling
├── fs/                  File system operations
├── git/                 Git operations (GitHub, GitLab, Bitbucket)
├── npm/                 npm-specific utilities
├── output/              Output formatting (JSON/Markdown/Text)
├── pnpm/                pnpm-specific utilities
├── process/             Process spawning and management
├── purl/                Package URL parsing
├── python/              Python standalone runtime
├── sea/                 SEA binary detection
├── sfw/                 Socket Firewall integration
├── socket/              Socket API integration
├── telemetry/           Analytics and error reporting
├── terminal/            Terminal UI (colors, spinners, tables)
├── update/              Update checking and notification
├── validation/          Input validation
└── yarn/                yarn-specific utilities
```

## Core Concepts

### Error Handling

Structured error types with recovery suggestions:

```typescript
// Error types in src/utils/error/errors.mts
AuthError          401/403 API authentication failures
InputError         User input validation failures
NetworkError       Network connectivity issues
RateLimitError     429 API rate limit exceeded
FileSystemError    File operation failures (ENOENT, EACCES)
ConfigError        Configuration problems
TimeoutError       Operation timeouts

// Usage pattern
throw new InputError('No package.json found', undefined, [
  'Run this command from a project directory',
  'Create a package.json with `npm init`'
])
```

### Output Modes

All commands support multiple output formats:

```typescript
// Controlled by --json, --markdown flags
type OutputKind = 'json' | 'markdown' | 'text'

// CResult pattern for JSON output
type CResult<T> =
  | { ok: true, data: T, message?: string }
  | { ok: false, message: string, cause?: string, code?: number }
```

### Configuration

Hierarchical configuration system:

```
Priority (highest to lowest):
1. Command-line flags (--org, --config)
2. Environment variables (SOCKET_CLI_API_TOKEN)
3. Config file (~/.config/socket/config.toml)
4. Default values

Config keys:
- apiToken           Socket API authentication token
- apiBaseUrl         API endpoint (default: api.socket.dev)
- defaultOrg         Default organization slug
- enforcedOrgs       Restrict commands to specific orgs
- apiProxy           HTTP proxy for API calls
```

## Language Ecosystem Support

Multi-ecosystem architecture supporting 11 package managers:

```
JavaScript/TypeScript    npm, npx, pnpm, yarn
Python                   pip, uv
Ruby                     gem, bundler
Rust                     cargo
Go                       go modules
.NET                     NuGet
```

Each ecosystem module provides:
- Package spec parsing (npm-package-arg style)
- Lockfile parsing
- Manifest file detection
- Requirements file support
- PURL (Package URL) generation

## Testing

```bash
# From packages/cli/ directory:
pnpm test                         # Full test suite
pnpm test:unit                    # Unit tests only
pnpm test:unit file.test.mts      # Single test file
pnpm test:unit --update           # Update snapshots
pnpm test:unit --coverage         # Coverage report

# Or from monorepo root:
pnpm --filter @socketsecurity/cli run test:unit
pnpm --filter @socketsecurity/cli run test:unit file.test.mts
```

Test structure:
- `test/unit/` - Unit tests (~270+ test files)
- `test/fixtures/` - Test fixtures and mock data
- `test/helpers/` - Test utilities and helpers
- Vitest framework with snapshot testing

## Development Workflow

```bash
# Watch mode - auto-rebuild on changes
pnpm dev

# Run local build
pnpm build && pnpm exec socket scan

# Run without build (direct TypeScript)
pnpm dev scan create

# Specific modes
pnpm dev:npm install express      # Test npm with Socket Firewall
pnpm dev:npx cowsay hello         # Test npx with Socket Firewall
```

## Key Statistics

- **Total Lines**: 57,000+ lines of TypeScript
- **Commands**: 41 root commands, 235 command files
- **Subcommands**: 160+ total (including nested)
- **Utility Modules**: 28 categories, 100+ files
- **Test Coverage**: 100+ test files
- **Build Targets**: 8 platform/arch combinations
- **Language Support**: 11 package ecosystems
- **Constants**: 15 constant modules

## Performance Features

- **Smart caching**: DLX manifest with TTL (15min default)
- **Streaming operations**: Memory-efficient large file handling
- **Lazy loading**: Dynamic imports for optional features
- **Parallel operations**: Concurrent API calls with queuing
- **Incremental builds**: Only rebuild changed modules

## API Integration

Socket SDK integration:

```typescript
// src/utils/socket/api.mts
import { SocketSdkClient } from '@socketsecurity/sdk'

// Automatic error handling with spinners
const result = await handleApiCall(
  sdk => sdk.createFullScan(params),
  { cmdPath: 'socket scan:create' }
)

// Features:
// - Automatic retry on transient failures
// - Permission requirement logging on 403
// - Detailed error diagnostics
// - Rate limit handling with guidance
```

## Security Features

Built-in security scanning and enforcement:

- **Pre-install scanning**: Block risky packages before installation
- **Alert detection**: 70+ security issue types
- **Reachability analysis**: Find actually-used vulnerabilities
- **SAST integration**: Static analysis via Coana
- **Secret scanning**: TruffleHog integration
- **Container scanning**: Trivy integration
- **Registry overrides**: Auto-apply safer alternatives

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Socket Security
  run: |
    npm install -g socket
    socket ci
```

Features:
- Exit code 1 on critical issues
- JSON output for parsing
- Non-interactive mode detection
- Skip update checks in CI

## Documentation

- [Official docs](https://docs.socket.dev/)
- [API reference](https://api.socket.dev/docs)
- [CLAUDE.md](../../CLAUDE.md) - Development guidelines
- [CHANGELOG.md](./CHANGELOG.md) - Version history

## Module Reference

### Command Modules (src/commands/)

- `scan/` - Security scanning with 11 subcommands (create, report, reach, diff, view, list, delete, metadata, setup, github)
- `organization/` - Organization management (dependencies, quota, policies)
- `npm/npx/pnpm/yarn/` - JavaScript package manager wrappers with Socket Firewall
- `raw-npm/raw-npx/` - Raw npm/npx passthrough without Socket Firewall
- `pip/uv/` - Python package manager wrappers
- `pycli/` - Python CLI integration for security analysis
- `sfw/` - Socket Firewall management
- `cargo/` - Rust package manager wrapper
- `gem/bundler/` - Ruby package manager wrappers
- `go/` - Go module wrapper
- `nuget/` - .NET package manager wrapper
- `optimize/` - Apply Socket registry overrides
- `patch/` - Manage custom package patches
- `install/uninstall/` - Socket integration management
- `config/` - Configuration management
- `login/logout/whoami/` - Authentication
- `ci/` - CI/CD integration
- `fix/` - Auto-fix security issues
- `manifest/` - Generate and manage SBOMs via cdxgen (includes auto, setup, gradle, kotlin, scala, conda subcommands)
- `analytics/` - Package analytics
- `audit-log/` - Organization audit logs
- `threat-feed/` - Security threat intelligence
- `repository/` - Repository management
- `package/` - Package information lookup
- `wrapper/` - Generic command wrapper
- `ask/` - AI-powered security questions
- `json/` - JSON utilities
- `oops/` - Error recovery

### Utility Modules (src/utils/)

**API & Network**
- `socket/api.mts` - Socket API communication with error handling
- `socket/sdk.mts` - SDK initialization and configuration
- `socket/alerts.mts` - Security alert processing

**CLI Framework**
- `cli/with-subcommands.mts` - Subcommand routing (350+ lines)
- `cli/completion.mts` - Shell completion generation
- `cli/messages.mts` - User-facing messages

**Data Processing**
- `data/map-to-object.mts` - Map to object conversion
- `data/objects.mts` - Object utilities
- `data/strings.mts` - String manipulation
- `data/walk-nested-map.mts` - Nested map traversal

**Ecosystem Support**
- `ecosystem/types.mts` - PURL types for 11 languages
- `ecosystem/environment.mts` - Runtime environment detection
- `ecosystem/requirements.mts` - API requirements lookup
- `ecosystem/spec.mts` - Package spec parsing

**Error Handling**
- `error/errors.mts` - Error types and diagnostics (560+ lines)
- `error/fail-msg-with-badge.mts` - Formatted error messages

**File Operations**
- `fs/fs.mts` - Safe file operations
- `fs/home-path.mts` - Home directory resolution
- `fs/path-resolve.mts` - Path resolution for scans
- `fs/find-up.mts` - Find files in parent directories

**Git Integration**
- `git/operations.mts` - Git commands (branch, commit, etc)
- `git/github.mts` - GitHub API integration
- `git/providers.mts` - Multi-provider support (GitHub, GitLab, Bitbucket)

**Output Formatting**
- `output/formatting.mts` - Help text and flag formatting
- `output/result-json.mts` - JSON serialization
- `output/markdown.mts` - Markdown table generation
- `output/mode.mts` - Output mode detection

**Package Managers**
- `npm/config.mts` - npm configuration reading
- `npm/package-arg.mts` - npm package spec parsing
- `npm/paths.mts` - npm path resolution
- `pnpm/lockfile.mts` - pnpm lockfile parsing
- `pnpm/scanning.mts` - pnpm scan integration
- `yarn/paths.mts` - yarn path resolution

**Process & Spawn**
- `process/cmd.mts` - Command-line utilities
- `process/os.mts` - OS detection
- `spawn/spawn-node.mts` - Node.js process spawning

**Security Tools**
- `coana/extract-scan-id.mts` - Coana reachability integration
- `dlx/cdxgen.mts` - SBOM generation
- `python/standalone.mts` - Python runtime management

**Terminal UI**
- `terminal/ascii-header.mts` - ASCII logo rendering
- `terminal/colors.mts` - ANSI color utilities
- `terminal/link.mts` - Hyperlink generation
- `terminal/rich-progress.mts` - Progress bars

**Update System**
- `update/manager.mts` - Update check orchestration
- `update/checker.mts` - Version comparison logic

**Validation**
- `validation/check-input.mts` - Input validation
- `validation/filter-config.mts` - Config validation

## Constants (src/constants/)

- `agents.mts` - Package manager constants (npm, pnpm, yarn, etc)
- `alerts.mts` - Security alert type constants
- `build.mts` - Build-time inlined constants
- `cache.mts` - Cache TTL values
- `cli.mts` - CLI flag constants
- `config.mts` - Configuration key constants
- `env.mts` - Environment variable access
- `errors.mts` - Error message constants
- `github.mts` - GitHub API constants
- `http.mts` - HTTP status code constants
- `packages.mts` - Package name constants
- `paths.mts` - Path constants
- `reporting.mts` - Report configuration
- `socket.mts` - Socket API URLs
- `types.mts` - Type constants

## Installation

```bash
# npm
npm install -g socket

# pnpm
pnpm add -g socket

# yarn
yarn global add socket

# Standalone binary
curl -L https://socket.dev/cli/install.sh | bash
```

## License

MIT - See [LICENSE](./LICENSE) for details.

## Contributing

See [CLAUDE.md](../../CLAUDE.md) for development guidelines and code standards.

## Support

- GitHub Issues: https://github.com/SocketDev/socket-cli/issues
- Documentation: https://docs.socket.dev/
- Website: https://socket.dev/
