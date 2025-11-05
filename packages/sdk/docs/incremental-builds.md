# Incremental Builds

Guide to optimizing build performance during development.

## Quick Start

```bash
# Development mode with incremental builds (68% faster)
pnpm build --watch

# Production build (full rebuild)
pnpm build
```

## Performance Comparison

| Build Type | Time | Use Case |
|------------|------|----------|
| Full build | ~27ms | CI, production, clean builds |
| Incremental | ~9ms | Development, hot reload |
| **Improvement** | **68% faster** | Watch mode only |

## How It Works

The build system uses esbuild's incremental mode when `--watch` is enabled:

1. **First build**: Full compilation (~27ms)
2. **Subsequent builds**: Only changed files (~9ms)
3. **Smart caching**: Build metadata reused across rebuilds
4. **Type checking**: Runs in parallel with bundling

## Watch Mode Features

```bash
pnpm build --watch
```

**Capabilities:**
- Automatic rebuild on file changes
- Preserved build context for faster increments
- Terminal output shows rebuild times
- Errors displayed immediately

**Limitations:**
- Type declarations regenerated each time
- Cache not persisted across process restarts
- Memory footprint slightly higher (build context in memory)

## Development Workflow

**Recommended setup:**

```bash
# Terminal 1: Watch mode for builds
pnpm build --watch

# Terminal 2: Run tests
pnpm test --fast

# Terminal 3: Type checking (optional)
pnpm tsc --watch
```

## Configuration

Build configuration lives in:
- `scripts/build.mjs` - Main build orchestration
- `.config/esbuild.config.mjs` - esbuild settings
- `.config/tsconfig.dts.json` - Type declaration generation

## Optimization Tips

1. **Use watch mode for development**
   - 68% faster rebuilds
   - Immediate feedback loop
   - Lower cognitive load

2. **Skip checks for quick iterations**
   ```bash
   pnpm test --fast   # Skip lint/type checks
   ```

3. **Parallel workflows**
   - Build in one terminal
   - Tests in another
   - No waiting for sequential operations

4. **Clean builds when needed**
   ```bash
   pnpm clean         # Remove dist/
   pnpm build         # Fresh build
   ```

## Troubleshooting

**Issue: Build seems slow**
- Solution: Ensure you're using `--watch` flag
- Check: `NODE_ENV` not set to `production`

**Issue: Changes not reflected**
- Solution: Kill watch process and restart
- Check: Ensure file is not in `.gitignore`

**Issue: Type errors not shown**
- Solution: Run `pnpm tsc` separately
- Context: Watch mode prioritizes speed over type checking

## Implementation Details

**esbuild configuration:**
```javascript
{
  incremental: isWatch,  // Enable incremental mode
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  // ... other settings
}
```

**Watch mode detection:**
```javascript
const isWatch = process.argv.includes('--watch')
```

## Performance Metrics

**Measured on M1 Mac:**
- Full TypeScript build: ~27ms
- Incremental rebuild: ~9ms
- Type declaration generation: ~15ms (parallel)

**Total development cycle:**
- Edit → Save → Rebuild: < 50ms
- Edit → Save → Rebuild → Test: < 2s (with `--fast`)

## See Also

- `docs/getting-started.md` - Initial setup
- `docs/dev/scripts.md` - All available scripts
- `scripts/build.mjs` - Build script implementation
