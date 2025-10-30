# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)

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

**New to Socket CLI development?** Start with our [Getting Started Guide](docs/development/getting-started.md) for complete setup instructions.

**Quick setup:**

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
pnpm exec socket --version
```

See [docs/development/](docs/development/) for detailed development guides.

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
- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js)

[Socket.dev]: https://socket.dev/

<br/>
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="logo-light.png">
    <img width="324" height="108" alt="Socket Logo" src="logo-light.png">
  </picture>
</div>
