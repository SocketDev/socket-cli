# Configuration Index

Comprehensive index of all shared configuration files and documentation for the socket-cli monorepo.

## Quick Links

- [Quick Reference](./quick-reference.md) - Copy-paste examples for common use cases
- [Usage Guide](./README.md) - Detailed usage documentation and examples
- [Architecture](../docs/shared-configuration-architecture.md) - Design principles and rationale
- [Migration Guide](../docs/configuration-migration.md) - Step-by-step migration instructions
- [Summary](../docs/configuration-summary.md) - Overview and roadmap

## Configuration Files

### TypeScript

| File | Purpose | Extends | Use When |
|------|---------|---------|----------|
| `tsconfig.base.json` | Base TypeScript configuration | - | All packages should extend this |
| `tsconfig.build.json` | Build outputs with declarations | `tsconfig.base.json` | Need to emit .d.ts files |
| `tsconfig.test.json` | Test files with relaxed rules | `tsconfig.base.json` | Test-specific type checking |

**Key Settings**:
- Target: ES2024
- Module: nodenext
- Strict: true
- exactOptionalPropertyTypes: true
- noUncheckedIndexedAccess: true

### Testing

| File | Purpose | Use When |
|------|---------|----------|
| `vitest.config.base.mts` | Base test runner configuration | All packages with tests |

**Key Settings**:
- Environment: node
- Pool: threads (isolate: false for performance)
- Timeout: 30 seconds
- Coverage: v8 provider with comprehensive settings

### Linting

| File | Purpose | Use When |
|------|---------|----------|
| `eslint.config.mjs` | ESLint flat config for entire monorepo | Applies automatically to all packages |

**Key Features**:
- TypeScript support
- Import ordering (eslint-plugin-import-x)
- Node.js rules (eslint-plugin-n)
- Sort destructured keys
- Biome and .gitignore pattern integration

### Build Utilities

| File | Purpose | Use When |
|------|---------|----------|
| `esbuild-inject-import-meta.mjs` | Import.meta.url polyfill | esbuild configs bundling to CommonJS |

## Documentation Files

### In .config/

| File | Lines | Purpose |
|------|-------|---------|
| `README.md` | 145 | Usage documentation with examples |
| `quick-reference.md` | 280 | Quick copy-paste reference |
| `index.md` | This file | Index of all configuration files |

### In docs/

| File | Lines | Purpose |
|------|-------|---------|
| `shared-configuration-architecture.md` | 287 | Design principles, rationale, patterns |
| `configuration-migration.md` | 297 | Step-by-step migration guide |
| `configuration-summary.md` | 295 | Overview and migration roadmap |

## Common Use Cases

### New Package

1. Create `tsconfig.json` extending base config
2. Create `vitest.config.mts` merging base config
3. No ESLint config needed (root config applies)

See: [Quick Reference](./quick-reference.md) for examples

### Existing Package Migration

1. Read current configs to identify custom settings
2. Replace with extended/merged configs
3. Keep only package-specific overrides
4. Test builds and tests

See: [Migration Guide](../docs/configuration-migration.md) for details

### Custom TypeScript Paths

1. Extend base config
2. Add `compilerOptions.paths` for custom mappings
3. Keep include/exclude specific to package

See: [README.md](./README.md) - "TypeScript - Type Checking Config"

### Custom Test Settings

1. Merge base vitest config
2. Override specific settings (timeout, coverage, etc.)
3. Add setupFiles if needed

See: [README.md](./README.md) - "Vitest - Package Config"

## Directory Layout

```
.config/
├── index.md                      # This file
├── README.md                     # Usage guide
├── quick-reference.md            # Quick reference
├── tsconfig.base.json            # Base TypeScript
├── tsconfig.build.json           # Build TypeScript
├── tsconfig.test.json            # Test TypeScript
├── vitest.config.base.mts        # Base Vitest
├── eslint.config.mjs             # ESLint flat config
└── esbuild-inject-import-meta.mjs # Import.meta polyfill

docs/
├── shared-configuration-architecture.md # Design doc
├── configuration-migration.md          # Migration guide
└── configuration-summary.md            # Summary & roadmap
```

## Configuration Matrix

### TypeScript Config Usage

| Package Type | Config | Extends | Custom Settings |
|-------------|--------|---------|-----------------|
| Simple package | tsconfig.json | `../../.config/tsconfig.base.json` | include/exclude only |
| Package with paths | tsconfig.json | `../../.config/tsconfig.base.json` | + compilerOptions.paths |
| Build package | tsconfig.json | `../../.config/tsconfig.build.json` | + outDir, rootDir |

### Vitest Config Usage

| Package Type | Config | Merges | Custom Settings |
|-------------|--------|---------|-----------------|
| Simple package | vitest.config.mts | `../../.config/vitest.config.base.mts` | include only |
| With setup | vitest.config.mts | base | + setupFiles |
| Custom timeout | vitest.config.mts | base | + testTimeout |
| Custom coverage | vitest.config.mts | base | + coverage.thresholds |

## Key Decisions

### Why isolate: false in Vitest?

- 2-3x performance improvement
- Required for nock HTTP mocking
- Required for vi.mock() module mocking
- Test pollution prevented by proper cleanup
- See [Architecture](../docs/shared-configuration-architecture.md) for details

### Why noUncheckedIndexedAccess?

- Prevents runtime errors from undefined access
- TypeScript best practice
- Enforces defensive programming
- See [Architecture](../docs/shared-configuration-architecture.md) for details

### Why type-aware linting disabled?

- Causes performance issues on large codebases
- Can hang for minutes
- Most type errors caught by TypeScript anyway
- See [Architecture](../docs/shared-configuration-architecture.md) for details

## Migration Status

### Completed

- [x] Shared configuration architecture designed
- [x] Configuration files created
- [x] Documentation written
- [x] Examples provided

### Next Steps

- [ ] Migrate simple packages (socketbin-*, cli-with-sentry, socket)
- [ ] Migrate complex package (cli)
- [ ] Align root configs
- [ ] Update CI/CD if needed

### Migration Order

1. **Phase 2**: Simple packages (4 packages, low risk)
2. **Phase 3**: Complex package (cli, medium risk)
3. **Phase 4**: Root alignment (optional)

## Support

### For Usage Questions

1. Check [Quick Reference](./quick-reference.md) for common patterns
2. Review [README.md](./README.md) for detailed examples
3. Compare with similar packages

### For Migration Questions

1. Check [Migration Guide](../docs/configuration-migration.md)
2. Review [Summary](../docs/configuration-summary.md) for roadmap
3. Check migrated packages for examples

### For Design Questions

1. Review [Architecture](../docs/shared-configuration-architecture.md)
2. Check rationale sections for key decisions
3. Document edge cases for future reference

## Updates

When updating shared configuration:

1. Update the relevant config file in `.config/`
2. Test with a sample package
3. Document breaking changes
4. Update this index if structure changes
5. Notify team of changes

## Version History

- **2024-10-24**: Initial shared configuration architecture created
  - 8 configuration files
  - 3 documentation files
  - Migration guide and roadmap

## See Also

- [Root tsconfig.json](../tsconfig.json) - Root TypeScript config
- [Root vitest.config.mts](../vitest.config.mts) - Root Vitest config
- [Root biome.json](../biome.json) - Biome formatter config
- [packages/cli/.config/](../packages/cli/.config/) - Example of package-specific configs
