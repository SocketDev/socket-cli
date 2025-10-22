# @socketbin/sea

Native Node.js SEA (Single Executable Application) binary builder.

**This is a private package used for building Socket CLI binaries as a fallback.**

## What It Does

Builds Socket CLI as a Node.js SEA binary using the official Node.js SEA feature.

This is a fallback option when custom Node.js builds encounter issues.

## Building

```bash
cd packages/socketbin-native-node-sea
pnpm run build
```

## Supported Platforms

- macOS (x64, arm64)
- Linux (x64, arm64)
- Alpine Linux (x64, arm64)
- Windows (x64, arm64)

## Output

Built binaries in: `dist/`

## License

MIT
