# Build/Dist Structure with History/Archive Pattern

## Philosophy

**build/** (gitignored)
- Workspace for building with intermediates
- Archive/history of completed builds with different configs
- Allows comparison, experimentation, rollback
- All ephemeral but useful for development

**dist/** (tracked in git)
- The "blessed" canonical distribution artifact
- What actually ships and gets consumed by other packages
- Single source of truth for "current production build"

## Recommended Structure

```
packages/<package>/
├── build/                    # Gitignored workspace + archive
│   ├── tmp/                  # Current build intermediates (cmake, obj files, etc.)
│   ├── cache/                # Download caches, source clones
│   └── archive/              # Historical completed builds
│       ├── 2025-10-26-001-opt-size/
│       ├── 2025-10-26-002-opt-speed/
│       ├── 2025-10-26-003-debug/
│       └── latest/           # Symlink to most recent build
└── dist/                     # Tracked canonical releases
    └── <final-artifacts>
```

## Package-Specific Patterns

### packages/yoga-layout

```
build/
├── tmp/                      # cmake/, _deps/, bin/, yoga-source/
├── cache/                    # Downloaded yoga source tarballs
└── archive/
    ├── 2025-10-26-opt-oz/   # Build with -Oz optimization
    │   ├── yoga.wasm
    │   └── yoga.js
    ├── 2025-10-26-opt-o3/   # Build with -O3 optimization
    │   ├── yoga.wasm
    │   └── yoga.js
    └── latest -> 2025-10-26-opt-oz/

dist/
├── yoga.wasm                 # Blessed release (copied from build/archive/latest/)
└── yoga.js
```

### packages/minilm-builder

```
build/
├── tmp/                      # Python venv, conversion intermediates
├── cache/                    # Hugging Face model cache
└── archive/
    ├── minilm-l6-v2-int8/   # INT8 quantized
    │   ├── model.onnx
    │   └── tokenizer.json
    ├── minilm-l6-v2-fp16/   # FP16 quantized
    │   ├── model.onnx
    │   └── tokenizer.json
    └── latest -> minilm-l6-v2-int8/

dist/
├── model.onnx                # Blessed model
└── tokenizer.json
```

### packages/node-sea-builder

```
build/
├── tmp/                      # AST transformation temp files
├── cache/                    # Node binary cache
└── archive/
    ├── socket-sea-full/      # Full CLI embedded
    │   ├── socket-macos-arm64
    │   ├── socket-linux-x64
    │   └── build-manifest.json
    ├── socket-sea-minimal/   # Minimal CLI
    │   └── socket-macos-arm64
    └── latest -> socket-sea-full/

dist/
├── socket-macos-arm64        # Blessed SEA binary
├── socket-linux-x64
└── socket-win-x64.exe
```

### packages/node-smol-builder

```
build/
├── tmp/                      # Node.js build intermediates (obj files)
├── cache/                    # Node.js source cache
└── archive/
    ├── node-24.10.0-brotli-sea/      # With brotli+sea patches
    │   ├── node
    │   └── build-manifest.json
    ├── node-24.10.0-minimal/         # Minimal patches
    │   └── node
    ├── node-24.10.0-compressed/      # Post-compression
    │   └── node
    └── latest -> node-24.10.0-compressed/

dist/
└── node                      # Blessed Node.js binary
```

### packages/cli

```
# Special case - dist/ is gitignored (ephemeral Rollup output)
dist/
└── cli.js                    # Rollup bundled CLI (consumed by node-sea-builder)
```

## Build Script Pattern

Build scripts should support archiving with:
- Timestamp-based archive naming: `YYYY-MM-DD-NNN-description`
- Build manifest JSON: config, flags, version, size, date
- Automatic "latest" symlink update
- Optional `--archive` flag to save to archive/
- Copy from archive/latest/ → dist/ for "blessed" promotion

## Benefits

1. **Experimentation**: Try different optimization levels without losing previous builds
2. **Comparison**: Easy A/B testing of build configurations
3. **Rollback**: Keep working builds when experimenting
4. **History**: Understand what changed between builds
5. **Debugging**: Compare artifacts when tracking down issues
6. **Documentation**: Build manifests document exact build configuration

## Gitignore Strategy

```gitignore
# .gitignore (root)
**/build/        # All build artifacts and archives (gitignored)

# dist/ NOT globally ignored - tracked in git for blessed releases
# Exception: packages/cli/.gitignore ignores its own dist/ (ephemeral Rollup output)
```

## Promotion Workflow

1. Build → `build/tmp/` (intermediates)
2. Success → `build/archive/<timestamp-config>/` (completed build)
3. Update → `build/archive/latest` symlink
4. Test and validate
5. Promote → Copy `build/archive/latest/*` → `dist/` (blessed release)
6. Commit `dist/` changes to git

## Example Build Manifest

`build/archive/2025-10-26-001-opt-oz/build-manifest.json`:
```json
{
  "timestamp": "2025-10-26T14:30:00Z",
  "config": {
    "optimization": "-Oz",
    "target": "wasm32",
    "features": ["size-optimized"]
  },
  "artifacts": [
    {"file": "yoga.wasm", "size": 133120, "hash": "sha256:abc123..."},
    {"file": "yoga.js", "size": 19456, "hash": "sha256:def456..."}
  ],
  "versions": {
    "yoga": "3.1.0",
    "emscripten": "3.1.50"
  }
}
```
