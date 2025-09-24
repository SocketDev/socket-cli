# Socket CLI Self-Executable Application (SEA)

Build self-contained executables using Node.js SEA.

## Platform Support Status

| Platform | x64 | ARM64 | Status |
|----------|-----|-------|--------|
| Linux    | ✅   | ✅     | Stable |
| macOS    | ✅   | ✅     | Stable |
| Windows  | ✅   | ✅     | Stable |

> **Note**: See [`docs/SEA_PLATFORM_SUPPORT.md`](../../docs/SEA_PLATFORM_SUPPORT.md) for platform-specific implementation details.

## Architecture

The executable is a **thin wrapper** that downloads `@socketsecurity/cli` from npm on first use.

Contains:
- Node.js runtime
- Bootstrap code to download CLI
- No actual CLI implementation

On first run:
1. Downloads `@socketsecurity/cli` from npm
2. Installs to `~/.socket/cli/`
3. Runs with your arguments

## Files

- **bootstrap.mts** - Thin wrapper that downloads CLI from npm
- **build-sea.mts** - Build script for creating executables

## Building

```bash
# Build for current platform
pnpm build:sea

# Build for specific platform/arch
pnpm build:sea -- --platform=darwin --arch=arm64

# Use specific Node version
pnpm build:sea -- --node-version=20.11.0
```

### Options

- `--platform=<platform>` - Target platform (win32, darwin, linux)
- `--arch=<arch>` - Target architecture (x64, arm64)
- `--node-version=<version>` - Node.js version (default: 20.11.0)
- `--output-dir=<path>` - Output directory (default: dist/sea)

## Output

Executables in `dist/sea/`:
- `socket-win-x64.exe` - Windows x64
- `socket-win-arm64.exe` - Windows ARM64
- `socket-macos-x64` - macOS Intel
- `socket-macos-arm64` - macOS Apple Silicon
- `socket-linux-x64` - Linux x64
- `socket-linux-arm64` - Linux ARM64

## Usage

```bash
./dist/sea/socket-macos-arm64 --version
./dist/sea/socket-macos-arm64 scan .
./dist/sea/socket-macos-arm64 <command> [options]
```

First run downloads CLI from npm. Subsequent runs use cached version.

## How It Works

1. **First Run**: Downloads `@socketsecurity/cli` from npm to `~/.socket/cli/`
2. **Subsequent Runs**: Uses cached CLI
3. **Requirements**: System Node.js required to run downloaded CLI

## Publishing

### NPM Package

The `socket` npm package provides a thin wrapper that downloads platform-specific binaries:

```bash
# Publish to npm (builds binaries and uploads to GitHub first)
pnpm publish:sea

# Publish only to npm (assumes GitHub release exists)
pnpm publish:sea:npm --version=1.0.0
```

### GitHub Releases

Binaries are attached to GitHub releases for direct download:

```bash
# Upload binaries to GitHub release
pnpm publish:sea:github --version=1.0.0
```

### Distribution

Three distribution methods:
1. **npm package (`socket`)** - Downloads binary on install
2. **npm package (`@socketsecurity/cli`)** - Full source distribution
3. **GitHub releases** - Direct binary downloads

### Workflow

The GitHub workflow automatically:
1. Builds binaries for all platforms
2. Uploads to GitHub release
3. Publishes `socket` package to npm

## Notes

- Small binary contains only bootstrap code
- CLI downloaded on first use
- Cached at `~/.socket/cli/`
- Requires Node.js installed on system