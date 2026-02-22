# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-41.97%25-yellow)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

CLI for [Socket.dev] security analysis

## Quick Start

**Install via package manager:**

```bash
pnpm install -g socket
socket --help
```

**Or install via npm:**

```bash
npm install -g socket
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
- `socket manifest [command]` - Generate and manage SBOMs for multiple ecosystems
  - `socket cdxgen [command]` - Alias for `socket manifest cdxgen` - Run [cdxgen](https://github.com/cdxgen/cdxgen) for SBOM generation

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

These flags are available on data-retrieval commands (scan, package, organization, etc.):

- `--json` - Output as JSON
- `--markdown` - Output as Markdown

### Other flags

- `--dry-run` - Run without uploading
- `--help` - Show help
- `--version` - Show version

## Configuration files

Socket CLI reads [`socket.yml`](https://docs.socket.dev/docs/socket-yml) configuration files.
Supports version 2 format with `projectIgnorePaths` for excluding files from reports.

## Environment variables

- `GITHUB_API_URL` - GitHub API base URL (default: `https://api.github.com`, set for GitHub Enterprise)
- `SOCKET_CLI_ACCEPT_RISKS` - Accept npm/npx risks
- `SOCKET_CLI_API_BASE_URL` - Override Socket API endpoint (default: `api.socket.dev`)
- `SOCKET_CLI_API_PROXY` - HTTP proxy for API calls
- `SOCKET_CLI_API_TIMEOUT` - API request timeout in milliseconds
- `SOCKET_CLI_API_TOKEN` - Socket API token
- `SOCKET_CLI_BIN_PATH` - Path to CLI binary
- `SOCKET_CLI_BOOTSTRAP_CACHE_DIR` - Bootstrap cache directory
- `SOCKET_CLI_BOOTSTRAP_SPEC` - Bootstrap specification
- `SOCKET_CLI_CDXGEN_LOCAL_PATH` - Local path to cdxgen tool
- `SOCKET_CLI_COANA_LOCAL_PATH` - Local path to Coana tool
- `SOCKET_CLI_CONFIG` - JSON configuration object
- `SOCKET_CLI_DEBUG` - Enable debug logging (set to `1`)
- `SOCKET_CLI_FIX` - Enable fix mode
- `SOCKET_CLI_GIT_USER_EMAIL` - Git user email (default: `github-actions[bot]@users.noreply.github.com`)
- `SOCKET_CLI_GIT_USER_NAME` - Git user name (default: `github-actions[bot]`)
- `SOCKET_CLI_GITHUB_TOKEN` - GitHub token with repo access (`GITHUB_TOKEN` and `GH_TOKEN` also recognized as fallbacks)
- `SOCKET_CLI_JS_PATH` - Path to JavaScript runtime
- `SOCKET_CLI_LOCAL_NODE_SMOL` - Path to local node-smol binary
- `SOCKET_CLI_LOCAL_PATH` - Local CLI path
- `SOCKET_CLI_MODE` - CLI operation mode
- `SOCKET_CLI_MODELS_PATH` - Path to AI models
- `SOCKET_CLI_NO_API_TOKEN` - Disable default API token
- `SOCKET_CLI_NPM_PATH` - Path to npm directory
- `SOCKET_CLI_OPTIMIZE` - Enable optimize mode
- `SOCKET_CLI_ORG_SLUG` - Socket organization slug
- `SOCKET_CLI_PYCLI_LOCAL_PATH` - Local path to Python CLI tool
- `SOCKET_CLI_PYTHON_PATH` - Path to Python interpreter
- `SOCKET_CLI_SEA_NODE_VERSION` - Node version for SEA builds
- `SOCKET_CLI_SFW_LOCAL_PATH` - Local path to SFW tool
- `SOCKET_CLI_SKIP_UPDATE_CHECK` - Disable update checking
- `SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH` - Local path to socket-patch tool
- `SOCKET_CLI_VIEW_ALL_RISKS` - Show all npm/npx risks

## Contributing

**Setup instructions:**

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
pnpm test
```

**Development commands:**

```bash
pnpm run build                    # Smart build
pnpm run build --force            # Force rebuild
```

**Debug logging:**
```bash
SOCKET_CLI_DEBUG=1 socket <command>    # Enable debug output
DEBUG=network socket <command>         # Specific category
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
