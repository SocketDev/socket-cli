# build-infra

Shared build infrastructure utilities for Socket CLI. Provides esbuild plugins, GitHub release downloaders, and caching utilities for optimizing build processes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      build-infra                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  esbuild Plugins          GitHub Releases      Caching      │
│  ┌───────────────┐       ┌──────────────┐    ┌──────────┐  │
│  │ Unicode       │       │ API Client   │    │ SHA256   │  │
│  │ Transform     │       │ + Download   │    │ Content  │  │
│  │               │       │              │    │ Hashing  │  │
│  └───────────────┘       ├──────────────┤    └──────────┤  │
│                          │ Asset Cache  │    │ Skip     │  │
│                          │ (1hr TTL)    │    │ Regen    │  │
│                          └──────────────┘    └──────────┘  │
│                                                              │
│  Helpers                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ import.meta.url Banner (CommonJS compat)             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
         ┌──────────────────────────────────────┐
         │  Used By                             │
         ├──────────────────────────────────────┤
         │  • CLI esbuild configs               │
         │  • SEA binary build scripts          │
         │  • Asset download scripts            │
         └──────────────────────────────────────┘
```

## Purpose

This package centralizes build-time utilities that are shared across multiple Socket CLI build configurations. It provides:

1. **esbuild plugins** for code transformations required by SEA (Single Executable Application) binaries
2. **GitHub release utilities** for downloading node-smol and other build dependencies
3. **Extraction caching** to avoid regenerating files when source hasn't changed

## Modules

### esbuild Plugins

#### `unicodeTransformPlugin()`

Transforms Unicode property escapes (`\p{Property}`) into basic character classes for `--with-intl=none` compatibility. Required because node-smol binaries lack ICU support.

```javascript
import { unicodeTransformPlugin } from 'build-infra/lib/esbuild-plugin-unicode-transform'

export default {
  plugins: [unicodeTransformPlugin()],
}
```

**Transformations:**

- `/\p{Letter}/u` → `/[A-Za-z\u00AA...]/` (no flags)
- `/\p{ASCII}/u` → `/[\x00-\x7F]/`
- `new RegExp('\\p{Alphabetic}', 'u')` → `new RegExp('[A-Za-z...]', '')`

**Features:**

- Babel AST parsing for accurate regex detection
- Handles both regex literals and `RegExp` constructor calls
- Replaces unsupported patterns with `/(?:)/` (no-op)
- Removes `/u` and `/v` flags after transformation

### esbuild Helpers

#### `IMPORT_META_URL_BANNER`

Banner injection for `import.meta.url` polyfill in CommonJS bundles. Converts `__filename` to proper `file://` URL using Node.js `pathToFileURL()`.

```javascript
import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'

export default {
  banner: IMPORT_META_URL_BANNER,
  define: {
    'import.meta.url': '__importMetaUrl',
  },
}
```

**Generated code:**

```javascript
const __importMetaUrl = require('node:url').pathToFileURL(__filename).href
```

### GitHub Releases

Downloads assets from SocketDev/socket-btm releases with retry logic and caching. Used for node-smol binaries, AI models, and build tools.

#### `getLatestRelease(tool, options)`

Fetches the latest release tag for a tool from socket-btm.

```javascript
import { getLatestRelease } from 'build-infra/lib/github-releases'

const tag = await getLatestRelease('node-smol')
// Returns: 'node-smol-20250115-abc1234'
```

**Parameters:**

- `tool` (string) - Tool name prefix (e.g., 'node-smol', 'binject')
- `options.quiet` (boolean) - Suppress log messages

**Returns:** Latest tag string or `null` if not found

**Features:**

- Searches last 100 releases for matching prefix
- 1-hour TTL cache to avoid rate limiting
- 3 retry attempts with 5s backoff
- Respects `GH_TOKEN`/`GITHUB_TOKEN` env vars

#### `getReleaseAssetUrl(tag, assetName, options)`

Gets the browser download URL for a specific release asset.

```javascript
import { getReleaseAssetUrl } from 'build-infra/lib/github-releases'

const url = await getReleaseAssetUrl(
  'node-smol-20250115-abc1234',
  'node-linux-x64',
)
// Returns: 'https://github.com/SocketDev/socket-btm/releases/download/...'
```

**Parameters:**

- `tag` (string) - Release tag name
- `assetName` (string) - Asset filename
- `options.quiet` (boolean) - Suppress log messages

**Returns:** Download URL string or `null` if not found

#### `downloadReleaseAsset(tag, assetName, outputPath, options)`

Downloads a release asset with automatic redirect following.

```javascript
import { downloadReleaseAsset } from 'build-infra/lib/github-releases'

await downloadReleaseAsset(
  'node-smol-20250120-abc1234',
  'node-smol-linux-x64',
  '/path/to/output',
)
```

**Parameters:**

- `tag` (string) - Release tag name
- `assetName` (string) - Asset filename
- `outputPath` (string) - Local file path to write
- `options.quiet` (boolean) - Suppress log messages

**Features:**

- Automatic directory creation
- Progress logging (10s interval)
- 3 retry attempts with 5s delay
- Uses `browser_download_url` to avoid API quota consumption

## Usage Examples

### esbuild Configuration

```javascript
// .config/esbuild.cli.mjs
import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'
import { unicodeTransformPlugin } from 'build-infra/lib/esbuild-plugin-unicode-transform'

export default {
  entryPoints: ['src/cli.mts'],
  bundle: true,
  outfile: 'build/cli.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',

  banner: {
    js: `#!/usr/bin/env node\n${IMPORT_META_URL_BANNER.js}`,
  },

  define: {
    'import.meta.url': '__importMetaUrl',
  },

  plugins: [unicodeTransformPlugin()],
}
```

### Asset Download Script

```javascript
// scripts/download-node-smol.mjs
import {
  getLatestRelease,
  downloadReleaseAsset,
} from 'build-infra/lib/github-releases'

const tag = await getLatestRelease('node-smol')
const platform = process.platform
const arch = process.arch

await downloadReleaseAsset(
  tag,
  `node-${platform}-${arch}`,
  `build/node-smol-${platform}-${arch}`,
)
```

## Code Quality

### Patterns

**Consistent structure:**

- Clear module-level JSDoc comments
- Exported functions first, helpers last
- Descriptive parameter/return type documentation
- Error handling with informative messages

**Clean implementations:**

- Single responsibility per function
- Minimal external dependencies
- Pure transformations where possible
- Proper resource cleanup

**Babel compatibility:**

- Handles both ESM and CommonJS Babel exports (`traverseImport.default` fallback)
- Uses MagicString for efficient string transformations
- Preserves source positions for accurate replacements

### Issues Found

None. Code is clean, well-organized, and follows consistent patterns.

**Strengths:**

- Excellent separation of concerns
- Thorough documentation
- Robust error handling
- Smart caching to avoid rate limits
- Type definitions provided for TypeScript consumers

## Dependencies

- `@babel/parser` - JavaScript AST parsing
- `@babel/traverse` - AST traversal utilities
- `@socketsecurity/lib` - Logger, HTTP, caching, and fs utilities
- `magic-string` - Efficient string transformations

## Build Directory

The `build/downloaded/` directory stores cached GitHub release assets:

```
build/downloaded/
├── binject-{tag}-{platform}-{arch}
├── node-smol-{tag}-{platform}-{arch}
└── models-{tag}.tar.gz
```

Assets are cached per tag to avoid re-downloading across builds.

## Related Files

**Consumers:**

- `packages/cli/.config/esbuild.cli.mjs` - Main CLI bundle config
- `packages/cli/scripts/download-assets.mjs` - Unified asset downloader
- `packages/cli/scripts/sea-build-util/builder.mjs` - SEA binary builder

**Dependencies:**

- `@socketsecurity/lib` - Socket shared library (logging, HTTP, caching)

## Environment Variables

**GitHub API:**

- `GH_TOKEN` or `GITHUB_TOKEN` - GitHub API authentication (optional but recommended to avoid rate limits)

**Build configuration:**

- `SOCKET_BTM_NODE_SMOL_TAG` - Override node-smol release tag
- `SOCKET_BTM_BINJECT_TAG` - Override binject release tag
