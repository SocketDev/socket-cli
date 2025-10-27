# sbom-generator Documentation

Package-level documentation for Socket SBOM Generator - a type-safe CycloneDX SBOM generator for multi-ecosystem projects with Socket.dev integration and CodeT5 optimization.

## Overview

This package provides a pure TypeScript implementation for generating Software Bill of Materials (SBOM) documents in CycloneDX format. Unlike cdxgen which requires external tools, our implementation parses lockfiles directly and provides native Socket.dev security enrichment and CodeT5 ML model optimization.

## Contents

- **[architecture.md](./architecture.md)** - System architecture and modular parser design
- **[ecosystems.md](./ecosystems.md)** - Supported ecosystems and lockfile parsing strategies
- **[fidelity-analysis.md](./fidelity-analysis.md)** - SBOM accuracy and completeness analysis
- **[implementation.md](./implementation.md)** - Implementation details and code organization
- **[lock-step-compliance.md](./lock-step-compliance.md)** - CycloneDX spec compliance and validation

## Quick Links

- **Main README**: [`../README.md`](../README.md)
- **Source Code**: [`../src/`](../src/)
- **Tests**: [`../test/`](../test/)
- **Examples**: [`../examples/`](../examples/)

## Key Features

- **No External Tools** - Parse lockfiles directly without npm, pip, cargo, etc.
- **Type-Safe** - Full TypeScript implementation with comprehensive type checking
- **Multi-Ecosystem** - Auto-detect and parse npm, Python, Go, Rust, Ruby, PHP
- **Socket Integration** - Native Socket.dev security enrichment
- **CodeT5 Optimized** - Format SBOMs for maximum ML model performance (600x token reduction)

## Architecture

### Parser System

Each ecosystem has a dedicated parser implementing the `Parser` interface:

```typescript
interface Parser {
  ecosystem: Ecosystem
  detect(projectPath: string): Promise<boolean>
  parse(projectPath: string): Promise<ParseResult>
}
```

Implementations:
- `NpmParser` - package-lock.json, yarn.lock, pnpm-lock.yaml
- `PythonParser` - poetry.lock, Pipfile.lock, requirements.txt
- `GoParser` - go.mod, go.sum
- `RustParser` - Cargo.lock
- `RubyParser` - Gemfile.lock
- `PhpParser` - composer.lock

### Main Generator

The `generateSbom()` function orchestrates the entire process:
1. Auto-detect applicable parsers
2. Parse each ecosystem in parallel
3. Combine results into single CycloneDX SBOM

## Output Format

Generates **CycloneDX v1.5** SBOM compatible with:
- Grype
- Syft
- Trivy
- Dependency-Track
- All CycloneDX-compliant tools

## Development Status

- ✅ **npm** - Fully implemented
- ⏳ **Python** - In progress
- ⏳ **Go** - Planned
- ⏳ **Rust** - Planned
- ⏳ **Ruby** - Planned
- ⏳ **PHP** - Planned

## License

Private - Socket.dev internal use only

---

**Last Updated**: 2025-10-27
