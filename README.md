# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-75.08%25-brightgreen)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

CLI for [Socket.dev](https://socket.dev) security analysis. For user documentation, see the [`socket` package on npm](https://socket.dev/npm/package/socket).

## Getting Started

### Prerequisites

- **Node.js** 25.8.1+ (see `.node-version`)
- **pnpm** 10.22+ (see `packageManager` in `package.json`)

### Setup

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
```

### Running the CLI

```bash
# Run the built CLI
node packages/cli/dist/index.js --help

# Or use watch mode during development
pnpm dev
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests for a specific file
pnpm --filter @socketsecurity/cli run test:unit src/commands/scan/cmd-scan.test.mts

# Run with pattern matching
pnpm --filter @socketsecurity/cli run test:unit src/commands/scan/cmd-scan.test.mts -t "pattern"
```

### Code Quality

```bash
pnpm run check        # Run lint + typecheck
pnpm run fix          # Auto-fix linting and formatting
```

## Project Structure

```
socket-cli/
├── packages/
│   ├── cli/                    # Main CLI package (@socketsecurity/cli)
│   │   ├── src/
│   │   │   ├── commands/       # Command implementations
│   │   │   ├── utils/          # Shared utilities
│   │   │   └── cli.mts         # Entry point
│   │   └── dist/               # Built output
│   ├── build-infra/            # Build system and tooling
│   └── package-builder/        # Package generation templates
├── scripts/                    # Monorepo scripts
└── test/                       # Shared test utilities
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Smart build (skips unchanged) |
| `pnpm run build --force` | Force rebuild everything |
| `pnpm run build:cli` | Build CLI package only |
| `pnpm run build:sea` | Build SEA binaries |
| `pnpm dev` | Watch mode (auto-rebuild) |
| `pnpm test` | Run all tests |
| `pnpm testu` | Update test snapshots |
| `pnpm run check` | Lint + typecheck |
| `pnpm run fix` | Auto-fix issues |

## Debug Logging

```bash
SOCKET_CLI_DEBUG=1 node packages/cli/dist/index.js <command>
```

## Environment Variables

Key variables for development:

| Variable | Description |
|----------|-------------|
| `SOCKET_CLI_DEBUG` | Enable debug logging (`1`) |
| `SOCKET_CLI_API_TOKEN` | Socket API token |
| `SOCKET_CLI_ORG_SLUG` | Socket organization slug |
| `SOCKET_CLI_API_BASE_URL` | Override API endpoint |
| `SOCKET_CLI_NO_API_TOKEN` | Disable default API token |

## Further Reading

- [`docs/build-guide.md`](docs/build-guide.md) — build pipeline, SEA binaries, cache management
- [`docs/bundle-tools.md`](docs/bundle-tools.md) — how bundled tools (opengrep, trivy, etc.) are integrated
- [`packages/cli/README.md`](packages/cli/README.md) — CLI package architecture
- [`packages/build-infra/README.md`](packages/build-infra/README.md) — shared build tooling
- [`packages/package-builder/README.md`](packages/package-builder/README.md) — template-based package generation

## See Also

- [Socket API Reference](https://docs.socket.dev/reference)
- [Socket GitHub App](https://github.com/apps/socket-security)
- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js)

<br/>
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="logo-light.png">
    <img width="324" height="108" alt="Socket Logo" src="logo-light.png">
  </picture>
</div>
