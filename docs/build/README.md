# Socket CLI Build System

## Quick Start

```bash
# Build CLI (smart caching)
pnpm build

# Force rebuild CLI + SEA for current platform
pnpm build --force

# Build SEA binaries for all platforms
pnpm build:sea

# Watch mode for development
pnpm dev
```

## Build Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Smart build (skips unchanged) |
| `pnpm build --force` | Force rebuild CLI + SEA for current platform |
| `pnpm build:sea` | Build SEA binaries for all platforms |
| `pnpm build:cli` | Build just CLI package |
| `pnpm dev` | Watch mode for development |

## What Gets Built

1. **CLI Package** (`@socketsecurity/cli`)
   - Main CLI application bundled with esbuild
   - Output: `packages/cli/dist/index.js`

2. **SEA Binary** (with `--force` or `build:sea`)
   - Single Executable Application (node-smol + CLI blob)
   - Output: `packages/cli/dist/sea/socket-<platform>-<arch>`

## Binary Downloads

Pre-built binaries are downloaded from socket-btm releases:
- **node-smol**: Minimal Node.js v24.10.0 binaries
- **Yoga WASM**: Terminal layout engine
- **Cache location**: `~/.socket/` directory

## Build Output

```
packages/cli/
├── dist/
│   ├── index.js              # Main CLI bundle
│   └── sea/                  # SEA binaries (with --force or build:sea)
│       ├── socket-darwin-arm64
│       ├── socket-darwin-x64
│       ├── socket-linux-arm64
│       ├── socket-linux-x64
│       └── socket-win-x64.exe
└── build/
    ├── cli.js                # Pre-compression CLI bundle
    └── yoga-sync.mjs         # Yoga WASM loader
```

## Requirements

```bash
node --version   # >=24.10.0
pnpm --version   # >=10.22.0
```

## Troubleshooting

**Build fails**: `pnpm install --frozen-lockfile`
**Slow build**: Use `pnpm build` (caching) instead of `--force`
**Clean rebuild**: `pnpm build --force`

## Related Documentation

- [Build/Dist Structure](build-dist-structure.md)
- [Node.js Build Quick Reference](node-build-quick-reference.md)
