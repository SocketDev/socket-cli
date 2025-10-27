# @socketbin/cli-ai Build Process

This package contains WASM binaries for Socket CLI.

## Build Steps

### 1. Build WASM Assets

```bash
# From monorepo root
cd packages/socketbin-cli-ai
pnpm run build
```

This generates compiled WASM binaries and JS loaders in `dist/`.

### 2. Compression

WASM binaries are compressed using brotli and base64-encoded for smaller package size:

1. **Compression**: WASM binary compressed with brotli
2. **Encoding**: Compressed binary encoded as base64
3. **Output**: Saved as `ai.bz` (brotli-compressed, base64-encoded)
4. **Loading**: `ai.js` handles base64 decoding and brotli decompression

### 3. JavaScript API

The package exports synchronous functions and a type:

```typescript
export type AiShape = Float32Array

export function analyze(text: string): AiShape
export function synthesize(shape: AiShape, maxTokens?: number): string
export function summarize(text: string, maxTokens?: number): string
```

- Auto-initializes WASM module on first call
- `analyze()`: Convert text to AI shape for comparison and classification
- `synthesize()`: Generate text from AI shape
- `summarize()`: Convenience method that combines analyze + synthesize
- All operations are synchronous

### 4. Publish to npm

```bash
# Manual publish (for initial versions)
cd packages/socketbin-cli-ai
npm version 1.0.0 --no-git-tag-version
npm publish --access public

# Or use workflow
gh workflow run publish-socketbin.yml --field version=1.0.0
```

## Package Structure

```
packages/socketbin-cli-ai/
├── package.json           # Package metadata
├── README.md             # User-facing documentation
├── BUILD.md              # This file (build instructions)
├── build/                # Build intermediates (gitignored)
└── dist/                 # Compressed binaries and JS loaders
    ├── ai.bz             # Brotli-compressed, base64-encoded WASM
    └── ai.js             # Loader with decompression logic
```

## Automatic Publishing

The `publish-socketbin.yml` workflow automatically updates the version and publishes this package alongside binary packages.

## Usage in CLI

The CLI automatically downloads this package on-demand when advanced code analysis features are used:

1. **Preflight download**: Silently downloads in background on first CLI run
2. **On-demand download**: Downloads when `socket ask` uses advanced analysis
3. **Cached**: Package manager caches models for instant reuse

## Notes

- Compressed binaries reduce package size significantly
- Base64 encoding ensures safe transport through npm registry
- Brotli decompression happens transparently in `ai.js`
- Binaries are loaded on-demand via package manager dlx pattern
- Version must stay in sync with other `@socketbin/*` packages
