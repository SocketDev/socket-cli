# Socket CLI Documentation

## Organization

📚 **[Documentation Organization Guide](documentation-organization.md)** - Complete guide to Socket CLI's 3-tier documentation hierarchy

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
- [Build process overview](build/build-process.md)
- [Build quick start](build/build-quick-start.md)
- [Build system summary](build/build-system-summary.md)
- [Build toolchain setup](build/build-toolchain-setup.md)
- [Builds created](build/builds-created.md)
- [Node.js build order](build/node-build-order-explained.md)
- [Node.js build quick reference](build/node-build-quick-reference.md)
- [Node.js patch creation guide](build/node-patch-creation-guide.md)
- [Node.js patch metadata](build/node-patch-metadata.md)
- [WASM build guide](build/wasm-build-guide.md)

### Configuration
- [Configuration migration guide](configuration/configuration-migration.md)
- [Configuration summary](configuration/configuration-summary.md)
- [Shared configuration architecture](configuration/shared-configuration-architecture.md)

### Development
- [Babel plugins](development/babel-plugins.md)
- [Development linking](development/linking.md)
- [Platform support](development/platform-support.md)

### Guides
- [Build yao-pkg binary](guides/yao-pkg-build.md)
- [CI setup for yao-pkg](guides/yao-pkg-ci.md)
- [Test yao-pkg binary](guides/testing-yao-pkg.md)

### Performance
- [Build performance](performance/performance-build.md)
- [CI performance](performance/performance-ci.md)
- [Testing performance](performance/performance-testing.md)

### Technical Details
- [Build improvements (2025-10-15)](technical/build-improvements-2025-10-15.md)
- [Build system improvements](technical/build-system-improvements.md)
- [Cacache format](technical/cacache-format.md)
- [Manifest extensions](technical/manifest-extensions.md)
- [Manifest format](technical/manifest-format.md)
- [Manifest management](technical/manifest-management.md)
- [Metadata files](technical/metadata-files.md)
- [Patch cacache](technical/patch-cacache.md)

### Testing
- [Local testing](testing/local-testing.md)
- [Smart test selection](testing/smart-test-selection.md)
- [Testing custom Node.js](testing/testing-custom-node.md)
