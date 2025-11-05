# Build Architecture

Socket Lib's build system optimizes for zero runtime dependencies while supporting vendored packages.

## Quick Reference

| Task | Command | Purpose |
|------|---------|---------|
| **Full build** | `pnpm run build` | Complete production build |
| **JavaScript only** | `pnpm run build:js` | Compile TypeScript → JavaScript |
| **Types only** | `pnpm run build:types` | Generate .d.ts files |
| **Bundle externals** | `pnpm run build:externals` | Bundle vendored dependencies |
| **Fix exports** | `pnpm run fix:exports` | Fix CommonJS exports |
| **Watch mode** | `pnpm run dev` | Auto-rebuild on changes |
| **Clean** | `pnpm run clean` | Remove dist/ |
| **Validate** | `pnpm run validate:externals` | Check dependency rules |

---

## Core Concept

**Dependency Strategy:**
```
┌──────────────────────────────────────────────────────────┐
│                Production Build Strategy                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Vendored (Bundled in dist/)     Runtime (Dependencies)  │
│  ├─ Socket packages               @socketregistry/       │
│  ├─ Small utilities                 packageurl-js        │
│  ├─ Tight version control           (1 runtime dep)     │
│  └─ Type definitions                                     │
│                                                           │
│  Goal: Minimize dependencies, maximize control           │
└──────────────────────────────────────────────────────────┘
```

**When to Vendor vs Runtime:**

| Factor | Vendor (src/external/) | Runtime (dependencies) |
|--------|------------------------|------------------------|
| **Size** | Small utilities | Large/complex packages |
| **Ownership** | Socket-owned packages | Third-party packages |
| **Version control** | Need tight control | Standard semver OK |
| **Updates** | Rarely changes | Frequent updates |
| **Examples** | yoctocolors-cjs, ansi-regex | @socketregistry/packageurl-js |

---

## Build Pipeline

**Complete Build Flow:**
```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐       ┌─────────────┐
│   Source    │       │   Compile    │       │ Post-Process │       │   Output    │
│   (src/)    │──────→│   (esbuild)  │──────→│  (scripts/)  │──────→│   (dist/)   │
└─────────────┘       └──────────────┘       └──────────────┘       └─────────────┘
     ↓                      ↓                       ↓                      ↓
 ├─ *.ts               - CommonJS              - Fix exports          ├─ *.js
 ├─ external/          - ES2022                - Bundle deps          ├─ *.d.ts
 ├─ themes/            - Preserve modules      - Validate             └─ external/
 └─ lib/               - ~1.6s (parallel)      - ~300ms
     ↓
 tsgo (types)
 ~2s (parallel)
```

**Build Steps Breakdown:**

| Step | Tool | Input | Output | Time |
|------|------|-------|--------|------|
| 1️⃣ **Clean** | fs.rm | `dist/` | Empty dir | ~10ms |
| 2️⃣ **Compile JS** | esbuild | `src/**/*.ts` | `dist/**/*.js` | ~1.6s |
| 3️⃣ **Generate Types** | tsgo | `src/**/*.ts` | `dist/**/*.d.ts` | ~2s |
| 4️⃣ **Bundle Externals** | esbuild | `src/external/` | `dist/external/` | ~200ms |
| 5️⃣ **Fix Exports** | Babel AST | `dist/**/*.js` | Fixed CommonJS | ~100ms |
| 6️⃣ **Validate** | Custom | `dist/` | Checks pass | ~50ms |

**Total: ~4s** (steps 2 & 3 run in parallel)

**Key Tools:**

| Tool | Purpose | Why This Tool? |
|------|---------|----------------|
| **esbuild** | TypeScript → JavaScript | Written in Go, extremely fast (~1.6s) |
| **tsgo** | Type definitions (.d.ts) | TypeScript Native Preview, Rust-based |
| **Babel AST** | Post-build transforms | Surgical code changes with source maps |

---

## Dependency Types

### Runtime Dependencies (package.json)

```json
{
  "dependencies": {
    "@socketregistry/packageurl-js": "1.3.0"
  }
}
```

| Criteria | Decision |
|----------|----------|
| **Use when** | Package is large or complex |
| | Package needs separate versioning |
| | Package is already a published dependency |
| | Frequent security/bug updates expected |
| **Current Count** | 1 runtime dependency |

### Vendored Dependencies (src/external/)

```
src/external/
├── @socketregistry/
│   ├── is-unicode-supported.js    # Small utility
│   ├── ansi-regex.js              # Tight control needed
│   └── strip-ansi.js              # Socket-owned
├── yoctocolors-cjs/               # Color utilities
└── ... (40+ packages)             # Bundle in dist/
```

| Criteria | Decision |
|----------|----------|
| **Use when** | Small utility packages (<50 KB) |
| | Socket-owned packages |
| | Tight version control needed |
| | Reducing dependency tree |
| **Current Count** | 40+ vendored packages |

---

## Import Rules

**Visual Decision Tree:**
```
Is it in src/external/?
    ├─ YES → Vendored code
    │         ├─ Inside src/external/ → Implement directly
    │         └─ Outside src/external/ → Use relative path
    └─ NO → Runtime dependency
              └─ Use bare import (must be in ALLOWED list)
```

### Import Pattern Reference

| Location | Dependency Type | Import Style | Example |
|----------|----------------|--------------|---------|
| **Inside src/external/** | Vendored code | Direct implementation | `module.exports = function() { ... }` |
| **Outside src/external/** | Vendored | Relative path | `import foo from '../external/foo'` |
| **Anywhere** | Runtime | Bare import | `import { PackageURL } from '@socketregistry/packageurl-js'` |

### Examples

**✅ Correct Patterns:**

```typescript
// 1. Runtime dependency (in ALLOWED_EXTERNAL_PACKAGES)
import { PackageURL } from '@socketregistry/packageurl-js'

// 2. Vendored dependency (relative path)
import isUnicodeSupported from '../external/@socketregistry/is-unicode-supported'
import colors from '../external/yoctocolors-cjs'

// 3. Internal module (path alias)
import { getCI } from '#env/ci'
```

**❌ Wrong Patterns:**

```typescript
// ❌ Bare import for vendored package
import isUnicodeSupported from '@socketregistry/is-unicode-supported'

// ❌ Relative import for runtime dependency
import { PackageURL } from '../../../node_modules/@socketregistry/packageurl-js'

// ❌ Unapproved runtime dependency
import axios from 'axios'  // Not in ALLOWED list
```

---

## Build Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `pnpm run build` | Full production build | Before release/testing |
| `pnpm run build:js` | Compile TypeScript → JavaScript | JS changes only |
| `pnpm run build:types` | Generate .d.ts files | Type changes only |
| `pnpm run build:externals` | Bundle external dependencies | After vendoring new package |
| `pnpm run fix:exports` | Fix CommonJS exports | After build troubleshooting |
| `pnpm run dev` | Watch mode (auto-rebuild) | Active development |
| `pnpm run clean` | Remove dist/ | Clean slate rebuild |
| `pnpm run validate:externals` | Check dependency rules | After adding dependencies |

---

## Build Scripts

All build scripts are Node.js modules (`.mjs`) for cross-platform compatibility:

```
scripts/
├── build.mjs                       # Main build orchestrator
├── build-js.mjs                    # esbuild JavaScript compilation
├── build-externals.mjs             # Bundle external dependencies
├── fix-commonjs-exports.mjs        # Post-build CommonJS fixes
├── fix-default-imports.mjs         # Fix default import patterns
├── validate-external.mjs           # Dependency validation
└── babel/
    ├── transform-commonjs-exports.mjs  # AST transformations
    └── README.md                       # Transform documentation
```

**No shell scripts (`.sh`)** — Node.js only for cross-platform compatibility (Windows support).

## Post-Build Transformations

### CommonJS Export Fixes

TypeScript compiles `export default X` to `exports.default = X`, requiring `.default` accessor. We fix this:

```javascript
// Before (TypeScript output)
exports.default = WIN32

// After (our fix)
module.exports = WIN32
```

This allows cleaner imports:

```javascript
// ✅ After fix
const WIN32 = require('./WIN32')

// ❌ Before fix
const WIN32 = require('./WIN32').default
```

### External Bundling

Vendored dependencies are bundled during build:

```javascript
// Build bundles src/external/* → dist/external/*
// Preserves module structure for selective imports
```

## Validation

`scripts/validate-external.mjs` ensures:

✅ All `src/external/` packages are properly vendored (no bare imports)
✅ Only allowed runtime dependencies are used
✅ No accidental external package imports

```bash
pnpm run validate:externals
```

---

## Adding Dependencies

### Adding a Runtime Dependency

| Step | Action | Command/Code |
|------|--------|--------------|
| 1 | Install package | `pnpm add @socketregistry/new-package` |
| 2 | Add to allowed list | Edit `scripts/validate-external.mjs` |
| 3 | Use in code | `import { Thing } from '@socketregistry/new-package'` |
| 4 | Validate | `pnpm run validate:externals` |

**Allowed list example:**
```javascript
const ALLOWED_EXTERNAL_PACKAGES = [
  '@socketregistry/packageurl-js',
  '@socketregistry/new-package',  // ← Add here
]
```

### Vendoring a Package

| Step | Action | Command/Code |
|------|--------|--------------|
| 1 | Copy source | `mkdir -p src/external/@socketregistry/my-util`<br>`cp node_modules/@socketregistry/my-util/index.js src/external/@socketregistry/my-util/` |
| 2 | Import with relative path | `import myUtil from '../external/@socketregistry/my-util'` |
| 3 | Build | `pnpm run build` |
| 4 | Validate | `pnpm run validate:externals` |

---

## Performance

### Build Times

| Step | Time | Tool |
|------|------|------|
| Clean | ~10ms | fs.rm |
| JavaScript | ~1.6s | esbuild |
| Types | ~2s | tsgo |
| Externals | ~200ms | esbuild |
| Post-process | ~100ms | Babel AST |
| **Total** | **~4s** | |

### Optimization Strategies

| Strategy | Benefit | Impact |
|----------|---------|--------|
| **Parallel builds** | JavaScript and types compile concurrently | ~50% faster |
| **Incremental** | Only rebuild changed files in watch mode | Near-instant rebuilds |
| **Native tools** | esbuild (Go), tsgo (Rust) | 10-100x faster than JS tools |
| **No bundling** | Preserve module structure | Faster than Rollup/Webpack |

---

## Build Output

```
dist/
├── constants/
│   ├── packages.js
│   ├── packages.d.ts
│   └── ...
├── env/
│   ├── ci.js
│   ├── ci.d.ts
│   └── ...
├── external/
│   ├── @socketregistry/
│   └── ...
├── effects/
├── stdio/
├── themes/
└── ... (matches src/ structure)
```

**Format:** CommonJS (`.js`) + TypeScript definitions (`.d.ts`)

**Target:** ES2022 (Node.js 20+)

---

## Troubleshooting

### Build Fails

**Quick fixes:**
```bash
pnpm run build                  # Check build output
pnpm run clean && pnpm run build # Clean rebuild
```

| Issue | Symptom | Solution |
|-------|---------|----------|
| Missing dist/ | `Cannot find module` errors | Run `pnpm run build` |
| TypeScript errors | Build fails with type errors | Run `pnpm run check` |
| Path alias issues | Module not found | Check `tsconfig.json` paths match src/ structure |
| Stale cache | Outdated output | Run `pnpm run clean` first |

### Validation Errors

**Check dependencies:**
```bash
pnpm run validate:externals
```

| Issue | Symptom | Solution |
|-------|---------|----------|
| Bare import in vendored code | Validation error | Use relative path: `'../external/pkg'` |
| Unapproved dependency | Import not in ALLOWED list | Add to `ALLOWED_EXTERNAL_PACKAGES` in `scripts/validate-external.mjs` |
| Missing vendored file | Module not found | Copy to `src/external/` |

### Watch Mode Not Working

| Issue | Solution |
|-------|----------|
| Port already in use | Kill existing process: `pkill -f "pnpm dev"` |
| Changes not detected | Restart: `pnpm run dev` |
| Build errors | Check console output for specific error |

---

## Advanced: Babel Transformations

Socket Lib uses Babel AST + magic-string for post-build transformations.

**Pattern:**
1. Parse with Babel → Get AST
2. Walk with Babel traverse → Find nodes
3. Edit with magic-string → Surgical changes
4. Preserve source maps → magic-string maintains mappings

**Available Transforms:**
- `transform-commonjs-exports.mjs` — Fix `exports.default`
- See `scripts/babel/README.md` for details

## References

- [esbuild Documentation](https://esbuild.github.io/)
- [tsgo Repository](https://github.com/microsoft/TypeScript/tree/main/src/tsgo)
- [Babel Parser](https://babeljs.io/docs/babel-parser)

---

**Back to:** [Getting Started](./getting-started.md) · [README](../README.md)
