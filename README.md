# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![Follow @SocketSecurity](assets/fleet/badge-follow-x.svg)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](assets/fleet/badge-follow-bluesky.svg)](https://bsky.app/profile/socket.dev)

CLI for [Socket.dev](https://socket.dev) — scan dependencies, audit packages, apply security patches, and gate installs from your terminal or CI. This is the 1.x line of the published `socket` package on npm.

## Install

```bash
npm install -g socket
socket --help
```

## Usage

### Commands

- `socket npm [args...]` and `socket npx [args...]` - Wraps npm/npx with Socket security scanning

- `socket fix` - Fix CVEs in dependencies

- `socket optimize` - Optimize dependencies with [`@socketregistry`](https://github.com/SocketDev/socket-registry) overrides

- `socket cdxgen [command]` - Run [cdxgen](https://cyclonedx.github.io/cdxgen/#/?id=getting-started) for SBOM generation

- `socket patch <command>` - Apply, manage, and rollback Socket security patches for vulnerable dependencies

#### Patch subcommands

| Command | Description |
|---------|-------------|
| `socket patch scan` | Scan installed packages for available security patches |
| `socket patch get <uuid> --org <slug>` | Download a patch by UUID and store it locally |
| `socket patch apply` | Apply downloaded patches to `node_modules` |
| `socket patch rollback [purl\|uuid]` | Rollback patches and restore original files |
| `socket patch list [--json]` | List all patches in the local manifest |
| `socket patch remove <purl\|uuid>` | Remove a patch from the manifest (rolls back by default) |
| `socket patch setup [--yes]` | Add `socket patch apply` to `postinstall` scripts |
| `socket patch repair` | Download missing blobs and clean up unused blobs |

**Quick start:**

```bash
# Scan for available patches, download, and apply.
socket patch scan
socket patch apply

# Or download a specific patch by UUID.
socket patch get <uuid> --org <org-slug>
socket patch apply

# Add to postinstall so patches reapply on npm install.
socket patch setup --yes
```

Free patches work without authentication. For paid patches, set `SOCKET_CLI_API_TOKEN` and `SOCKET_CLI_ORG_SLUG`.

### Aliases

All aliases support the flags and arguments of the commands they alias.

- `socket ci` - Alias for `socket scan create --report` (creates report and exits with error if unhealthy)

### Reachability analysis

Socket reachability analysis comes in three forms:

- **Full application reachability** (formerly Tier 1): Analyzes your application together with its dependencies to determine whether vulnerable code is actually invoked from your code through the full dependency graph — the highest-precision reachability analysis. Run it with `socket scan create --reach`.
- **Precomputed reachability** (formerly Tier 2): Determines whether vulnerable code in transitive dependencies is reachable through your direct dependencies, using precomputed static analysis of dependency chains (no access to your application code required). In the CLI this is the fallback used when full application reachability cannot complete (see the `--reach-continue-on-*` flags).
- **Dependency reachability** (formerly Tier 3): Package-level filtering that detects which dependencies are actually used, so CVEs in unused/dead dependencies can be filtered out.

### Flags

#### Output flags

- `--json` - Output as JSON
- `--markdown` - Output as Markdown

#### Other flags

- `--dry-run` - Run without uploading
- `--debug` - Show debug output
- `--help` - Show help
- `--max-old-space-size` - Set Node.js memory limit
- `--max-semi-space-size` - Set Node.js heap size
- `--version` - Show version

### Configuration files

Socket CLI reads [`socket.yml`](https://docs.socket.dev/docs/socket-yml) configuration files.
Supports version 2 format with `projectIgnorePaths` for excluding files from reports.

### Environment variables

- `SOCKET_CLI_API_TOKEN` - Socket API token
- `SOCKET_CLI_CONFIG` - JSON configuration object
- `SOCKET_CLI_GITHUB_API_URL` - GitHub API base URL
- `SOCKET_CLI_GIT_USER_EMAIL` - Git user email (default: `github-actions[bot]@users.noreply.github.com`)
- `SOCKET_CLI_GIT_USER_NAME` - Git user name (default: `github-actions[bot]`)
- `SOCKET_CLI_GITHUB_TOKEN` - GitHub token with repo access (alias: `GITHUB_TOKEN`)
- `SOCKET_CLI_NO_API_TOKEN` - Disable default API token
- `SOCKET_CLI_NPM_PATH` - Path to npm directory
- `SOCKET_CLI_ORG_SLUG` - Socket organization slug
- `SOCKET_CLI_ACCEPT_RISKS` - Accept npm/npx risks
- `SOCKET_CLI_VIEW_ALL_RISKS` - Show all npm/npx risks

### See also

- [Socket API Reference](https://docs.socket.dev/reference)
- [Socket GitHub App](https://github.com/apps/socket-security)
- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js)

## Development

Run locally:

```bash
npm install
npm run build
npm exec socket
```

### Development environment variables

- `SOCKET_CLI_API_BASE_URL` - API base URL (default: `https://api.socket.dev/v0/`)
- `SOCKET_CLI_API_PROXY` - Proxy for API requests (aliases: `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`)
- `SOCKET_CLI_API_TIMEOUT` - API request timeout in milliseconds
- `SOCKET_CLI_COANA_LAUNCHER` - How the reachability engine (`@coana-tech/cli`) is launched: `auto` (default; try `npx`, fall back to `npm install` + `node` if the launcher fails), `npx` (never fall back), or `npm-install` (skip `npx` entirely)
- `SOCKET_CLI_DEBUG` - Enable debug logging
- `DEBUG` - Enable [`debug`](https://socket.dev/npm/package/debug) package logging

## License

MIT

<br/>
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/fleet/socket-combomark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/fleet/socket-combomark-light.svg">
    <img width="324" height="104" alt="Socket" src="assets/fleet/socket-combomark-light.svg">
  </picture>
</div>
