# Documentation Organization Guide

This guide explains Socket CLI's 3-tier documentation hierarchy and best practices for organizing documentation across the monorepo.

## Overview

Socket CLI follows a structured 3-tier documentation system that separates concerns by scope:
- **Tier 1** (Monorepo) - Cross-package architecture and shared systems
- **Tier 2** (Package) - Package-specific technical documentation
- **Tier 3** (Sub-package) - Implementation-level details for submodules

## 3-Tier Documentation Hierarchy

### Tier 1: Monorepo Documentation (`/docs/`)

**Purpose**: Document cross-package architecture, build systems, development guides, and monorepo-wide standards.

**Structure**:
```
docs/
├── README.md                     # Complete documentation index
├── architecture/                 # System design and flow diagrams
│   ├── cli-architecture.md
│   └── command-patterns.md
├── build/                        # Build system documentation
│   ├── build-process.md
│   ├── build-quick-start.md
│   ├── wasm-build-guide.md
│   └── node-patch-creation-guide.md
├── configuration/                # Shared configuration architecture
│   └── env-config.md
├── development/                  # Development tools and workflow
│   ├── getting-started.md
│   └── debugging.md
├── guides/                       # User-facing how-to guides
│   └── cli-usage.md
├── performance/                  # Performance optimization strategies
│   └── optimization-guide.md
├── technical/                    # Low-level implementation details
│   └── async-patterns.md
└── testing/                      # Testing strategies and guides
    └── test-helpers.md
```

**When to Use Tier 1**:
- Documenting systems that span multiple packages
- Architecture decisions affecting the entire monorepo
- Build system documentation (WASM, Node.js patches, etc.)
- Development workflow and tooling
- Cross-package testing strategies

**Examples**:
- `docs/build/wasm-build-guide.md` - WASM compilation affects multiple builder packages
- `docs/architecture/command-patterns.md` - CLI command architecture used across packages/cli
- `docs/testing/test-helpers.md` - Test utilities used across all packages

### Tier 2: Package Documentation (`packages/<pkg>/docs/`)

**Purpose**: Document package-specific APIs, build processes, and implementation details.

**Structure**:
```
packages/<package-name>/docs/
├── README.md                     # Package documentation index
├── api-reference.md              # Public API documentation
├── build-process.md              # Package-specific build details
├── upstream-tracking.md          # Version tracking for dependencies
└── <implementation>.md           # Package-specific technical docs
```

**When to Use Tier 2**:
- Package has complex implementation requiring technical documentation
- Package wraps upstream dependencies needing version tracking
- Package has public APIs requiring reference documentation
- Package has unique build processes not covered in tier 1

**Examples**:
- `packages/yoga-layout/docs/` - Yoga Layout WASM builder documentation
  - `README.md` - Package overview with build output specs
  - `build-process.md` - Emscripten build configuration and optimization
  - `upstream-tracking.md` - Tracking Facebook Yoga v3.1.0 updates

- `packages/onnx-runtime-builder/docs/` - ONNX Runtime WASM builder
  - `README.md` - Package overview with required operators list
  - `operator-set.md` - 21 operators required for CodeT5 models
  - `optimization-strategy.md` - Size optimization techniques

- `packages/minilm-builder/docs/` - ML model conversion pipeline
  - `README.md` - 6-phase pipeline overview
  - `pipeline-architecture.md` - Conversion process details
  - `upstream-tracking.md` - Tracking Hugging Face transformers releases

- `packages/node-sea-builder/docs/` - SEA builder documentation
  - `README.md` - SEA build process overview
  - `ast-transformations.md` - Code transformations for compatibility
  - `verification-process.md` - AST-based verification

### Tier 3: Sub-Package Documentation (`packages/<pkg>/*/docs/`)

**Purpose**: Document language-specific or submodule implementation details.

**Structure**:
```
packages/<package-name>/<submodule>/docs/
├── <implementation-detail>.md
└── <language-specific>.md
```

**When to Use Tier 3**:
- Submodule has complex implementation (e.g., Rust WASM modules)
- Language-specific implementation details (C++, Rust, Python)
- Sub-package has distinct build process from parent package
- Implementation details not relevant to package-level consumers

**Examples**:
- `packages/node-smol-builder/wasm-bundle/docs/` - Rust WASM compression
  - `cross-platform-compression.md` - WASM-based compression without UPX
  - `macho-compression.md` - macOS-specific Mach-O compression

## Best Practices

### File Naming
- Use lowercase with hyphens: `build-process.md`, `api-reference.md`
- Be descriptive and specific: `wasm-build-guide.md` not `build.md`
- Avoid abbreviations unless widely known: `cli` ✅, `proc` ❌

### Documentation Index Files
Every `docs/` directory MUST have a `README.md` that serves as an index:
- List all documentation files with brief descriptions
- Provide quick links to related documentation
- Include upstream repository links and versions
- Document build output locations and formats

**Example Index Structure**:
```markdown
# package-name Documentation

Package-level documentation for [brief description].

## Overview

[1-2 paragraph overview of what this package does]

## Contents

- **file1.md** - Description of file1
- **file2.md** - Description of file2

## Quick Links

- **Main README**: `../README.md`
- **Build Script**: `../scripts/build.mjs`

## Build Output

- **Location**: `build/output/`
- **Files**: List of output files

## Upstream

- **Repository**: https://github.com/org/repo
- **Version**: vX.Y.Z
- **License**: MIT
```

### Linking Between Tiers
- Use relative paths for cross-tier links
- Link from tier 2 → tier 3: `../wasm-bundle/docs/compression.md`
- Link from tier 3 → tier 2: `../docs/README.md`
- Link from tier 2 → tier 1: `../../docs/build/wasm-build-guide.md`

### Upstream Tracking
For packages wrapping upstream dependencies:
- Always document upstream repository URL
- Document current version being used
- Note license information
- Link to upstream changelog or release notes
- Document update process in `upstream-tracking.md`

### Build Output Documentation
Document build artifacts consistently:
- Artifact locations (`build/`, `dist/`)
- File names and formats
- File sizes (where relevant for performance)
- Platform-specific outputs

### Writing Style
- Be concise and technical - readers are developers
- Use code blocks and examples liberally
- Include diagrams where helpful (ASCII art is fine)
- Focus on "why" not just "what"
- Keep paragraphs short and scannable

## Migration Guide

### Moving Documentation to Correct Tier

**Identify Misplaced Docs**:
1. Cross-package docs in tier 2 → Move to tier 1
2. Implementation-level docs in tier 2 → Move to tier 3
3. Missing package docs → Create tier 2 structure

**Steps to Migrate**:
1. Create target `docs/` directory if needed
2. Move documentation files to correct tier
3. Update internal links to reflect new structure
4. Create or update `README.md` index files
5. Update any references in CLAUDE.md or other guides

**Example Migration**:
```bash
# Bad: Implementation details in package docs
packages/node-smol-builder/docs/cross-platform-compression.md

# Good: Implementation details in sub-package docs
packages/node-smol-builder/wasm-bundle/docs/cross-platform-compression.md
```

## When NOT to Create Documentation

**Avoid over-documentation**:
- Don't document every small utility function
- Don't create docs for simple packages with clear README
- Don't duplicate information from code comments
- Don't create placeholder documentation

**Self-documenting code is better**:
- Simple packages with clear code don't need extensive docs
- Good type definitions and JSDoc comments are often sufficient
- README files may be enough for straightforward packages

## Quick Decision Tree

```
┌─ Cross-package scope?
│  ├─ YES → Tier 1 (/docs/)
│  └─ NO ↓
│
├─ Package-level scope?
│  ├─ YES → Tier 2 (packages/<pkg>/docs/)
│  └─ NO ↓
│
└─ Sub-package/implementation?
   └─ YES → Tier 3 (packages/<pkg>/*/docs/)
```

## Examples from Socket CLI

### Well-Organized Documentation

**Tier 1 Example** - `docs/build/wasm-build-guide.md`:
- Covers WASM compilation for ALL builder packages
- Documents shared Emscripten toolchain setup
- Cross-package build strategies

**Tier 2 Example** - `packages/yoga-layout/docs/README.md`:
- Package overview and build output specifications
- Links to sub-documents (build-process, upstream-tracking)
- Quick links to scripts and README

**Tier 3 Example** - `packages/node-smol-builder/wasm-bundle/docs/`:
- Rust-specific WASM implementation details
- Platform-specific compression techniques (Mach-O)
- Not relevant to package-level consumers

### Common Mistakes to Avoid

❌ **Tier Confusion**:
```
# Bad: Cross-package guide in single package
packages/yoga-layout/docs/wasm-compilation-guide.md

# Good: Cross-package guide in tier 1
docs/build/wasm-build-guide.md
```

❌ **Missing Index**:
```
# Bad: No README.md in docs/
packages/onnx-runtime-builder/docs/
├── operators.md
└── optimization.md

# Good: README.md index present
packages/onnx-runtime-builder/docs/
├── README.md
├── operator-set.md
└── optimization-strategy.md
```

❌ **Implementation in Package Docs**:
```
# Bad: Implementation details in tier 2
packages/node-smol-builder/docs/macho-compression.md

# Good: Implementation details in tier 3
packages/node-smol-builder/wasm-bundle/docs/macho-compression.md
```

## Maintenance

### Regular Reviews
- Audit documentation hierarchy quarterly
- Check for outdated upstream version references
- Validate all cross-tier links still work
- Remove obsolete documentation

### Documentation Debt
Track documentation improvements in issues:
- Missing package-level docs
- Outdated version references
- Broken cross-tier links
- Missing index files

### Continuous Improvement
- Add documentation when complexity grows
- Move documentation when scope changes
- Remove documentation when code is simplified
- Keep upstream tracking current

## Resources

- **CLAUDE.md** - Repository Structure & Documentation section
- **Socket Registry CLAUDE.md** - Shared documentation standards
- **Keep a Changelog** - https://keepachangelog.com/
- **Write the Docs** - https://www.writethedocs.org/

---

**Last Updated**: 2025-10-26
**Maintainer**: Socket CLI Team
