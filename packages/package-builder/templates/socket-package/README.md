<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo-light.png">
  <source media="(prefers-color-scheme: light)" srcset="logo-dark.png">
  <img alt="Socket" src="logo-dark.png" width="200">
</picture>

# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)

CLI for [Socket.dev](https://socket.dev) security analysis

## Quick Start

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

- `SOCKET_CLI_API_TOKEN` - Socket API token
- `SOCKET_CLI_ORG_SLUG` - Socket organization slug
- `SOCKET_CLI_DEBUG` - Enable debug logging (set to `1`)
- `SOCKET_CLI_CONFIG` - JSON configuration object

For full documentation, see the [Socket CLI repository](https://github.com/SocketDev/socket-cli).

## See also

- [Socket API Reference](https://docs.socket.dev/reference)
- [Socket GitHub App](https://github.com/apps/socket-security)
- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js)

## License

[MIT](./LICENSE)
