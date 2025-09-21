# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

CLI for [Socket.dev] security analysis

## Usage

```bash
npm install -g socket
socket --help
```

## Commands

- `socket npm [args...]` and `socket npx [args...]` - Wraps npm/npx with Socket security scanning

- `socket fix` - Fix CVEs in dependencies

- `socket optimize` - Optimize dependencies with [`@socketregistry`](https://github.com/SocketDev/socket-registry) overrides

- `socket cdxgen [command]` - Run [cdxgen](https://cyclonedx.github.io/cdxgen/#/?id=getting-started) for SBOM generation

## Aliases

All aliases support the flags and arguments of the commands they alias.

- `socket ci` - Alias for `socket scan create --report` (creates report and exits with error if unhealthy)

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
- `SOCKET_CLI_GIT_USER_EMAIL` - Git user email (default: `github-actions[bot]@users.noreply.github.com`)
- `SOCKET_CLI_GIT_USER_NAME` - Git user name (default: `github-actions[bot]`)
- `SOCKET_CLI_GITHUB_TOKEN` - GitHub token with repo access (alias: `GITHUB_TOKEN`)
- `SOCKET_CLI_NO_API_TOKEN` - Disable default API token
- `SOCKET_CLI_NPM_PATH` - Path to npm directory
- `SOCKET_CLI_ORG_SLUG` - Socket organization slug
- `SOCKET_CLI_ACCEPT_RISKS` - Accept npm/npx risks
- `SOCKET_CLI_VIEW_ALL_RISKS` - Show all npm/npx risks

## Contributing

Run locally:

```
npm install
npm run build
npm exec socket
```

### Development environment variables

- `SOCKET_CLI_API_BASE_URL` - API base URL (default: `https://api.socket.dev/v0/`)
- `SOCKET_CLI_API_PROXY` - Proxy for API requests (aliases: `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`)
- `SOCKET_CLI_API_TIMEOUT` - API request timeout in milliseconds
- `SOCKET_CLI_DEBUG` - Enable debug logging
- `DEBUG` - Enable [`debug`](https://socket.dev/npm/package/debug) package logging

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
