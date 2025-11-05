# Getting Started

**Quick start guide** — Get up and running in 5 minutes.

---

## 📋 Prerequisites

```
Required:
 ✓ Node.js 20+ (LTS recommended)
 ✓ pnpm 9+
 ✓ Git

Optional:
 ✓ VS Code (recommended)
 ✓ GitHub CLI (gh)
```

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone the repository
git clone https://github.com/SocketDev/socket-lib.git
cd socket-lib

# Install dependencies
pnpm install

# Verify installation
pnpm test
```

**Expected output:**
```
✓ 4600+ tests passing
✓ 100% code coverage
✓ Build artifacts in dist/
```

---

### 2. Project Structure

```
socket-lib/
├── src/                    # Source code
│   ├── constants/          # Node.js, npm, package constants
│   ├── env/                # Environment variable getters (68+)
│   ├── effects/            # Visual effects (shimmer, pulse, ultra)
│   ├── lib/                # Core utilities
│   │   ├── fs/             # File system operations
│   │   ├── packages/       # Package management (npm, pnpm, yarn)
│   │   └── spawn/          # Process spawning utilities
│   ├── stdio/              # Terminal I/O utilities
│   ├── themes/             # Theme system (5 themes)
│   └── external/           # Vendored dependencies (41 packages)
│
├── test/                   # Test files (mirrors src/)
├── scripts/                # Build and utility scripts
├── .config/                # Tool configurations
│   └── vitest.config.mts   # Test configuration
└── docs/                   # Documentation
    ├── getting-started.md  # Development setup
    ├── build.md            # Build system details
    └── themes.md           # Theme system guide
```

---

### 3. Essential Commands

```bash
# Development
pnpm run dev              # Watch mode (auto-rebuild on changes)
pnpm build                # Production build
pnpm run clean            # Remove build artifacts

# Testing
pnpm test                 # Run all tests
pnpm run cover            # Run tests with coverage
pnpm test path/to/file    # Run specific test file

# Quality
pnpm run check            # Type check + lint
pnpm run lint             # Lint code
pnpm run fix              # Auto-fix formatting/lint issues

# Pre-commit
pnpm run fix && pnpm test # Recommended before committing
```

---

## 🏗️ Build System

**Stack:**
- **Compiler**: esbuild (fast TypeScript → CommonJS)
- **Types**: tsgo (TypeScript Native Preview)
- **Target**: ES2022, CommonJS output
- **Watch**: `pnpm run dev` for live rebuilds

**Build artifacts:**
```
dist/
├── *.js            # Compiled JavaScript (CommonJS)
├── *.d.ts          # TypeScript declarations
└── external/       # Bundled vendored dependencies
```

**Build time:** ~1-2 seconds (esbuild is fast!)

---

## 🧪 Testing

**Framework:** Vitest with v8 coverage

**Test structure:**
- Tests mirror `src/` structure
- File naming: `*.test.ts` (e.g., `spinner.test.ts` tests `spinner.ts`)
- Coverage requirement: 100%

**Common patterns:**

```typescript
// test/spinner.test.ts
import { describe, it, expect } from 'vitest'
import { Spinner } from '../src/spinner'

describe('Spinner', () => {
  it('creates spinner with text', () => {
    const spinner = Spinner({ text: 'Loading...' })
    expect(spinner.text).toBe('Loading...')
  })
})
```

**Running tests:**
```bash
pnpm test                           # All tests
pnpm test spinner                   # Tests matching "spinner"
pnpm run cover                      # With coverage report
```

---

## 💡 Development Workflow

### Making Changes

```
1. Create branch         → git checkout -b feature/my-change
2. Make changes          → Edit src/ files
3. Watch mode            → pnpm run dev (auto-rebuild)
4. Add tests             → test/ files with 100% coverage
5. Verify                → pnpm run fix && pnpm test
6. Commit                → Conventional commits format
7. Push & PR             → Open pull request
```

### Commit Message Format

```
type(scope): description

Examples:
  feat(spinner): add pulse animation support
  fix(fs): handle ENOENT in readJsonFile
  docs(themes): add usage examples
  test(spawn): add timeout test cases
```

**Types:** feat, fix, docs, style, refactor, test, chore

---

## 📚 Key Concepts

### 1. Path Aliases

Internal imports use path aliases defined in `tsconfig.json`:

```typescript
// ✓ Use path aliases
import { getCI } from '#env/ci'
import { NODE_MODULES } from '#constants/packages'

// ✗ Don't use relative imports for internal modules
import { getCI } from '../env/ci'  // Wrong!
```

### 2. Zero Dependencies

This library has **zero runtime dependencies**. All external code is vendored in `src/external/`.

### 3. CommonJS Output

While source is TypeScript/ESM, build output is CommonJS for maximum compatibility.

### 4. Environment Module Pattern

Environment getters are pure functions:

```typescript
// src/env/ci.ts
export function getCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1'
}
```

For testing, use the rewire module:

```typescript
import { setEnv, resetEnv } from '#env/rewire'

setEnv('CI', 'true')
expect(getCI()).toBe(true)
resetEnv()  // Clean up in afterEach
```

---

## 🎨 Visual Effects & Themes

The library includes 5 themes with visual effects:

```typescript
import { setTheme, Spinner } from '@socketsecurity/lib'

setTheme('ultra')  // 🌈 Rainbow shimmer
const spinner = Spinner({ text: 'Processing...' })
spinner.start()
```

**Available themes:** none, default, pulse, shimmer, ultra

See [docs/themes.md](./themes.md) for details.

---

## 🔧 Troubleshooting

### Tests Failing

```bash
# Clear cache and rebuild
pnpm run clean
pnpm install
pnpm test
```

### Build Errors

```bash
# Check TypeScript errors
pnpm run check

# Check for missing dependencies
pnpm install
```

### Coverage Not 100%

```bash
# Run coverage and see report
pnpm run cover

# Open HTML report
open coverage/index.html
```

---

## 📖 Additional Resources

- [Build System](./build.md) - Build architecture and vendored deps
- [Themes Documentation](./themes.md) - Theme system deep dive
- [CLAUDE.md](../CLAUDE.md) - Development standards
- [Main README](../README.md) - API overview

---

## 🆘 Getting Help

- **Issues:** [GitHub Issues](https://github.com/SocketDev/socket-lib/issues)
- **Discussions:** Ask questions in issue comments
- **Standards:** Check [CLAUDE.md](../CLAUDE.md) for coding conventions

---

## ✅ Checklist for First Contribution

- [ ] Cloned repo and installed dependencies
- [ ] Ran `pnpm test` successfully (4600+ tests passing)
- [ ] Read [CLAUDE.md](../CLAUDE.md) development standards
- [ ] Understand path aliases (`#env/*`, `#constants/*`, etc.)
- [ ] Know how to run tests (`pnpm test`)
- [ ] Know how to check code (`pnpm run check`)
- [ ] Understand commit message format (conventional commits)
- [ ] Ready to make your first PR!

**Welcome to socket-lib!** 🎉
