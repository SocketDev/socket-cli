# Socket CLI Monorepo Guide

This document explains the monorepo structure and how the different packages relate to each other.

## Package Overview

### Three Release Builds

Socket CLI releases three distinct npm packages:

1. **`@socketsecurity/cli`** - Full JavaScript CLI implementation
2. **`@socketsecurity/cli-with-sentry`** - Full JavaScript CLI with Sentry telemetry
3. **`socket`** - Thin wrapper that downloads `@socketsecurity/cli` on demand

### Platform Binary Packages (8 total)

Optional platform-specific native binaries:

- `@socketbin/cli-darwin-arm64` - macOS Apple Silicon
- `@socketbin/cli-darwin-x64` - macOS Intel
- `@socketbin/cli-linux-arm64` - Linux ARM64 (glibc)
- `@socketbin/cli-linux-x64` - Linux x64 (glibc)
- `@socketbin/cli-alpine-arm64` - Alpine Linux ARM64 (musl)
- `@socketbin/cli-alpine-x64` - Alpine Linux x64 (musl)
- `@socketbin/cli-win32-arm64` - Windows ARM64
- `@socketbin/cli-win32-x64` - Windows x64

### Private Build Tools (2 total)

- `@socketbin/custom-node` - Builds custom Node.js from source with Socket patches
- `@socketbin/sea` - Builds Socket CLI as native Node.js SEA binaries (fallback)

## Directory Structure

```
socket-cli/
├── packages/
│   ├── cli/                                    # @socketsecurity/cli
│   │   ├── src/                                # CLI source code
│   │   ├── bin/                                # CLI entry points
│   │   ├── test/                               # Tests
│   │   ├── data/                               # Static data
│   │   └── package.json
│   │
│   ├── socket/                                 # socket (thin wrapper)
│   │   ├── bin/
│   │   │   ├── socket.js                       # Entry point
│   │   │   └── bootstrap.js                    # Bootstrap logic
│   │   └── package.json
│   │
│   ├── socketbin-custom-node-from-source/      # Custom Node.js builder
│   │   ├── build/
│   │   │   ├── patches/                        # Socket security patches
│   │   │   └── additions/                      # Additional C++ code
│   │   ├── scripts/
│   │   │   └── build.mjs                       # Build script
│   │   └── package.json
│   │
│   ├── socketbin-native-node-sea/              # SEA builder
│   │   ├── scripts/
│   │   │   ├── build.mjs                       # SEA build script
│   │   │   └── publish.mjs                     # Publish script
│   │   └── package.json
│   │
│   └── socketbin-cli-{platform}-{arch}/        # 8 platform packages
│       ├── bin/
│       │   └── socket (or socket.exe)          # Native binary
│       └── package.json
│
├── pnpm-workspace.yaml                         # pnpm workspace config
└── package.json                                # Root workspace