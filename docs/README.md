# Socket CLI Documentation

## New to Socket CLI Development?

**Start here:** [Getting Started Guide](development/getting-started.md)

Complete end-to-end onboarding for new contributors:
- Prerequisites and installation
- 5-minute quick start
- Development workflow
- Testing strategies
- Troubleshooting guide

## Documentation Organization

📚 **[Documentation Organization Guide](documentation-organization.md)** - Complete guide to Socket CLI's 3-tier documentation hierarchy

### Categories

- **architecture/** - System design documents and flow diagrams
- **build/** - Node.js build system and patching documentation
- **configuration/** - Shared configuration architecture
- **development/** - Development tools and workflow
- **guides/** - User-facing how-to guides
- **performance/** - Performance optimization guides
- **technical/** - Low-level implementation details
- **testing/** - Testing strategies and guides

## Quick Links

### Architecture
- [Bootstrap/stub architecture](architecture/bootstrap-stub.md)
- [Repository structure](architecture/repository.md)
- [Stub execution flow](architecture/stub-execution.md)
- [Stub package](architecture/stub-package.md)
- [Unified binary design](architecture/unified-binary.md)

### Build System
- [Build System Guide](build/README.md) - **Start here** - Complete build system overview
- [Build/dist structure](build/build-dist-structure.md) - Output directory structure
- [Caching strategy](build/caching-strategy.md) - How build caching works
- [WASM build guide](build/wasm-build-guide.md) - Building WASM packages
- [Node.js build quick reference](build/node-build-quick-reference.md) - Troubleshooting custom Node.js builds
- [Node.js patch creation guide](build/node-patch-creation-guide.md) - Creating Socket patches for Node.js
- [Node.js patch metadata](build/node-patch-metadata.md) - Patch metadata format
- [Node.js build order](build/node-build-order-explained.md) - Understanding patch application order

### Configuration
- [Configuration migration guide](configuration/configuration-migration.md)
- [Configuration summary](configuration/configuration-summary.md)
- [Shared configuration architecture](configuration/shared-configuration-architecture.md)

### Development
- [Getting started](development/getting-started.md) - Complete onboarding guide for new contributors
- [Babel plugins](development/babel-plugins.md)
- [Development linking](development/linking.md)
- [Platform support](development/platform-support.md)

### Guides
- [CI setup for yao-pkg](guides/yao-pkg-ci.md)
- [Test yao-pkg binary](guides/testing-yao-pkg.md)

### Performance
- [Build performance](performance/performance-build.md)
- [CI performance](performance/performance-ci.md)
- [Testing performance](performance/performance-testing.md)

### Technical Details
- [Manifest management](technical/manifest-management.md) - Complete manifest API reference
- [Manifest extensions](technical/manifest-extensions.md) - Proposed future features
- [Metadata files](technical/metadata-files.md) - Metadata file formats
- [Patch cacache](technical/patch-cacache.md) - Patch backup and caching system

### Testing
- [Local testing](testing/local-testing.md)
- [Smart test selection](testing/smart-test-selection.md)
- [Testing custom Node.js](testing/testing-custom-node.md)
