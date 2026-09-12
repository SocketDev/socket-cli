# <picture><img width="32" height="32" alt="socket-cli" src="https://raw.githubusercontent.com/SocketDev/socket-cli/HEAD/assets/repo/logomark.svg"></picture> Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
<picture><img src="https://raw.githubusercontent.com/SocketDev/socket-cli/HEAD/assets/repo/coverage.svg?v=fce8b9cdc6e7" height="20" alt="Coverage" /></picture>

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

CLI for [Socket.dev](https://socket.dev) - bring Socket's supply-chain security analysis to your terminal and CI.

Socket CLI is the command-line interface to [Socket.dev](https://socket.dev), letting you scan dependencies, audit packages, and gate installs from your terminal or CI. This branch develops the 2.x prerelease of `@socketsecurity/cli`. End-user documentation lives on [socket.dev](https://docs.socket.dev).

## Install

```sh
pnpm add --global @socketsecurity/cli
```

Then run:

```sh
socket --help
```

## Usage

```sh
# Scan a package
socket package npm/express@4.18.0

# Scan your project's dependencies
socket scan create

# Audit an install before it runs (npm, pnpm, or yarn)
socket npm install
socket pnpm install
socket yarn add <package>
```

`socket npm`, `socket pnpm`, and `socket yarn` each run the underlying
package manager through [Socket Firewall](https://docs.socket.dev), which
blocks known-malicious packages before they are installed. Install-time
protection is no longer npm-only.

See [the Socket docs](https://docs.socket.dev) for the full command reference.

### MCP connections

For a local stdio connection, run `socket login` once, then configure your MCP
client to launch `socket` with arguments `["mcp"]`. Reuse saved authentication
until it expires or the server rejects it.

For the hosted service, use your client's native remote connector with
`https://mcp.socket.dev/`. In Claude Desktop, add it through **Customize >
Connectors**.

<details>
<summary>Configure clients that require a stdio bridge</summary>

Clients that require a stdio bridge can use the verified `mcp-remote@0.8.3`
release. Install it with `pnpm add --global mcp-remote@0.8.3`, then configure:

```json
{
  "mcpServers": {
    "socket": {
      "command": "mcp-remote",
      "args": ["https://mcp.socket.dev/"]
    }
  }
}
```

The bridge runs the OAuth callback listener on your computer. Version 0.1.49
can open authorization after connection without starting that listener. The
[upstream fix](https://github.com/punkpeye/mcp-remote/pull/340) is included in
0.8.3. Update the bridge executable if authorization returns to an unavailable
localhost callback. Reauthorization recovery was verified against the published
bridge transport; a complete browser login remains a separate integration check.

</details>

## Architecture

CLI entrypoints live in `src/command/`. Shared implementations live in `src/core/`. See the [architecture guide](docs/repo/architecture.md) for the source and test layout.

## Development

<details>
<summary>Contributor commands</summary>

```sh
git clone --depth=1 --single-branch https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
pnpm test
```

Requires Node.js (see `.node-version`) and pnpm (see the `packageManager` field in `package.json`).

| Command                       | Description                   |
| ----------------------------- | ----------------------------- |
| `pnpm run build`              | Smart build (skips unchanged) |
| `pnpm run build --force`      | Force rebuild everything      |
| `pnpm run build:cli`          | Build CLI package only        |
| `pnpm run build:watch`        | Rebuild the CLI on changes    |
| `pnpm test`                   | Run all tests                 |
| `pnpm run test:unit -- --all` | Run all product unit tests    |
| `pnpm run check`              | Lint + typecheck              |
| `pnpm run fix`                | Auto-fix lint + formatting    |

Run the built CLI from source:

```sh
pnpm run s --help
```

Enable debug logging:

```sh
SOCKET_CLI_DEBUG=1 pnpm run s <command>
```

Key development environment variables:

| Variable                           | Description                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `SOCKET_CLI_DEBUG`                 | Enable debug logging (`1`)                                                    |
| `SOCKET_CLI_API_TOKEN`             | Socket API token                                                              |
| `SOCKET_CLI_ORG_SLUG`              | Socket organization slug                                                      |
| `SOCKET_CLI_API_BASE_URL`          | Override API endpoint                                                         |
| `SOCKET_CLI_NO_API_TOKEN`          | Disable default API token                                                     |
| `SOCKET_CLI_ALLOWED_PRIVATE_HOSTS` | Comma-separated hostnames allowed to be private (see below); unset by default |

The API base URL and the npm registry URL both receive an `Authorization`
header, so the CLI refuses either one when it points at a loopback, private, or
link-local host - a repo-supplied `SOCKET_CLI_CONFIG` or `.npmrc` cannot aim the
token at `169.254.169.254` or an internal service. An enterprise Socket instance
or npm registry reached by a literal private address names that host in
`SOCKET_CLI_ALLOWED_PRIVATE_HOSTS`:

```sh
SOCKET_CLI_ALLOWED_PRIVATE_HOSTS=10.0.0.5,registry.10.0.0.6.nip.io
```

It is an allowlist rather than an off switch, so allowing your own host does not
allow every other private host.

Further contributor reading:

- [`docs/build-guide.md`](docs/build-guide.md) - single-package build and verification
- [`docs/bundle-tools.md`](docs/bundle-tools.md) - how bundled tools (opengrep, trivy, etc.) are integrated
- [`docs/repo/architecture.md`](docs/repo/architecture.md) - source and command layout

</details>

## License

MIT
