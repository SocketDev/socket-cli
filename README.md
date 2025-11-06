# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)
![Code Coverage](https://img.shields.io/badge/code--coverage-37.17%25-yellow)
![Type Coverage](https://img.shields.io/badge/type--coverage-98.16%25-brightgreen)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

CLI for [Socket.dev] security analysis

## Quick Start

**Install via curl:**

```bash
curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-cli/main/install.sh | bash
```

**Or install via package manager:**

```bash
pnpm install -g socket
socket --help
```

## Core Commands

- `socket npm [args...]` / `socket npx [args...]` - Wrap npm/npx with security scanning
- `socket pnpm [args...]` / `socket yarn [args...]` - Wrap pnpm/yarn with security scanning
- `socket pip [args...]` - Wrap pip with security scanning
- `socket scan` - Create and manage security scans
- `socket package <name>` - Analyze package security scores
- `socket fix` - Fix CVEs in dependencies
- `socket optimize` - Optimize dependencies with [`@socketregistry`](https://github.com/SocketDev/socket-registry) overrides
- `socket cdxgen [command]` - Run [cdxgen](https://cyclonedx.github.io/cdxgen/#/?id=getting-started) for SBOM generation

## Organization & Repository Management

- `socket organization` (alias: `org`) - Manage organization settings
- `socket repository` (alias: `repo`) - Manage repositories
- `socket dependencies` (alias: `deps`) - View organization dependencies
- `socket audit-log` (alias: `audit`) - View audit logs
- `socket analytics` - View organization analytics
- `socket threat-feed` (alias: `feed`) - View threat intelligence

## Authentication & Configuration

- `socket login` - Authenticate with Socket.dev
- `socket logout` - Remove authentication
- `socket whoami` - Show authenticated user
- `socket config` - Manage CLI configuration

## Aliases

All aliases support the flags and arguments of the commands they alias.

- `socket ci` - Alias for `socket scan create --report` (creates report and exits with error if unhealthy)
- `socket org` - Alias for `socket organization`
- `socket repo` - Alias for `socket repository`
- `socket pkg` - Alias for `socket package`
- `socket deps` - Alias for `socket dependencies`
- `socket audit` - Alias for `socket audit-log`
- `socket feed` - Alias for `socket threat-feed`

## Flags

### Output flags

- `--json` - Output as JSON
- `--markdown` - Output as Markdown

### Other flags

- `--dry-run` - Run without uploading
- `--debug` - Show debug output
- `--help` - Show help
- `--max-old-space-size` - Set Node.js memory limit
- `--max-semi-space-size` - Set Node.js heap size
- `--version` - Show version

## Configuration files

Socket CLI reads [`socket.yml`](https://docs.socket.dev/docs/socket-yml) configuration files.
Supports version 2 format with `projectIgnorePaths` for excluding files from reports.

## Environment variables

- `SOCKET_CLI_API_TOKEN` - Socket API token
- `SOCKET_CLI_CONFIG` - JSON configuration object
- `SOCKET_CLI_GITHUB_API_URL` - GitHub API base URL
- `SOCKET_CLI_GIT_USER_EMAIL` - Git user email (default: `94589996+socket-bot@users.noreply.github.com`)
- `SOCKET_CLI_GIT_USER_NAME` - Git user name (default: `Socket Bot`)
- `SOCKET_CLI_GITHUB_TOKEN` - GitHub token with repo access (alias: `GITHUB_TOKEN`)
- `SOCKET_CLI_NO_API_TOKEN` - Disable default API token
- `SOCKET_CLI_NPM_PATH` - Path to npm directory
- `SOCKET_CLI_ORG_SLUG` - Socket organization slug
- `SOCKET_CLI_ACCEPT_RISKS` - Accept npm/npx risks
- `SOCKET_CLI_VIEW_ALL_RISKS` - Show all npm/npx risks

## Contributing

**Quick setup:**

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
pnpm exec socket --version
```

#### Quick start (easiest)

The default build command automatically skips packages that are already up-to-date:

```bash
# Build only what changed (recommended for development)
pnpm run build
```

**How it works:**
- Checks if output files exist (e.g., `packages/yoga/dist/yoga.wasm`)
- Skips building if output is present and up-to-date
- Shows which packages were built vs. skipped
- Displays build time summary

**Example output:**
```
============================================================
Socket CLI Build System
============================================================

→ Yoga WASM: skipped (up to date)
→ CLI Package: building...
✓ CLI Package: built (12.3s)
→ SEA Binary: building...
✓ SEA Binary: built (45.1s)

============================================================
Build Summary
============================================================

Built:    2
Skipped:  1
Total:    57.4s

✓ Build completed successfully
```

#### Force rebuild

To rebuild everything from scratch (ignoring cache):

```bash
# Force rebuild all packages
pnpm run build --force
```

#### Single target builds

For fast iteration during development:

```bash
# Build only CLI package
pnpm run build --target cli

# Build SEA binary
pnpm run build --target sea

# Build specific platform binary (combined syntax)
pnpm run build --target darwin-arm64

# Build specific platform binary (separate flags - matches node-sea-builder)
pnpm run build --platform darwin --arch arm64
```

#### Multiple target builds

Build multiple packages at once:

```bash
# Build multiple specific targets sequentially
pnpm run build --targets cli,sea,darwin-arm64

# Build multiple targets in parallel (faster)
pnpm run build --targets cli,sea,darwin-arm64 --parallel
```

#### Platform binaries

Build all platform binaries (8 platforms):

```bash
# Build all platforms sequentially (safer for limited resources)
pnpm run build --platforms

# Build all platforms in parallel (much faster, requires more CPU/RAM)
pnpm run build --platforms --parallel
```

**Platform targets:** alpine-arm64, alpine-x64, darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-arm64, win32-x64

#### Advanced: Direct package builds

Build individual packages directly with pnpm filters:

```bash
# Build Yoga WASM (for terminal layouts)
pnpm --filter @socketsecurity/yoga run build

# Build CLI package (TypeScript + bundling)
pnpm --filter @socketsecurity/cli run build

# Build SEA binary (Node.js Single Executable)
pnpm --filter @socketbin/node-sea-builder-builder run build
```

#### All build options

```bash
pnpm run build --help
```

### Development environment variables

- `SOCKET_CLI_API_BASE_URL` - API base URL (default: `https://api.socket.dev/v0/`)
- `SOCKET_CLI_API_PROXY` - Proxy for API requests (aliases: `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`)
- `SOCKET_CLI_API_TIMEOUT` - API request timeout in milliseconds
- `SOCKET_CLI_CACHE_ENABLED` - Enable API response caching (default: `false`)
- `SOCKET_CLI_CACHE_TTL` - Cache TTL in milliseconds (default: `300000` = 5 minutes)
- `SOCKET_CLI_DEBUG` - Enable debug logging
- `DEBUG` - Enable [`debug`](https://socket.dev/npm/package/debug) package logging

### Debug logging categories

The CLI supports granular debug logging via the `DEBUG` environment variable:

**Default categories** (shown with `SOCKET_CLI_DEBUG=1`):
- `error` - Critical errors that prevent operation
- `warn` - Important warnings that may affect behavior
- `notice` - Notable events and state changes
- `silly` - Very verbose debugging info

**Opt-in categories** (require explicit `DEBUG='category'`):
- `cache` - Cache hit/miss operations
- `network` - HTTP requests with timing
- `command` - External command execution
- `auth` - Authentication flow
- `perf` - Performance timing
- `spinner` - Spinner state changes
- `inspect` - Detailed object inspection
- `stdio` - Command execution logs

**Examples:**
```bash
DEBUG=cache socket scan              # Cache debugging only
DEBUG=network,cache socket scan      # Multiple categories
DEBUG=* socket scan                  # All categories
SOCKET_CLI_DEBUG=1 socket scan       # Default categories
```

## Developer API

### Progress indicators

Track long-running operations with visual progress bars:

```typescript
import { startSpinner, updateSpinnerProgress } from './src/utils/spinner.mts'

const stop = startSpinner('Processing files')
for (let i = 0; i < files.length; i++) {
  updateSpinnerProgress(i + 1, files.length, 'files')
  await processFile(files[i])
}
stop()
// Output: ⠋ Processing files ████████████░░░░░░░░ 60% (12/20 files)
```

### Table formatting

Display structured data with professional table formatting:

```typescript
import { formatTable, formatSimpleTable } from './src/utils/output-formatting.mts'
import colors from 'yoctocolors-cjs'

// Bordered table with box-drawing characters
const data = [
  { name: 'lodash', version: '4.17.21', issues: 0 },
  { name: 'react', version: '18.2.0', issues: 2 }
]
const columns = [
  { key: 'name', header: 'Package' },
  { key: 'version', header: 'Version', align: 'center' },
  {
    key: 'issues',
    header: 'Issues',
    align: 'right',
    color: (v) => v === '0' ? colors.green(v) : colors.red(v)
  }
]
console.log(formatTable(data, columns))
// Output:
// ┌─────────┬─────────┬────────┐
// │ Package │ Version │ Issues │
// ├─────────┼─────────┼────────┤
// │ lodash  │ 4.17.21 │      0 │
// │ react   │ 18.2.0  │      2 │
// └─────────┴─────────┴────────┘

// Simple table without borders
console.log(formatSimpleTable(data, columns))
// Output:
// Package  Version  Issues
// ───────  ───────  ──────
// lodash   4.17.21       0
// react    18.2.0        2
```

### Performance monitoring

Track and optimize CLI performance with comprehensive monitoring utilities:

```typescript
import { perfTimer, measure, perfCheckpoint, printPerformanceSummary } from './src/utils/performance.mts'

// Simple operation timing
const stop = perfTimer('fetch-packages')
await fetchPackages()
stop({ count: 50 })

// Function measurement
const { result, duration } = await measure('parse-manifest', async () => {
  return parseManifest(file)
})
console.log(`Parsed in ${duration}ms`)

// Track complex operation progress
perfCheckpoint('start-scan')
perfCheckpoint('analyze-dependencies', { count: 100 })
perfCheckpoint('detect-issues', { issueCount: 5 })
perfCheckpoint('end-scan')

// Print performance summary
printPerformanceSummary()
// Performance Summary:
// fetch-packages: 1 calls, avg 234ms (min 234ms, max 234ms, total 234ms)
// parse-manifest: 5 calls, avg 12ms (min 8ms, max 20ms, total 60ms)
```

**Enable with:** `DEBUG=perf socket <command>`

### Intelligent caching strategies

Optimize API performance with smart caching based on data volatility:

```typescript
import { getCacheStrategy, getRecommendedTtl, warmCaches } from './src/utils/cache-strategies.mts'

// Get recommended TTL for an endpoint
const ttl = getRecommendedTtl('/npm/lodash/4.17.21/score')
// Returns: 900000 (15 minutes for stable package info)

// Check cache strategy
const strategy = getCacheStrategy('/scans/abc123')
// Returns: { ttl: 120000, volatile: true } (2 minutes for active scans)

// Warm critical caches on startup
await warmCaches(sdk, [
  '/users/me',
  '/organizations/my-org/settings'
])
```

**Built-in strategies:**
- Package info: 15min (stable data)
- Package issues: 5min (moderate volatility)
- Scan results: 2min (high volatility)
- Org settings: 30min (very stable)
- User info: 1hr (most stable)

### Enhanced error handling

Handle errors with actionable recovery suggestions:

```typescript
import { InputError, AuthError, getRecoverySuggestions } from './src/utils/errors.mts'

// Throw errors with recovery suggestions
throw new InputError('Invalid package name', 'Must be in format: @scope/name', [
  'Use npm package naming conventions',
  'Check for typos in the package name'
])

throw new AuthError('Token expired', [
  'Run `socket login` to re-authenticate',
  'Generate a new token at https://socket.dev/dashboard'
])

// Extract and display recovery suggestions
try {
  await operation()
} catch (error) {
  const suggestions = getRecoverySuggestions(error)
  if (suggestions.length > 0) {
    console.error('How to fix:')
    suggestions.forEach(s => console.error(`  - ${s}`))
  }
}
```

## See also

- [Socket API Reference](https://docs.socket.dev/reference)
- [Socket GitHub App](https://github.com/apps/socket-security)

[Socket.dev]: https://socket.dev/

<br/>
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="logo-light.png">
    <img width="324" height="108" alt="Socket Logo" src="logo-light.png">
  </picture>
</div>
