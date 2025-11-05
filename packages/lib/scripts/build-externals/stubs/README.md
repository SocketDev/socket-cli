# External Dependency Stubs

This directory contains stub modules used during the external package bundling process to replace unused dependencies and reduce bundle size.

**Philosophy:** Be conservative. Only stub dependencies that are provably unused or already disabled.

## How It Works

The build-externals system bundles external npm dependencies (like pacote, cacache, make-fetch-happen) into standalone modules in `dist/external/`. During bundling, esbuild uses the stubs in this directory to replace dependencies we don't need.

The stub configuration lives in `../esbuild-config.mjs`, which maps module patterns to stub files:

```javascript
const STUB_MAP = {
  '^(encoding|iconv-lite)$': 'encoding.cjs',
  '^debug$': 'debug.cjs',
}
```

When esbuild encounters `require('encoding')` during bundling, it replaces it with the contents of `encoding.cjs` instead of bundling the entire encoding package.

## Stub Types

This directory provides both active stubs (currently in use) and utility stubs (available for future use):

### Utility Stubs (Available for Use)

**`empty.cjs`** - Empty object for unused modules
- Exports: `{}`
- Use case: Dependencies referenced but never executed

**`noop.cjs`** - No-op function for optional features
- Exports: Function that does nothing
- Use case: Logging, debugging, optional callbacks

**`throw.cjs`** - Error-throwing for unexpected usage
- Exports: Function that throws descriptive error
- Use case: Code paths that should never execute

### Active Stubs (Currently in Use)

**`encoding.cjs`** - Character encoding stub
- Replaces: `encoding`, `iconv-lite`
- Reason: We only use UTF-8, don't need legacy encoding support
- Size impact: ~9KB saved (pacote, make-fetch-happen)

**`debug.cjs`** - Debug logging stub
- Replaces: `debug` module
- Reason: Already compiled out via `process.env.DEBUG = undefined`
- Size impact: ~9KB saved

## Adding New Stubs

**Before adding a stub:**
1. Verify the dependency is truly unused via code analysis
2. Check if it's already disabled via esbuild `define` constants
3. Consider the risk - conservative only!

**To add a stub:**
1. Create stub file in this directory
2. Document what it replaces and why it's safe
3. Add entry to `STUB_MAP` in `../esbuild-config.mjs`
4. Test: `pnpm build && pnpm test`
5. Verify size savings: `du -sh dist/external`

## Testing Stubs

After adding stubs, verify:
1. Build succeeds: `pnpm build`
2. Tests pass: `pnpm test`
3. No runtime errors in dependent packages
4. Bundle size decreased as expected
