# Getting Started

Quick start for Socket CLI development.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Git

## Setup

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm test
```

## Structure

```
socket-cli/
├── packages/cli/         # Main CLI (@socketsecurity/cli)
├── packages/socket/      # Published npm package
└── packages/bootstrap/   # CLI bootstrapper
```

## Commands

```bash
pnpm build         # Build all packages
pnpm test          # Run tests
pnpm run check     # Type check + lint
```

## Development

1. Make changes in `packages/cli/src/`
2. Run `pnpm test`
3. Follow Conventional Commits format

See [CLAUDE.md](../CLAUDE.md) for coding standards.
