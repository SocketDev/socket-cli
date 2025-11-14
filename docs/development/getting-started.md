# Getting Started

Quick start for Socket CLI development.

## Prerequisites

- Node.js 18+ ([download](https://nodejs.org/))
- pnpm 10.22+ (`npm install -g pnpm` or `corepack enable`)
- Git 2.0+

## Setup

```bash
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli
pnpm install
pnpm run build
pnpm test
```

## Common Commands

```bash
pnpm run build          # Build CLI
pnpm test               # Run all tests
pnpm test:unit          # Run unit tests only
pnpm run check          # Type check + lint
pnpm exec socket        # Run CLI locally
```

## Development

1. Make changes in `packages/cli/src/`
2. Run `pnpm run build`
3. Test with `pnpm test`
4. Follow [Conventional Commits](https://www.conventionalcommits.org/)

See [CLAUDE.md](../../CLAUDE.md) for coding standards.

## Troubleshooting

**Tests failing?**
```bash
pnpm run build          # Ensure fresh build
pnpm test               # Run again
```

**Cache issues?**
```bash
pnpm run setup --skip-gh-cache
pnpm run clean
pnpm install
```
