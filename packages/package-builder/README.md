# Package Builder

Automated package generation system for Socket CLI distribution. Transforms templates into publishable npm packages for multiple distribution channels and platforms.

## Table of Contents

- [Architecture](#architecture)
- [Distribution Strategy](#distribution-strategy)
  - [Tool Management](#tool-management)
- [Package Types](#package-types)
  - [CLI Packages](#cli-packages)
  - [Socket Wrapper Package](#socket-wrapper-package)
  - [cli.exe Tail Packages](#cliexe-tail-packages)
  - [Socketbin Packages (legacy)](#socketbin-packages-legacy)
- [Generator Scripts](#generator-scripts)
  - [generate-cli-packages.mjs](#generate-cli-packagesmjs)
  - [generate-cli-exe-packages.mts](#generate-cli-exe-packagesmts)
  - [generate-socketbin-packages.mjs](#generate-socketbin-packagesmjs)
- [Build Process](#build-process)
  - [CLI Package Build](#cli-package-build)
- [Template Structure](#template-structure)
  - [CLI Package Template](#cli-package-template)
  - [Socketbin Package Template](#socketbin-package-template)
- [Package Validation](#package-validation)
- [Build Output](#build-output)
- [Integration Points](#integration-points)
  - [Dependencies on Main CLI](#dependencies-on-main-cli)
  - [esbuild Configuration](#esbuild-configuration)
  - [Version Synchronization](#version-synchronization)
- [Usage](#usage)
  - [Generate All Packages](#generate-all-packages)
  - [Generate Individual Package Type](#generate-individual-package-type)
  - [Build Generated Package](#build-generated-package)
  - [Verify Generated Package](#verify-generated-package)
- [Design Patterns](#design-patterns)
  - [Template-Based Generation](#template-based-generation)
  - [Platform Abstraction](#platform-abstraction)
  - [Build Delegation](#build-delegation)
  - [Optional Binary Dependencies](#optional-binary-dependencies)
- [Code Quality Observations](#code-quality-observations)
  - [Strengths](#strengths)
  - [Patterns](#patterns)
  - Potential Improvements
- [Summary](#summary)

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Package Builder                          │
│                                                                 │
│  Templates + Scripts → Generated Build Artifacts               │
└─────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │  Templates   │
                              │              │
                              │  • cli       │
                              │  • cli-sentry│
                              │  • socket    │
                              │  • cli-exe   │
                              │  • socketbin │
                              └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
              │  Scripts   │   │  Scripts   │   │  Scripts   │
              │            │   │            │   │            │
              │ generate-  │   │ generate-  │   │ generate-  │
              │    cli     │   │  socketbin │   │   socket   │
              └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                    │               │               │
              ┌─────▼──────────────▼──────────────▼─────┐
              │           Build Directory                │
              │                                          │
              │  Generated Packages:                     │
              │  • cli/                (npm package)     │
              │  • cli-with-sentry/    (npm package)     │
              │  • cli.exe.*/          (8 platforms)     │
              │  • socketbin-cli-*/    (legacy, frozen)  │
              └──────────────────────────────────────────┘
```

## Distribution Strategy

Socket CLI uses a multi-channel distribution approach with VFS-based tool bundling:

```text
┌────────────────────────────────────────────────────────────┐
│                 Distribution Channels                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. socket (npm wrapper)                                   │
│     └─→ optionalDependencies → Installs platform binary   │
│         Binary contains: CLI + VFS with external tools     │
│         First run: Extract tools from VFS → cache          │
│                                                            │
│  2. @socketsecurity/cli                                    │
│     └─→ Pure JavaScript (no VFS)                           │
│         First run: Lazy download tools from GitHub         │
│         Tools cached in ~/.socket/vfs-tools/               │
│                                                            │
│  3. @socketsecurity/cli-with-sentry                        │
│     └─→ Pure JavaScript + Sentry telemetry (no VFS)        │
│         First run: Lazy download tools from GitHub         │
│         Tools cached in ~/.socket/vfs-tools/               │
│                                                            │
│  4. @socketsecurity/cli.exe.<triplet>                      │
│     └─→ SEA binary with embedded VFS (8 variants)          │
│         • darwin-arm64, darwin-x64                         │
│         • linux-arm64, linux-arm64-musl                    │
│         • linux-x64, linux-x64-musl                        │
│         • win32-arm64, win32-x64                           │
│         Binary contains: CLI code + external tools in VFS  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Tool Management

**VFS (Virtual File System) - For Binaries:**

- External tools embedded in binary at build time
- Tools: Python, OpenGrep, Trivy, TruffleHog, npm packages
- First run: Extract from VFS → `~/.socket/vfs-tools/`
- No network required for tool installation

**Lazy Download - For Pure JS Packages:**

- External tools downloaded from GitHub releases on first run
- Same tools as VFS binaries
- Cached in `~/.socket/vfs-tools/` (same location)
- Network required only on first run

## Package Types

### CLI Packages

Standard Node.js implementations with all CLI functionality.

#### @socketsecurity/cli

- Pure JavaScript CLI package (no binaries, no VFS).
- No telemetry.
- Built from `templates/cli-package/`.
- Includes: Main CLI + npm/npx/pnpm/yarn wrappers.
- Lazy downloads external tools from GitHub on first run.
- Tools cached in `~/.socket/vfs-tools/`.

#### @socketsecurity/cli-with-sentry

- Pure JavaScript CLI with Sentry error reporting (no binaries, no VFS).
- Built from `templates/cli-sentry-package/`.
- Uses `cli-dispatch-with-sentry.mts` entry point.
- Includes `@sentry/node` as external dependency.
- Lazy downloads external tools from GitHub on first run.
- Tools cached in `~/.socket/vfs-tools/`.

### Socket Wrapper Package

Installs platform-specific binaries via optionalDependencies. Prefers the
`@socketsecurity/cli.exe.<triplet>` tails and falls back to the frozen legacy
`@socketbin/cli-*` binaries until the new set is live and pinned.

### cli.exe Tail Packages

Self-contained SEA binaries with embedded VFS — the current distribution
family, named per the fleet dot-naming grammar with the `.exe` target and pnpm
pack-app platform tails.

#### @socketsecurity/cli.exe.&lt;triplet&gt;

- 8 packages total (darwin × 2, linux × 4 incl. musl, win32 × 2).
- Generated by `scripts/generate-cli-exe-packages.mts` from
  `scripts/cli-exe-targets.mts` + `templates/cli-exe-package/`.
- Executable at `bin/socket` — `bin/socket.exe` on Windows.
- Includes exact `os` / `cpu` / `libc` constraints in package.json.
- VFS includes: Python, OpenGrep, Trivy, TruffleHog, npm tools.
- First run: Extracts tools from VFS → `~/.socket/vfs-tools/`.

### Socketbin Packages (legacy)

The decommissioned `@socketbin/cli-*` family. The scope is dead — npm still
serves the frozen 2025-11-03 binaries, so the wrapper and installer keep them
as a fallback, but no new publish can ever happen. The template + generator
remain only until the cli.exe tails are live and pinned.

#### socketbin-cli-{platform}-{arch} (legacy)

- Generated from `templates/socketbin-package/`.
- Contains single executable binary with CLI + VFS.
- Includes OS and CPU constraints in package.json.

## Generator Scripts

### generate-cli-packages.mjs

Creates both standard CLI packages.

```text
Input:  templates/cli-package/
        templates/cli-sentry-package/

Output: build/cli/
        build/cli-with-sentry/

Action: Recursive directory copy.
```

### generate-cli-exe-packages.mts

Creates the current platform-specific binary packages.

```text
Input:  scripts/cli-exe-targets.mts        # names, engine fields, manifests
        templates/cli-exe-package/         # README template + gitignore seed

Output: build/{dev|prod}/out/cli.exe.<triplet>/

Action: Programmatic manifest construction + template rendering.
```

**Platform Triplets:**

```text
darwin-arm64      → macOS ARM64 (Apple Silicon)
darwin-x64        → macOS x64 (Intel)
linux-arm64       → Linux ARM64 (glibc)
linux-arm64-musl  → Linux ARM64 (musl)
linux-x64         → Linux x64 (glibc)
linux-x64-musl    → Linux x64 (musl)
win32-arm64       → Windows ARM64 (.exe)
win32-x64         → Windows x64 (.exe)
```

### generate-socketbin-packages.mjs

Creates the legacy platform-specific binary packages — kept only until the
cli.exe tails are live.

```text
Input:  templates/socketbin-package/
        - package.json.template
        - README.md.template
        - .gitignore

Output: build/socketbin-cli-{platform}-{arch}/

Action: Template variable replacement:
        {{PLATFORM}}, {{ARCH}}, {{OS}},
        {{CPU}}, {{BIN_EXT}}, {{DESCRIPTION}}
```

**Platform Configurations:**

```text
darwin-arm64  → macOS ARM64 (Apple Silicon)
darwin-x64    → macOS x64 (Intel)
linux-arm64   → Linux ARM64
linux-x64     → Linux x64
win32-arm64   → Windows ARM64 (.exe)
win32-x64     → Windows x64 (.exe)
```

## Build Process

### CLI Package Build

Located in `templates/cli-package/scripts/build.mjs`:

```text
1. Build CLI bundle     → .config/esbuild.cli.build.mjs
2. Build index loader   → .config/esbuild.index.config.mjs
3. Build npm inject     → .config/esbuild.inject.config.mjs
4. Copy CLI to dist     → dist/cli.js
5. Copy data directory  → data/
6. Copy repo assets     → LICENSE, CHANGELOG.md, logos
```

**Binary Outputs:**

- `bin/cli.js` - Main CLI entry.
- `bin/npm-cli.js` - npm wrapper.
- `bin/npx-cli.js` - npx wrapper.
- `bin/pnpm-cli.js` - pnpm wrapper.
- `bin/yarn-cli.js` - yarn wrapper.

## Template Structure

### CLI Package Template

```text
cli-package/
├── .config/
│   ├── esbuild.cli.build.mjs      # Main CLI build
│   ├── esbuild.config.mjs         # Base config
│   ├── esbuild.index.config.mjs   # Index loader
│   └── esbuild.inject.config.mjs  # Shadow npm inject
├── bin/
│   ├── cli.js          # Main entry
│   ├── npm-cli.js      # npm wrapper
│   ├── npx-cli.js      # npx wrapper
│   ├── pnpm-cli.js     # pnpm wrapper
│   └── yarn-cli.js     # yarn wrapper
├── scripts/
│   ├── build.mjs       # Build orchestration
│   └── verify-package.mjs  # Package validation
├── test/
│   └── package.test.mjs
├── package.json
└── vitest.config.mts
```

### Socket Package Template

```text
socket-package/
├── scripts/
│   ├── build.mjs                      # Build orchestration
│   ├── esbuild.bootstrap.config.mjs   # Bootstrap bundler
│   └── verify-package.mjs             # Package validation
├── test/
│   └── bootstrap.test.mjs
├── package.json
└── vitest.config.mts
```

**Key Features:**

- Optional dependencies on all socketbin packages.
- Bootstrap loader detects platform and downloads binary.
- Falls back to Node.js implementation if binary unavailable.

### Socketbin Package Template

```text
socketbin-package/
├── package.json.template    # Template with variables
├── README.md.template       # Template with variables
└── .gitignore               # Static file
```

**Template Variables:**

- `{{PLATFORM}}` - OS platform (darwin/linux/win32).
- `{{ARCH}}` - CPU architecture (arm64/x64).
- `{{OS}}` - OS constraint for package.json.
- `{{CPU}}` - CPU constraint for package.json.
- `{{BIN_EXT}}` - Binary extension (.exe for Windows, empty for Unix).
- `{{DESCRIPTION}}` - Human-readable platform description.

## Package Validation

Each template includes verification scripts to validate generated packages.

**Validation Checks:**

- package.json exists and has correct structure.
- Required files present (LICENSE, CHANGELOG.md).
- Dist files exist (index.js, cli.js).
- Data directory and files exist.
- Binary files exist (for CLI packages).
- Sentry integration present (for cli-with-sentry).

**Run Validation:**

```bash
node scripts/verify-package.mjs
```

## Build Output

Generated packages appear in `build/` directory:

```text
build/{dev|prod}/out/
├── cli/                      # @socketsecurity/cli
├── cli-with-sentry/          # @socketsecurity/cli-with-sentry
├── cli.exe.darwin-arm64/     # @socketsecurity/cli.exe.darwin-arm64
├── cli.exe.darwin-x64/
├── cli.exe.linux-arm64/
├── cli.exe.linux-arm64-musl/
├── cli.exe.linux-x64/
├── cli.exe.linux-x64-musl/
├── cli.exe.win32-arm64/
├── cli.exe.win32-x64/
└── socketbin-cli-*/          # legacy, frozen on npm
```

Each directory is a complete, publishable npm package.

## Integration Points

### Dependencies on Main CLI

All generated packages depend on:

- Main CLI source (`packages/cli/`).
- Bootstrap package (`packages/bootstrap/`).
- Build infrastructure (`packages/build-infra/`).

### esbuild Configuration

Templates reference base configurations from main CLI:

```javascript
import baseConfig from '../../cli/.config/esbuild.cli.build.mjs'
```

This ensures consistency across all distribution channels.

### Version Synchronization

All packages share version from monorepo:

- Read from `.node-version` for Node.js version.
- Read from `package.json` for CLI version.
- Injected as build-time constants.

## Usage

### Generate All Packages

```bash
# From package-builder directory:
node scripts/generate-cli-packages.mjs
node scripts/generate-socketbin-packages.mjs
```

### Generate Individual Package Type

```bash
# CLI packages only:
node scripts/generate-cli-packages.mjs

# Socketbin packages only:
node scripts/generate-socketbin-packages.mjs
```

### Build Generated Package

```bash
# Navigate to generated package:
cd build/cli
pnpm run build

# Or from package-builder:
pnpm --filter ./build/cli run build
```

### Verify Generated Package

```bash
cd build/cli
pnpm run verify
```

## Design Patterns

### Template-Based Generation

**Pattern:** Separate templates from generated output.

**Benefits:**

- Templates tracked in version control.
- Generated packages excluded from git.
- Clear separation of source and artifacts.
- Easy to regenerate from scratch.

### Platform Abstraction

**Pattern:** Single template generates multiple platform-specific packages.

**Benefits:**

- Reduces duplication.
- Ensures consistency across platforms.
- Simplifies platform additions.
- Centralizes platform configurations.

### Build Delegation

**Pattern:** Generated packages contain their own build scripts.

**Benefits:**

- Packages are self-contained.
- Can be built independently.
- Supports incremental builds.
- Simplifies CI/CD integration.

### Optional Binary Dependencies

**Pattern:** Main package lists binaries as optional dependencies.

**Benefits:**

- Graceful fallback to Node.js implementation.
- Reduces download size.
- Platform-specific installation.
- Better error handling.

## Code Quality Observations

### Strengths

1. **Consistent Structure:** All generators follow same pattern.
2. **Clear Separation:** Templates isolated from generated output.
3. **Error Handling:** Proper error messages and exit codes.
4. **Validation:** Built-in verification for generated packages.
5. **Logging:** Clear, informative progress messages.
6. **Documentation:** Good inline comments explaining purpose.

### Patterns

1. **Directory Operations:** Uses `fs.cp` for recursive copying.
2. **Template Processing:** Simple regex-based variable replacement.
3. **Async/Await:** Consistent async patterns throughout.
4. **ESM Modules:** All scripts use `.mjs` extension.
5. **Path Resolution:** Proper use of `fileURLToPath` and `path.join`.

### Recent Improvements

1. **Handlebars Template Engine:** Upgraded from regex-based replacement to Handlebars.
   - Supports conditional logic with `{{#if}}` and loops with `{{#each}}`.
   - Backward compatible with existing `{{VARIABLE}}` syntax.
   - Shared `processTemplate()` utility in `scripts/utils.mjs` for reuse.
   - Enables advanced template features like helpers and partials.

## Summary

The package-builder is a well-designed code generation system that transforms templates into multiple distribution formats. Key strengths include:

- Clear architecture with template-based generation.
- Support for multiple distribution channels (npm, binary, wrapper).
- Platform-specific package generation (6 platforms).
- Self-contained generated packages with own build scripts.
- Comprehensive validation and verification.
- Clean, maintainable code with good error handling.

The system effectively handles the complexity of multi-platform CLI distribution while maintaining a simple, understandable structure.
