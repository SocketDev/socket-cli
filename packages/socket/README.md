# socket

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![npm version](https://img.shields.io/npm/v/socket.svg)](https://www.npmjs.com/package/socket)
[![npm downloads](https://img.shields.io/npm/dm/socket.svg)](https://www.npmjs.com/package/socket)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

Thin Socket CLI wrapper that downloads and delegates to @socketsecurity/cli.

## Installation

```bash
npm install -g socket
```

## Usage

```bash
socket --help
```

## How It Works

1. On first run, automatically downloads `@socketsecurity/cli` from npm
2. Caches CLI in `~/.socket/_dlx/cli/`
3. Delegates all commands to the cached CLI
4. Optionally uses platform-specific native binaries from `@socketbin/cli-*` packages

## Platform Binaries

This package optionally depends on platform-specific native binaries:

- `@socketbin/cli-darwin-arm64` - macOS Apple Silicon
- `@socketbin/cli-darwin-x64` - macOS Intel
- `@socketbin/cli-linux-arm64` - Linux ARM64
- `@socketbin/cli-linux-x64` - Linux x64
- `@socketbin/cli-alpine-arm64` - Alpine Linux ARM64
- `@socketbin/cli-alpine-x64` - Alpine Linux x64
- `@socketbin/cli-win32-arm64` - Windows ARM64
- `@socketbin/cli-win32-x64` - Windows x64

If a platform binary is available, it will be used. Otherwise, the bootstrap downloads the standard Node.js CLI.

## License

MIT
