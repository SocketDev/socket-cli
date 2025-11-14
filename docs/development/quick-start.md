# Quick Start

## Setup

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
nvm use          # Uses Node 24.10.0 from .nvmrc.
pnpm install
pnpm build
```

## Development

```bash
pnpm dev                              # Watch mode.
pnpm exec socket <command>            # Run CLI.
pnpm test:unit <glob>                 # Run tests (supports globs).
pnpm check                            # Lint and type check.
```

## Project Structure

Focus on `packages/cli/src/` for most changes. See [CLAUDE.md](../../CLAUDE.md) for coding standards.
