# Socket CLI Repository Structure

## Overview

This document explains the organization of build artifacts, temporary files, and build scripts in the Socket CLI repository.

## Directory Structure

```
socket-cli/
├── .custom-node-build/        # Build artifacts (NOT in git)
│   ├── node-yao-pkg/          # Current Node.js v24.10.0 with yao-pkg patches
│   │   ├── out/Release/node   # Built Node binary (~83MB)
│   │   └── ...                # Node.js source (~19GB with build artifacts)
│   └── patches/               # Downloaded yao-pkg patches
│       └── node.v24.10.0.cpp.patch
├── pkg-binaries/              # pkg output binaries (NOT in git)
│   ├── socket-macos-arm64     # Built pkg executable (~90-110MB)
│   ├── socket-macos-x64
│   ├── socket-linux-x64
│   ├── socket-linux-arm64
│   ├── socket-win-x64
│   └── socket-win-arm64
├── dist/                      # Rollup output (NOT in git)
│   ├── cli.js                 # Bundled CLI code
│   ├── vendor.js              # Bundled dependencies
│   └── ...
├── scripts/                   # Build scripts (IN git)
│   ├── build.mjs              # Main build script (rollup)
│   ├── build-yao-pkg-node.sh # Script to build custom Node.js
│   ├── babel/                 # Custom Babel plugins
│   │   ├── babel-plugin-strict-mode.mjs
│   │   ├── babel-plugin-remove-icu.mjs
│   │   └── README.md
│   └── ...
├── patches/                   # Socket CLI patches (IN git)
│   └── yoga-layout.patch      # Patch for yoga-layout WASM
├── pkg.json                   # pkg configuration (IN git)
├── .gitignore                 # Ignores build artifacts
└── docs/                      # Documentation (IN git)
    ├── YAO_PKG_BUILD.md
    ├── BABEL_PLUGINS.md
    ├── PKG_PLATFORM_SUPPORT.md
    └── REPOSITORY_STRUCTURE.md (this file)
```

---

## What's In Version Control (Git)

### Source Code
- `src/` - TypeScript source files
- `test/` - Test files
- `scripts/` - Build scripts
- `patches/` - Socket CLI patches (yoga-layout, etc.)

### Configuration Files
- `package.json` - npm package configuration
- `pnpm-lock.yaml` - Dependency lock file
- `pkg.json` - pkg/yao-pkg configuration
- `tsconfig.json` - TypeScript configuration
- `.config/` - Build tool configurations (rollup, babel, etc.)

### Documentation
- `docs/` - All documentation files
- `README.md` - Main readme
- `CHANGELOG.md` - Version history
- `CLAUDE.md` - Development guidelines

### CI/CD
- `.github/workflows/` - GitHub Actions workflows

---

## What's NOT In Version Control (Gitignored)

### Build Artifacts (Output)
```gitignore
dist/                    # Rollup bundled output
pkg-binaries/            # pkg executable binaries
/socket                  # Built pkg binary in root
/socket-*                # Built pkg binaries in root (any platform)
```

### Node.js Build Artifacts
```gitignore
.custom-node-build/      # All Node.js build files
```

**Why gitignored:**
- **Large size:** ~19-20GB per Node.js build with artifacts
- **Platform-specific:** Built binaries only work on target platform
- **Reproducible:** Can be rebuilt anytime from source using build script
- **Temporary:** Build artifacts change frequently

### Dependency Directories
```gitignore
node_modules/            # npm/pnpm dependencies
.yarn/                   # Yarn PnP files
.pnp.cjs                 # Yarn PnP loader
```

### Cache & Temporary Files
```gitignore
.rollup.cache/           # Rollup incremental build cache
.cache/                  # Generic cache directory
**/.cache                # Cache in any subdirectory
.type-coverage/          # Type coverage cache
*.tsbuildinfo            # TypeScript incremental build info
```

### IDE & System Files
```gitignore
.vscode/                 # VS Code settings (except extensions.json)
.DS_Store                # macOS Finder metadata
Thumbs.db                # Windows Explorer metadata
```

### Environment Files
```gitignore
.env                     # Local environment variables
.nvm/                    # nvm Node version manager
.node-version            # Node version pinning
```

---

## Build Artifact Locations

### 1. Custom Node.js Build

**Location:** `.custom-node-build/node-yao-pkg/`
**Size:** ~19-20GB (source + build artifacts)
**Binary:** `.custom-node-build/node-yao-pkg/out/Release/node` (~83MB)

**Created by:**
```bash
pnpm run build:yao-pkg:node
# Runs: scripts/build-yao-pkg-node.sh
```

**What it does:**
1. Downloads Node.js v24.10.0 source from GitHub (~1.5GB)
2. Downloads yao-pkg patch from pkg-fetch repo (~33KB)
3. Applies patch to Node.js source
4. Configures with size optimizations
5. Builds with all CPU cores (~30-60 minutes)
6. Produces optimized Node binary (~83MB)

**Cleanup:**
```bash
# Remove old/unused Node builds (saves ~40GB)
rm -rf .custom-node-build/node
rm -rf .custom-node-build/node-patched

# Keep only current build
# .custom-node-build/node-yao-pkg
```

### 2. Socket CLI Distribution

**Location:** `dist/`
**Size:** ~10-15MB
**Key files:**
- `dist/cli.js` - Main CLI entry point
- `dist/vendor.js` - Bundled dependencies
- `dist/constants.js` - CLI constants
- `dist/utils.js` - Utility functions

**Created by:**
```bash
pnpm run build:cli
# Runs: rollup with .config/rollup.dist.config.mjs
```

**What it does:**
1. Compiles TypeScript to JavaScript
2. Bundles with rollup
3. Applies Babel transformations:
   - Strict-mode conversion
   - ICU removal (optional)
   - `__proto__` transformations
4. Outputs to `dist/`

**Cleanup:**
```bash
pnpm run clean:dist
# Removes dist/ directory
```

### 3. pkg Binaries

**Location:** `pkg-binaries/`
**Size:** ~90-110MB per binary
**Files:**
- `socket-macos-arm64` - macOS Apple Silicon
- `socket-macos-x64` - macOS Intel
- `socket-linux-x64` - Linux x86_64 (most Docker)
- `socket-linux-arm64` - Linux ARM64 (AWS Graviton)
- `socket-win-x64.exe` - Windows x86_64
- `socket-win-arm64.exe` - Windows ARM64

**Created by:**
```bash
pnpm run build:yao-pkg
# Runs: pnpm exec pkg . (uses pkg.json config)
```

**What it does:**
1. Reads `pkg.json` configuration
2. Uses custom Node.js binary from `.custom-node-build/node-yao-pkg/out/Release/node`
3. Bundles `dist/` files as V8 bytecode
4. Embeds assets in virtual filesystem
5. Creates standalone executables

**Cleanup:**
```bash
rm -rf pkg-binaries/
# Or keep only the platform you need
rm pkg-binaries/socket-win-*    # Remove Windows binaries
rm pkg-binaries/socket-macos-*  # Remove macOS binaries
```

### 4. Patches

**Location:** `patches/` (IN git) and `.custom-node-build/patches/` (NOT in git)

#### Socket CLI Patches (tracked)
```
patches/
└── yoga-layout.patch    # Patch for yoga-layout WASM support
```

**Purpose:** Enable yoga-layout to work in pkg binaries by creating synchronous WASM entry point.

**Applied by:** pnpm (automatically via `pnpm-lock.yaml`)

#### yao-pkg Patches (not tracked)
```
.custom-node-build/patches/
└── node.v24.10.0.cpp.patch    # Official yao-pkg patch for Node.js
```

**Purpose:** Enable V8 bytecode compilation in Node.js

**Applied by:** `scripts/build-yao-pkg-node.sh`

**Downloaded from:** https://github.com/yao-pkg/pkg-fetch

---

## Disk Space Usage

### Development Environment
```
Total: ~50-60GB

node_modules/              ~2-3 GB   (dependencies)
.custom-node-build/        ~20-40 GB (Node.js builds)
  ├── node-yao-pkg/        ~19-20 GB (current, keep)
  ├── node-patched/        ~20 GB    (old, can delete)
  └── node/                ~20 GB    (old, can delete)
dist/                      ~10-15 MB (rollup output)
pkg-binaries/              ~500 MB   (6 binaries × ~90MB)
```

### Minimal Build Environment
```
Total: ~22-25GB

node_modules/              ~2-3 GB
.custom-node-build/        ~19-20 GB (only node-yao-pkg)
```

### CI/CD Environment
```
Total: ~5-10GB

node_modules/              ~2-3 GB
Pre-built Node binary      ~83 MB    (download from release)
dist/                      ~10-15 MB
pkg-binaries/              ~90-110 MB per platform
```

---

## Cleanup Scripts

### Remove Old Node Builds

```bash
#!/usr/bin/env bash
# scripts/cleanup-old-node-builds.sh

echo "Removing old Node.js builds..."

# Remove old v22 builds
rm -rf .custom-node-build/node
rm -rf .custom-node-build/node-patched

echo "Kept: .custom-node-build/node-yao-pkg (current)"
echo "Disk space freed: ~40GB"
```

### Clean All Build Artifacts

```bash
#!/usr/bin/env bash
# scripts/clean-all.sh

echo "Cleaning all build artifacts..."

# Clean rollup output
pnpm run clean:dist

# Clean pkg binaries
rm -rf pkg-binaries/
rm -f socket socket-*

# Clean Node.js builds (optional - takes 30-60 min to rebuild)
# rm -rf .custom-node-build/

echo "Build artifacts cleaned"
echo "Run 'pnpm run build' to rebuild"
```

### Clean Everything (Fresh Start)

```bash
#!/usr/bin/env bash
# scripts/clean-everything.sh

echo "⚠️  This will remove ALL build artifacts and dependencies"
echo "You'll need to reinstall and rebuild everything"
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Remove dependencies
  rm -rf node_modules/

  # Remove build artifacts
  rm -rf dist/
  rm -rf pkg-binaries/
  rm -rf .custom-node-build/

  # Remove caches
  rm -rf .rollup.cache/
  rm -rf .cache/

  echo "Everything cleaned!"
  echo "Run 'pnpm install && pnpm run build:yao-pkg:node' to start fresh"
fi
```

---

## CI/CD Recommendations

### GitHub Actions

**Option 1: Build Node.js on each run (slow)**
```yaml
- name: Build custom Node.js
  run: pnpm run build:yao-pkg:node  # 30-60 minutes
```

**Option 2: Cache Node.js build (faster)**
```yaml
- name: Cache Node.js build
  uses: actions/cache@v4
  with:
    path: .custom-node-build/node-yao-pkg
    key: node-yao-pkg-v24.9.0-${{ runner.os }}-${{ runner.arch }}

- name: Build Node.js if not cached
  if: steps.cache-node.outputs.cache-hit != 'true'
  run: pnpm run build:yao-pkg:node
```

**Option 3: Use pre-built binary (fastest)**
```yaml
- name: Download pre-built Node.js
  run: |
    curl -L https://github.com/.../releases/.../node-v24.10.0-yao-pkg.tar.gz | tar xz
    mv node .custom-node-build/node-yao-pkg/out/Release/node
```

### Artifact Uploads

```yaml
- name: Upload pkg binaries
  uses: actions/upload-artifact@v4
  with:
    name: socket-${{ matrix.platform }}
    path: pkg-binaries/socket-${{ matrix.platform }}
    retention-days: 7  # Don't keep forever
```

---

## Best Practices

### For Local Development

1. **Keep only current Node build:**
   ```bash
   # Remove old builds
   rm -rf .custom-node-build/node
   rm -rf .custom-node-build/node-patched

   # Keep: .custom-node-build/node-yao-pkg
   ```

2. **Don't commit build artifacts:**
   - `.gitignore` is already configured
   - Run `git status` to verify

3. **Clean before release:**
   ```bash
   pnpm run clean:dist
   pnpm run build:cli
   pnpm run build:yao-pkg
   ```

### For CI/CD

1. **Cache Node.js builds** to avoid 30-60 minute build times
2. **Upload artifacts** to GitHub Releases, not repo
3. **Build only needed platforms** (linux-x64 for Docker, etc.)
4. **Set artifact retention** (7-30 days, not forever)

### For Distribution

1. **Release artifacts to GitHub Releases:**
   - Upload pkg binaries as release assets
   - Don't include in npm package
   - Users download specific platform

2. **npm package includes:**
   - Source code (`src/`)
   - Rollup output (`dist/`)
   - No binaries

3. **Docker images:**
   - Copy `pkg-binaries/socket-linux-x64` to image
   - Don't include full repo

---

## Directory Size Reference

| Path | Size | Can Delete? | Rebuild Time |
|------|------|-------------|--------------|
| `node_modules/` | 2-3 GB | Yes | `pnpm install` (~2 min) |
| `.custom-node-build/node-yao-pkg/` | 19-20 GB | No (current) | 30-60 minutes |
| `.custom-node-build/node/` | 20 GB | Yes (old) | N/A |
| `.custom-node-build/node-patched/` | 20 GB | Yes (old) | N/A |
| `dist/` | 10-15 MB | Yes | `pnpm run build:cli` (~10 sec) |
| `pkg-binaries/` | 500 MB | Yes | `pnpm run build:yao-pkg` (~30 sec) |

**Total reclaimable:** ~40 GB (by removing old Node builds)

---

## Troubleshooting

### "Where is the custom Node.js binary?"

**Location:** `.custom-node-build/node-yao-pkg/out/Release/node`

**How to rebuild:**
```bash
pnpm run build:yao-pkg:node
```

### "Where do pkg binaries go?"

**Location:** `pkg-binaries/` directory

**Configured in:** `pkg.json` → `outputPath` field

**How to rebuild:**
```bash
pnpm run build:yao-pkg
```

### "Why is .custom-node-build so large?"

Node.js source is ~1.5GB, plus build artifacts (~17-18GB) makes ~19-20GB total per build.

**Solution:** Keep only the current build (`node-yao-pkg`), delete old ones:
```bash
rm -rf .custom-node-build/node
rm -rf .custom-node-build/node-patched
```

### "Can I commit pkg binaries?"

**No.** They're too large (90-110MB each) and platform-specific.

**Instead:**
- Upload to GitHub Releases
- Build in CI/CD
- Download on demand

---

## Summary

### Tracked in Git
- ✅ Source code (`src/`)
- ✅ Build scripts (`scripts/`)
- ✅ Socket CLI patches (`patches/`)
- ✅ Configuration files (`pkg.json`, `package.json`, etc.)
- ✅ Documentation (`docs/`)

### Not Tracked in Git (Build Artifacts)
- ❌ Custom Node.js builds (`.custom-node-build/`)
- ❌ pkg binaries (`pkg-binaries/`, `socket-*`)
- ❌ Rollup output (`dist/`)
- ❌ Dependencies (`node_modules/`)
- ❌ Caches (`.rollup.cache/`, `.cache/`)

### Cleanup Recommendation
Remove old Node builds to free ~40GB:
```bash
rm -rf .custom-node-build/node .custom-node-build/node-patched
```

### Build From Scratch
```bash
# Clean start
pnpm install                    # Install dependencies (2-3 min)
pnpm run build:yao-pkg:node    # Build Node.js (30-60 min, one-time)
pnpm run build:cli        # Build CLI (10 sec)
pnpm run build:yao-pkg         # Build pkg binaries (30 sec)
```
