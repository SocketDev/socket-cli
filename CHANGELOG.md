# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2.0.0 - 2026-07-09

### Added

- **`check`** — add external-tools-release-tags-resolve gate
- **`hooks`** — add claude-md-size-guard and no-revert-guard
- **`cli`** — add defineHandoffCommand factory for ecosystem hand-off wrappers
- **`optimize`** — write pnpm 11+ overrides to pnpm-workspace.yaml
- **`mcp`** — port socket-mcp standalone into `socket mcp` subcommand
- **`scan`** — add --exclude-paths flag for full Tier 1 exclusion (port of #1298) (#1306)
- **`scan`** — brotli-compress .socket.facts.json on upload (port of #1291) (#1305)
- add xport lock-step manifest tooling (#1284)
- bootstrap @socketsecurity/lib + @socketregistry/packageurl-js + @sinclair/typebox via firewall-checked registry fetch (#1282)
- **`claude`** — add public-surface-reminder + token-hygiene hooks (#1272)
- **`build`** — port scripts/build.mts to shared build-pipeline orchestrator (#1265)
- **`cli`** — machine-output mode — stream discipline, flag propagation, scrubber (#1234)
- **`organization`** — show quota usage, max, and refresh time (#1236)
- **`cli`** — rename --default-branch (scan create) to --make-default-branch; harden default-branch flags (#1230)
- backport v1.x features and DRY out HTTP layer
- **`ci`** — add updating skill and weekly-update workflow
- **`sea`** — bundle Python packages at build time for offline operation
- **`build`** — pre-install socketsecurity into bundled Python for SEA
- **`vfs`** — add opengrep, trivy, trufflehog, python to SEA VFS extraction
- **`security`** — add SHA-256 verification for PyPI package downloads
- **`security`** — add SHA-256 checksum verification for PyCLI (socketsecurity)
- **`build`** — add npm package integrity verification
- **`build`** — inline all external tool checksums at build time
- **`dlx`** — add SHA256 checksum verification for Python and socket-patch downloads
- **`tui`** — add advanced iocraft components and styling features
- **`tui`** — add comprehensive terminal UI property support
- **`iocraft`** — add binary download mechanism from socket-btm
- **`iocraft`** — add author field to platform packages
- **`publish`** — use 'pre' dist-tag for all pre-release packages
- **`iocraft`** — use 'pre' dist-tag for pre-release versions
- **`iocraft`** — add MIT LICENSE files to socketaddon packages
- **`iocraft`** — add @socketaddon/iocraft v3.0.0-pre.0 package infrastructure
- **`publish`** — make dry-run first option and default to true
- **`socket`** — add bootstrap loader for @socketbin/\* binaries
- **`scan`** — add --workspace flag to scan create command
- **BREAKING:** **`patch`** — migrate socket-patch to v2.0.0 Rust binary from GitHub releases
- **`socketbin`** — improve platform detection for binary packages
- add musl/Alpine Linux support for binary packages
- **`build-infra`** — add github-error-utils for transient error handling
- **`cli`** — use process.smol.mount() for full VFS directory extraction
- add dependency updates to quality-scan skill + update deps
- **`cli`** — add GH_TOKEN as fallback for GitHub authentication
- **`cli`** — add explicit sfw command for Socket Firewall
- **`cli`** — add explicit pycli command for Python CLI invocation
- **`python`** — unify Python CLI spawning with SEA and DLX support
- **`build`** — add npm package download utilities for VFS bundling
- **`skills`** — add validation and chain-of-thought to quality-scan
- **`scan`** — add socket-basics integration utilities
- **`claude`** — add quality-scan skill for comprehensive code analysis
- **`deps`** — add @socketbin packages to update script
- migrate patch command to @socketsecurity/socket-patch@1.2.0 (#1042)
- add E2E test sharding and misc fixes (#1022)
- add alpm and vscode ecosystems, add scan type constants
- set scanType to socket_tier1 when creating reachability full scans
- add --silence flag to `socket fix`
- add --reach-lazy-mode flag for reachability analysis
- **`telemetry`** — adding initial telemetry functionality to the cli
- **`ci`** — add force rebuild option to all workflow_dispatch workflows
- **`cli`** — standardize .version tracking across all extract scripts
- **`sea`** — improve build cache management and add local development mode
- **`config`** — use EditableJson for non-destructive config saving
- **`scan`** — add --reach-use-only-pregenerated-sboms flag
- **`fix`** — add --fix-version flag to override Coana CLI version
- **`fix`** — add --ecosystems flag and rename --limit to --pr-limit
- **`fix`** — add --all flag to process all vulnerabilities
- **`debug`** — add API request/response logging via SDK hooks
- **`cli`** — add --reach-debug flag to enable verbose logging in the reachability (Coana) CLI
- **`build`** — leverage socket-btm releases for pre-compiled assets
- **`scan`** — add reachability concurrency and analysis splitting flags
- **`pip`** — add socket pip3 command with auto-detection and context passing
- **`errors`** — improve 403 error messages with command-specific permission guidance
- **`dx`** — standardize check runner output formatting
- **`dx`** — add .nvmrc and minimal quick-start guide
- **BREAKING:** **`build`** — improve setup script flags and logging
- **`build`** — add dead code elimination plugin
- **`cli`** — optimize development workflow with caching and improved docs
- **`cli-with-sentry`** — add package structure and build configuration
- **`bootstrap`** — add SOCKET_CLI_LOCAL_PATH support for testing
- **`cli`** — add supporting files
- **`cli`** — add new commands
- **`sfw`** — add Socket Firewall package manager wrappers
- **`smol-builder`** — add granular checkpoint system and refactor logger
- **`bootstrap`** — add Brotli compression for all bootstrap variants
- **`smol`** — implement binary caching to avoid recompilation on post-processing failures
- **`dlx`** — implement unified manifest for packages and binaries
- **`git-hooks`** — make security checks mandatory, lint/test optional
- **`scripts`** — add file validation checks
- **`validate`** — add bundle dependencies validation
- **`validation`** — add guard against link: dependencies and remove from root
- **`preflight`** — add @cyclonedx/cdxgen to background downloads
- **`nlp`** — add progressive enhancement with ONNX Runtime stub
- **`ci`** — add quantization level option to WASM workflow
- **`models`** — add INT8 quantization option for AI model builds
- **`workflows`** — add toggleable checkboxes for all build workflows
- **`install`** — enhance installer with Socket branding and better UX
- re-enable ONNX Runtime and add INT4-quantized AI models
- **`build`** — add dependency-aware caching and binary build scripts
- **`node-smol-builder`** — implement VM-based bootstrap loader for async support
- enhance socket build script with spinners and structured logging
- add comprehensive build script for socket package
- add shimmer effect to bootstrap spinner
- add spinner to bootstrap loading with withSpinner
- **`build`** — add --platform and --arch flags for consistency
- **`build`** — add parallel builds and consolidate build system
- **`build`** — add intelligent caching to build system
- **`bootstrap`** — add IPC handshake support for subprocess detection
- **`spawn`** — implement system Node.js detection with which
- **`dlx`** — unify .dlx-metadata.json schema across TypeScript and C++
- **`ci`** — auto-update socketbin versions in provenance workflow
- **`cli`** — enhance error handling with network diagnostics and timeout errors
- **`bootstrap`** — build SEA bootstrap in build script
- **`bootstrap`** — add SEA bootstrap for minimal SEA binaries
- **`cli,cli-with-sentry`** — add LICENSE and CHANGELOG.md to packages
- **`build`** — copy logos and data to packages during build
- **`ci`** — add npm@latest for trusted publishing support
- **`cli`** — temporarily disable ONNX Runtime integration
- **`python`** — add Python CLI version tracking to build configuration
- **`publish`** — query npm registry for latest @socketbin/\* versions
- **`publish`** — use base version from package.json for datetime versioning
- **`cli`** — add custom ONNX Runtime build package following yoga pattern
- **`bootstrap`** — restore logger with lazy initialization support
- **`build`** — add comprehensive Unicode property transformations
- **`build`** — auto-generate socketbin spec for cache keys
- **`compress`** — add spec string embedding for socket-lib cache keys
- **`compress`** — implement self-extracting binary architecture
- **`debug`** — add detailed HTTP request logging for failed API calls
- **`bootstrap`** — add Unicode property escape transforms for --with-intl=none
- **`ci`** — use Alpine Docker container for smol musl builds
- **`ci`** — add Alpine (musl) platform support to SEA and smol builds
- **`fix`** — integrate provider pattern into PR operations
- **`git`** — implement GitLab provider with MR operations
- **`git`** — implement GitHub provider with PR operations
- **`git`** — add provider infrastructure for GitHub/GitLab support
- **`cli`** — add markdown utility functions for consistent output formatting
- **`cli`** — implement markdown output for fix and optimize commands
- **`fix`** — add comprehensive PR management and tracking
- **`socket-fix`** — add batch PR flag for future implementation
- **`socket-fix`** — add persistent GHSA tracking to avoid duplicate fixes
- **`socket-fix`** — add PR lifecycle logging and superseded PR detection
- **`sea`** — add network retry, integrity checks, and freshness validation
- **`cli`** — add SHA256 checksum generation for build integrity
- **`build`** — add network retry utility with exponential backoff
- **`build`** — auto-build bootstrap package when missing
- **`bootstrap`** — add system node detection and forwarding control
- **`bootstrap`** — add system node detection and forwarding control
- **`bootstrap`** — create shared bootstrap package for npm and smol builds
- **`socket`** — add comprehensive builtin module mapping for smol
- **`socket`** — add dual bootstrap build for SEA and smol
- **`ci`** — build socket package bootstrap before SEA and smol builds
- **`ci`** — add stripped binary cache checkpoint for smol builds
- **`build-infra`** — add preflight-checks runner for DRY build validation
- **`build-infra`** — add script-runner utilities for DRY monorepo operations
- **`builders`** — add platform/arch arguments and use socket-lib parseArgs
- **`socket`** — add esbuild-based bootstrap implementation
- **`self-update`** — improve package manager detection and error messages
- add install.sh for Socket CLI installation
- **`ci`** — unify caching strategy across all build workflows
- **`ci`** — cache ONNX Runtime intermediate build artifacts
- **`ci`** — add GitHub Actions grouping to WASM and SEA workflows
- **`ci`** — add Ninja installation for smol builds
- **`node-smol`** — add GitHub Actions grouping for verbose build steps
- **`ci`** — add concurrency control to build workflows
- **`sbom-generator`** — add TypeScript SBOM generator package
- **`ci`** — reuse cached binaries from build-socketbin.yml
- **`ci`** — add cache restoration and fallback WASM builds
- **`ci`** — add @socketbin build workflow with caching
- **`ci`** — add WASM build workflow with caching
- add WIN32 shell support and update build infrastructure
- **`node-sea-builder`** — add hash-based caching for SEA binaries
- **`node-smol-builder`** — add hash-based caching for build artifacts
- **`cli-ai`** — throttle model update checks to once per 24 hours
- **`cli`** — add hash-based caching to extraction scripts
- **`build-infra`** — add extraction-cache utility for hash-based caching
- **`socketbin-cli-ai`** — add model update notifier with user prompt
- **`socketbin-cli-ai`** — add checkpoint-based incremental builds
- **`socketbin-cli-ai`** — add complete build system with INT4 quantization
- **`socketbin`** — add @socketbin/cli-ai package with compression strategy
- **`e2e`** — add interactive prompts and cache support for smol/sea binaries
- **`smol`** — make binary compression default with opt-out
- **`build-infra`** — add automated tool installer for cross-platform builds
- **`monorepo`** — add pnpm workspace catalog for Socket dependencies
- **`node-smol-builder`** — implement patch analysis with build-infra helpers
- **`build-infra`** — add patch analysis and conflict detection
- **`build-infra`** — add build logging and checkpoint helpers
- **`e2e`** — add auto-build support for binary E2E tests
- **`e2e`** — add npm scripts for testing different binary types
- **`e2e`** — add comprehensive binary test suite for JS, smol, and SEA
- **`e2e`** — add environment files for comprehensive E2E testing
- **`build`** — add automated build tools installation
- **`env`** — add RUN_E2E_TESTS environment variable
- **`dlx`** — add testable binary resolution pattern
- **`env`** — add system and LOCAL_PATH env modules with live VITEST mode
- **`os`** — add platform detection utilities for socketbin packages
- **`registry`** — add npm registry utilities for package downloads
- **`build`** — complete WASM package build scripts
- **`build-infra`** — add build environment and Rust builder modules
- **`tests`** — add case-insensitive env Proxy for Windows compatibility
- **`scripts`** — add monorepo-aware update, type, and test scripts
- **`scripts`** — add monorepo-aware lint, fix, and check scripts
- **`scripts`** — add monorepo utility helpers
- **`build`** — add platform-specific binary size optimization
- **`security`** — prevent SIGUSR1 debugger signal handling
- **`patch`** — add default subcommand handler
- **`constants`** — add barrel file and fix test imports
- **`patch`** — enable patch command and fix tests
- **`config`** — add shared configuration architecture for monorepo
- add Intl polyfill stub modules for CLI
- auto-strip AI attribution from commit messages
- add JS-only fallback release workflow for socket CLI
- register console and ask commands
- add interactive console command with Ink-based TUI
- add ASCII header banner utility with CI/VITEST plain text support
- implement SDK v3 file validation callback
- complete monorepo enhancements with all optional improvements
- add cli-sentry target for future @socketsecurity/cli-with-sentry package
- add all platform targets to build command
- add JSON and Markdown output support for manifest commands
- enhance workflows with monorepo support and configurable options
- add pre-publish validation to publishing workflows Add comprehensive validation to all three publishing workflows to prevent publishing broken packages. Created validation script that checks: - Package.json required fields and validity - Dist directory structure and files - Binary files and permissions - Data files presence - Production dependencies (no devDependencies) - Git status and tags - CLI bundle size sanity checks Workflow changes: - provenance.yml: Added validation after each of 3 package builds - publish-socketbin.yml: Added validation before main package publish - release-sea.yml: Added binary validation before GitHub release upload This prevents broken packages from reaching npm and users.
- add version consistency check script Create check-version-consistency.mjs to validate version numbers across package.json files before publishing. This ensures all packages are published with consistent versions. The script: - Checks main package.json version matches expected version - Optionally checks SEA npm package version (with warnings) - Exits with code 1 if critical version mismatches found - Provides clear colored output for CI workflows Referenced by .github/workflows/publish-socketbin.yml
- add ask mode demo and silence semantic model messages Add demo-ask-mode.mjs script that showcases natural language query translation across 6 categories with ~20 example queries. Remove semantic model loading messages since the model is optional and pattern matching works perfectly without it. The messages were noisy and gave the impression something was broken when it's actually working as intended.
- add esbuild configuration for CLI build Add esbuild configuration to replace Rollup bundler: - esbuild.cli.config.mjs: main configuration with plugins for package resolution - esbuild.cli.build.mjs: build script wrapper - esbuild-inject-import-meta.js: import.meta.url polyfill for CommonJS output This addresses template literal corruption issues in large bundles (>9MB) that occurred with Rollup. esbuild handles template literals correctly and produces faster builds without corruption.
- add module registration for --import flag Replace deprecated --loader with modern --import + register() API for Node.js 18+
- integrate MiniLM inference into socket ask command Updates handle-ask to use custom MiniLMInference engine instead of transformers.js. Implements hybrid semantic matching with three-tier progressive enhancement: pattern matching → word overlap → ONNX. Changes: - Replace transformers.js with MiniLMInference - Update cosineSimilarity to work with Float32Array - Use embedded ONNX from external/onnx-sync.mjs - Graceful degradation when ONNX unavailable
- add MiniLM model download and embedding scripts Scripts to download MiniLM model assets and embed them as base64 JavaScript for bundling. Follows yoga-layout WASM embedding pattern. - download-minilm.mjs: Downloads tokenizer and quantized ONNX model - embed-minilm.mjs: Embeds model as base64 in external/minilm-sync.mjs
- add MiniLM inference engine for semantic matching Implements direct ONNX Runtime integration with MiniLM model for semantic text understanding. Provides WordPiece tokenization, ONNX inference, mean pooling, and cosine similarity computation. Key features: - Direct ONNX Runtime with embedded WASM (no transformers.js wrapper) - Custom WordPiece tokenizer (pure JavaScript, 1-2ms per query) - 384-dimensional embeddings with mean pooling - Cosine similarity for semantic matching - SEA-compatible architecture with base64 WASM embedding
- add WordPiece tokenizer for ML model integration Implements pure JavaScript WordPiece tokenization for BERT/MiniLM models: WHAT IT IS: - Subword tokenization used by transformer models - Converts text → token IDs for ONNX Runtime - Zero ML dependencies, pure JavaScript HOW IT WORKS: 1. Basic tokenization (whitespace + punctuation splitting) 2. Greedy longest-match from vocabulary 3. Add special tokens ([CLS], [SEP], [UNK]) 4. Convert tokens to numeric IDs 5. Generate attention masks PERFORMANCE: - ~500KB vocab file (loaded once, cached) - ~1-2ms per query tokenization - Zero runtime ML overhead EXAMPLE: Input: "fixing vulnerabilities" Tokens: ["[CLS]", "fix", "##ing", "vulnerability", "##ies", "[SEP]"] IDs: [101, 8081, 2075, 23829, 2497, 102] FILES: - src/utils/wordpiece-tokenizer.mts - Core tokenizer implementation - src/utils/wordpiece-tokenizer.test.mts - Comprehensive test suite DOCUMENTATION: - Extensive inline comments explaining each step - Real-world examples from socket ask use cases - Links to original WordPiece and BERT papers
- add hybrid semantic matching for socket ask command Implements progressive enhancement for natural language understanding: Fast Path (instant): - Pattern matching with keyword detection - Compromise NLP for verb/noun normalization - Word-overlap matching with synonym expansion (~3KB semantic index) - Handles 80-90% of queries with zero ML overhead Fallback (50-80ms, high accuracy): - ONNX Runtime with MiniLM embeddings (planned) - Deep semantic understanding for ambiguous queries - Only loads when needed for remaining 10-20% edge cases Infrastructure: - scripts/llm/ directory for semantic tooling - scripts/extract-\*-wasm.mjs for WASM bundling - Claude skills in ~/.claude/skills/socket-cli/ for IDE integration - Generic wasm-loader.mjs utility Architecture follows yoga-layout pattern for WASM embedding: - Base64 encode WASM at build time - Synchronous instantiation for SEA compatibility - Full control over loading and initialization
- enhance socket ask with compromise NLP library Add compromise for text normalization to handle: - Verb tenses: 'fixing' -> 'fix', 'scanned' -> 'scan' - Plurals: 'vulnerabilities' -> 'vulnerability' - Natural phrasing: 'Can you scan...' -> 'scan' Improves pattern matching accuracy by ~10-15% while maintaining fast response times (<100ms). Falls back gracefully if NLP fails. Size impact: +3MB (acceptable for dev tool)
- implement socket ask command with natural language processing - Add cmd-ask.mts with --execute and --explain flags - Add handle-ask.mts with pattern matching engine - Priority-based matching (fix/patch/optimize > scan/package > issues) - Extracts severity, environment, package names, dry-run mode - Confidence scoring for intent matching - Add output-ask.mts with rich formatted output - Color-coded query interpretation - Command preview with syntax highlighting - Detailed explanations of what commands do - Project context display (dependency counts) - Register command in src/commands.mts - Fix yoga-layout patch to remove restrictive exports Pattern matching maps natural language to Socket CLI commands: - 'fix critical issues' → socket fix --severity=critical - 'apply patches' → socket patch - 'optimize dependencies' → socket optimize - 'is express safe' → socket package score express - 'scan for vulnerabilities' → socket scan create
- enhance patch command functionality Add new patch discover, download, and status subcommands with improved UX
- register rm and cleanup subcommands in patch command Added cmdPatchRm and cmdPatchCleanup to the patch command's subcommand registry. This enables users to run socket patch rm and socket patch cleanup commands. All subcommands are now registered: - apply: Apply patches with backup creation - cleanup: Clean up orphaned backups - get: Download patch files - info: Show patch details - list: List all patches - rm: Remove patch and restore backups
- integrate backup system with patch apply Integrated Phase 1.1 backup system into patch apply command. Before applying any patch, createBackup() is called to store the original file contents. This enables safe rollback via socket patch rm. Changes: - Import createBackup from backup utilities - Add patchUuid parameter to processFilePatch - Create backup before copying patched file - Log backup creation and continue on backup failure - Pass patch UUID from manifest to backup system This completes the backup integration loop: - apply: creates backups - rm: restores backups - cleanup: removes orphaned backups
- add patch cleanup subcommand for backup management Implemented socket patch cleanup to manage orphaned patch backups. Supports three modes: - No args: Clean up orphaned backups (not in manifest) - UUID: Clean up specific patch backups - --all: Clean up all patch backups Uses Phase 1.1 backup system APIs: - listAllPatches() to find all backup UUIDs - cleanupBackups() to remove backup data Includes 7 comprehensive tests covering help, missing directory, cleanup modes, and all output formats.
- add patch rm subcommand with backup restoration Implemented socket patch rm `<PURL>` to remove applied patches and restore original files from backups. Uses the Phase 1.1 backup system to restore files and clean up backups. Supports --keep-backups flag to preserve backup files after removal. Integrates with: - restoreAllBackups() to restore original files - cleanupBackups() to remove backup data - removePatch() to update manifest Includes 8 comprehensive tests covering help, missing PURL, patch not found, removal without backups, and all output formats.
- add patch get subcommand Implemented socket patch get `<PURL>` to download patch files from the .socket/blobs directory to a local directory for inspection. Files are copied with their directory structure preserved. Supports custom output directory via --output flag. Supports JSON and markdown output formats. Ready for tests to be added in next commit.
- add patch info subcommand Implemented socket patch info `<PURL>` to show detailed information about a specific patch. Displays all vulnerability details (GHSA IDs, CVEs, severity, descriptions), file changes with before/after hashes, and patch metadata (UUID, description, tier, license). Supports JSON and markdown output formats. Includes comprehensive tests covering help, missing PURL, patch not found, and all output formats.
- add patch list subcommand Implemented socket patch list to display all patches from the manifest. Shows PURL, UUID, description, exported date, file count, vulnerability count, tier, and license for each patch. Supports JSON and markdown output formats. Includes comprehensive tests covering help, error cases, and all output formats.
- add handle test helper infrastructure Add setupStandardHandleMocks helper for handle function tests: - Automatic function name derivation from module paths - Module-level mock setup for vi.mock hoisting - Clear pattern for testing fetch + output orchestration - Comprehensive JSDoc with usage examples
- use unified runner for all test stages with Ctrl+O support - Use unified-runner for checks, build, and tests (not just tests) - Display "Press Ctrl+O to show/hide output" hint at start - Eliminates spinner artifacts in logs - Provides consistent Ctrl+O toggle experience throughout - Cleaner output with no leaked spinner frames
- improve test script output consistency and masking - Replace createSectionHeader with printHeader for consistent formatting - Mask build output with spinner instead of showing verbose logs - Only show build output on failure - Aligns socket-cli test runner with socket-registry style
- add unified runner with Ctrl+O toggle for test output - Added unified-runner.mjs for consistent interactive output control - Updated test.mjs to use unified runner for TTY sessions - Added test setup file to suppress debug output - Configured vitest to use setup file - Provides consistent Ctrl+O toggle behavior across socket-\* repos
- add IPC validation module for inter-process communication - Add runtime validation for IPC messages - Implement type guards for IPC handshakes and stubs - Add helper functions for creating and parsing IPC messages - Ensure type safety for socket-cli inter-process communication
- add bordered input and lazy ink utilities - Add bordered-input.mts for styled terminal input - Add lazy-ink.mts for lazy loading ink components
- add interactive help system for better UX - Replace verbose --help output with interactive category selection - Support --help=category for direct category access - Categories: scan, fix, pm, pkg, org, config, ask, all, quick - Shows 'What can I help you with?' prompt with numbered options - Non-interactive terminals show category list with instructions - Maintains backward compatibility with --help-full for full output Examples: - socket --help # Interactive category selection - socket --help=scan # Show scan commands directly - socket --help=quick # Show quick start guide - socket --help-full # Show original full help
- add project context awareness and rich progress utilities - Add project context detection for package managers and frameworks - Add rich progress indicators for better UX during long operations - Create foundation for Claude CLI-like enhancements - Support for multi-progress bars, spinners, and file progress - Auto-detect npm/yarn/pnpm and provide contextual suggestions
- add trusted publisher verification script - Check if all @socketbin packages exist on npm - Verify provenance attestations if present - Check GitHub workflow configuration - Verify NPM_TOKEN secret (if accessible) - Provide clear status and next steps Run with: node scripts/verify-trusted-publisher.mjs
- add placeholder packages for @socketbin namespace - Create placeholder packages at v0.0.0 for all 6 platforms - Add script to generate placeholder packages - Add script to publish all placeholders at once - Add verification script to check packages on npm registry These placeholders are needed to enable trusted publisher configuration. Real binaries will be published at v1.x after trusted publisher is set up.
- implement @socketbin binary distribution system - Add package generator script for creating @socketbin/\* packages - Create dispatcher script that selects correct platform binary - Add GitHub Actions workflow for building and publishing with provenance - Update socket package to use optionalDependencies instead of postinstall - Remove install.js in favor of npm's built-in optional dependency handling This new approach eliminates postinstall failures and simplifies distribution
- add catastrophic delete protection to bootstrap remove() - Add inline remove() function with safety checks similar to del package - Prevent deleting cwd or directories outside SOCKET_HOME - Replace all fs.unlink() calls with safe remove() - Protects against accidental system-wide deletions - Can be overridden with force option if needed
- add affected test runner for faster test execution Implements intelligent test selection based on git changes to speed up local development and precommit hooks. Maps source files to their corresponding test files, running only affected tests when possible. Key features: - Detects changed/staged files using git utilities - Maps commands to co-located test files - Maps utils to test files in src/utils/ and test/unit/utils/ - Core files (cli, constants, types) trigger all tests - Supports --staged, --all, --force, and --coverage flags - Builds project automatically if needed
- add experimental bootstrap loader for stub distribution Simple Node.js loader that checks for ~/.socket/\_socket and delegates. Foundation for future bootstrap architecture improvements. Not yet integrated with build system.
- add build dependency checker and stub bundle verification - check-build-deps: Verifies build tools, offers UPX installation - verify-stub-bundle: Ensures bootstrap contains only Node builtins - Both support cross-platform (macOS, Linux, Windows)
- add bootstrap stub update capability to self-update command - Add checkAndUpdateStub() to update bootstrap stub during self-update - Check for stub updates even when CLI is up to date - Use stub path from IPC handshake to locate stub binary - Create backups and handle rollback for stub updates - Update both CLI and stub binaries in single self-update operation
- add centralized Ink and React imports wrapper Create src/utils/ink.mts to centralize Ink, React, and InkTable imports with proper tsgo workarounds. Add src/external/ink-table wrapper for proper ESM/CommonJS interop. This eliminates the need for @ts-ignore comments in every TSX file.
- add comprehensive memoization utilities Added full-featured memoization system for caching function results and optimizing expensive computations. Memoization Features: - memoize() for sync functions with configurable caching - memoizeAsync() for async functions with promise deduplication - memoizeWeak() using WeakMap for garbage-collectable object keys - once() for single-execution functions - memoizeDebounced() combining memoization with debouncing - LRU cache eviction when maxSize exceeded - TTL expiration for time-limited caching - Custom key generators for flexible cache keys - @Memoize decorator for class methods Cache Management: - Configurable max cache size with LRU eviction - TTL-based expiration - Access count tracking - Cache hit/miss debugging (DEBUG=cache) - Failed promise cleanup (errors not cached) - Concurrent call deduplication for async functions Test Coverage: - 20 tests covering all functionality (all passing) - Basic memoization with various argument types - Custom key generators - LRU eviction - TTL expiration - Async function handling - Concurrent call deduplication - Error handling - WeakMap garbage collection - once() single execution Usage Examples: - Simple: const fn = memoize((x) => x \* 2) - With options: memoize(fn, { maxSize: 100, ttl: 60000 }) - Async: const fn = memoizeAsync(async (id) => await fetchData(id)) - Once: const init = once(() => loadConfig()) - Weak: const fn = memoizeWeak((obj) => transform(obj)) Technical Details: - Zero overhead when DEBUG!=cache - Proper TypeScript generics - LRU access order tracking - High-resolution timestamps - Promise caching prevents duplicate API calls - WeakMap enables garbage collection
- add comprehensive performance monitoring utilities Added full-featured performance monitoring system for identifying bottlenecks and optimizing CLI execution. Performance Monitoring Features: - perfTimer() for timing operations with metadata - measure() and measureSync() for function execution timing - perfCheckpoint() for tracking progress through complex operations - trackMemory() for heap usage monitoring - Performance metrics collection (operation, duration, timestamp, metadata) - getPerformanceSummary() with count, avg, min, max, total statistics - generatePerformanceReport() for formatted output - Automatic cleanup and metric aggregation Integration: - Integrates with DEBUG=perf environment variable - No-op when perf tracking disabled (zero overhead) - Compatible with existing debug logging system - Works with debugFn for console output Test Coverage: - 21 tests covering all functionality (all passing) - Timer operations with metadata - Async and sync function measurement - Error handling and metadata tracking - Summary statistics calculation - Checkpoint and memory tracking - Report generation Usage Examples: - Simple timing: const stop = perfTimer('op'); stop() - Function measurement: const { result, duration } = await measure('op', fn) - Checkpoints: perfCheckpoint('phase-1', { count: 100 }) - Memory tracking: const mem = trackMemory('before-operation') - Summary: printPerformanceSummary() Technical Details: - Uses performance.now() for high-resolution timing - Rounds durations to 2 decimal places - Groups metrics by operation name - Exports all metrics for external analysis - Type-safe with PerformanceMetrics interface
- add intelligent caching strategies and comprehensive tests Added smart caching strategies and comprehensive test coverage for new features. Intelligent Caching Strategies: - Endpoint-specific TTL based on data volatility - Package info: 15min (stable), Issues: 5min (volatile), Scans: 2min (very volatile) - Org settings: 30min, User info: 1hr (most stable) - getCacheStrategy() for automatic TTL selection - shouldWarmCache() for critical data preloading - calculateAdaptiveTtl() for frequency-based TTL adjustment - Cache warming support for faster initial responses Test Coverage: - 23 tests for cache strategies (all passing) - Strategy selection for different endpoint patterns - TTL recommendations based on data characteristics - Cache warming decisions - Volatility detection - Adaptive TTL calculations - 14 tests for table formatting (all passing) - Bordered table rendering with box-drawing characters - Simple table rendering without borders - Column alignment (left, right, center) - Color function application - Width calculation with ANSI codes - Missing value handling - Dynamic vs fixed column widths Technical Details: - Pattern matching with glob-style wildcards - Debug logging integration for cache operations - Minimum TTL enforcement (30s) for adaptive caching - Maximum 50% reduction for frequently accessed data
- Enhanced error handling with recovery suggestions Add comprehensive error types with actionable recovery information: - AuthError: Authentication failures with login instructions - NetworkError: Connection issues with retry guidance - RateLimitError: API quota exceeded with wait times and upgrade suggestions - FileSystemError: File operations with code-specific recovery (ENOENT, EACCES, ENOSPC) - ConfigError: Configuration issues with setup instructions Improvements: - Each error type includes contextual recovery suggestions - Recovery suggestions displayed in terminal output with visual hierarchy - JSON output includes recovery array for programmatic consumption - Error display enhanced with cyan 'Suggested actions' section - 41 comprehensive tests covering all error types and recovery utilities Benefits: - Users get immediate, actionable guidance when errors occur - Reduces support burden with self-service recovery steps - Better UX with helpful suggestions vs generic error messages - Consistent error handling patterns across the codebase
- Add command registry infrastructure Add complete command registry system with: - Type-safe command definitions with flags, validation, and hooks - CommandRegistry class for registration and execution - Koa-style middleware composition - Flag parsing (string, boolean, number, array types) - Required flag validation and custom validators - Automatic help text generation - Before/after hooks for command lifecycle - Plugin system for extensibility - 17 comprehensive tests (all passing) Benefits: - Declarative command definitions vs imperative code - Type-safe with full TypeScript support - Self-documenting via auto-generated help - Middleware for cross-cutting concerns - Testable and composable Architecture ready for migration but not yet integrated into CLI entry point. Existing meow-based system continues to work unchanged.
- add comprehensive test utilities Add mock-helpers.mts with SDK/API mocking utilities Add environment.mts with test setup and cleanup helpers Add fixtures.mts with standard test data configurations Add constants.mts with common test values Add index.mts for convenient re-exports
- add core utilities for types, messages, result handling, and logging Add BaseFetchOptions type for consistent SDK options Add centralized error message templates in messages.mts Add result validation utilities with requireOk, map, chain functions Add command-scoped logger with context for better debugging

### Changed

- **`cli`** — use direct env reads for HOME in 5 commands
- **`ci`** — complete dependency caching for all test jobs
- **`ci`** — add dependency caching to GitHub Actions
- **`publish`** — optimize CLI build and consolidate platform definitions
- **`sea`** — parallelize binary injection for 8x faster builds
- **`cli`** — add Node.js memory allocation flags for large builds
- **`scripts`** — optimize build process
- **`cli`** — defer registryUrl lookup until needed
- **`smol`** — use vm.compileFunction() and remove internal path remapping
- **`ci`** — implement critical workflow optimizations
- **`ci`** — add Emscripten SDK and pip caching to build-sea workflow
- **`ci`** — add Emscripten SDK and pip package caching to WASM workflow
- optimize CI and test performance
- remove lazy-loading of bun lockfile parser
- **`ci`** — add caching to build-deps jobs
- **`ci`** — increase max parallel builds to 6 for SEA and smol workflows
- **`ci`** — add pip cache for Python dependencies in AI models build
- **`ci`** — optimize runner allocation and switch to Ninja
- **`ci`** — optimize binary builds with ccache and faster runners
- **`wasm`** — switch to single-threaded ONNX Runtime variant
- **`test`** — maximize thread pool based on CPU count
- **`build,test,ci,docs`** — apply socket-sdk-js optimizations across all phases

### Fixed

- **`lint`** — split oversize modules, type the build scripts, restore output-assertions helper
- **`lint`** — clear remaining non-split findings — identity assertions, template method order, changelog format
- **`ci`** — clear fleet gate findings — patch rationales, soak globs, userconfig opt-out, run-s globs
- **`build`** — repair createHash import and drop unpublished lib-stable external/semver subpath
- **`build`** — restore pipeline modules and exports the dead-code sweep removed while still imported
- **`build`** — restore build-pipeline.mts — scripts/build.mts still imports runPipelineCli
- **`ci`** — refresh external-tools pins to fleet data format
- **`config`** — repo.type is mono, not monorepo
- **`deps`** — bump vulnerable packages to soaked patched versions
- **`sea`** — repoint build-sea/test-sea imports at sea-build-utils dir
- **`deps`** — pin rolldown to soaked 1.0.3, matching the fleet baseline
- **`lint`** — migrate socket-hook markers to socket-lint prefix
- **`scripts`** — delegate all test scopes to per-package in no-config workspaces
- **`deps`** — migrate source to lib-stable 6.0.7 API
- **`scripts`** — make fleet test runner monorepo-safe and drop pnpm exec
- **`scripts`** — import logger in sync-checksums so log calls don't ReferenceError
- **`hooks`** — repoint commit-msg husky shim to .git-hooks/fleet/
- **`hooks`** — repoint husky shims to .git-hooks/fleet/ after segmentation
- **`debug,git`** — redact GitHub token in debug log; use debugNs for level namespaces
- **`mcp`** — bind unauthenticated HTTP transport to loopback + cap POST body
- **`scripts,format`** — repair migration-orphan imports/paths + format-script scope
- **`deps`** — bump vitest to 4.1.6 to clear GHSA-5xrq-8626-4rwp
- **`hooks`** — declare shell-quote dep so \_shared parser resolves
- **`tsconfig`** — point extends at .config/fleet/tsconfig.base.json
- **`build`** — migrate remaining external-tools.json tools to platforms schema
- **`build`** — migrate pnpm external-tools entry to platforms schema
- **`lint`** — revert colocate work in packages/cli/src — fleet rule requires export
- **`rich-progress`** — restore inadvertently-deleted file + v6 leaf import
- **`rich-progress`** — inline socket-hook marker so logger-guard sees it on the right line
- **`build`** — give each downloaded asset its own subdir to avoid .version race
- **`mcp/transport-http`** — drop `| undefined` from McpHandleRequest's auth field
- **`lint`** — convert file-scope oxlint disables + clear other violations
- **`packageManager`** — bump pnpm@11.0.8 → pnpm@11.1.2
- stop oxfmt from reformatting wheelhouse-schema.json
- **`scripts/check-prompt-less-setup`** — drop never-used writeFileSync + isLinux
- **`deps`** — restore -stable catalog aliases for self-named fleet packages
- **`lint`** — clean lint debt in packages/cli/scripts + src
- **`types`** — restore explicit-undefined on AuthenticatedRequest.auth
- **`types`** — resolve 4 tsgo errors in cli
- **`vitest`** — drop orphan base config + fix stale isolate comment
- **`scripts`** — restore spawnSync import in bootstrap-firewall-deps
- **`deps`** — bump hono to 4.12.18, fast-uri to 3.1.2 for CVE patches
- **`lint`** — dlx test polish — import-type, max-file-lines, sort
- **`types`** — resolve noUncheckedIndexedAccess + noUncheckedSideEffectImports
- **`lint`** — generate-report.test — max-file-lines legitimate bypass
- **`lint`** — cmd-manifest-cdxgen — exported helpers + cached for-loop
- **`lint`** — telemetry — prefer-function-declaration + cached-for-loop
- **`lint`** — mark Set-iteration for-of as intentional in 3 sites
- **`hook`** — mark progress-bar stderr writes as intentional
- **`lint`** — clear remaining socket/\* rule violations in cli package
- **`lint`** — scripts and package-builder
- **`lint`** — cache array.length in build-infra for-loops
- **`sync`** — cascade prefer-cached-for-loop let/const preservation patch
- **`lint`** — sort-source-methods - reorder 20 src files + oxfmt drift
- **`tests`** — restore vi.mock named exports for node:fs / node:os after import refactor
- **`lint`** — autofix sort-source-methods (13 files) + cascade canonical script fixes
- **`lint`** — close out non-blocked socket-cli rules
- **`types`** — no-explicit-any — final 29 src files (1-site fixes, brings count to 0)
- **`types`** — no-explicit-any — 11 src files, mostly 2-3 sites each
- **`types`** — no-explicit-any — 7 src files (pull-request, update-manifest, scan-from-github, lockfile-readers, errors, package-alert, shallow-score)
- **`types`** — no-explicit-any — second-pass test files for return / tuple positions
- **`types`** — no-explicit-any — top 6 src files (logger, api-wrapper, builder, meow, api, simple-output)
- **`types`** — consistent-type-imports — hoist 30 inline import() annotations across 19 test files
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 3/3)
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 2/3)
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 1/3)
- **`imports`** — node-builtin — inline-disable 6 test files using fs as value
- **`types`** — consistent-type-imports — hoist 29 inline import() annotations across 15 test files
- **`types`** — consistent-type-imports — hoist 29 inline import() annotations across 15 test files
- **`types`** — consistent-type-imports — hoist 16 inline import() annotations across 10 test files
- **`types`** — iocraft — add namespace import for ComponentNode type cast
- **`imports`** — node-builtin — remove dead fs imports in 5 test files
- **`types`** — consistent-type-imports — hoist 12 inline import() annotations across 5 test files
- **`imports`** — node-builtin — 7 files converted to named imports
- **`types`** — consistent-type-imports — hoist inline import() in sdk-test-helpers.mts
- **`regex`** — sort-regex-alternations — 8 rewrites + 1 order-significant disable
- **`types`** — consistent-type-imports — hoist inline import() in iocraft.mts
- **`types`** — consistent-type-imports — hoist inline import() in spawn-node.mts
- **`types`** — consistent-type-imports — hoist inline import() in types.mts
- **`imports`** — node-builtin — 5 files converted to named imports
- **`imports`** — node-builtin — 6 files converted to named imports
- **`lint`** — sort-named-imports — inline-disable intentional domain-grouped barrel import
- **`lint`** — max-file-lines — file-level bypass on 86 oversized files
- **`lint`** — no-fetch-prefer-http-request — inline-disable 5 dev-script fetches that need raw Response
- **`lint`** — apply 2nd-pass oxlint autofixes — sort-source-methods reorder 3 files
- **`lint`** — personal-path-placeholders — file-level disable on fixture tests + replace example usernames in src comments
- **`lint`** — prefer-exists-sync — rewrite 2 fileExists helpers + inline-disable legitimate metadata reads
- **`oxlint`** — rewrite overrides patterns as **/scripts/** etc.
- **`lint`** — export-top-level-functions — collapse 5 export-block aggregators
- **`lint`** — apply oxlint autofixes — export-top-level-functions / prefer-exists-sync / prefer-node-builtin-imports / sort-equality-disjunctions / prefer-undefined-over-null
- **`no-status-emoji`** — cascade rule self-disable + bypass scripts/tests
- **`lint`** — re-cascade canonical oxlint plugin rules — undo self-corruption
- lint --fix autofix pass + cascade canonical check-paths.mts
- **`tests`** — align 39 assertions with null→undefined flip
- **`types,quality`** — revert Object.create(undefined) regression + finish null→undefined flip
- **`cli`** — register `mcp` in canonical bucketed-commands set
- **`deps`** — bump hono via override to ≥4.12.16 (CVE patched)
- **`hooks`** — release-workflow-guard — multi-root dry-run resolution
- **`hook`** — release-workflow-guard — derive project dir from script path
- **`hooks`** — tighten npx-scanner regex to skip identifier/key contexts
- **`deps`** — override ip-address >=10.1.1 (GHSA-v2v4-37r5-5v8g)
- **`hooks`** — anchor hook commands + project paths to $CLAUDE_PROJECT_DIR
- **`test`** — repair four CI-failing assertions on main
- **`deps`** — regenerate pnpm-lock.yaml for catalog drift
- **`cli`** — stop socket cdxgen from silently shipping empty-components SBOMs (#1266)
- **`cli`** — error messages in env/ + constants/ + sea-build scripts (#1258)
- **`cli`** — error messages in utils/ misc (flags, fs, git, npm, promise, terminal) (#1260)
- **`cli`** — error messages for utils/update + utils/command + error library migration (#1257)
- **`cli`** — error messages in utils/dlx/ (#1256)
- **`cli`** — error messages in commands/ (14 commands + their tests) (#1255)
- **`cli`** — align test/ error messages with 4-ingredient strategy (#1259)
- **`cli`** — return org slug, not display name, from org resolution (#1232)
- **`deps`** — bump nanotar 0.2.0 → 0.2.1 to patch path traversal (CVE-2025-69874) (#1250)
- **`debug`** — log structured HTTP error details instead of raw response (#1233)
- **`test`** — pass --passWithNoTests to vitest (#1240)
- **`scan`** — surface GitHub rate-limit errors in bulk repo scan (#1235)
- **`fix`** — validate target directory and detect misplaced IDs (#1227)
- **`api`** — include request path in API error messages (#1224)
- **`api`** — distinguish 401 (auth failure) from 403 (permissions) (#1226)
- **`scan`** — respect projectIgnorePaths from socket.yml (#1225)
- **`ci`** — replace close/reopen hack with workflow_dispatch for bot PRs (#1210)
- **`build`** — improve asset download resilience against rate limits (#1201)
- **`config`** — align .npmrc and pnpm-workspace.yaml for pnpm v11 (#1198)
- **`hooks`** — normalize platform keys and strip host prefix from repository (#1194)
- **`hooks`** — use strings for binary file scanning in pre-push (#1196)
- **`hooks`** — update zizmor repo from woodruffw to zizmorcore (#1191)
- **`deps`** — bump vite to 7.3.2 (security) (#1168)
- **`ci`** — harden weekly-update — allowedTools, two-phase update, diff validation (#1159)
- move minimum-release-age to pnpm-workspace.yaml (#1158)
- **`build`** — fix runtime bugs in build scripts (#1148)
- upgrade handlebars to 4.7.9, fix pre-push hook (#1134)
- upgrade brace-expansion to 5.0.5 (CVE-2026-33750) (#1132)
- **`ci`** — rebuild weekly-update.yml with proper YAML and features
- harden GitHub Actions workflows (#1129)
- **`ci`** — update pnpm/action-setup to Node 24 (58e6119)
- **`skill`** — update updating skill to use pnpm run update and check --all
- **`ci`** — add timeout-minutes and shell declarations to workflows
- **`ci`** — add explicit shell: bash declarations to provenance workflow
- **`types`** — remove unused import and fix context tests
- **`security`** — make missing SHA-256 checksums a hard error
- **`ci`** — add complete stub package with JS implementation for iocraft
- **`ci`** — create stub packages before pnpm install
- **`ci`** — setup pnpm before node to enable cache
- **`types`** — resolve TypeScript type errors in iocraft and test helpers
- **`tui`** — fix border rendering in iocraft column layouts
- **`deps`** — remove stale restore-cursor patch
- **`deps`** — remove stale React/Ink dependencies after iocraft migration
- **`test`** — replace unsafe fs.rm with safeDelete
- **`cli`** — improve cache coherency and notification handling
- **`cli`** — handle undefined returns from getMajor in optimize
- **`security`** — address critical security vulnerabilities
- **`cli`** — invalidate token cache on login/logout
- **`cli`** — correct unreachable error branch in scan-diff
- **`iocraft`** — critical publishing workflow fixes
- **`publish`** — use separate versions for cli and iocraft ecosystems
- **`iocraft`** — use independent versioning starting at 1.0.0-pre.0
- **`cli`** — transform yoga-sync.mjs to remove top-level await for CJS
- use 0.0.0 for placeholder version (matches existing pattern)
- properly disable dependabot (#1119)
- **`publish`** — rename workflow to provenance.yml for trusted publishing
- **`publish`** — restore socket package and fix paths
- **`ci`** — read base version from cli-package template
- **`publish`** — add missing check-version-consistency script and update docs
- **`sfw`** — use separate versions for SEA and npm CLI distributions
- address quality scan findings (Round 1)
- **`dry-run`** — show computed query parameters in read-only commands
- **`cli`** — enhance fix dry-run to show computed details
- **`cli`** — improve optimize dry-run and remove unused logger imports
- **`quality-scan`** — remove socket-btm cross-project references
- **`cli`** — replace broken --dry-run with meaningful preview output
- **`test`** — inject inlined env vars in test setup for e2e tests
- **`ci`** — remove integration tests job (no integration tests exist)
- **`ci`** — simplify CI workflow and remove references to non-existent directories
- **`ci`** — use pnpm/action-setup to read packageManager from package.json
- **`quality`** — add try-catch for JSON.parse in build scripts
- **`quality`** — add defensive checks and fix Windows ARM64 Python detection
- quality scan fixes - NaN validation, logging conventions, docs
- **`sea`** — use relative paths in sea-config and update SDK
- remove cross-repository updates from quality-scan skill
- **`sea`** — update Trivy to v0.69.2
- **`sea`** — use win32 platform keys in external-tools-platforms
- **`vfs`** — update mount type signature to async `Promise<string>`
- **`sea`** — fix sfw extraction from VFS with node_modules structure
- **`sea`** — add Socket Firewall (sfw) to VFS bundling
- **`scan`** — correct policy strictness comparison in alert aggregation
- **`hooks`** — check only new commits in pre-push, not all since release
- **`hooks`** — use portable for loop instead of process substitution in pre-push
- **`cli`** — address quality scan findings round 10
- **`package-builder`** — correct dependencies for cli-with-sentry template
- **`cli`** — restore 'as unknown as' pattern in type assertions
- **`cli`** — handle negative time deltas in msAtHome function
- **`cli`** — add defensive optional chaining in getHighestEntryIndex
- **`cli`** — address remaining round 17 low priority issues
- **`cli`** — address round 17 quality scan findings
- **`cli`** — improve type safety by replacing unsafe type assertions
- **`cli`** — remove globalThis indirection in update notifier
- **`cli`** — improve Coana output parsing to handle empty lines
- **`cli`** — add HTTP request timeouts to prevent indefinite hangs
- **`cli`** — restore and fix handle-optimize.test.mts
- **`cli`** — resolve TOCTOU race conditions in file cleanup
- **`cli`** — replace Math.random() with fixed delay in preflight downloads
- **`cli`** — address quality scan findings round 9
- **`cli`** — address quality scan findings round 8
- **`cli`** — prevent unbounded Map growth in inflight trackers
- **`cli`** — code style consistency - catch parameter naming and type safety
- **`cli`** — add missing lru-cache dependency
- **`cli`** — address quality scan findings round 4 (part 2) - lock detection and race conditions
- **`cli`** — address quality scan findings round 4 (part 1)
- **`cli`** — address quality scan findings round 3
- **`cli`** — capture timestamp at function entry for accurate TTL
- **`ci`** — add required .env.precommit for pre-commit hooks
- **`ci`** — improve workflow reliability and security validation
- **`cli`** — add input validation and bounds checking
- **`cli`** — resolve race conditions and improve locking mechanisms
- **`cli`** — resolve memory leaks and resource cleanup issues
- **`cli`** — fix getMaxOldSpaceSizeFlag default calculation
- **`hooks`** — add prerequisite checks to pre-commit hook
- **`cli`** — address quality scan findings round 11
- **`cli`** — address quality scan findings round 10
- **`cli`** — address quality scan findings round 9
- **`cli`** — address quality scan findings round 8
- **`cli`** — address quality scan findings round 7
- **`cli`** — address round 6 quality scan findings
- **`cli`** — address round 5 quality scan findings
- **`cli`** — address quality scan findings (round 4)
- **`cli`** — address quality scan findings (round 3)
- **`cli`** — address quality scan findings (round 2)
- **`cli`** — address quality scan findings across codebase
- **`cli`** — inject external tool versions in integration test runner
- **`scripts`** — use absolute paths for validation scripts in check.mjs
- **`types`** — resolve TypeScript errors in spawn usage and unused imports
- **`types`** — resolve TypeScript errors in quality scan fixes
- **`build`** — resolve TOCTOU races and cache invalidation
- **`cli`** — improve type safety in spec parsing and overrides
- **`scan`** — resolve critical bugs in scan output handlers
- **`build`** — remove redundant warning emojis from logger.warn calls
- **`deps`** — always update Socket packages in update script (#1059)
- **`deps`** — add restore-cursor signal-exit v4 compatibility patch
- **`deps`** — update @socketsecurity/lib to v5.5.3 and add signal-exit v4 compatibility patches
- **`deps`** — update Socket packages regardless of taze result
- prevent heap overflow in large monorepo scans (#1041)
- remaining fixes from PR 1025 (#1027)
- ensure build directory exists before writing yoga placeholder
- remove unused silence parameter from FetchOrganizationOptions type
- update extract scripts for corrected socket-btm asset names
- implement findAsset locally, remove non-existent import
- exit with code 1 when socket ci finds blocking alerts
- **`security`** — disable automatic caching in setup-node to prevent cache poisoning
- **`security`** — resolve artipacked and docker security vulnerabilities
- **`sea`** — use unique cache directories for parallel binject builds
- **`sea`** — add exit code checking for binject spawn
- **`build`** — use bracket notation for TypeScript index signatures
- **`build`** — add GitHub API authentication to avoid rate limits
- **`deps`** — Remove http2 module dependency from @sigstore/sign
- **`cli`** — add per-platform caching for parallel SEA builds
- **`build-infra`** — add GitHub token authentication to API requests
- **`build-infra`** — Add GitHub API headers to httpRequest calls
- **`glob`** — add dot:true to match dotfiles and dot directories
- **`optimize`** — remove Node.js version filter from manifest entries
- **`sea`** — use toUnixPath for Git Bash tar compatibility
- **`sea`** — use current Node.js process for SEA blob generation
- **`sea`** — update binject command and node-smol URL format
- **`debug`** — use correct debug functions with proper namespacing
- **`scan`** — use Octokit for GitHub API calls with proper error handling
- **`ci`** — add Node.js and pnpm setup immediately after checkout in all workflows
- **`sea`** — compute rootPath in getBinjectPath function
- **`build`** — use yoga-sync.mjs from socket-btm and integrate binject
- **`cli`** — resolve socket-lib external paths at any nesting depth
- **`bootstrap`** — remove non-existent polyfill imports and fix build errors
- **`fix`** — add ecosystems support to coana CLI calls
- **`fix`** — add --limit as alias for --pr-limit
- **`flags`** — make --exclude and --include visible in socket fix command
- **`dlx`** — support Coana CLI binary execution via SOCKET_CLI_COANA_LOCAL_PATH
- **`docs`** — remove hardcoded personal paths and realistic API key examples
- **`hooks`** — limit pre-push AI attribution check to commits since latest release
- upload manifest files relative to target for coana-fix and perform-reachability-analysis
- **`self-update`** — implement bootstrap binary path via IPC handshake
- **`api`** — improve CVE to GHSA conversion caching and error messaging
- **`cli`** — resolve --limit flag not working in local mode
- **`fix`** — improve PR creation logic and branch lifecycle management
- **`dlx`** — pin Coana to exact version without tilde prefix
- **`alerts`** — respect SOCKET_CLI_API_TOKEN environment variable
- **`test`** — resolve flaky TTL boundary test by mocking Date.now()
- **`build`** — inline environment variables to prevent package.json errors
- **`shadow`** — use static imports for shadow bins instead of dynamic require
- **`spawn`** — add which() resolution for command spawns
- **`deps`** — fix bin entries and standardize engine requirements
- **`ui`** — change error badge text from red to white on red background
- **`deps`** — resolve ANSI bundling compatibility issues
- **`bootstrap`** — use consistent naming for published build flag
- **`dev`** — improve fresh clone developer experience
- **`build`** — fix bundle dependencies validation and add missing deps
- **`build`** — add TypeScript dependency and fix socket-lib bundling
- **`build`** — update pnpm and fix CLI build with socket-lib 3.3.2
- **`test`** — fix test infrastructure and ensure build before test:all
- **`build`** — fix bundle dependencies validation
- **`setup`** — verify gh CLI is accessible after installation
- **`cli`** — add missing subcommands to help menu validation
- **`hooks`** — improve AI attribution detection in pre-push hook
- **`hooks`** — use printf for colored output in pre-push hook
- **`workflows`** — resolve all zizmor security findings
- **`socket`** — correct package.json metadata and build script
- **`socket`** — add missing version defines to bootstrap build config
- **`cli`** — add src to files array for bin entry
- **`cli`** — rename duplicate dev script to dev:watch for clarity
- **`types`** — resolve TypeScript errors in package manager commands
- **`hooks`** — improve git hook compatibility and formatting
- **`smol-builder`** — fix spawn import in compress-binary script
- **`smol-builder`** — fix smokeTestBinary API mismatch
- **`smol-builder`** — standardize brotli2c naming to socketsecurity\_ prefix
- **`smol-builder`** — convert remaining patches to standard unified diff format
- **`smol-builder`** — convert polyfill patches to standard unified diff format
- **`smol-builder`** — regenerate polyfill patches with real git hashes
- **`smol-builder`** — replace fs.rm with safeDelete for secure deletion
- **`smol-builder`** — replace remaining rm calls with fs.rm
- **`smol-builder`** — replace cp with fs.cp for file copy operations
- **`smol-builder`** — add readdirSync back to fs imports
- **`smol-builder`** — replace remaining mkdir calls with safeMkdir
- **`eslint`** — enable no-undef rule for script files
- **`smol-builder`** — use fs.method() pattern for all fs.promises calls
- **`smol-builder`** — replace mkdir with safeMkdir
- **`smol-builder`** — copy bootstrap loader to lib/internal before compilation
- **`smol-builder`** — correct brotli2c patch line numbers for pristine Node.js v24.10.0
- **`sea-builder`** — remove erroneous closing brace causing syntax error
- **`smol-builder`** — copy brotli header to src directory
- **`smol-builder`** — update hardcoded patch reference to use numbered prefix
- **`test`** — correct import path for confirm prompt
- **`bootstrap`** — use major version only for CLI download spec
- **`smol`** — implement robust cross-platform strip with capability detection
- **`smol`** — use platform-specific strip flags for binary optimization
- **`smol`** — use shell for execCapture and enable fail-fast for builds
- **`bootstrap`** — show Socket CLI version instead of Node.js version
- **`bootstrap`** — skip preflight on --version for instant response
- **`smol`** — skip CLI bootstrap for basic Node.js operations
- **`ci`** — make WASM optional in SEA builds with graceful fallback
- **`ci`** — remove ai-cache-valid references from build-sea workflow
- **`ci`** — comment out socketbin-cli-ai references in build-sea workflow
- **`ci`** — update ONNX Runtime artifact verification to check for .mjs files
- **`onnx`** — add existence checks to patch verification
- **`onnx`** — verify wasm_post_build.js patch in cache validation
- **`onnx`** — clean stale cache after GitHub Actions restoration
- **`onnxruntime`** — patch wasm_post_build.js in both source and build directories
- **`bootstrap`** — remove unnecessary empty log after spinner completes
- **`test`** — reduce thread count on macOS CI to prevent SIGABRT
- **`types`** — resolve exactOptionalPropertyTypes issue in UpdateStore
- **`update`** — only show content-type warning in debug mode on parse failure
- **`types`** — correct parameter types for SDK method calls
- **`types`** — add explicit type parameters to handleApiCall calls
- **`types`** — update handleApiCall signature for SDK v3 compatibility
- **`types`** — revert to use SDK v3 method names in type references
- **`types`** — update SDK operation names to match API types
- **`deps`** — update all packages to use catalog for @socketsecurity/lib
- **`lint`** — fix all lint errors and update dependencies
- **`build`** — externalize Socket dependencies and add bundle validation test
- update for @socketsecurity/lib 3.0.5 compatibility
- **`build`** — use default export workaround for CommonJS imports with --import flag
- **`test`** — resolve TypeScript errors and test failures in NLP modules
- **`smol`** — use Module.prototype.require.bind for virtual module
- **`smol`** — use Module.createRequire for proper module context
- **`onnx`** — patch wasm_post_build.js to handle modern Emscripten
- **`bootstrap`** — correct stream/promises module path for smol builds
- **`ci`** — remove expression from build-models job name
- **`models`** — correct --all flag logic to build both models
- **`ci`** — build all AI models in workflow
- **`models`** — check for all expected ONNX files during conversion
- **`models`** — fix method variable scope in quantization fallback
- **`ci`** — remove invalid job-level matrix conditions from workflows
- **`onnxruntime`** — remove EXPORT_ES6=0 patch for threading compatibility
- **`onnxruntime`** — enable threading and SIMD for v1.21.1 compatibility
- **`ci`** — mark ONNX Runtime WASM build as non-blocking
- **`models`** — update INT4 quantization API for onnxruntime 1.20+
- **`ci`** — install optimum[onnxruntime] for ONNX model export
- **`onnx`** — remove ES module type from onnxruntime package.json
- **`socket`** — remove bootstrap-smol.js from npm package build
- **`patch`** — remove unused imports after duplicate logging removal
- **`patch`** — remove duplicate output logging to fix markdown test flakiness
- **`path`** — handle UNC paths correctly on Windows
- **`path`** — add Windows validation for Unix-style paths in findNpmDirPathSync
- **`wasm`** — update INT4 quantization to use matmul_nbits_quantizer API
- **`ci`** — pin onnxruntime>=1.20.0 to ensure INT4 quantization support
- **`ci`** — upgrade onnxruntime and add INT4 quantization tools
- **`ci`** — uncomment ONNX Runtime build steps to fix bash syntax error
- **`bootstrap`** — eliminate spurious error message on successful CLI execution
- improve bootstrap error handling
- **`completion`** — resolve CLI package root correctly for tab completion script
- **`scan`** — flatten SDK options and make repo parameter conditional
- restore v1.x environment variable fallbacks and EEXIST handling
- **`smol`** — enable code cache for brotli decompression support
- run build before verify in socket package
- inject **MIN_NODE_VERSION** in bootstrap esbuild configs
- use logger.fail for error messages in verify script
- read CLI version from socket package.json during build
- **`cli-with-sentry`** — add missing esbuild config for shadow-npm-inject
- **`cli-with-sentry`** — add missing shadow-npm-inject build step
- **`build`** — skip onnxruntime build (temporarily disabled)
- **`gitignore`** — allow docs/build directory without requiring -f flag
- resolve TypeScript errors after nodeDebugFlags removal
- remove nodeDebugFlags references
- **`build`** — align platform/arch flags in build-all-binaries
- **`build`** — disable minifySyntax across all esbuild configs
- **`socket`** — disable minifySyntax to prevent async function boundary corruption
- **`ci`** — align smol cache keys with build-smol.yml in publish-socketbin.yml
- **`ci`** — use SEA binary cache from build-sea.yml in publish-socketbin.yml
- **`sbom-generator`** — resolve exactOptionalPropertyTypes type errors
- **`test`** — use proper function syntax for Vitest constructor mocks
- **`lint`** — resolve lint errors and remove dead getInternals code
- **`node-sea-builder`** — add missing crypto import
- **`bootstrap`** — improve error handling for CLI download failures
- **`cli`** — update getBinCliPath to use dist/index.js instead of bin/cli.js
- **`environment`** — remove unused createRequire import
- **`environment`** — lazy-load bun lockfile parser
- **`install`** — download from npm registry instead of GitHub releases
- **`prepare`** — remove dotenvx wrapper from husky prepare script
- **`workflow`** — specify correct build target for cli-with-sentry
- **`workflow`** — update JS-only fallback validation
- **`cli-with-sentry`** — use dist/index.js and validate cli.js.bz
- **`cli-with-sentry`** — use socket-with-sentry bin name
- **`cli-with-sentry`** — move @sentry/node to dependencies
- **`ci`** — validate yoga WASM cache instead of building on miss
- **`ci`** — publish from package directories and build yoga WASM on cache miss
- **`ci`** — replace obsolete external cache with yoga-layout WASM cache
- **`scripts`** — update dist validation to check for index.js and cli.js.bz
- **`scripts`** — update pre-publish-validate to accept package path
- **`scripts`** — remove duplicate colors declaration in pre-publish-validate
- **`ci`** — use 'pnpm run build' instead of non-existent 'build:dist'
- **`packages`** — run pnpm pkg fix to normalize package.json fields
- **`socketbin`** — add repository field to all package.json files
- **`ci`** — add --tag latest to all npm publish commands for prerelease versions
- **`ci`** — use semver to extract X.Y.Z from package version before appending timestamp
- **`scripts`** — skip socketbin-cli-ai version check (not published by workflow)
- **`scripts`** — skip root package.json check for socketbin versions
- **`ci`** — install dependencies before version consistency check
- **`ci`** — use bash shell for verify binary step on Windows
- **`ci`** — skip smol build when method=sea and use bash shell for Windows compatibility
- **`ci`** — use 2-core runners in publish-socketbin for better availability
- **`ci`** — comment out ONNX runtime in build-sea workflow
- **`ci`** — correct ONNX package paths in build-sea workflow
- **`ci`** — correct SEA builder package name in publish-socketbin
- **`ci`** — add CLI build step before SEA binary build in publish-socketbin
- **`scripts`** — prepublish-socketbin should create bin/socket not bin/cli
- **`ci`** — align publish-socketbin binary paths with build-sea naming
- **`ci`** — upgrade actions/cache to v4.3.0 in publish-socketbin workflow
- **`scripts`** — improve type check error output in check script
- **`cli`** — add missing INLINED_SOCKET_CLI_PYCLI_VERSION to ENV
- **`onnxruntime`** — correct EXPORT_ES6=0 to output .js files instead of .mjs
- **`onnxruntime`** — add EXPORT_ES6=0 patch and require shim for WASM build
- **`test`** — fix scan create tests to use valid directory targets
- **`onnx`** — disable WASM threading and patch cmake to fix MLFloat16 build errors
- **`test`** — fix self-update tests by mocking canSelfUpdate and cleaning up leftover directories
- **`build`** — add missing INLINED_SOCKET_CLI_CDXGEN_VERSION to esbuild config
- **`onnxruntime`** — enable WASM threading to fix MLFloat16 build errors
- **`bootstrap`** — remove logger usage from smol bootstrap for early initialization
- **`tests`** — fix GitLab provider mock constructor
- **`tests`** — fix npm-config mock constructor to work with 'new' operator
- **`scan-reach`** — handle empty string and undefined outputPath properly
- **`cli`** — inline build-time constants with post-bundle replacement plugin
- **`build-infra`** — escape regex patterns for string literal context in Unicode transform
- **`onnxruntime`** — pass WASM_ASYNC_COMPILATION via CMake defines
- **`ci`** — use package version for WASM workflow cache keys
- **`ci`** — use package version for ONNX Runtime cache key
- **`onnxruntime`** — update Eigen hash patch for v1.21.1 deps.txt format
- **`onnxruntime`** — re-clone if Eigen patch not applied
- **`onnxruntime`** — clean CMake cache when applying Eigen hash patch
- **`onnxruntime`** — apply Eigen hash patch unconditionally
- strip placeholder suffix from socketbin versions
- **`publish`** — read base version from current package being generated
- **`onnxruntime`** — patch Eigen hash to match GitLab archive format
- **`onnxruntime`** — disable TLS verification for CMake downloads
- **`onnxruntime`** — update to v1.21.1 to fix Eigen hash mismatch
- remove yoga-layout patch reference from root package.json
- **`cli`** — handle missing yoga-layout WASM files gracefully
- **`bootstrap`** — avoid logger initialization before stdout is ready
- **`cli`** — correct ESLint config paths to monorepo root
- **`build`** — read socketbin spec from actual package.json
- **`compress`** — align cache key generation with socket-lib
- **`scan`** — resolve TypeScript errors from merged PRs
- **`lint`** — exclude test fixtures from Biome linting
- **`git`** — correct import path for paths module
- **`bootstrap`** — load Intl polyfill before logger to prevent smol build failure
- **`test`** — delete obsolete bootstrap test and fix provider factory assertions
- **`test`** — add missing paths mock for provider factory tests
- **`test`** — fix constructor mocks and add missing canSelfUpdate export
- **`test`** — replace runCommandQuiet with spawn and fix mock constructors
- **`types`** — resolve TypeScript errors in GitLab provider
- **`cli-with-sentry`** — write esbuild output and add gitignore
- **`smol`** — fix MODULE_NOT_FOUND error for socketsecurity bootstrap
- **`ci`** — disable pip cache in build-wasm to prevent cache failures
- **`ci`** — correct artifact paths in build-sea workflow
- **`ci`** — correct artifact paths in build-smol workflow
- **`cli`** — suppress esbuild warnings in CLI build
- **`ci`** — correct socket package verification in build-sea workflow
- **`ci`** — remove CLI build from build-deps job in SEA workflow
- **`ci`** — add detailed cache diagnostics to build-sea workflow
- **`ai`** — update onnxruntime to 1.21.0+ for INT4 quantization support
- **`ci`** — add WASM asset verification before CLI build in SEA workflow
- **`ci`** — include bootstrap deps in SEA binary cache key
- **`ci`** — include bootstrap deps in smol binary cache key
- **`smol`** — add diagnostic logging for bootstrap file location
- **`ci`** — correct artifact download path and add relocation logic
- **`ci`** — add verification step for downloaded build artifacts
- **`smol`** — fail build if bootstrap cannot be copied
- **`lint`** — remove unused variables and parameters
- **`scripts`** — replace undefined runCommandQuiet with spawn
- **`socket-fix`** — add missing import and fix optional prNumber type
- **`socket-fix`** — add remote branch cleanup on PR creation failure
- **`smol`** — optimize build flow and fix macOS ARM64 signing
- **`ci`** — split dependency builds from matrix parallelization
- **`sea`** — use versionSemver from node-version.json to avoid double 'v' prefix
- **`sea`** — decompress cli.js.bz instead of using build/ intermediate
- **`sea`** — auto-build CLI package when missing
- **`ci`** — build bootstrap package before socket and smol/sea builders
- **`socket`** — reference bootstrap files from packages/bootstrap
- **`e2e`** — check JS binary existence before running tests
- **`e2e`** — error and exit if binary doesn't exist when explicitly requested
- **`e2e`** — disable Node.js binary forwarding in .env.test
- **`cli`** — remove unnecessary force: true from safeDeleteSync calls
- **`bootstrap`** — export .config/node-version.mjs for workspace imports
- **`cli`** — auto-enable RUN_E2E_TESTS when running e2e.mjs
- **`socket`** — handle prefix-only modules in smol transform
- **`socket`** — correct internal module paths in smol transform
- **`ci`** — skip cache restore when force rebuild is requested
- **`node-smol-builder`** — use socket package bootstrap not local stub
- **`node-smol-builder`** — add placeholder bootstrap for socketsecurity patch
- **`sea-builder`** — add shell execution for postject on Windows
- **`sea-builder`** — use direct postject path instead of pnpm exec
- **`sea-builder`** — add postject as catalog devDependency
- **`ci`** — enable cross-OS cache sharing for Windows builds
- **`ci`** — pass --force flag to WASM build scripts when force rebuild requested
- **`ci`** — move Windows WASM cache check before build attempt
- **`ci`** — require WASM cache for Windows SEA builds
- **`ci`** — add wasm-opt to PATH for Windows Emscripten builds
- **`sea`** — strip leading '--' from pnpm arguments for correct parsing
- **`sea`** — enable cross-platform SEA builds using prebuilt Node binaries
- **`ci`** — limit SEA builds to native architectures only
- **`ci`** — correct SEA binary build for cross-platform compilation
- **`build`** — resolve SEA build failures across platforms
- **`packages`** — correct spawn result access in package build scripts
- **`build`** — correct spawn result access in build orchestration scripts
- **`wasm`** — correct spawn result property access in WASM build scripts
- **`scripts`** — resolve duplicate spawn import and incorrect result access
- **`ci`** — remove pip upgrade to improve Python dependency caching
- move .node-source to packages/node-smol-builder/build/
- **`onnx`** — output to dist/ directory instead of build/wasm/
- **`ci`** — save ONNX build cache even on failure
- **`onnx`** — fix second readCheckpoint usage in export stage
- **`onnx`** — use correct checkpoint function name
- **`build`** — enable WASM features in wasm-opt optimization
- **`onnx`** — locate WASM files in MinSizeRel subdirectory
- **`smol`** — use compressed binary in Final distribution directory
- **`build`** — use fs.statfs for reliable cross-platform disk space check
- **`ci`** — use requirements.txt for proper pip caching
- **`onnx`** — upgrade to v1.23.2 to resolve Eigen hash mismatch
- **`wasm`** — correct checkDiskSpace parameter units (GB not bytes)
- **`onnx`** — use build.sh script instead of direct CMake
- **`wasm`** — use explicit EMSDK paths for wasm-opt and wasm-strip
- **`onnx-runtime`** — remove existing source dir before clone and add debug logging
- **`wasm`** — use shell:true for wasm-opt/wasm-strip to inherit emsdk PATH
- **`socketbin-cli-ai`** — auto-clean stale checkpoints when artifacts missing
- **`onnx-runtime`** — auto-clean stale checkpoints and use existsSync
- **`yoga-layout`** — auto-clean stale checkpoints when artifacts missing
- **`yoga-layout`** — throw errors instead of warnings on missing artifacts
- **`ci`** — add debugging output for WASM build artifact verification
- **`build-infra`** — replace exec wrappers with direct spawn calls
- **`ai`** — add progress indicator for brotli compression
- **`build-infra`** — add exec wrapper to builder classes
- **`ci`** — fail builds when WASM artifacts are missing
- **`ai`** — define originalSize/quantSize before use
- **`ci`** — add cache artifact verification to WASM builds
- **`onnx`** — use proper spawn command/args pattern
- replace build-exec with spawn in remaining builder packages
- **`onnx`** — replace build-exec with spawn
- **`ci`** — replace shasum with sha256sum for Windows compatibility
- **`ci`** — use standard ubuntu-latest runners for WASM builds
- **`node-smol`** — use console.log instead of logger.log in binary smoke test
- **`cli-ai`** — make INT4 quantization optional with graceful fallback
- **`ci`** — correct INT4 quantization import and remove invalid autocrlf
- **`ci`** — remove push triggers from build-wasm to avoid runner contention
- **`cli-ai`** — correct import path for matmul_4bits_quantizer
- **`ci`** — require onnxruntime>=1.20.0 for INT4 quantization
- **`ci`** — use optimum[onnx] instead of optimum[exporters]
- **`build-infra`** — use result.code instead of result.status
- **`build-infra`** — import printSubstep for debug logging
- **`build-infra`** — use shell for Python detection on all platforms
- **`build-infra`** — try multiple Python command names in version check
- **`build-infra`** — handle undefined status in Python check
- **`build-infra`** — fix spawn calls to use proper command+args pattern
- **`build-infra`** — restore shell: WIN32 option in Python check
- **`build-infra`** — use direct python3 execution without shell
- **`build-infra`** — add detailed error logging to Python check
- **`ci`** — add Python verification step for debugging
- **`ci`** — setup Python for all platforms in smol build
- **`ci`** — add Python 3.11 setup for WASM builds in SEA job
- **`build-infra`** — remove duplicate imports in tool-installer
- **`node-smol-builder`** — replace build-exec with spawn wrappers
- **`ci`** — add WASM asset restoration to SEA build job
- **`ci`** — correct package names and cache key generation
- **`ci`** — ensure dist directories exist before verification
- **`ci`** — include node-smol-builder patches and additions in cache keys
- **`ci`** — update patches directory path from build/patches to patches
- **`ci`** — update actions/cache to v4.3.0
- **`ci`** — add workflow_call trigger to build-wasm workflow
- **`ci`** — add WASM asset preparation before CI tests
- **`cli`** — remove unused imports in optional-models.mts
- **`e2e`** — prompt for sea and smol binaries separately
- **`test`** — update tests for read-only ENV properties from @socketsecurity/lib
- **`test`** — skip Unix permission checks on Windows
- **`env`** — convert CI to boolean and fix type comparison
- **`e2e`** — correct property names and assertions in critical commands test
- **`tests`** — correct import paths in E2E dlx test
- **`test`** — correct e2e test exclusion pattern
- **`paths`** — replace path.sep with normalizePath across codebase
- use forward-slash patterns for normalized path matching
- normalize paths consistently across platforms
- **`shadow/npm`** — wrap path.join calls with normalizePath
- **`tests`** — resolve cross-platform npm and path issues
- **`cli`** — resolve TypeScript error in shadowNpmBase cwd handling
- **`cli`** — pass converted cwd to spawn in shadowNpmBase
- improve developer onboarding and fix broken commands
- **`cli`** — use platform-specific PATH separator in npm tests
- remove accidental gitlinks for yoga source directories
- **`cli`** — make path tests cross-platform compatible
- **`build`** — use fileURLToPath for cross-platform path comparison in esbuild
- **`ci`** — prevent diagnostic checks from stopping script execution
- **`gitignore`** — restore dist/ ignore and update build artifact documentation
- **`test`** — use tmpdir for patch discover test to avoid spawn failures
- **`ci`** — remove del-cli from test-setup-script
- **`ci`** — remove redundant pnpm install from test-setup-script
- **`ci`** — replace rm -rf with cross-platform del-cli command
- **`cli`** — normalize paths for Windows compatibility in completion and tildify
- **`cli`** — update NODE_VERSION to getNodeVersion()
- **`cli`** — skip update checks in test environments
- **`tests`** — update test imports and fix NpmConfig mock
- **`utils`** — update remaining ecosystem.mjs imports to types.mjs
- **`cli`** — update ONNX runtime extraction
- **`build-infra`** — improve Emscripten and build execution
- **`scripts`** — add missing colors import in verify-node-build
- **`deps`** — use socket-lib 1.3.5 with Windows Proxy fix
- **`tests`** — pass undefined env to avoid multiple process.env spreads
- **`tests`** — revert to working spawn pattern from commit 39ee9465
- **`tests`** — use Proxy in test mode to preserve Windows env behavior
- **`tests`** — use exact spawn env pattern from working commit 39ee9465
- **`tests`** — omit env option when no custom env vars provided
- **`tests`** — avoid spreading process.env in spawn calls
- **`tests`** — preserve process.env proxy for Windows
- **`ci`** — resolve dependency caching issue causing test failures
- **`cli`** — resolve TypeScript strict mode errors
- **`ci`** — use consistent pnpm --filter pattern in test setup
- **`ci`** — use pnpm --filter to run scripts in monorepo context
- **`ci`** — remove redundant cd commands in workflow scripts
- **`deps`** — correct @socketsecurity/lib references in workspace packages
- **`scan`** — add optional chaining for spinner safety
- **`patch`** — wrap logger output in outputKind checks for JSON/markdown
- **`patch`** — use optional chaining for spinner to handle null in tests
- **`tests`** — update CI handle test imports and debug API
- **`tests`** — update debug imports and skip path-resolve test
- **`tests`** — add missing stdout/stderr destructuring in optimize tests
- **`cli`** — disable interactive help menu in test environments
- **`tests`** — replace await import with vi.importMock in fetch-threat-feed tests
- **`tests`** — replace helper functions with direct mocks in fetch-list-repos and fetch-list-all-repos
- **`tests`** — replace await import with vi.importMock in remaining repository tests
- **`tests`** — use vi.importMock() consistently in fetch-update-repo tests
- **`tests`** — rewrite fetch-delete-repo tests to match actual implementation
- **`tests`** — use vi.importMock() consistently in fetch-create-repo tests
- **`dlx`** — skip cache entries with invalid metadata in listDlxCache
- **`tests`** — correct UNKNOWN_ERROR import in errors.test.mts
- **`tests`** — add missing await to async operations in optimize tests
- **`ci`** — clear Vitest cache before running tests
- **`test`** — correct mock setup for scan tests
- **`test`** — correct mock setup for repository output tests
- **`test`** — correct mock setup for output-security-policy tests
- **`test`** — correct mock setup for output-quota tests
- **`test`** — correct mock setup for output-license-policy tests
- **`test`** — correct mock setup for output-dependencies tests
- **`tests`** — correct import paths and logger references in organization tests
- **`tests`** — remove invalid await from destructuring in scan tests
- **`config`** — handle Buffer return from safeReadFileSync in findSocketYmlSync
- **`tests`** — update API requirements output test expectations
- **`tests`** — resolve shadow/links PATH and Windows test issues
- **`tests`** — correct socket/alerts mock paths
- **`tests`** — correct pnpm scanning test mocks
- **`tests`** — fix environment variable mocking in API tests
- **`tests`** — update API error message expectations
- **`tests`** — update CLI behavior expectations for interactive menu
- **`tests`** — correct org-slug test mocks and expectations
- **`tests`** — update socket.json test expectations
- **`test`** — resolve mock configuration issues in validation and helper tests
- **`tests`** — update SDK API mock expectations for v3.0.6
- **`cli`** — add ask, console, and patch commands to validation list
- **`tests`** — add missing color functions to yoctocolors-cjs mock
- **`tests`** — correct module import paths in shadow links and performance tests
- **`tests`** — correct module file name imports
- **`tests`** — correct remaining import paths in test files
- **`tests`** — remove getProcessEnv import that doesn't exist
- **`tests`** — correct module mock paths in test helpers
- **`tests`** — correct additional import paths in utils subdirectories
- **`tests`** — correct import paths and remove orphaned test files
- **`windows`** — add LOCALAPPDATA fallback for app data path
- **`test`** — resolve binCliPath undefined errors and CI shimmer test
- **`test`** — correct import paths in 76 command test files
- **`test`** — correct import path in constants.test.mts
- **`test`** — resolve SDK dynamic require error in vitest config
- **`build`** — use getLocalPackageAliases instead of hardcoded paths
- **`test`** — enable test isolation to prevent worker thread termination errors
- **`test`** — correct output-threat-feed mock path for serializeResultJson
- **`test`** — correct arborist-helpers mock path for idToNpmPurl
- **`test`** — correct handle-create-new-scan mocks and expectations
- **`tests`** — properly mock paths and dependencies in postinstall-wrapper tests
- **`tests`** — properly mock @socketsecurity/lib/debug in debug tests
- resolve socket-lib bundled external dependencies in esbuild
- add missing TypeScript base config at root
- remove @socketsecurity/lib link override for CI build compatibility
- update @socketbin/cli packages to available version 0.0.0
- replace fragile regex parsing with file-based JSON extraction in coana discovery
- resolve pre-existing unit test failures
- **`ci`** — remove coverage-script and coverage-report-script
- **`ci`** — update workflow SHAs to d8ff3b05
- update build scripts to use pnpm filter for monorepo
- link to local @socketsecurity/sdk for development Replace @socketsecurity/sdk version dependency with link to sibling socket-sdk-js directory. Remove SDK patch as types are now fixed at source. This enables development on SDK and CLI simultaneously and ensures we're testing against the latest SDK changes.
- patch @socketsecurity/sdk@2.0.1 to correct type definition paths The SDK package.json incorrectly references index.d.mts and testing.d.mts but the actual files are index.d.ts and testing.d.ts. This patch corrects the types field to point to the correct .d.ts files. Note: This fixes the "could not find declaration file" errors, but there are still type export issues with SDK v2.0.1 that need to be addressed. Socket CLI uses SocketSdkSuccessResult and other types that are not being properly exported from the SDK index despite being defined in types.d.ts.
- suppress lint warning for intentional control character regex Add biome-ignore comment to asciiUnsafeRegexp which intentionally matches control characters for test output cleanup. This is a false positive from the noControlCharactersInRegex rule.
- suppress lint warning for intentional control character regex Add biome-ignore comment to asciiUnsafeRegexp which intentionally matches control characters for test output cleanup. This is a false positive from the noControlCharactersInRegex rule.
- resolve merge conflict in provenance.yml workflow Remove merge conflict markers and use correct publish command that changes to dist directory before publishing @socketsecurity/cli-with-sentry. This ensures the package is published from the correct location.
- handle directory targets according to specification When a directory path is provided, it now recursively scans that directory for all files by appending /\*_/_ to the path pattern. This ensures directory targets work as expected in scanning operations. Also fixes a type annotation issue in getWorkspaceGlobs. Cherry-picked from PR #794 (commit 5f78dfdf) Original author: Martin Torp <martin@socket.dev> Co-Authored-By: Martin Torp <martin@socket.dev>
- disable Biome assist to prevent import organization conflicts
- update Biome and ESLint configs for bracket notation support Update linting configuration to support TypeScript bracket notation for index signature properties: - Disable Biome rules: useLiteralKeys, noParameterAssign, noNonNullAssertion, noExplicitAny, noAsyncPromiseExecutor, noAssignInExpressions, useIterableCallbackReturn, noBannedTypes - Disable ESLint rules: no-unexpected-multiline, sort-imports - Apply Biome formatting across codebase This aligns with socket-sdk-js and enables TypeScript TS4111 compliance.
- inject build metadata in esbuild config After migrating from Rollup to esbuild, build metadata values (INLINED_SOCKET_CLI_VERSION, etc.) were no longer being injected, causing the CLI version to display as "vundefined" in the header. Changes: - Added build-time injection of all metadata values via esbuild's define option (version, version hash, dependency versions, build flags) - Implemented proper version hash computation matching Rollup's logic: "${version}:${gitHash}:${randomUUID}${devSuffix}" - Fixed dependency version lookups to use devDependencies (coana, cdxgen, synp) - Renamed esbuild-inject-import-meta.js to .mjs for proper module resolution - Added default export to scripts/constants.mjs for compatibility - Fixed import order in esbuild.cli.config.mjs - Added biome-ignore comments for ANSI escape code patterns in demo The CLI header now correctly shows the version (e.g., "v1.1.25") and all build constants are properly inlined during bundling.
- improve ask command intent parsing and model loading Cache semantic model loading failures to avoid repeated error messages. Previously tried to load the model 6 times per query, now fails once and caches. Improve package name extraction to reject common command words like 'vulnerabilities', 'security', 'issues'. Only extracts valid package names like 'express', '@scope/package', etc. Fix esbuild import.meta.url injection by using ESM export syntax instead of CommonJS module.exports format.
- link to local socket-registry for development Update package.json to use local socket-registry for development to access latest exports and constants not yet published to npm. Add scripts/constants.mjs barrel file to re-export all constants modules. Fix lint issues: - Add eslint-disable for intentional process.exit() in SIGINT handler - Add eslint-disable for intentional await in loop for sequential URL checking
- patch https-proxy-agent to prevent Rollup template literal corruption Replace \r\n literals with hex codes (\x0d\x0a) to prevent Rollup from corrupting template literals during bundling process.
- skip processing of large base64-encoded WASM/model files Adds custom Rollup plugin to load external/ files raw without parsing. This fixes build hangs caused by Babel/CommonJS trying to parse 40MB+ base64-encoded strings in onnx-sync.mjs and minilm-sync.mjs. Changes: - Add skip-external-assets plugin to load() files raw - Exclude external/**from babel processing - Exclude external/** from commonjs processing
- suppress TypeScript errors for local registry imports Add ambient module declarations for @socketsecurity/registry subpaths. This suppresses TS2307 errors during development when using local builds. The Node.js loader resolves these imports correctly at runtime, and build tools use getLocalPackageAliases() for resolution. Update .gitignore to allow src/types/\*_/_.d.ts (ambient declarations).
- restore ink patch with proper git hashes Regenerate <ink@6.3.1.patch> using pnpm patch workflow to fix integrity check failures.
- ensure fix script forwards --all, --changed, and --staged flags to lint Updates scripts/fix.mjs to properly forward file filtering flags to the underlying lint command. This ensures consistent behavior across socket-cli, socket-packageurl, and socket-sdk-js repositories. - Add --all, --changed, and --staged options to parseArgs - Build lint command arguments conditionally based on flags - Forward flags to pnpm run lint --fix command - Update script documentation with new options
- resolve all ESLint errors and warnings - Fix undefined NODE_DIR by defining it properly in build-yao-pkg-node.mjs - Add eslint-disable comments for intentional unused variables in catch blocks - Add eslint-disable comments for intentional process.exit() calls in SEA wrapper - Add eslint-disable comments for intentional await-in-loop in retry/batch operations - Auto-fix all import ordering warnings across codebase - Ensure proper import grouping: builtin -> external -> internal -> local
- handle deleted files in lint and test scripts - Add existsSync checks to filter out deleted files before linting - Add existsSync checks in affected-test-mapper to skip deleted test files - Prevents 'No files matching pattern' errors when files are deleted This fixes an issue where git reports deleted files in changed/staged lists, but the files no longer exist on disk, causing lint and test runners to fail.
- improve Ctrl+O output display behavior When Ctrl+O is pressed to show output: - Remove "--- Showing output ---" header for cleaner display - Don't clear the buffer after dumping it - Keep output streaming live to stdout while visible - Allow toggling back to spinner mode This provides a smoother interactive experience where pressing Ctrl+O clears the spinner and shows all output, continuing to stream live until toggled back.
- prevent ENAMETOOLONG in path-resolve tests from circular symlinks The test was using mock-fs.load() to load the entire node_modules tree, which followed circular symlinks between @socketregistry/packageurl-js and @socketsecurity/registry infinitely, causing ENAMETOOLONG errors. Additionally, the registry's dist/external/streaming-iterables.js was not accessible in the mock filesystem because Node's require follows the symlink to the actual socket-registry/registry location. Solution: - Don't load the entire node_modules tree (avoids ENAMETOOLONG) - Load only the registry dist from its actual location since require follows symlinks to socket-registry/registry All 21 path-resolve tests now pass.
- correct SDK API calls and TypeScript types - Fix createOrgFullScan call: use options object with pathsRelativeTo and queryParams - Fix streamOrgFullScan call: use options object with output property - Fix purl-to-ghsa: only include affects when truthy to satisfy exactOptionalPropertyTypes - Fix purl types: replace non-existent PurlQualifiers with Record<string, string>
- correct yoctocolors mock in failMsgWithBadge test Move vi.mock() before imports and use plain functions instead of vi.fn() to properly mock the color functions. Remove spy assertion tests that are no longer applicable with plain function mocks.
- add worker termination error handler to test runner Add unhandledRejection handler to filter out non-fatal vitest worker thread cleanup errors. Prevents false negative test failures. Matches socket-sdk-js implementation for consistent behavior.
- use correct TypeScript check script name Change check:types to check:tsc to match the actual script name in package.json.
- use test.mjs script and suppress worker termination warnings - Update package.json test script to use test.mjs for --all flag support - Add --unhandled-rejections=warn to NODE_OPTIONS to suppress non-fatal unhandled rejection warnings from vitest worker thread cleanup This aligns socket-cli with the test infrastructure used in other socket-\* repos and prevents false test failures from worker cleanup.
- handle vitest worker termination errors gracefully Update test runner to capture output and detect worker termination errors. Override exit code to 0 when only worker termination errors occur without actual test failures. This prevents false negatives from known non-fatal vitest cleanup issues.
- suppress TypeScript spread type errors with ts-expect-error Add @ts-expect-error comments to suppress TS2698 errors on getOwn spread operations. While spreading undefined technically works at runtime in modern JavaScript, TypeScript's strict mode rejects it. Since the linter strips out nullish coalescing operators, we use ts-expect-error instead. Files updated: - src/commands/optimize/agent-installer.mts - src/shadow/npm/arborist-helpers.mts - src/shadow/npm/install.mts - src/utils/dlx.mts - src/utils/meow-with-subcommands.mts - src/utils/socket-package-alert.mts
- replace log.progress with log.step in build script - Use log.step() instead of log.progress() to avoid spinner interference - Remove manual line clearing code (no longer needed) - Replace log.failed() with log.error() for consistency - Prevents output interference with dividers and status updates
- resolve TypeScript TS2698 spread type errors with exactOptionalPropertyTypes Add nullish coalescing to getOwn() calls to ensure spread operations always receive objects when exactOptionalPropertyTypes is enabled.
- continue resolving TypeScript errors - Fixed EditablePackageJson import to use ReturnType pattern - Fixed Buffer/NonSharedBuffer .trim() issues in update-store.mts - Fixed ChildProcessType exit event parameter types - Fixed debug namespace calls (isDebugNs, debugFnNs) in error-display.mts Reduced errors from 255 to 251
- resolve TypeScript API migration errors - Convert 2-argument debug calls to namespace variants (debugFnNs) - Replace logger.debug with logger.log (API removed in registry) - Update pluralize calls to use { count } option object - Add missing LATEST and PACKAGE_LOCK_JSON exports - Import namespace debug functions in debug utilities Reduced TypeScript errors from 432 to 255
- update @socketbin workflow for trusted publisher - Remove automatic release trigger (manual dispatch only) - Remove all NODE_AUTH_TOKEN/NPM_TOKEN references - Use OIDC authentication via id-token permission instead - Simplify version determination (no release event handling) Trusted publisher uses GitHub OIDC tokens, no npm token needed.
- add file extension filtering to affected test mapper - Skip non-code files (images, docs, etc.) in test mapping - Prevents running all tests for non-code file changes - Improves test performance
- resolve ESLint and TypeScript linting issues Fix inline comment positioning (line-comment-position): - Move inline comments to separate lines above code - Affected: cache-strategies.mts and all test files Fix TypeScript index signature access: - Change dot notation to bracket notation for metadata properties - Affected: performance.test.mts Add ESLint disable comments: - Disable no-control-regex for ANSI color code tests - Affected: output-formatting-tables.test.mts All files now pass `pnpm run check` successfully.
- use Object.create(null) for ResultErrorOptions Replace **proto**: null in typed object literal with Object.create(null) Follows CLAUDE.md pattern for empty null-prototype objects
- **`ci`** — update socket-registry SHA to 5b2880d7
- **`ci`** — update socket-registry SHA to 662bbcab
- **`ci`** — update socket-registry SHA to b94a1086
- **`ci`** — update socket-registry SHA to dba06046
- **`ci`** — update socket-registry SHA to 0782233c
- **`ci`** — correct socket-registry SHA to full hash
- **`ci`** — update socket-registry SHA to 43a668e1
- **`ci`** — update socket-registry SHA to d1bbbbad
- **`ci`** — update socket-registry SHA to dc181fb5
- **`ci`** — update socket-registry SHA to 08fba31a
- **`ci`** — update socket-registry workflows to latest SHA (c61feb5e)
- **`ci`** — pin socket-registry workflows to SHA instead of @main
- improve organization capabilities detection for plan variants
- enterprise plan filter (#785) Signed-off-by: Ahmad Nassri <email@ahmadnassri.com> Co-authored-by: John-David Dalton <jdalton@users.noreply.github.com>
- handle pnpm frozen-lockfile in CI for optimize command In CI environments, pnpm automatically runs with --frozen-lockfile which prevents lockfile updates. When the optimize command tries to add overrides and update the lockfile, it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Added explicit --no-frozen-lockfile flag when running pnpm install in CI mode to allow the lockfile to be updated with Socket.dev overrides.
- Add fallback for npm exec path detection When constants.npmExecPath from the published registry doesn't exist or isn't executable, fall back to using whichBin to find npm. This fixes CI failures where the published version's npm-exec-path module might not correctly detect npm in certain environments.
- Add defensive check for whichBinSync return value The published version of @socketsecurity/registry may return a string when only one result is found even with all: true. This defensive check handles both cases to ensure compatibility with the current published version and future versions that properly return an array.

## 1.0.0 - 2026-07-09

### Added

- **`check`** — add external-tools-release-tags-resolve gate
- **`hooks`** — add claude-md-size-guard and no-revert-guard
- **`cli`** — add defineHandoffCommand factory for ecosystem hand-off wrappers
- **`optimize`** — write pnpm 11+ overrides to pnpm-workspace.yaml
- **`mcp`** — port socket-mcp standalone into `socket mcp` subcommand
- **`scan`** — add --exclude-paths flag for full Tier 1 exclusion (port of #1298) (#1306)
- **`scan`** — brotli-compress .socket.facts.json on upload (port of #1291) (#1305)
- add xport lock-step manifest tooling (#1284)
- bootstrap @socketsecurity/lib + @socketregistry/packageurl-js + @sinclair/typebox via firewall-checked registry fetch (#1282)
- **`claude`** — add public-surface-reminder + token-hygiene hooks (#1272)
- **`build`** — port scripts/build.mts to shared build-pipeline orchestrator (#1265)
- **`cli`** — machine-output mode — stream discipline, flag propagation, scrubber (#1234)
- **`organization`** — show quota usage, max, and refresh time (#1236)
- **`cli`** — rename --default-branch (scan create) to --make-default-branch; harden default-branch flags (#1230)
- backport v1.x features and DRY out HTTP layer
- **`ci`** — add updating skill and weekly-update workflow
- **`sea`** — bundle Python packages at build time for offline operation
- **`build`** — pre-install socketsecurity into bundled Python for SEA
- **`vfs`** — add opengrep, trivy, trufflehog, python to SEA VFS extraction
- **`security`** — add SHA-256 verification for PyPI package downloads
- **`security`** — add SHA-256 checksum verification for PyCLI (socketsecurity)
- **`build`** — add npm package integrity verification
- **`build`** — inline all external tool checksums at build time
- **`dlx`** — add SHA256 checksum verification for Python and socket-patch downloads
- **`tui`** — add advanced iocraft components and styling features
- **`tui`** — add comprehensive terminal UI property support
- **`iocraft`** — add binary download mechanism from socket-btm
- **`iocraft`** — add author field to platform packages
- **`publish`** — use 'pre' dist-tag for all pre-release packages
- **`iocraft`** — use 'pre' dist-tag for pre-release versions
- **`iocraft`** — add MIT LICENSE files to socketaddon packages
- **`iocraft`** — add @socketaddon/iocraft v3.0.0-pre.0 package infrastructure
- **`publish`** — make dry-run first option and default to true
- **`socket`** — add bootstrap loader for @socketbin/\* binaries
- **`scan`** — add --workspace flag to scan create command
- **BREAKING:** **`patch`** — migrate socket-patch to v2.0.0 Rust binary from GitHub releases
- **`socketbin`** — improve platform detection for binary packages
- add musl/Alpine Linux support for binary packages
- **`build-infra`** — add github-error-utils for transient error handling
- **`cli`** — use process.smol.mount() for full VFS directory extraction
- add dependency updates to quality-scan skill + update deps
- **`cli`** — add GH_TOKEN as fallback for GitHub authentication
- **`cli`** — add explicit sfw command for Socket Firewall
- **`cli`** — add explicit pycli command for Python CLI invocation
- **`python`** — unify Python CLI spawning with SEA and DLX support
- **`build`** — add npm package download utilities for VFS bundling
- **`skills`** — add validation and chain-of-thought to quality-scan
- **`scan`** — add socket-basics integration utilities
- **`claude`** — add quality-scan skill for comprehensive code analysis
- **`deps`** — add @socketbin packages to update script
- migrate patch command to @socketsecurity/socket-patch@1.2.0 (#1042)
- add E2E test sharding and misc fixes (#1022)
- add alpm and vscode ecosystems, add scan type constants
- set scanType to socket_tier1 when creating reachability full scans
- add --silence flag to `socket fix`
- add --reach-lazy-mode flag for reachability analysis
- **`telemetry`** — adding initial telemetry functionality to the cli
- **`ci`** — add force rebuild option to all workflow_dispatch workflows
- **`cli`** — standardize .version tracking across all extract scripts
- **`sea`** — improve build cache management and add local development mode
- **`config`** — use EditableJson for non-destructive config saving
- **`scan`** — add --reach-use-only-pregenerated-sboms flag
- **`fix`** — add --fix-version flag to override Coana CLI version
- **`fix`** — add --ecosystems flag and rename --limit to --pr-limit
- **`fix`** — add --all flag to process all vulnerabilities
- **`debug`** — add API request/response logging via SDK hooks
- **`cli`** — add --reach-debug flag to enable verbose logging in the reachability (Coana) CLI
- **`build`** — leverage socket-btm releases for pre-compiled assets
- **`scan`** — add reachability concurrency and analysis splitting flags
- **`pip`** — add socket pip3 command with auto-detection and context passing
- **`errors`** — improve 403 error messages with command-specific permission guidance
- **`dx`** — standardize check runner output formatting
- **`dx`** — add .nvmrc and minimal quick-start guide
- **BREAKING:** **`build`** — improve setup script flags and logging
- **`build`** — add dead code elimination plugin
- **`cli`** — optimize development workflow with caching and improved docs
- **`cli-with-sentry`** — add package structure and build configuration
- **`bootstrap`** — add SOCKET_CLI_LOCAL_PATH support for testing
- **`cli`** — add supporting files
- **`cli`** — add new commands
- **`sfw`** — add Socket Firewall package manager wrappers
- **`smol-builder`** — add granular checkpoint system and refactor logger
- **`bootstrap`** — add Brotli compression for all bootstrap variants
- **`smol`** — implement binary caching to avoid recompilation on post-processing failures
- **`dlx`** — implement unified manifest for packages and binaries
- **`git-hooks`** — make security checks mandatory, lint/test optional
- **`scripts`** — add file validation checks
- **`validate`** — add bundle dependencies validation
- **`validation`** — add guard against link: dependencies and remove from root
- **`preflight`** — add @cyclonedx/cdxgen to background downloads
- **`nlp`** — add progressive enhancement with ONNX Runtime stub
- **`ci`** — add quantization level option to WASM workflow
- **`models`** — add INT8 quantization option for AI model builds
- **`workflows`** — add toggleable checkboxes for all build workflows
- **`install`** — enhance installer with Socket branding and better UX
- re-enable ONNX Runtime and add INT4-quantized AI models
- **`build`** — add dependency-aware caching and binary build scripts
- **`node-smol-builder`** — implement VM-based bootstrap loader for async support
- enhance socket build script with spinners and structured logging
- add comprehensive build script for socket package
- add shimmer effect to bootstrap spinner
- add spinner to bootstrap loading with withSpinner
- **`build`** — add --platform and --arch flags for consistency
- **`build`** — add parallel builds and consolidate build system
- **`build`** — add intelligent caching to build system
- **`bootstrap`** — add IPC handshake support for subprocess detection
- **`spawn`** — implement system Node.js detection with which
- **`dlx`** — unify .dlx-metadata.json schema across TypeScript and C++
- **`ci`** — auto-update socketbin versions in provenance workflow
- **`cli`** — enhance error handling with network diagnostics and timeout errors
- **`bootstrap`** — build SEA bootstrap in build script
- **`bootstrap`** — add SEA bootstrap for minimal SEA binaries
- **`cli,cli-with-sentry`** — add LICENSE and CHANGELOG.md to packages
- **`build`** — copy logos and data to packages during build
- **`ci`** — add npm@latest for trusted publishing support
- **`cli`** — temporarily disable ONNX Runtime integration
- **`python`** — add Python CLI version tracking to build configuration
- **`publish`** — query npm registry for latest @socketbin/\* versions
- **`publish`** — use base version from package.json for datetime versioning
- **`cli`** — add custom ONNX Runtime build package following yoga pattern
- **`bootstrap`** — restore logger with lazy initialization support
- **`build`** — add comprehensive Unicode property transformations
- **`build`** — auto-generate socketbin spec for cache keys
- **`compress`** — add spec string embedding for socket-lib cache keys
- **`compress`** — implement self-extracting binary architecture
- **`debug`** — add detailed HTTP request logging for failed API calls
- **`bootstrap`** — add Unicode property escape transforms for --with-intl=none
- **`ci`** — use Alpine Docker container for smol musl builds
- **`ci`** — add Alpine (musl) platform support to SEA and smol builds
- **`fix`** — integrate provider pattern into PR operations
- **`git`** — implement GitLab provider with MR operations
- **`git`** — implement GitHub provider with PR operations
- **`git`** — add provider infrastructure for GitHub/GitLab support
- **`cli`** — add markdown utility functions for consistent output formatting
- **`cli`** — implement markdown output for fix and optimize commands
- **`fix`** — add comprehensive PR management and tracking
- **`socket-fix`** — add batch PR flag for future implementation
- **`socket-fix`** — add persistent GHSA tracking to avoid duplicate fixes
- **`socket-fix`** — add PR lifecycle logging and superseded PR detection
- **`sea`** — add network retry, integrity checks, and freshness validation
- **`cli`** — add SHA256 checksum generation for build integrity
- **`build`** — add network retry utility with exponential backoff
- **`build`** — auto-build bootstrap package when missing
- **`bootstrap`** — add system node detection and forwarding control
- **`bootstrap`** — add system node detection and forwarding control
- **`bootstrap`** — create shared bootstrap package for npm and smol builds
- **`socket`** — add comprehensive builtin module mapping for smol
- **`socket`** — add dual bootstrap build for SEA and smol
- **`ci`** — build socket package bootstrap before SEA and smol builds
- **`ci`** — add stripped binary cache checkpoint for smol builds
- **`build-infra`** — add preflight-checks runner for DRY build validation
- **`build-infra`** — add script-runner utilities for DRY monorepo operations
- **`builders`** — add platform/arch arguments and use socket-lib parseArgs
- **`socket`** — add esbuild-based bootstrap implementation
- **`self-update`** — improve package manager detection and error messages
- add install.sh for Socket CLI installation
- **`ci`** — unify caching strategy across all build workflows
- **`ci`** — cache ONNX Runtime intermediate build artifacts
- **`ci`** — add GitHub Actions grouping to WASM and SEA workflows
- **`ci`** — add Ninja installation for smol builds
- **`node-smol`** — add GitHub Actions grouping for verbose build steps
- **`ci`** — add concurrency control to build workflows
- **`sbom-generator`** — add TypeScript SBOM generator package
- **`ci`** — reuse cached binaries from build-socketbin.yml
- **`ci`** — add cache restoration and fallback WASM builds
- **`ci`** — add @socketbin build workflow with caching
- **`ci`** — add WASM build workflow with caching
- add WIN32 shell support and update build infrastructure
- **`node-sea-builder`** — add hash-based caching for SEA binaries
- **`node-smol-builder`** — add hash-based caching for build artifacts
- **`cli-ai`** — throttle model update checks to once per 24 hours
- **`cli`** — add hash-based caching to extraction scripts
- **`build-infra`** — add extraction-cache utility for hash-based caching
- **`socketbin-cli-ai`** — add model update notifier with user prompt
- **`socketbin-cli-ai`** — add checkpoint-based incremental builds
- **`socketbin-cli-ai`** — add complete build system with INT4 quantization
- **`socketbin`** — add @socketbin/cli-ai package with compression strategy
- **`e2e`** — add interactive prompts and cache support for smol/sea binaries
- **`smol`** — make binary compression default with opt-out
- **`build-infra`** — add automated tool installer for cross-platform builds
- **`monorepo`** — add pnpm workspace catalog for Socket dependencies
- **`node-smol-builder`** — implement patch analysis with build-infra helpers
- **`build-infra`** — add patch analysis and conflict detection
- **`build-infra`** — add build logging and checkpoint helpers
- **`e2e`** — add auto-build support for binary E2E tests
- **`e2e`** — add npm scripts for testing different binary types
- **`e2e`** — add comprehensive binary test suite for JS, smol, and SEA
- **`e2e`** — add environment files for comprehensive E2E testing
- **`build`** — add automated build tools installation
- **`env`** — add RUN_E2E_TESTS environment variable
- **`dlx`** — add testable binary resolution pattern
- **`env`** — add system and LOCAL_PATH env modules with live VITEST mode
- **`os`** — add platform detection utilities for socketbin packages
- **`registry`** — add npm registry utilities for package downloads
- **`build`** — complete WASM package build scripts
- **`build-infra`** — add build environment and Rust builder modules
- **`tests`** — add case-insensitive env Proxy for Windows compatibility
- **`scripts`** — add monorepo-aware update, type, and test scripts
- **`scripts`** — add monorepo-aware lint, fix, and check scripts
- **`scripts`** — add monorepo utility helpers
- **`build`** — add platform-specific binary size optimization
- **`security`** — prevent SIGUSR1 debugger signal handling
- **`patch`** — add default subcommand handler
- **`constants`** — add barrel file and fix test imports
- **`patch`** — enable patch command and fix tests
- **`config`** — add shared configuration architecture for monorepo
- add Intl polyfill stub modules for CLI
- auto-strip AI attribution from commit messages
- add JS-only fallback release workflow for socket CLI
- register console and ask commands
- add interactive console command with Ink-based TUI
- add ASCII header banner utility with CI/VITEST plain text support
- implement SDK v3 file validation callback
- complete monorepo enhancements with all optional improvements
- add cli-sentry target for future @socketsecurity/cli-with-sentry package
- add all platform targets to build command
- add JSON and Markdown output support for manifest commands
- enhance workflows with monorepo support and configurable options
- add pre-publish validation to publishing workflows Add comprehensive validation to all three publishing workflows to prevent publishing broken packages. Created validation script that checks: - Package.json required fields and validity - Dist directory structure and files - Binary files and permissions - Data files presence - Production dependencies (no devDependencies) - Git status and tags - CLI bundle size sanity checks Workflow changes: - provenance.yml: Added validation after each of 3 package builds - publish-socketbin.yml: Added validation before main package publish - release-sea.yml: Added binary validation before GitHub release upload This prevents broken packages from reaching npm and users.
- add version consistency check script Create check-version-consistency.mjs to validate version numbers across package.json files before publishing. This ensures all packages are published with consistent versions. The script: - Checks main package.json version matches expected version - Optionally checks SEA npm package version (with warnings) - Exits with code 1 if critical version mismatches found - Provides clear colored output for CI workflows Referenced by .github/workflows/publish-socketbin.yml
- add ask mode demo and silence semantic model messages Add demo-ask-mode.mjs script that showcases natural language query translation across 6 categories with ~20 example queries. Remove semantic model loading messages since the model is optional and pattern matching works perfectly without it. The messages were noisy and gave the impression something was broken when it's actually working as intended.
- add esbuild configuration for CLI build Add esbuild configuration to replace Rollup bundler: - esbuild.cli.config.mjs: main configuration with plugins for package resolution - esbuild.cli.build.mjs: build script wrapper - esbuild-inject-import-meta.js: import.meta.url polyfill for CommonJS output This addresses template literal corruption issues in large bundles (>9MB) that occurred with Rollup. esbuild handles template literals correctly and produces faster builds without corruption.
- add module registration for --import flag Replace deprecated --loader with modern --import + register() API for Node.js 18+
- integrate MiniLM inference into socket ask command Updates handle-ask to use custom MiniLMInference engine instead of transformers.js. Implements hybrid semantic matching with three-tier progressive enhancement: pattern matching → word overlap → ONNX. Changes: - Replace transformers.js with MiniLMInference - Update cosineSimilarity to work with Float32Array - Use embedded ONNX from external/onnx-sync.mjs - Graceful degradation when ONNX unavailable
- add MiniLM model download and embedding scripts Scripts to download MiniLM model assets and embed them as base64 JavaScript for bundling. Follows yoga-layout WASM embedding pattern. - download-minilm.mjs: Downloads tokenizer and quantized ONNX model - embed-minilm.mjs: Embeds model as base64 in external/minilm-sync.mjs
- add MiniLM inference engine for semantic matching Implements direct ONNX Runtime integration with MiniLM model for semantic text understanding. Provides WordPiece tokenization, ONNX inference, mean pooling, and cosine similarity computation. Key features: - Direct ONNX Runtime with embedded WASM (no transformers.js wrapper) - Custom WordPiece tokenizer (pure JavaScript, 1-2ms per query) - 384-dimensional embeddings with mean pooling - Cosine similarity for semantic matching - SEA-compatible architecture with base64 WASM embedding
- add WordPiece tokenizer for ML model integration Implements pure JavaScript WordPiece tokenization for BERT/MiniLM models: WHAT IT IS: - Subword tokenization used by transformer models - Converts text → token IDs for ONNX Runtime - Zero ML dependencies, pure JavaScript HOW IT WORKS: 1. Basic tokenization (whitespace + punctuation splitting) 2. Greedy longest-match from vocabulary 3. Add special tokens ([CLS], [SEP], [UNK]) 4. Convert tokens to numeric IDs 5. Generate attention masks PERFORMANCE: - ~500KB vocab file (loaded once, cached) - ~1-2ms per query tokenization - Zero runtime ML overhead EXAMPLE: Input: "fixing vulnerabilities" Tokens: ["[CLS]", "fix", "##ing", "vulnerability", "##ies", "[SEP]"] IDs: [101, 8081, 2075, 23829, 2497, 102] FILES: - src/utils/wordpiece-tokenizer.mts - Core tokenizer implementation - src/utils/wordpiece-tokenizer.test.mts - Comprehensive test suite DOCUMENTATION: - Extensive inline comments explaining each step - Real-world examples from socket ask use cases - Links to original WordPiece and BERT papers
- add hybrid semantic matching for socket ask command Implements progressive enhancement for natural language understanding: Fast Path (instant): - Pattern matching with keyword detection - Compromise NLP for verb/noun normalization - Word-overlap matching with synonym expansion (~3KB semantic index) - Handles 80-90% of queries with zero ML overhead Fallback (50-80ms, high accuracy): - ONNX Runtime with MiniLM embeddings (planned) - Deep semantic understanding for ambiguous queries - Only loads when needed for remaining 10-20% edge cases Infrastructure: - scripts/llm/ directory for semantic tooling - scripts/extract-\*-wasm.mjs for WASM bundling - Claude skills in ~/.claude/skills/socket-cli/ for IDE integration - Generic wasm-loader.mjs utility Architecture follows yoga-layout pattern for WASM embedding: - Base64 encode WASM at build time - Synchronous instantiation for SEA compatibility - Full control over loading and initialization
- enhance socket ask with compromise NLP library Add compromise for text normalization to handle: - Verb tenses: 'fixing' -> 'fix', 'scanned' -> 'scan' - Plurals: 'vulnerabilities' -> 'vulnerability' - Natural phrasing: 'Can you scan...' -> 'scan' Improves pattern matching accuracy by ~10-15% while maintaining fast response times (<100ms). Falls back gracefully if NLP fails. Size impact: +3MB (acceptable for dev tool)
- implement socket ask command with natural language processing - Add cmd-ask.mts with --execute and --explain flags - Add handle-ask.mts with pattern matching engine - Priority-based matching (fix/patch/optimize > scan/package > issues) - Extracts severity, environment, package names, dry-run mode - Confidence scoring for intent matching - Add output-ask.mts with rich formatted output - Color-coded query interpretation - Command preview with syntax highlighting - Detailed explanations of what commands do - Project context display (dependency counts) - Register command in src/commands.mts - Fix yoga-layout patch to remove restrictive exports Pattern matching maps natural language to Socket CLI commands: - 'fix critical issues' → socket fix --severity=critical - 'apply patches' → socket patch - 'optimize dependencies' → socket optimize - 'is express safe' → socket package score express - 'scan for vulnerabilities' → socket scan create
- enhance patch command functionality Add new patch discover, download, and status subcommands with improved UX
- register rm and cleanup subcommands in patch command Added cmdPatchRm and cmdPatchCleanup to the patch command's subcommand registry. This enables users to run socket patch rm and socket patch cleanup commands. All subcommands are now registered: - apply: Apply patches with backup creation - cleanup: Clean up orphaned backups - get: Download patch files - info: Show patch details - list: List all patches - rm: Remove patch and restore backups
- integrate backup system with patch apply Integrated Phase 1.1 backup system into patch apply command. Before applying any patch, createBackup() is called to store the original file contents. This enables safe rollback via socket patch rm. Changes: - Import createBackup from backup utilities - Add patchUuid parameter to processFilePatch - Create backup before copying patched file - Log backup creation and continue on backup failure - Pass patch UUID from manifest to backup system This completes the backup integration loop: - apply: creates backups - rm: restores backups - cleanup: removes orphaned backups
- add patch cleanup subcommand for backup management Implemented socket patch cleanup to manage orphaned patch backups. Supports three modes: - No args: Clean up orphaned backups (not in manifest) - UUID: Clean up specific patch backups - --all: Clean up all patch backups Uses Phase 1.1 backup system APIs: - listAllPatches() to find all backup UUIDs - cleanupBackups() to remove backup data Includes 7 comprehensive tests covering help, missing directory, cleanup modes, and all output formats.
- add patch rm subcommand with backup restoration Implemented socket patch rm `<PURL>` to remove applied patches and restore original files from backups. Uses the Phase 1.1 backup system to restore files and clean up backups. Supports --keep-backups flag to preserve backup files after removal. Integrates with: - restoreAllBackups() to restore original files - cleanupBackups() to remove backup data - removePatch() to update manifest Includes 8 comprehensive tests covering help, missing PURL, patch not found, removal without backups, and all output formats.
- add patch get subcommand Implemented socket patch get `<PURL>` to download patch files from the .socket/blobs directory to a local directory for inspection. Files are copied with their directory structure preserved. Supports custom output directory via --output flag. Supports JSON and markdown output formats. Ready for tests to be added in next commit.
- add patch info subcommand Implemented socket patch info `<PURL>` to show detailed information about a specific patch. Displays all vulnerability details (GHSA IDs, CVEs, severity, descriptions), file changes with before/after hashes, and patch metadata (UUID, description, tier, license). Supports JSON and markdown output formats. Includes comprehensive tests covering help, missing PURL, patch not found, and all output formats.
- add patch list subcommand Implemented socket patch list to display all patches from the manifest. Shows PURL, UUID, description, exported date, file count, vulnerability count, tier, and license for each patch. Supports JSON and markdown output formats. Includes comprehensive tests covering help, error cases, and all output formats.
- add handle test helper infrastructure Add setupStandardHandleMocks helper for handle function tests: - Automatic function name derivation from module paths - Module-level mock setup for vi.mock hoisting - Clear pattern for testing fetch + output orchestration - Comprehensive JSDoc with usage examples
- use unified runner for all test stages with Ctrl+O support - Use unified-runner for checks, build, and tests (not just tests) - Display "Press Ctrl+O to show/hide output" hint at start - Eliminates spinner artifacts in logs - Provides consistent Ctrl+O toggle experience throughout - Cleaner output with no leaked spinner frames
- improve test script output consistency and masking - Replace createSectionHeader with printHeader for consistent formatting - Mask build output with spinner instead of showing verbose logs - Only show build output on failure - Aligns socket-cli test runner with socket-registry style
- add unified runner with Ctrl+O toggle for test output - Added unified-runner.mjs for consistent interactive output control - Updated test.mjs to use unified runner for TTY sessions - Added test setup file to suppress debug output - Configured vitest to use setup file - Provides consistent Ctrl+O toggle behavior across socket-\* repos
- add IPC validation module for inter-process communication - Add runtime validation for IPC messages - Implement type guards for IPC handshakes and stubs - Add helper functions for creating and parsing IPC messages - Ensure type safety for socket-cli inter-process communication
- add bordered input and lazy ink utilities - Add bordered-input.mts for styled terminal input - Add lazy-ink.mts for lazy loading ink components
- add interactive help system for better UX - Replace verbose --help output with interactive category selection - Support --help=category for direct category access - Categories: scan, fix, pm, pkg, org, config, ask, all, quick - Shows 'What can I help you with?' prompt with numbered options - Non-interactive terminals show category list with instructions - Maintains backward compatibility with --help-full for full output Examples: - socket --help # Interactive category selection - socket --help=scan # Show scan commands directly - socket --help=quick # Show quick start guide - socket --help-full # Show original full help
- add project context awareness and rich progress utilities - Add project context detection for package managers and frameworks - Add rich progress indicators for better UX during long operations - Create foundation for Claude CLI-like enhancements - Support for multi-progress bars, spinners, and file progress - Auto-detect npm/yarn/pnpm and provide contextual suggestions
- add trusted publisher verification script - Check if all @socketbin packages exist on npm - Verify provenance attestations if present - Check GitHub workflow configuration - Verify NPM_TOKEN secret (if accessible) - Provide clear status and next steps Run with: node scripts/verify-trusted-publisher.mjs
- add placeholder packages for @socketbin namespace - Create placeholder packages at v0.0.0 for all 6 platforms - Add script to generate placeholder packages - Add script to publish all placeholders at once - Add verification script to check packages on npm registry These placeholders are needed to enable trusted publisher configuration. Real binaries will be published at v1.x after trusted publisher is set up.
- implement @socketbin binary distribution system - Add package generator script for creating @socketbin/\* packages - Create dispatcher script that selects correct platform binary - Add GitHub Actions workflow for building and publishing with provenance - Update socket package to use optionalDependencies instead of postinstall - Remove install.js in favor of npm's built-in optional dependency handling This new approach eliminates postinstall failures and simplifies distribution
- add catastrophic delete protection to bootstrap remove() - Add inline remove() function with safety checks similar to del package - Prevent deleting cwd or directories outside SOCKET_HOME - Replace all fs.unlink() calls with safe remove() - Protects against accidental system-wide deletions - Can be overridden with force option if needed
- add affected test runner for faster test execution Implements intelligent test selection based on git changes to speed up local development and precommit hooks. Maps source files to their corresponding test files, running only affected tests when possible. Key features: - Detects changed/staged files using git utilities - Maps commands to co-located test files - Maps utils to test files in src/utils/ and test/unit/utils/ - Core files (cli, constants, types) trigger all tests - Supports --staged, --all, --force, and --coverage flags - Builds project automatically if needed
- add experimental bootstrap loader for stub distribution Simple Node.js loader that checks for ~/.socket/\_socket and delegates. Foundation for future bootstrap architecture improvements. Not yet integrated with build system.
- add build dependency checker and stub bundle verification - check-build-deps: Verifies build tools, offers UPX installation - verify-stub-bundle: Ensures bootstrap contains only Node builtins - Both support cross-platform (macOS, Linux, Windows)
- add bootstrap stub update capability to self-update command - Add checkAndUpdateStub() to update bootstrap stub during self-update - Check for stub updates even when CLI is up to date - Use stub path from IPC handshake to locate stub binary - Create backups and handle rollback for stub updates - Update both CLI and stub binaries in single self-update operation
- add centralized Ink and React imports wrapper Create src/utils/ink.mts to centralize Ink, React, and InkTable imports with proper tsgo workarounds. Add src/external/ink-table wrapper for proper ESM/CommonJS interop. This eliminates the need for @ts-ignore comments in every TSX file.
- add comprehensive memoization utilities Added full-featured memoization system for caching function results and optimizing expensive computations. Memoization Features: - memoize() for sync functions with configurable caching - memoizeAsync() for async functions with promise deduplication - memoizeWeak() using WeakMap for garbage-collectable object keys - once() for single-execution functions - memoizeDebounced() combining memoization with debouncing - LRU cache eviction when maxSize exceeded - TTL expiration for time-limited caching - Custom key generators for flexible cache keys - @Memoize decorator for class methods Cache Management: - Configurable max cache size with LRU eviction - TTL-based expiration - Access count tracking - Cache hit/miss debugging (DEBUG=cache) - Failed promise cleanup (errors not cached) - Concurrent call deduplication for async functions Test Coverage: - 20 tests covering all functionality (all passing) - Basic memoization with various argument types - Custom key generators - LRU eviction - TTL expiration - Async function handling - Concurrent call deduplication - Error handling - WeakMap garbage collection - once() single execution Usage Examples: - Simple: const fn = memoize((x) => x \* 2) - With options: memoize(fn, { maxSize: 100, ttl: 60000 }) - Async: const fn = memoizeAsync(async (id) => await fetchData(id)) - Once: const init = once(() => loadConfig()) - Weak: const fn = memoizeWeak((obj) => transform(obj)) Technical Details: - Zero overhead when DEBUG!=cache - Proper TypeScript generics - LRU access order tracking - High-resolution timestamps - Promise caching prevents duplicate API calls - WeakMap enables garbage collection
- add comprehensive performance monitoring utilities Added full-featured performance monitoring system for identifying bottlenecks and optimizing CLI execution. Performance Monitoring Features: - perfTimer() for timing operations with metadata - measure() and measureSync() for function execution timing - perfCheckpoint() for tracking progress through complex operations - trackMemory() for heap usage monitoring - Performance metrics collection (operation, duration, timestamp, metadata) - getPerformanceSummary() with count, avg, min, max, total statistics - generatePerformanceReport() for formatted output - Automatic cleanup and metric aggregation Integration: - Integrates with DEBUG=perf environment variable - No-op when perf tracking disabled (zero overhead) - Compatible with existing debug logging system - Works with debugFn for console output Test Coverage: - 21 tests covering all functionality (all passing) - Timer operations with metadata - Async and sync function measurement - Error handling and metadata tracking - Summary statistics calculation - Checkpoint and memory tracking - Report generation Usage Examples: - Simple timing: const stop = perfTimer('op'); stop() - Function measurement: const { result, duration } = await measure('op', fn) - Checkpoints: perfCheckpoint('phase-1', { count: 100 }) - Memory tracking: const mem = trackMemory('before-operation') - Summary: printPerformanceSummary() Technical Details: - Uses performance.now() for high-resolution timing - Rounds durations to 2 decimal places - Groups metrics by operation name - Exports all metrics for external analysis - Type-safe with PerformanceMetrics interface
- add intelligent caching strategies and comprehensive tests Added smart caching strategies and comprehensive test coverage for new features. Intelligent Caching Strategies: - Endpoint-specific TTL based on data volatility - Package info: 15min (stable), Issues: 5min (volatile), Scans: 2min (very volatile) - Org settings: 30min, User info: 1hr (most stable) - getCacheStrategy() for automatic TTL selection - shouldWarmCache() for critical data preloading - calculateAdaptiveTtl() for frequency-based TTL adjustment - Cache warming support for faster initial responses Test Coverage: - 23 tests for cache strategies (all passing) - Strategy selection for different endpoint patterns - TTL recommendations based on data characteristics - Cache warming decisions - Volatility detection - Adaptive TTL calculations - 14 tests for table formatting (all passing) - Bordered table rendering with box-drawing characters - Simple table rendering without borders - Column alignment (left, right, center) - Color function application - Width calculation with ANSI codes - Missing value handling - Dynamic vs fixed column widths Technical Details: - Pattern matching with glob-style wildcards - Debug logging integration for cache operations - Minimum TTL enforcement (30s) for adaptive caching - Maximum 50% reduction for frequently accessed data
- Enhanced error handling with recovery suggestions Add comprehensive error types with actionable recovery information: - AuthError: Authentication failures with login instructions - NetworkError: Connection issues with retry guidance - RateLimitError: API quota exceeded with wait times and upgrade suggestions - FileSystemError: File operations with code-specific recovery (ENOENT, EACCES, ENOSPC) - ConfigError: Configuration issues with setup instructions Improvements: - Each error type includes contextual recovery suggestions - Recovery suggestions displayed in terminal output with visual hierarchy - JSON output includes recovery array for programmatic consumption - Error display enhanced with cyan 'Suggested actions' section - 41 comprehensive tests covering all error types and recovery utilities Benefits: - Users get immediate, actionable guidance when errors occur - Reduces support burden with self-service recovery steps - Better UX with helpful suggestions vs generic error messages - Consistent error handling patterns across the codebase
- Add command registry infrastructure Add complete command registry system with: - Type-safe command definitions with flags, validation, and hooks - CommandRegistry class for registration and execution - Koa-style middleware composition - Flag parsing (string, boolean, number, array types) - Required flag validation and custom validators - Automatic help text generation - Before/after hooks for command lifecycle - Plugin system for extensibility - 17 comprehensive tests (all passing) Benefits: - Declarative command definitions vs imperative code - Type-safe with full TypeScript support - Self-documenting via auto-generated help - Middleware for cross-cutting concerns - Testable and composable Architecture ready for migration but not yet integrated into CLI entry point. Existing meow-based system continues to work unchanged.
- add comprehensive test utilities Add mock-helpers.mts with SDK/API mocking utilities Add environment.mts with test setup and cleanup helpers Add fixtures.mts with standard test data configurations Add constants.mts with common test values Add index.mts for convenient re-exports
- add core utilities for types, messages, result handling, and logging Add BaseFetchOptions type for consistent SDK options Add centralized error message templates in messages.mts Add result validation utilities with requireOk, map, chain functions Add command-scoped logger with context for better debugging

### Changed

- **`cli`** — use direct env reads for HOME in 5 commands
- **`ci`** — complete dependency caching for all test jobs
- **`ci`** — add dependency caching to GitHub Actions
- **`publish`** — optimize CLI build and consolidate platform definitions
- **`sea`** — parallelize binary injection for 8x faster builds
- **`cli`** — add Node.js memory allocation flags for large builds
- **`scripts`** — optimize build process
- **`cli`** — defer registryUrl lookup until needed
- **`smol`** — use vm.compileFunction() and remove internal path remapping
- **`ci`** — implement critical workflow optimizations
- **`ci`** — add Emscripten SDK and pip caching to build-sea workflow
- **`ci`** — add Emscripten SDK and pip package caching to WASM workflow
- optimize CI and test performance
- remove lazy-loading of bun lockfile parser
- **`ci`** — add caching to build-deps jobs
- **`ci`** — increase max parallel builds to 6 for SEA and smol workflows
- **`ci`** — add pip cache for Python dependencies in AI models build
- **`ci`** — optimize runner allocation and switch to Ninja
- **`ci`** — optimize binary builds with ccache and faster runners
- **`wasm`** — switch to single-threaded ONNX Runtime variant
- **`test`** — maximize thread pool based on CPU count
- **`build,test,ci,docs`** — apply socket-sdk-js optimizations across all phases

### Fixed

- **`build`** — repair createHash import and drop unpublished lib-stable external/semver subpath
- **`build`** — restore pipeline modules and exports the dead-code sweep removed while still imported
- **`build`** — restore build-pipeline.mts — scripts/build.mts still imports runPipelineCli
- **`ci`** — refresh external-tools pins to fleet data format
- **`config`** — repo.type is mono, not monorepo
- **`deps`** — bump vulnerable packages to soaked patched versions
- **`sea`** — repoint build-sea/test-sea imports at sea-build-utils dir
- **`deps`** — pin rolldown to soaked 1.0.3, matching the fleet baseline
- **`lint`** — migrate socket-hook markers to socket-lint prefix
- **`scripts`** — delegate all test scopes to per-package in no-config workspaces
- **`deps`** — migrate source to lib-stable 6.0.7 API
- **`scripts`** — make fleet test runner monorepo-safe and drop pnpm exec
- **`scripts`** — import logger in sync-checksums so log calls don't ReferenceError
- **`hooks`** — repoint commit-msg husky shim to .git-hooks/fleet/
- **`hooks`** — repoint husky shims to .git-hooks/fleet/ after segmentation
- **`debug,git`** — redact GitHub token in debug log; use debugNs for level namespaces
- **`mcp`** — bind unauthenticated HTTP transport to loopback + cap POST body
- **`scripts,format`** — repair migration-orphan imports/paths + format-script scope
- **`deps`** — bump vitest to 4.1.6 to clear GHSA-5xrq-8626-4rwp
- **`hooks`** — declare shell-quote dep so \_shared parser resolves
- **`tsconfig`** — point extends at .config/fleet/tsconfig.base.json
- **`build`** — migrate remaining external-tools.json tools to platforms schema
- **`build`** — migrate pnpm external-tools entry to platforms schema
- **`lint`** — revert colocate work in packages/cli/src — fleet rule requires export
- **`rich-progress`** — restore inadvertently-deleted file + v6 leaf import
- **`rich-progress`** — inline socket-hook marker so logger-guard sees it on the right line
- **`build`** — give each downloaded asset its own subdir to avoid .version race
- **`mcp/transport-http`** — drop `| undefined` from McpHandleRequest's auth field
- **`lint`** — convert file-scope oxlint disables + clear other violations
- **`packageManager`** — bump pnpm@11.0.8 → pnpm@11.1.2
- stop oxfmt from reformatting wheelhouse-schema.json
- **`scripts/check-prompt-less-setup`** — drop never-used writeFileSync + isLinux
- **`deps`** — restore -stable catalog aliases for self-named fleet packages
- **`lint`** — clean lint debt in packages/cli/scripts + src
- **`types`** — restore explicit-undefined on AuthenticatedRequest.auth
- **`types`** — resolve 4 tsgo errors in cli
- **`vitest`** — drop orphan base config + fix stale isolate comment
- **`scripts`** — restore spawnSync import in bootstrap-firewall-deps
- **`deps`** — bump hono to 4.12.18, fast-uri to 3.1.2 for CVE patches
- **`lint`** — dlx test polish — import-type, max-file-lines, sort
- **`types`** — resolve noUncheckedIndexedAccess + noUncheckedSideEffectImports
- **`lint`** — generate-report.test — max-file-lines legitimate bypass
- **`lint`** — cmd-manifest-cdxgen — exported helpers + cached for-loop
- **`lint`** — telemetry — prefer-function-declaration + cached-for-loop
- **`lint`** — mark Set-iteration for-of as intentional in 3 sites
- **`hook`** — mark progress-bar stderr writes as intentional
- **`lint`** — clear remaining socket/\* rule violations in cli package
- **`lint`** — scripts and package-builder
- **`lint`** — cache array.length in build-infra for-loops
- **`sync`** — cascade prefer-cached-for-loop let/const preservation patch
- **`lint`** — sort-source-methods - reorder 20 src files + oxfmt drift
- **`tests`** — restore vi.mock named exports for node:fs / node:os after import refactor
- **`lint`** — autofix sort-source-methods (13 files) + cascade canonical script fixes
- **`lint`** — close out non-blocked socket-cli rules
- **`types`** — no-explicit-any — final 29 src files (1-site fixes, brings count to 0)
- **`types`** — no-explicit-any — 11 src files, mostly 2-3 sites each
- **`types`** — no-explicit-any — 7 src files (pull-request, update-manifest, scan-from-github, lockfile-readers, errors, package-alert, shallow-score)
- **`types`** — no-explicit-any — second-pass test files for return / tuple positions
- **`types`** — no-explicit-any — top 6 src files (logger, api-wrapper, builder, meow, api, simple-output)
- **`types`** — consistent-type-imports — hoist 30 inline import() annotations across 19 test files
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 3/3)
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 2/3)
- **`types`** — no-explicit-any — replace any with unknown in test files (batch 1/3)
- **`imports`** — node-builtin — inline-disable 6 test files using fs as value
- **`types`** — consistent-type-imports — hoist 29 inline import() annotations across 15 test files
- **`types`** — consistent-type-imports — hoist 29 inline import() annotations across 15 test files
- **`types`** — consistent-type-imports — hoist 16 inline import() annotations across 10 test files
- **`types`** — iocraft — add namespace import for ComponentNode type cast
- **`imports`** — node-builtin — remove dead fs imports in 5 test files
- **`types`** — consistent-type-imports — hoist 12 inline import() annotations across 5 test files
- **`imports`** — node-builtin — 7 files converted to named imports
- **`types`** — consistent-type-imports — hoist inline import() in sdk-test-helpers.mts
- **`regex`** — sort-regex-alternations — 8 rewrites + 1 order-significant disable
- **`types`** — consistent-type-imports — hoist inline import() in iocraft.mts
- **`types`** — consistent-type-imports — hoist inline import() in spawn-node.mts
- **`types`** — consistent-type-imports — hoist inline import() in types.mts
- **`imports`** — node-builtin — 5 files converted to named imports
- **`imports`** — node-builtin — 6 files converted to named imports
- **`lint`** — sort-named-imports — inline-disable intentional domain-grouped barrel import
- **`lint`** — max-file-lines — file-level bypass on 86 oversized files
- **`lint`** — no-fetch-prefer-http-request — inline-disable 5 dev-script fetches that need raw Response
- **`lint`** — apply 2nd-pass oxlint autofixes — sort-source-methods reorder 3 files
- **`lint`** — personal-path-placeholders — file-level disable on fixture tests + replace example usernames in src comments
- **`lint`** — prefer-exists-sync — rewrite 2 fileExists helpers + inline-disable legitimate metadata reads
- **`oxlint`** — rewrite overrides patterns as **/scripts/** etc.
- **`lint`** — export-top-level-functions — collapse 5 export-block aggregators
- **`lint`** — apply oxlint autofixes — export-top-level-functions / prefer-exists-sync / prefer-node-builtin-imports / sort-equality-disjunctions / prefer-undefined-over-null
- **`no-status-emoji`** — cascade rule self-disable + bypass scripts/tests
- **`lint`** — re-cascade canonical oxlint plugin rules — undo self-corruption
- lint --fix autofix pass + cascade canonical check-paths.mts
- **`tests`** — align 39 assertions with null→undefined flip
- **`types,quality`** — revert Object.create(undefined) regression + finish null→undefined flip
- **`cli`** — register `mcp` in canonical bucketed-commands set
- **`deps`** — bump hono via override to ≥4.12.16 (CVE patched)
- **`hooks`** — release-workflow-guard — multi-root dry-run resolution
- **`hook`** — release-workflow-guard — derive project dir from script path
- **`hooks`** — tighten npx-scanner regex to skip identifier/key contexts
- **`deps`** — override ip-address >=10.1.1 (GHSA-v2v4-37r5-5v8g)
- **`hooks`** — anchor hook commands + project paths to $CLAUDE_PROJECT_DIR
- **`test`** — repair four CI-failing assertions on main
- **`deps`** — regenerate pnpm-lock.yaml for catalog drift
- **`cli`** — stop socket cdxgen from silently shipping empty-components SBOMs (#1266)
- **`cli`** — error messages in env/ + constants/ + sea-build scripts (#1258)
- **`cli`** — error messages in utils/ misc (flags, fs, git, npm, promise, terminal) (#1260)
- **`cli`** — error messages for utils/update + utils/command + error library migration (#1257)
- **`cli`** — error messages in utils/dlx/ (#1256)
- **`cli`** — error messages in commands/ (14 commands + their tests) (#1255)
- **`cli`** — align test/ error messages with 4-ingredient strategy (#1259)
- **`cli`** — return org slug, not display name, from org resolution (#1232)
- **`deps`** — bump nanotar 0.2.0 → 0.2.1 to patch path traversal (CVE-2025-69874) (#1250)
- **`debug`** — log structured HTTP error details instead of raw response (#1233)
- **`test`** — pass --passWithNoTests to vitest (#1240)
- **`scan`** — surface GitHub rate-limit errors in bulk repo scan (#1235)
- **`fix`** — validate target directory and detect misplaced IDs (#1227)
- **`api`** — include request path in API error messages (#1224)
- **`api`** — distinguish 401 (auth failure) from 403 (permissions) (#1226)
- **`scan`** — respect projectIgnorePaths from socket.yml (#1225)
- **`ci`** — replace close/reopen hack with workflow_dispatch for bot PRs (#1210)
- **`build`** — improve asset download resilience against rate limits (#1201)
- **`config`** — align .npmrc and pnpm-workspace.yaml for pnpm v11 (#1198)
- **`hooks`** — normalize platform keys and strip host prefix from repository (#1194)
- **`hooks`** — use strings for binary file scanning in pre-push (#1196)
- **`hooks`** — update zizmor repo from woodruffw to zizmorcore (#1191)
- **`deps`** — bump vite to 7.3.2 (security) (#1168)
- **`ci`** — harden weekly-update — allowedTools, two-phase update, diff validation (#1159)
- move minimum-release-age to pnpm-workspace.yaml (#1158)
- **`build`** — fix runtime bugs in build scripts (#1148)
- upgrade handlebars to 4.7.9, fix pre-push hook (#1134)
- upgrade brace-expansion to 5.0.5 (CVE-2026-33750) (#1132)
- **`ci`** — rebuild weekly-update.yml with proper YAML and features
- harden GitHub Actions workflows (#1129)
- **`ci`** — update pnpm/action-setup to Node 24 (58e6119)
- **`skill`** — update updating skill to use pnpm run update and check --all
- **`ci`** — add timeout-minutes and shell declarations to workflows
- **`ci`** — add explicit shell: bash declarations to provenance workflow
- **`types`** — remove unused import and fix context tests
- **`security`** — make missing SHA-256 checksums a hard error
- **`ci`** — add complete stub package with JS implementation for iocraft
- **`ci`** — create stub packages before pnpm install
- **`ci`** — setup pnpm before node to enable cache
- **`types`** — resolve TypeScript type errors in iocraft and test helpers
- **`tui`** — fix border rendering in iocraft column layouts
- **`deps`** — remove stale restore-cursor patch
- **`deps`** — remove stale React/Ink dependencies after iocraft migration
- **`test`** — replace unsafe fs.rm with safeDelete
- **`cli`** — improve cache coherency and notification handling
- **`cli`** — handle undefined returns from getMajor in optimize
- **`security`** — address critical security vulnerabilities
- **`cli`** — invalidate token cache on login/logout
- **`cli`** — correct unreachable error branch in scan-diff
- **`iocraft`** — critical publishing workflow fixes
- **`publish`** — use separate versions for cli and iocraft ecosystems
- **`iocraft`** — use independent versioning starting at 1.0.0-pre.0
- **`cli`** — transform yoga-sync.mjs to remove top-level await for CJS
- use 0.0.0 for placeholder version (matches existing pattern)
- properly disable dependabot (#1119)
- **`publish`** — rename workflow to provenance.yml for trusted publishing
- **`publish`** — restore socket package and fix paths
- **`ci`** — read base version from cli-package template
- **`publish`** — add missing check-version-consistency script and update docs
- **`sfw`** — use separate versions for SEA and npm CLI distributions
- address quality scan findings (Round 1)
- **`dry-run`** — show computed query parameters in read-only commands
- **`cli`** — enhance fix dry-run to show computed details
- **`cli`** — improve optimize dry-run and remove unused logger imports
- **`quality-scan`** — remove socket-btm cross-project references
- **`cli`** — replace broken --dry-run with meaningful preview output
- **`test`** — inject inlined env vars in test setup for e2e tests
- **`ci`** — remove integration tests job (no integration tests exist)
- **`ci`** — simplify CI workflow and remove references to non-existent directories
- **`ci`** — use pnpm/action-setup to read packageManager from package.json
- **`quality`** — add try-catch for JSON.parse in build scripts
- **`quality`** — add defensive checks and fix Windows ARM64 Python detection
- quality scan fixes - NaN validation, logging conventions, docs
- **`sea`** — use relative paths in sea-config and update SDK
- remove cross-repository updates from quality-scan skill
- **`sea`** — update Trivy to v0.69.2
- **`sea`** — use win32 platform keys in external-tools-platforms
- **`vfs`** — update mount type signature to async `Promise<string>`
- **`sea`** — fix sfw extraction from VFS with node_modules structure
- **`sea`** — add Socket Firewall (sfw) to VFS bundling
- **`scan`** — correct policy strictness comparison in alert aggregation
- **`hooks`** — check only new commits in pre-push, not all since release
- **`hooks`** — use portable for loop instead of process substitution in pre-push
- **`cli`** — address quality scan findings round 10
- **`package-builder`** — correct dependencies for cli-with-sentry template
- **`cli`** — restore 'as unknown as' pattern in type assertions
- **`cli`** — handle negative time deltas in msAtHome function
- **`cli`** — add defensive optional chaining in getHighestEntryIndex
- **`cli`** — address remaining round 17 low priority issues
- **`cli`** — address round 17 quality scan findings
- **`cli`** — improve type safety by replacing unsafe type assertions
- **`cli`** — remove globalThis indirection in update notifier
- **`cli`** — improve Coana output parsing to handle empty lines
- **`cli`** — add HTTP request timeouts to prevent indefinite hangs
- **`cli`** — restore and fix handle-optimize.test.mts
- **`cli`** — resolve TOCTOU race conditions in file cleanup
- **`cli`** — replace Math.random() with fixed delay in preflight downloads
- **`cli`** — address quality scan findings round 9
- **`cli`** — address quality scan findings round 8
- **`cli`** — prevent unbounded Map growth in inflight trackers
- **`cli`** — code style consistency - catch parameter naming and type safety
- **`cli`** — add missing lru-cache dependency
- **`cli`** — address quality scan findings round 4 (part 2) - lock detection and race conditions
- **`cli`** — address quality scan findings round 4 (part 1)
- **`cli`** — address quality scan findings round 3
- **`cli`** — capture timestamp at function entry for accurate TTL
- **`ci`** — add required .env.precommit for pre-commit hooks
- **`ci`** — improve workflow reliability and security validation
- **`cli`** — add input validation and bounds checking
- **`cli`** — resolve race conditions and improve locking mechanisms
- **`cli`** — resolve memory leaks and resource cleanup issues
- **`cli`** — fix getMaxOldSpaceSizeFlag default calculation
- **`hooks`** — add prerequisite checks to pre-commit hook
- **`cli`** — address quality scan findings round 11
- **`cli`** — address quality scan findings round 10
- **`cli`** — address quality scan findings round 9
- **`cli`** — address quality scan findings round 8
- **`cli`** — address quality scan findings round 7
- **`cli`** — address round 6 quality scan findings
- **`cli`** — address round 5 quality scan findings
- **`cli`** — address quality scan findings (round 4)
- **`cli`** — address quality scan findings (round 3)
- **`cli`** — address quality scan findings (round 2)
- **`cli`** — address quality scan findings across codebase
- **`cli`** — inject external tool versions in integration test runner
- **`scripts`** — use absolute paths for validation scripts in check.mjs
- **`types`** — resolve TypeScript errors in spawn usage and unused imports
- **`types`** — resolve TypeScript errors in quality scan fixes
- **`build`** — resolve TOCTOU races and cache invalidation
- **`cli`** — improve type safety in spec parsing and overrides
- **`scan`** — resolve critical bugs in scan output handlers
- **`build`** — remove redundant warning emojis from logger.warn calls
- **`deps`** — always update Socket packages in update script (#1059)
- **`deps`** — add restore-cursor signal-exit v4 compatibility patch
- **`deps`** — update @socketsecurity/lib to v5.5.3 and add signal-exit v4 compatibility patches
- **`deps`** — update Socket packages regardless of taze result
- prevent heap overflow in large monorepo scans (#1041)
- remaining fixes from PR 1025 (#1027)
- ensure build directory exists before writing yoga placeholder
- remove unused silence parameter from FetchOrganizationOptions type
- update extract scripts for corrected socket-btm asset names
- implement findAsset locally, remove non-existent import
- exit with code 1 when socket ci finds blocking alerts
- **`security`** — disable automatic caching in setup-node to prevent cache poisoning
- **`security`** — resolve artipacked and docker security vulnerabilities
- **`sea`** — use unique cache directories for parallel binject builds
- **`sea`** — add exit code checking for binject spawn
- **`build`** — use bracket notation for TypeScript index signatures
- **`build`** — add GitHub API authentication to avoid rate limits
- **`deps`** — Remove http2 module dependency from @sigstore/sign
- **`cli`** — add per-platform caching for parallel SEA builds
- **`build-infra`** — add GitHub token authentication to API requests
- **`build-infra`** — Add GitHub API headers to httpRequest calls
- **`glob`** — add dot:true to match dotfiles and dot directories
- **`optimize`** — remove Node.js version filter from manifest entries
- **`sea`** — use toUnixPath for Git Bash tar compatibility
- **`sea`** — use current Node.js process for SEA blob generation
- **`sea`** — update binject command and node-smol URL format
- **`debug`** — use correct debug functions with proper namespacing
- **`scan`** — use Octokit for GitHub API calls with proper error handling
- **`ci`** — add Node.js and pnpm setup immediately after checkout in all workflows
- **`sea`** — compute rootPath in getBinjectPath function
- **`build`** — use yoga-sync.mjs from socket-btm and integrate binject
- **`cli`** — resolve socket-lib external paths at any nesting depth
- **`bootstrap`** — remove non-existent polyfill imports and fix build errors
- **`fix`** — add ecosystems support to coana CLI calls
- **`fix`** — add --limit as alias for --pr-limit
- **`flags`** — make --exclude and --include visible in socket fix command
- **`dlx`** — support Coana CLI binary execution via SOCKET_CLI_COANA_LOCAL_PATH
- **`docs`** — remove hardcoded personal paths and realistic API key examples
- **`hooks`** — limit pre-push AI attribution check to commits since latest release
- upload manifest files relative to target for coana-fix and perform-reachability-analysis
- **`self-update`** — implement bootstrap binary path via IPC handshake
- **`api`** — improve CVE to GHSA conversion caching and error messaging
- **`cli`** — resolve --limit flag not working in local mode
- **`fix`** — improve PR creation logic and branch lifecycle management
- **`dlx`** — pin Coana to exact version without tilde prefix
- **`alerts`** — respect SOCKET_CLI_API_TOKEN environment variable
- **`test`** — resolve flaky TTL boundary test by mocking Date.now()
- **`build`** — inline environment variables to prevent package.json errors
- **`shadow`** — use static imports for shadow bins instead of dynamic require
- **`spawn`** — add which() resolution for command spawns
- **`deps`** — fix bin entries and standardize engine requirements
- **`ui`** — change error badge text from red to white on red background
- **`deps`** — resolve ANSI bundling compatibility issues
- **`bootstrap`** — use consistent naming for published build flag
- **`dev`** — improve fresh clone developer experience
- **`build`** — fix bundle dependencies validation and add missing deps
- **`build`** — add TypeScript dependency and fix socket-lib bundling
- **`build`** — update pnpm and fix CLI build with socket-lib 3.3.2
- **`test`** — fix test infrastructure and ensure build before test:all
- **`build`** — fix bundle dependencies validation
- **`setup`** — verify gh CLI is accessible after installation
- **`cli`** — add missing subcommands to help menu validation
- **`hooks`** — improve AI attribution detection in pre-push hook
- **`hooks`** — use printf for colored output in pre-push hook
- **`workflows`** — resolve all zizmor security findings
- **`socket`** — correct package.json metadata and build script
- **`socket`** — add missing version defines to bootstrap build config
- **`cli`** — add src to files array for bin entry
- **`cli`** — rename duplicate dev script to dev:watch for clarity
- **`types`** — resolve TypeScript errors in package manager commands
- **`hooks`** — improve git hook compatibility and formatting
- **`smol-builder`** — fix spawn import in compress-binary script
- **`smol-builder`** — fix smokeTestBinary API mismatch
- **`smol-builder`** — standardize brotli2c naming to socketsecurity\_ prefix
- **`smol-builder`** — convert remaining patches to standard unified diff format
- **`smol-builder`** — convert polyfill patches to standard unified diff format
- **`smol-builder`** — regenerate polyfill patches with real git hashes
- **`smol-builder`** — replace fs.rm with safeDelete for secure deletion
- **`smol-builder`** — replace remaining rm calls with fs.rm
- **`smol-builder`** — replace cp with fs.cp for file copy operations
- **`smol-builder`** — add readdirSync back to fs imports
- **`smol-builder`** — replace remaining mkdir calls with safeMkdir
- **`eslint`** — enable no-undef rule for script files
- **`smol-builder`** — use fs.method() pattern for all fs.promises calls
- **`smol-builder`** — replace mkdir with safeMkdir
- **`smol-builder`** — copy bootstrap loader to lib/internal before compilation
- **`smol-builder`** — correct brotli2c patch line numbers for pristine Node.js v24.10.0
- **`sea-builder`** — remove erroneous closing brace causing syntax error
- **`smol-builder`** — copy brotli header to src directory
- **`smol-builder`** — update hardcoded patch reference to use numbered prefix
- **`test`** — correct import path for confirm prompt
- **`bootstrap`** — use major version only for CLI download spec
- **`smol`** — implement robust cross-platform strip with capability detection
- **`smol`** — use platform-specific strip flags for binary optimization
- **`smol`** — use shell for execCapture and enable fail-fast for builds
- **`bootstrap`** — show Socket CLI version instead of Node.js version
- **`bootstrap`** — skip preflight on --version for instant response
- **`smol`** — skip CLI bootstrap for basic Node.js operations
- **`ci`** — make WASM optional in SEA builds with graceful fallback
- **`ci`** — remove ai-cache-valid references from build-sea workflow
- **`ci`** — comment out socketbin-cli-ai references in build-sea workflow
- **`ci`** — update ONNX Runtime artifact verification to check for .mjs files
- **`onnx`** — add existence checks to patch verification
- **`onnx`** — verify wasm_post_build.js patch in cache validation
- **`onnx`** — clean stale cache after GitHub Actions restoration
- **`onnxruntime`** — patch wasm_post_build.js in both source and build directories
- **`bootstrap`** — remove unnecessary empty log after spinner completes
- **`test`** — reduce thread count on macOS CI to prevent SIGABRT
- **`types`** — resolve exactOptionalPropertyTypes issue in UpdateStore
- **`update`** — only show content-type warning in debug mode on parse failure
- **`types`** — correct parameter types for SDK method calls
- **`types`** — add explicit type parameters to handleApiCall calls
- **`types`** — update handleApiCall signature for SDK v3 compatibility
- **`types`** — revert to use SDK v3 method names in type references
- **`types`** — update SDK operation names to match API types
- **`deps`** — update all packages to use catalog for @socketsecurity/lib
- **`lint`** — fix all lint errors and update dependencies
- **`build`** — externalize Socket dependencies and add bundle validation test
- update for @socketsecurity/lib 3.0.5 compatibility
- **`build`** — use default export workaround for CommonJS imports with --import flag
- **`test`** — resolve TypeScript errors and test failures in NLP modules
- **`smol`** — use Module.prototype.require.bind for virtual module
- **`smol`** — use Module.createRequire for proper module context
- **`onnx`** — patch wasm_post_build.js to handle modern Emscripten
- **`bootstrap`** — correct stream/promises module path for smol builds
- **`ci`** — remove expression from build-models job name
- **`models`** — correct --all flag logic to build both models
- **`ci`** — build all AI models in workflow
- **`models`** — check for all expected ONNX files during conversion
- **`models`** — fix method variable scope in quantization fallback
- **`ci`** — remove invalid job-level matrix conditions from workflows
- **`onnxruntime`** — remove EXPORT_ES6=0 patch for threading compatibility
- **`onnxruntime`** — enable threading and SIMD for v1.21.1 compatibility
- **`ci`** — mark ONNX Runtime WASM build as non-blocking
- **`models`** — update INT4 quantization API for onnxruntime 1.20+
- **`ci`** — install optimum[onnxruntime] for ONNX model export
- **`onnx`** — remove ES module type from onnxruntime package.json
- **`socket`** — remove bootstrap-smol.js from npm package build
- **`patch`** — remove unused imports after duplicate logging removal
- **`patch`** — remove duplicate output logging to fix markdown test flakiness
- **`path`** — handle UNC paths correctly on Windows
- **`path`** — add Windows validation for Unix-style paths in findNpmDirPathSync
- **`wasm`** — update INT4 quantization to use matmul_nbits_quantizer API
- **`ci`** — pin onnxruntime>=1.20.0 to ensure INT4 quantization support
- **`ci`** — upgrade onnxruntime and add INT4 quantization tools
- **`ci`** — uncomment ONNX Runtime build steps to fix bash syntax error
- **`bootstrap`** — eliminate spurious error message on successful CLI execution
- improve bootstrap error handling
- **`completion`** — resolve CLI package root correctly for tab completion script
- **`scan`** — flatten SDK options and make repo parameter conditional
- restore v1.x environment variable fallbacks and EEXIST handling
- **`smol`** — enable code cache for brotli decompression support
- run build before verify in socket package
- inject **MIN_NODE_VERSION** in bootstrap esbuild configs
- use logger.fail for error messages in verify script
- read CLI version from socket package.json during build
- **`cli-with-sentry`** — add missing esbuild config for shadow-npm-inject
- **`cli-with-sentry`** — add missing shadow-npm-inject build step
- **`build`** — skip onnxruntime build (temporarily disabled)
- **`gitignore`** — allow docs/build directory without requiring -f flag
- resolve TypeScript errors after nodeDebugFlags removal
- remove nodeDebugFlags references
- **`build`** — align platform/arch flags in build-all-binaries
- **`build`** — disable minifySyntax across all esbuild configs
- **`socket`** — disable minifySyntax to prevent async function boundary corruption
- **`ci`** — align smol cache keys with build-smol.yml in publish-socketbin.yml
- **`ci`** — use SEA binary cache from build-sea.yml in publish-socketbin.yml
- **`sbom-generator`** — resolve exactOptionalPropertyTypes type errors
- **`test`** — use proper function syntax for Vitest constructor mocks
- **`lint`** — resolve lint errors and remove dead getInternals code
- **`node-sea-builder`** — add missing crypto import
- **`bootstrap`** — improve error handling for CLI download failures
- **`cli`** — update getBinCliPath to use dist/index.js instead of bin/cli.js
- **`environment`** — remove unused createRequire import
- **`environment`** — lazy-load bun lockfile parser
- **`install`** — download from npm registry instead of GitHub releases
- **`prepare`** — remove dotenvx wrapper from husky prepare script
- **`workflow`** — specify correct build target for cli-with-sentry
- **`workflow`** — update JS-only fallback validation
- **`cli-with-sentry`** — use dist/index.js and validate cli.js.bz
- **`cli-with-sentry`** — use socket-with-sentry bin name
- **`cli-with-sentry`** — move @sentry/node to dependencies
- **`ci`** — validate yoga WASM cache instead of building on miss
- **`ci`** — publish from package directories and build yoga WASM on cache miss
- **`ci`** — replace obsolete external cache with yoga-layout WASM cache
- **`scripts`** — update dist validation to check for index.js and cli.js.bz
- **`scripts`** — update pre-publish-validate to accept package path
- **`scripts`** — remove duplicate colors declaration in pre-publish-validate
- **`ci`** — use 'pnpm run build' instead of non-existent 'build:dist'
- **`packages`** — run pnpm pkg fix to normalize package.json fields
- **`socketbin`** — add repository field to all package.json files
- **`ci`** — add --tag latest to all npm publish commands for prerelease versions
- **`ci`** — use semver to extract X.Y.Z from package version before appending timestamp
- **`scripts`** — skip socketbin-cli-ai version check (not published by workflow)
- **`scripts`** — skip root package.json check for socketbin versions
- **`ci`** — install dependencies before version consistency check
- **`ci`** — use bash shell for verify binary step on Windows
- **`ci`** — skip smol build when method=sea and use bash shell for Windows compatibility
- **`ci`** — use 2-core runners in publish-socketbin for better availability
- **`ci`** — comment out ONNX runtime in build-sea workflow
- **`ci`** — correct ONNX package paths in build-sea workflow
- **`ci`** — correct SEA builder package name in publish-socketbin
- **`ci`** — add CLI build step before SEA binary build in publish-socketbin
- **`scripts`** — prepublish-socketbin should create bin/socket not bin/cli
- **`ci`** — align publish-socketbin binary paths with build-sea naming
- **`ci`** — upgrade actions/cache to v4.3.0 in publish-socketbin workflow
- **`scripts`** — improve type check error output in check script
- **`cli`** — add missing INLINED_SOCKET_CLI_PYCLI_VERSION to ENV
- **`onnxruntime`** — correct EXPORT_ES6=0 to output .js files instead of .mjs
- **`onnxruntime`** — add EXPORT_ES6=0 patch and require shim for WASM build
- **`test`** — fix scan create tests to use valid directory targets
- **`onnx`** — disable WASM threading and patch cmake to fix MLFloat16 build errors
- **`test`** — fix self-update tests by mocking canSelfUpdate and cleaning up leftover directories
- **`build`** — add missing INLINED_SOCKET_CLI_CDXGEN_VERSION to esbuild config
- **`onnxruntime`** — enable WASM threading to fix MLFloat16 build errors
- **`bootstrap`** — remove logger usage from smol bootstrap for early initialization
- **`tests`** — fix GitLab provider mock constructor
- **`tests`** — fix npm-config mock constructor to work with 'new' operator
- **`scan-reach`** — handle empty string and undefined outputPath properly
- **`cli`** — inline build-time constants with post-bundle replacement plugin
- **`build-infra`** — escape regex patterns for string literal context in Unicode transform
- **`onnxruntime`** — pass WASM_ASYNC_COMPILATION via CMake defines
- **`ci`** — use package version for WASM workflow cache keys
- **`ci`** — use package version for ONNX Runtime cache key
- **`onnxruntime`** — update Eigen hash patch for v1.21.1 deps.txt format
- **`onnxruntime`** — re-clone if Eigen patch not applied
- **`onnxruntime`** — clean CMake cache when applying Eigen hash patch
- **`onnxruntime`** — apply Eigen hash patch unconditionally
- strip placeholder suffix from socketbin versions
- **`publish`** — read base version from current package being generated
- **`onnxruntime`** — patch Eigen hash to match GitLab archive format
- **`onnxruntime`** — disable TLS verification for CMake downloads
- **`onnxruntime`** — update to v1.21.1 to fix Eigen hash mismatch
- remove yoga-layout patch reference from root package.json
- **`cli`** — handle missing yoga-layout WASM files gracefully
- **`bootstrap`** — avoid logger initialization before stdout is ready
- **`cli`** — correct ESLint config paths to monorepo root
- **`build`** — read socketbin spec from actual package.json
- **`compress`** — align cache key generation with socket-lib
- **`scan`** — resolve TypeScript errors from merged PRs
- **`lint`** — exclude test fixtures from Biome linting
- **`git`** — correct import path for paths module
- **`bootstrap`** — load Intl polyfill before logger to prevent smol build failure
- **`test`** — delete obsolete bootstrap test and fix provider factory assertions
- **`test`** — add missing paths mock for provider factory tests
- **`test`** — fix constructor mocks and add missing canSelfUpdate export
- **`test`** — replace runCommandQuiet with spawn and fix mock constructors
- **`types`** — resolve TypeScript errors in GitLab provider
- **`cli-with-sentry`** — write esbuild output and add gitignore
- **`smol`** — fix MODULE_NOT_FOUND error for socketsecurity bootstrap
- **`ci`** — disable pip cache in build-wasm to prevent cache failures
- **`ci`** — correct artifact paths in build-sea workflow
- **`ci`** — correct artifact paths in build-smol workflow
- **`cli`** — suppress esbuild warnings in CLI build
- **`ci`** — correct socket package verification in build-sea workflow
- **`ci`** — remove CLI build from build-deps job in SEA workflow
- **`ci`** — add detailed cache diagnostics to build-sea workflow
- **`ai`** — update onnxruntime to 1.21.0+ for INT4 quantization support
- **`ci`** — add WASM asset verification before CLI build in SEA workflow
- **`ci`** — include bootstrap deps in SEA binary cache key
- **`ci`** — include bootstrap deps in smol binary cache key
- **`smol`** — add diagnostic logging for bootstrap file location
- **`ci`** — correct artifact download path and add relocation logic
- **`ci`** — add verification step for downloaded build artifacts
- **`smol`** — fail build if bootstrap cannot be copied
- **`lint`** — remove unused variables and parameters
- **`scripts`** — replace undefined runCommandQuiet with spawn
- **`socket-fix`** — add missing import and fix optional prNumber type
- **`socket-fix`** — add remote branch cleanup on PR creation failure
- **`smol`** — optimize build flow and fix macOS ARM64 signing
- **`ci`** — split dependency builds from matrix parallelization
- **`sea`** — use versionSemver from node-version.json to avoid double 'v' prefix
- **`sea`** — decompress cli.js.bz instead of using build/ intermediate
- **`sea`** — auto-build CLI package when missing
- **`ci`** — build bootstrap package before socket and smol/sea builders
- **`socket`** — reference bootstrap files from packages/bootstrap
- **`e2e`** — check JS binary existence before running tests
- **`e2e`** — error and exit if binary doesn't exist when explicitly requested
- **`e2e`** — disable Node.js binary forwarding in .env.test
- **`cli`** — remove unnecessary force: true from safeDeleteSync calls
- **`bootstrap`** — export .config/node-version.mjs for workspace imports
- **`cli`** — auto-enable RUN_E2E_TESTS when running e2e.mjs
- **`socket`** — handle prefix-only modules in smol transform
- **`socket`** — correct internal module paths in smol transform
- **`ci`** — skip cache restore when force rebuild is requested
- **`node-smol-builder`** — use socket package bootstrap not local stub
- **`node-smol-builder`** — add placeholder bootstrap for socketsecurity patch
- **`sea-builder`** — add shell execution for postject on Windows
- **`sea-builder`** — use direct postject path instead of pnpm exec
- **`sea-builder`** — add postject as catalog devDependency
- **`ci`** — enable cross-OS cache sharing for Windows builds
- **`ci`** — pass --force flag to WASM build scripts when force rebuild requested
- **`ci`** — move Windows WASM cache check before build attempt
- **`ci`** — require WASM cache for Windows SEA builds
- **`ci`** — add wasm-opt to PATH for Windows Emscripten builds
- **`sea`** — strip leading '--' from pnpm arguments for correct parsing
- **`sea`** — enable cross-platform SEA builds using prebuilt Node binaries
- **`ci`** — limit SEA builds to native architectures only
- **`ci`** — correct SEA binary build for cross-platform compilation
- **`build`** — resolve SEA build failures across platforms
- **`packages`** — correct spawn result access in package build scripts
- **`build`** — correct spawn result access in build orchestration scripts
- **`wasm`** — correct spawn result property access in WASM build scripts
- **`scripts`** — resolve duplicate spawn import and incorrect result access
- **`ci`** — remove pip upgrade to improve Python dependency caching
- move .node-source to packages/node-smol-builder/build/
- **`onnx`** — output to dist/ directory instead of build/wasm/
- **`ci`** — save ONNX build cache even on failure
- **`onnx`** — fix second readCheckpoint usage in export stage
- **`onnx`** — use correct checkpoint function name
- **`build`** — enable WASM features in wasm-opt optimization
- **`onnx`** — locate WASM files in MinSizeRel subdirectory
- **`smol`** — use compressed binary in Final distribution directory
- **`build`** — use fs.statfs for reliable cross-platform disk space check
- **`ci`** — use requirements.txt for proper pip caching
- **`onnx`** — upgrade to v1.23.2 to resolve Eigen hash mismatch
- **`wasm`** — correct checkDiskSpace parameter units (GB not bytes)
- **`onnx`** — use build.sh script instead of direct CMake
- **`wasm`** — use explicit EMSDK paths for wasm-opt and wasm-strip
- **`onnx-runtime`** — remove existing source dir before clone and add debug logging
- **`wasm`** — use shell:true for wasm-opt/wasm-strip to inherit emsdk PATH
- **`socketbin-cli-ai`** — auto-clean stale checkpoints when artifacts missing
- **`onnx-runtime`** — auto-clean stale checkpoints and use existsSync
- **`yoga-layout`** — auto-clean stale checkpoints when artifacts missing
- **`yoga-layout`** — throw errors instead of warnings on missing artifacts
- **`ci`** — add debugging output for WASM build artifact verification
- **`build-infra`** — replace exec wrappers with direct spawn calls
- **`ai`** — add progress indicator for brotli compression
- **`build-infra`** — add exec wrapper to builder classes
- **`ci`** — fail builds when WASM artifacts are missing
- **`ai`** — define originalSize/quantSize before use
- **`ci`** — add cache artifact verification to WASM builds
- **`onnx`** — use proper spawn command/args pattern
- replace build-exec with spawn in remaining builder packages
- **`onnx`** — replace build-exec with spawn
- **`ci`** — replace shasum with sha256sum for Windows compatibility
- **`ci`** — use standard ubuntu-latest runners for WASM builds
- **`node-smol`** — use console.log instead of logger.log in binary smoke test
- **`cli-ai`** — make INT4 quantization optional with graceful fallback
- **`ci`** — correct INT4 quantization import and remove invalid autocrlf
- **`ci`** — remove push triggers from build-wasm to avoid runner contention
- **`cli-ai`** — correct import path for matmul_4bits_quantizer
- **`ci`** — require onnxruntime>=1.20.0 for INT4 quantization
- **`ci`** — use optimum[onnx] instead of optimum[exporters]
- **`build-infra`** — use result.code instead of result.status
- **`build-infra`** — import printSubstep for debug logging
- **`build-infra`** — use shell for Python detection on all platforms
- **`build-infra`** — try multiple Python command names in version check
- **`build-infra`** — handle undefined status in Python check
- **`build-infra`** — fix spawn calls to use proper command+args pattern
- **`build-infra`** — restore shell: WIN32 option in Python check
- **`build-infra`** — use direct python3 execution without shell
- **`build-infra`** — add detailed error logging to Python check
- **`ci`** — add Python verification step for debugging
- **`ci`** — setup Python for all platforms in smol build
- **`ci`** — add Python 3.11 setup for WASM builds in SEA job
- **`build-infra`** — remove duplicate imports in tool-installer
- **`node-smol-builder`** — replace build-exec with spawn wrappers
- **`ci`** — add WASM asset restoration to SEA build job
- **`ci`** — correct package names and cache key generation
- **`ci`** — ensure dist directories exist before verification
- **`ci`** — include node-smol-builder patches and additions in cache keys
- **`ci`** — update patches directory path from build/patches to patches
- **`ci`** — update actions/cache to v4.3.0
- **`ci`** — add workflow_call trigger to build-wasm workflow
- **`ci`** — add WASM asset preparation before CI tests
- **`cli`** — remove unused imports in optional-models.mts
- **`e2e`** — prompt for sea and smol binaries separately
- **`test`** — update tests for read-only ENV properties from @socketsecurity/lib
- **`test`** — skip Unix permission checks on Windows
- **`env`** — convert CI to boolean and fix type comparison
- **`e2e`** — correct property names and assertions in critical commands test
- **`tests`** — correct import paths in E2E dlx test
- **`test`** — correct e2e test exclusion pattern
- **`paths`** — replace path.sep with normalizePath across codebase
- use forward-slash patterns for normalized path matching
- normalize paths consistently across platforms
- **`shadow/npm`** — wrap path.join calls with normalizePath
- **`tests`** — resolve cross-platform npm and path issues
- **`cli`** — resolve TypeScript error in shadowNpmBase cwd handling
- **`cli`** — pass converted cwd to spawn in shadowNpmBase
- improve developer onboarding and fix broken commands
- **`cli`** — use platform-specific PATH separator in npm tests
- remove accidental gitlinks for yoga source directories
- **`cli`** — make path tests cross-platform compatible
- **`build`** — use fileURLToPath for cross-platform path comparison in esbuild
- **`ci`** — prevent diagnostic checks from stopping script execution
- **`gitignore`** — restore dist/ ignore and update build artifact documentation
- **`test`** — use tmpdir for patch discover test to avoid spawn failures
- **`ci`** — remove del-cli from test-setup-script
- **`ci`** — remove redundant pnpm install from test-setup-script
- **`ci`** — replace rm -rf with cross-platform del-cli command
- **`cli`** — normalize paths for Windows compatibility in completion and tildify
- **`cli`** — update NODE_VERSION to getNodeVersion()
- **`cli`** — skip update checks in test environments
- **`tests`** — update test imports and fix NpmConfig mock
- **`utils`** — update remaining ecosystem.mjs imports to types.mjs
- **`cli`** — update ONNX runtime extraction
- **`build-infra`** — improve Emscripten and build execution
- **`scripts`** — add missing colors import in verify-node-build
- **`deps`** — use socket-lib 1.3.5 with Windows Proxy fix
- **`tests`** — pass undefined env to avoid multiple process.env spreads
- **`tests`** — revert to working spawn pattern from commit 39ee9465
- **`tests`** — use Proxy in test mode to preserve Windows env behavior
- **`tests`** — use exact spawn env pattern from working commit 39ee9465
- **`tests`** — omit env option when no custom env vars provided
- **`tests`** — avoid spreading process.env in spawn calls
- **`tests`** — preserve process.env proxy for Windows
- **`ci`** — resolve dependency caching issue causing test failures
- **`cli`** — resolve TypeScript strict mode errors
- **`ci`** — use consistent pnpm --filter pattern in test setup
- **`ci`** — use pnpm --filter to run scripts in monorepo context
- **`ci`** — remove redundant cd commands in workflow scripts
- **`deps`** — correct @socketsecurity/lib references in workspace packages
- **`scan`** — add optional chaining for spinner safety
- **`patch`** — wrap logger output in outputKind checks for JSON/markdown
- **`patch`** — use optional chaining for spinner to handle null in tests
- **`tests`** — update CI handle test imports and debug API
- **`tests`** — update debug imports and skip path-resolve test
- **`tests`** — add missing stdout/stderr destructuring in optimize tests
- **`cli`** — disable interactive help menu in test environments
- **`tests`** — replace await import with vi.importMock in fetch-threat-feed tests
- **`tests`** — replace helper functions with direct mocks in fetch-list-repos and fetch-list-all-repos
- **`tests`** — replace await import with vi.importMock in remaining repository tests
- **`tests`** — use vi.importMock() consistently in fetch-update-repo tests
- **`tests`** — rewrite fetch-delete-repo tests to match actual implementation
- **`tests`** — use vi.importMock() consistently in fetch-create-repo tests
- **`dlx`** — skip cache entries with invalid metadata in listDlxCache
- **`tests`** — correct UNKNOWN_ERROR import in errors.test.mts
- **`tests`** — add missing await to async operations in optimize tests
- **`ci`** — clear Vitest cache before running tests
- **`test`** — correct mock setup for scan tests
- **`test`** — correct mock setup for repository output tests
- **`test`** — correct mock setup for output-security-policy tests
- **`test`** — correct mock setup for output-quota tests
- **`test`** — correct mock setup for output-license-policy tests
- **`test`** — correct mock setup for output-dependencies tests
- **`tests`** — correct import paths and logger references in organization tests
- **`tests`** — remove invalid await from destructuring in scan tests
- **`config`** — handle Buffer return from safeReadFileSync in findSocketYmlSync
- **`tests`** — update API requirements output test expectations
- **`tests`** — resolve shadow/links PATH and Windows test issues
- **`tests`** — correct socket/alerts mock paths
- **`tests`** — correct pnpm scanning test mocks
- **`tests`** — fix environment variable mocking in API tests
- **`tests`** — update API error message expectations
- **`tests`** — update CLI behavior expectations for interactive menu
- **`tests`** — correct org-slug test mocks and expectations
- **`tests`** — update socket.json test expectations
- **`test`** — resolve mock configuration issues in validation and helper tests
- **`tests`** — update SDK API mock expectations for v3.0.6
- **`cli`** — add ask, console, and patch commands to validation list
- **`tests`** — add missing color functions to yoctocolors-cjs mock
- **`tests`** — correct module import paths in shadow links and performance tests
- **`tests`** — correct module file name imports
- **`tests`** — correct remaining import paths in test files
- **`tests`** — remove getProcessEnv import that doesn't exist
- **`tests`** — correct module mock paths in test helpers
- **`tests`** — correct additional import paths in utils subdirectories
- **`tests`** — correct import paths and remove orphaned test files
- **`windows`** — add LOCALAPPDATA fallback for app data path
- **`test`** — resolve binCliPath undefined errors and CI shimmer test
- **`test`** — correct import paths in 76 command test files
- **`test`** — correct import path in constants.test.mts
- **`test`** — resolve SDK dynamic require error in vitest config
- **`build`** — use getLocalPackageAliases instead of hardcoded paths
- **`test`** — enable test isolation to prevent worker thread termination errors
- **`test`** — correct output-threat-feed mock path for serializeResultJson
- **`test`** — correct arborist-helpers mock path for idToNpmPurl
- **`test`** — correct handle-create-new-scan mocks and expectations
- **`tests`** — properly mock paths and dependencies in postinstall-wrapper tests
- **`tests`** — properly mock @socketsecurity/lib/debug in debug tests
- resolve socket-lib bundled external dependencies in esbuild
- add missing TypeScript base config at root
- remove @socketsecurity/lib link override for CI build compatibility
- update @socketbin/cli packages to available version 0.0.0
- replace fragile regex parsing with file-based JSON extraction in coana discovery
- resolve pre-existing unit test failures
- **`ci`** — remove coverage-script and coverage-report-script
- **`ci`** — update workflow SHAs to d8ff3b05
- update build scripts to use pnpm filter for monorepo
- link to local @socketsecurity/sdk for development Replace @socketsecurity/sdk version dependency with link to sibling socket-sdk-js directory. Remove SDK patch as types are now fixed at source. This enables development on SDK and CLI simultaneously and ensures we're testing against the latest SDK changes.
- patch @socketsecurity/sdk@2.0.1 to correct type definition paths The SDK package.json incorrectly references index.d.mts and testing.d.mts but the actual files are index.d.ts and testing.d.ts. This patch corrects the types field to point to the correct .d.ts files. Note: This fixes the "could not find declaration file" errors, but there are still type export issues with SDK v2.0.1 that need to be addressed. Socket CLI uses SocketSdkSuccessResult and other types that are not being properly exported from the SDK index despite being defined in types.d.ts.
- suppress lint warning for intentional control character regex Add biome-ignore comment to asciiUnsafeRegexp which intentionally matches control characters for test output cleanup. This is a false positive from the noControlCharactersInRegex rule.
- suppress lint warning for intentional control character regex Add biome-ignore comment to asciiUnsafeRegexp which intentionally matches control characters for test output cleanup. This is a false positive from the noControlCharactersInRegex rule.
- resolve merge conflict in provenance.yml workflow Remove merge conflict markers and use correct publish command that changes to dist directory before publishing @socketsecurity/cli-with-sentry. This ensures the package is published from the correct location.
- handle directory targets according to specification When a directory path is provided, it now recursively scans that directory for all files by appending /\*_/_ to the path pattern. This ensures directory targets work as expected in scanning operations. Also fixes a type annotation issue in getWorkspaceGlobs. Cherry-picked from PR #794 (commit 5f78dfdf) Original author: Martin Torp <martin@socket.dev> Co-Authored-By: Martin Torp <martin@socket.dev>
- disable Biome assist to prevent import organization conflicts
- update Biome and ESLint configs for bracket notation support Update linting configuration to support TypeScript bracket notation for index signature properties: - Disable Biome rules: useLiteralKeys, noParameterAssign, noNonNullAssertion, noExplicitAny, noAsyncPromiseExecutor, noAssignInExpressions, useIterableCallbackReturn, noBannedTypes - Disable ESLint rules: no-unexpected-multiline, sort-imports - Apply Biome formatting across codebase This aligns with socket-sdk-js and enables TypeScript TS4111 compliance.
- inject build metadata in esbuild config After migrating from Rollup to esbuild, build metadata values (INLINED_SOCKET_CLI_VERSION, etc.) were no longer being injected, causing the CLI version to display as "vundefined" in the header. Changes: - Added build-time injection of all metadata values via esbuild's define option (version, version hash, dependency versions, build flags) - Implemented proper version hash computation matching Rollup's logic: "${version}:${gitHash}:${randomUUID}${devSuffix}" - Fixed dependency version lookups to use devDependencies (coana, cdxgen, synp) - Renamed esbuild-inject-import-meta.js to .mjs for proper module resolution - Added default export to scripts/constants.mjs for compatibility - Fixed import order in esbuild.cli.config.mjs - Added biome-ignore comments for ANSI escape code patterns in demo The CLI header now correctly shows the version (e.g., "v1.1.25") and all build constants are properly inlined during bundling.
- improve ask command intent parsing and model loading Cache semantic model loading failures to avoid repeated error messages. Previously tried to load the model 6 times per query, now fails once and caches. Improve package name extraction to reject common command words like 'vulnerabilities', 'security', 'issues'. Only extracts valid package names like 'express', '@scope/package', etc. Fix esbuild import.meta.url injection by using ESM export syntax instead of CommonJS module.exports format.
- link to local socket-registry for development Update package.json to use local socket-registry for development to access latest exports and constants not yet published to npm. Add scripts/constants.mjs barrel file to re-export all constants modules. Fix lint issues: - Add eslint-disable for intentional process.exit() in SIGINT handler - Add eslint-disable for intentional await in loop for sequential URL checking
- patch https-proxy-agent to prevent Rollup template literal corruption Replace \r\n literals with hex codes (\x0d\x0a) to prevent Rollup from corrupting template literals during bundling process.
- skip processing of large base64-encoded WASM/model files Adds custom Rollup plugin to load external/ files raw without parsing. This fixes build hangs caused by Babel/CommonJS trying to parse 40MB+ base64-encoded strings in onnx-sync.mjs and minilm-sync.mjs. Changes: - Add skip-external-assets plugin to load() files raw - Exclude external/**from babel processing - Exclude external/** from commonjs processing
- suppress TypeScript errors for local registry imports Add ambient module declarations for @socketsecurity/registry subpaths. This suppresses TS2307 errors during development when using local builds. The Node.js loader resolves these imports correctly at runtime, and build tools use getLocalPackageAliases() for resolution. Update .gitignore to allow src/types/\*_/_.d.ts (ambient declarations).
- restore ink patch with proper git hashes Regenerate <ink@6.3.1.patch> using pnpm patch workflow to fix integrity check failures.
- ensure fix script forwards --all, --changed, and --staged flags to lint Updates scripts/fix.mjs to properly forward file filtering flags to the underlying lint command. This ensures consistent behavior across socket-cli, socket-packageurl, and socket-sdk-js repositories. - Add --all, --changed, and --staged options to parseArgs - Build lint command arguments conditionally based on flags - Forward flags to pnpm run lint --fix command - Update script documentation with new options
- resolve all ESLint errors and warnings - Fix undefined NODE_DIR by defining it properly in build-yao-pkg-node.mjs - Add eslint-disable comments for intentional unused variables in catch blocks - Add eslint-disable comments for intentional process.exit() calls in SEA wrapper - Add eslint-disable comments for intentional await-in-loop in retry/batch operations - Auto-fix all import ordering warnings across codebase - Ensure proper import grouping: builtin -> external -> internal -> local
- handle deleted files in lint and test scripts - Add existsSync checks to filter out deleted files before linting - Add existsSync checks in affected-test-mapper to skip deleted test files - Prevents 'No files matching pattern' errors when files are deleted This fixes an issue where git reports deleted files in changed/staged lists, but the files no longer exist on disk, causing lint and test runners to fail.
- improve Ctrl+O output display behavior When Ctrl+O is pressed to show output: - Remove "--- Showing output ---" header for cleaner display - Don't clear the buffer after dumping it - Keep output streaming live to stdout while visible - Allow toggling back to spinner mode This provides a smoother interactive experience where pressing Ctrl+O clears the spinner and shows all output, continuing to stream live until toggled back.
- prevent ENAMETOOLONG in path-resolve tests from circular symlinks The test was using mock-fs.load() to load the entire node_modules tree, which followed circular symlinks between @socketregistry/packageurl-js and @socketsecurity/registry infinitely, causing ENAMETOOLONG errors. Additionally, the registry's dist/external/streaming-iterables.js was not accessible in the mock filesystem because Node's require follows the symlink to the actual socket-registry/registry location. Solution: - Don't load the entire node_modules tree (avoids ENAMETOOLONG) - Load only the registry dist from its actual location since require follows symlinks to socket-registry/registry All 21 path-resolve tests now pass.
- correct SDK API calls and TypeScript types - Fix createOrgFullScan call: use options object with pathsRelativeTo and queryParams - Fix streamOrgFullScan call: use options object with output property - Fix purl-to-ghsa: only include affects when truthy to satisfy exactOptionalPropertyTypes - Fix purl types: replace non-existent PurlQualifiers with Record<string, string>
- correct yoctocolors mock in failMsgWithBadge test Move vi.mock() before imports and use plain functions instead of vi.fn() to properly mock the color functions. Remove spy assertion tests that are no longer applicable with plain function mocks.
- add worker termination error handler to test runner Add unhandledRejection handler to filter out non-fatal vitest worker thread cleanup errors. Prevents false negative test failures. Matches socket-sdk-js implementation for consistent behavior.
- use correct TypeScript check script name Change check:types to check:tsc to match the actual script name in package.json.
- use test.mjs script and suppress worker termination warnings - Update package.json test script to use test.mjs for --all flag support - Add --unhandled-rejections=warn to NODE_OPTIONS to suppress non-fatal unhandled rejection warnings from vitest worker thread cleanup This aligns socket-cli with the test infrastructure used in other socket-\* repos and prevents false test failures from worker cleanup.
- handle vitest worker termination errors gracefully Update test runner to capture output and detect worker termination errors. Override exit code to 0 when only worker termination errors occur without actual test failures. This prevents false negatives from known non-fatal vitest cleanup issues.
- suppress TypeScript spread type errors with ts-expect-error Add @ts-expect-error comments to suppress TS2698 errors on getOwn spread operations. While spreading undefined technically works at runtime in modern JavaScript, TypeScript's strict mode rejects it. Since the linter strips out nullish coalescing operators, we use ts-expect-error instead. Files updated: - src/commands/optimize/agent-installer.mts - src/shadow/npm/arborist-helpers.mts - src/shadow/npm/install.mts - src/utils/dlx.mts - src/utils/meow-with-subcommands.mts - src/utils/socket-package-alert.mts
- replace log.progress with log.step in build script - Use log.step() instead of log.progress() to avoid spinner interference - Remove manual line clearing code (no longer needed) - Replace log.failed() with log.error() for consistency - Prevents output interference with dividers and status updates
- resolve TypeScript TS2698 spread type errors with exactOptionalPropertyTypes Add nullish coalescing to getOwn() calls to ensure spread operations always receive objects when exactOptionalPropertyTypes is enabled.
- continue resolving TypeScript errors - Fixed EditablePackageJson import to use ReturnType pattern - Fixed Buffer/NonSharedBuffer .trim() issues in update-store.mts - Fixed ChildProcessType exit event parameter types - Fixed debug namespace calls (isDebugNs, debugFnNs) in error-display.mts Reduced errors from 255 to 251
- resolve TypeScript API migration errors - Convert 2-argument debug calls to namespace variants (debugFnNs) - Replace logger.debug with logger.log (API removed in registry) - Update pluralize calls to use { count } option object - Add missing LATEST and PACKAGE_LOCK_JSON exports - Import namespace debug functions in debug utilities Reduced TypeScript errors from 432 to 255
- update @socketbin workflow for trusted publisher - Remove automatic release trigger (manual dispatch only) - Remove all NODE_AUTH_TOKEN/NPM_TOKEN references - Use OIDC authentication via id-token permission instead - Simplify version determination (no release event handling) Trusted publisher uses GitHub OIDC tokens, no npm token needed.
- add file extension filtering to affected test mapper - Skip non-code files (images, docs, etc.) in test mapping - Prevents running all tests for non-code file changes - Improves test performance
- resolve ESLint and TypeScript linting issues Fix inline comment positioning (line-comment-position): - Move inline comments to separate lines above code - Affected: cache-strategies.mts and all test files Fix TypeScript index signature access: - Change dot notation to bracket notation for metadata properties - Affected: performance.test.mts Add ESLint disable comments: - Disable no-control-regex for ANSI color code tests - Affected: output-formatting-tables.test.mts All files now pass `pnpm run check` successfully.
- use Object.create(null) for ResultErrorOptions Replace **proto**: null in typed object literal with Object.create(null) Follows CLAUDE.md pattern for empty null-prototype objects
- **`ci`** — update socket-registry SHA to 5b2880d7
- **`ci`** — update socket-registry SHA to 662bbcab
- **`ci`** — update socket-registry SHA to b94a1086
- **`ci`** — update socket-registry SHA to dba06046
- **`ci`** — update socket-registry SHA to 0782233c
- **`ci`** — correct socket-registry SHA to full hash
- **`ci`** — update socket-registry SHA to 43a668e1
- **`ci`** — update socket-registry SHA to d1bbbbad
- **`ci`** — update socket-registry SHA to dc181fb5
- **`ci`** — update socket-registry SHA to 08fba31a
- **`ci`** — update socket-registry workflows to latest SHA (c61feb5e)
- **`ci`** — pin socket-registry workflows to SHA instead of @main
- improve organization capabilities detection for plan variants
- enterprise plan filter (#785) Signed-off-by: Ahmad Nassri <email@ahmadnassri.com> Co-authored-by: John-David Dalton <jdalton@users.noreply.github.com>
- handle pnpm frozen-lockfile in CI for optimize command In CI environments, pnpm automatically runs with --frozen-lockfile which prevents lockfile updates. When the optimize command tries to add overrides and update the lockfile, it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Added explicit --no-frozen-lockfile flag when running pnpm install in CI mode to allow the lockfile to be updated with Socket.dev overrides.
- Add fallback for npm exec path detection When constants.npmExecPath from the published registry doesn't exist or isn't executable, fall back to using whichBin to find npm. This fixes CI failures where the published version's npm-exec-path module might not correctly detect npm in certain environments.
- Add defensive check for whichBinSync return value The published version of @socketsecurity/registry may return a string when only one result is found even with all: true. This defensive check handles both cases to ensure compatibility with the current published version and future versions that properly return an array.

## [Unreleased]

### Changed

- `socket organization quota` is no longer hidden and now shows remaining quota, total quota, usage percentage, and the next refresh time in text and markdown output.

### Added

- Advanced TUI components and styling for rich terminal interfaces:
  - **MixedText component**: Render text with multiple styled sections, perfect for syntax highlighting and rich formatting
  - **Fragment component**: Group elements without layout impact, enabling cleaner component composition
  - **Extended border styles**: double-left-right, double-top-bottom, and classic ASCII borders
  - **Custom border characters**: Full control over border rendering with custom character sets
  - **ANSI 256-color support**: Use extended color palette with `ansi:123` or bare number notation for vibrant terminal output
- Comprehensive TUI styling and layout properties for terminal interfaces:
  - Text styling: weight (normal, bold, light), dimColor for faded appearance, strikethrough decoration
  - Text layout: align (left, center, right), wrap (wrap, nowrap) for content control
  - Flex layout: flexBasis for initial sizing, flexWrap for multi-line layouts, alignContent for line distribution
  - Advanced positioning: display (flex, none), position (relative, absolute) with inset controls (top, right, bottom, left)
  - Dimension constraints: minWidth, maxWidth, minHeight, maxHeight for responsive layouts
  - Overflow control: overflow, overflowX, overflowY for content that exceeds container bounds
  - Border customization: borderEdges for selective border rendering (top, right, bottom, left)
  - Layout spacing: rowGap and columnGap for fine-grained flex item spacing

### Updated

- Updated to @socketsecurity/socket-patch@1.2.0.
- Updated Coana CLI to v14.12.148.
- `socket scan create` now accepts `--make-default-branch` (mirrors the `make_default_branch` API field) instead of `--default-branch`. The old name keeps working but emits a deprecation warning.

### Deprecated

- `socket scan create --default-branch` / `--defaultBranch` — use `--make-default-branch` instead. The legacy names still work during the deprecation window but emit a warning.

### Fixed

- Prevent heap overflow in large monorepo scans by using streaming-based filtering to avoid accumulating all file paths in memory before filtering.
- `socket scan create` now rejects `--default-branch=<name>` and `--default-branch <name>` (space-separated) with an actionable error instead of silently dropping the branch name. Scans that used the misuse shape were getting recorded without a branch tag and disappearing from the Main/PR dashboard tabs.
- `socket repository create` / `socket repository update` now reject bare `--default-branch` (no value) and `--default-branch=` (empty value). Previously both persisted a blank default-branch name on the repo record.
- `socket cdxgen` no longer silently produces SBOMs with an empty `components` array when run in the default `--lifecycle pre-build` + `--no-install-deps` mode against a Node.js project that has no lockfile and no `node_modules/`. The command now fails fast with an actionable error (install dependencies or pass `--lifecycle build`), and when the generated BOM still ends up empty for any other reason (e.g. overly narrow `--filter`/`--only`), emits a post-run warning so the condition is surfaced instead of shipping an SBOM that renders as "no alerts" on the Socket dashboard.

## [2.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v2.1.0) - 2025-11-02

### Added

- Unified DLX manifest storage for packages and binary downloads with persistent caching and TTL support
- Progressive enhancement with ONNX Runtime stub for optional NLP features
- SHA-256 checksum verification for Python build standalone downloads
- Optional external alias detection for TypeScript configurations
- `--reach-use-unreachable-from-precomputation` flag for `scan reach` and `scan create` commands
  to use precomputed unreachable information for improved reachability analysis accuracy

### Changed

- DLX manifest now uses unified format supporting both npm packages and binary downloads
- Standardized environment variable naming with SOCKET*CLI* prefix
- Preflight downloads now stagger with variable delays (1-3 seconds) to avoid resource contention

### Fixed

- Bootstrap stream/promises module path corrected for smol builds
- Bootstrap error handling improved for clearer failure messages
- Windows path handling now correctly processes UNC paths

## [2.0.10](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.10) - 2025-10-31

### Fixed

- Tab completion script now resolves CLI package root correctly
- SDK scan options flattened and repo parameter made conditional
- Output handling now safely checks for null before calling toString()
- Environment variable fallbacks from v1.x restored for backward compatibility
- Directory creation EEXIST errors now handled gracefully

## [2.0.9](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.9) - 2025-10-31

### Fixed

- Updated @socketsecurity/lib to v2.10.2 with critical DLX fixes for scoped package parsing

## [2.0.8](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.8) - 2025-10-31

### Fixed

- Binary name resolution for external tools (@coana-tech/cli, @cyclonedx/cdxgen, synp) in dlx execution
- Preflight downloads now correctly specify binary names for background package caching

## [2.0.7](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.7) - 2025-10-31

### Added

- Shimmer effect to bootstrap spinner for enhanced visual feedback during CLI download

### Changed

- Consolidated SOCKET_CLI_ISSUES_URL constant to socket constants module for better organization

## [2.0.6](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.6) - 2025-10-31

### Fixed

- Shadow npm spawn mechanism now properly uses spawnNode abstraction for SEA binary compatibility
- IPC handshake structure for shadow npm processes with correct parent_pid and subprocess fields

## [2.0.2](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.2) - 2025-10-30

### Fixed

- Fixed import from @socketsecurity/registry to @socketsecurity/lib

## [2.0.1](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.1) - 2025-10-30

### Changed

- Updated @socketsecurity/lib to v2.9.0 with Socket.dev URL constants and enhanced error messages
- Updated @socketsecurity/sdk to v3.0.21
- Normalized lock behavior across codebase

### Fixed

- Bootstrap path resolution in binary builders to correct path

## [2.0.0](https://github.com/SocketDev/socket-cli/releases/tag/v2.0.0) - 2025-10-29

### Changed

- **BREAKING**: CLI now ships as single executable binary requiring no external Node.js installation

### Added

- GitLab merge request support for `socket fix`
- Persistent GHSA tracking to avoid duplicate fixes
- Markdown output support for `socket fix` and `socket optimize`
- `--reach-min-severity` flag to filter reachability analysis by vulnerability severity threshold

### Fixed

- Target directory handling in reachability analysis for scan commands

## [1.1.25](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.25) - 2025-10-10

### Added

- `--no-major-updates` flag
- `--show-affected-direct-dependencies` flag

### Fixed

- Provenance handling

## [1.1.24](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.24) - 2025-10-10

### Added

- `--minimum-release-age` flag for `socket fix`
- SOCKET_CLI_COANA_LOCAL_PATH environment variable

### Fixed

- Organization capabilities detection
- Enterprise plan filtering

## [1.1.23](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.23) - 2025-09-22

### Changed

- Renamed `--dont-apply-fixes` to `--no-apply-fixes` (old flag remains as alias)
- pnpm dlx operations no longer use `--ignore-scripts`

### Fixed

- Error handling in optimize command for pnpm

## [1.1.22](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.22) - 2025-09-20

### Changed

- Renamed `--only-compute` to `--dont-apply-fixes` for `socket fix` (old flag remains as alias)

### Fixed

- Interactive prompts in `socket optimize` with pnpm
- Git repository name sanitization

## [1.1.21](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.21) - 2025-09-20

### Added

- `--compact-header` flag

### Fixed

- Error handling in `socket optimize`

## [1.1.20](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.20) - 2025-09-19

### Added

- Terminal link support

### Fixed

- Windows package manager execution

## [1.1.13](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.13) - 2025-09-16

### Added

- `--output-file` flag for `socket fix`
- `--only-compute` flag for `socket fix`

## [1.1.9](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.9) - 2025-09-11

### Added

- `socket fix --id` now accepts CVE IDs and PURLs

### Fixed

- SOCKET_CLI_API_TIMEOUT environment variable lookup

## [1.1.7](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.7) - 2025-09-11

### Added

- `--no-spinner` flag

### Fixed

- Proxy support

## [1.1.4](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.4) - 2025-09-09

### Added

- `--report-level` flag for scan output control

## [1.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.1) - 2025-09-04

### Removed

- Legacy `--test` and `--test-script` flags from `socket fix`

## [1.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.0) - 2025-09-03

### Added

- Package versions in `socket npm` security reports

## [1.0.111](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.111) - 2025-09-03

### Added

- `--range-style` flag for `socket fix`

## [1.0.106](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.106) - 2025-09-02

### Added

- `--reach-skip-cache` flag

## [1.0.89](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.89) - 2025-08-15

### Added

- `socket scan create --reach` for manifest scanning

## [1.0.85](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.85) - 2025-08-01

### Added

- SOCKET_CLI_NPM_PATH environment variable

## [1.0.82](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.82) - 2025-07-30

### Added

- `--max-old-space-size` and `--max-semi-space-size` flags

## [1.0.73](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.73) - 2025-07-14

### Added

- Automatic `.socket.facts.json` detection

## [1.0.69](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.69) - 2025-07-10

### Added

- `--no-pr-check` flag for `socket fix`

## [1.0.0](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.0) - 2025-06-13

### Added

- Official v1.0.0 release
- Added `socket org deps` alias command

### Changed

- Moved dependencies command to a subcommand of organization
- Improved UX for threat-feed and audit-logs
- Removed Node 18 deprecation warnings
- Removed v1 preparation flags

## [0.15.64](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.64) - 2025-06-13

### Fixed

- Improved `socket fix` error handling when server rejects request

### Changed

- Final pre-v1.0.0 stability improvements

## [0.15.63](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.63) - 2025-06-12

### Added

- Enhanced debugging capabilities

## [0.15.62](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.62) - 2025-06-12

### Fixed

- Avoided double installing during `socket fix` operations

## [0.15.61](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.61) - 2025-06-11

### Fixed

- Memory management for `socket fix` with packument cache clearing

## [0.15.60](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.60) - 2025-06-10

### Changed

- Widened Node.js test matrix
- Removed Node 18 support due to native-ts compatibility

## [0.15.59](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.59) - 2025-06-09

### Changed

- Reduced Node version restrictions on CLI

## [0.15.57](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.57) - 2025-06-06

### Added

- Added `socket threat-feed` search flags

## [0.15.56](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.56) - 2025-05-07

### Added

- `socket manifest setup` for project configuration
- Enhanced debugging output and error handling

## [0.15.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.15.0) - 2025-05-07

### Added

- Enhanced `socket threat-feed` with new API endpoints
- `socket.json` configuration support
- Improved `socket fix` error handling

### Fixed

- Avoid double installing with `socket fix`
- CI/CD improvements reducing GitHub Action dependencies for `socket fix`

## [0.14.155](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.155) - 2025-05-07

### Added

- `SOCKET_CLI_API_BASE_URL` for base URL configuration
- `DISABLE_GITHUB_CACHE` environment variable
- `cdxgen` lifecycle logging and documentation hyperlinks

### Fixed

- Set `exitCode=1` when login steps fail
- Fixed Socket package URLs
- Band-aid fix for `socket analytics`
- Improved handling of non-SDK API calls

### Changed

- Enhanced JSON-safe API handling
- Updated `cdxgen` flags and configuration

## [0.14.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.14.0) - 2024-10-10

### Added

- `socket optimize` to apply Socket registry overrides
- Suggestion flows to `socket scan create`
- JSON/markdown output support for `socket repos list`
- Enhanced organization command with `--json` and `--markdown` flags
- `SOCKET_CLI_NO_API_TOKEN` environment variable support
- Improved test snapshot updating

### Fixed

- Spinner management in report flow and after API errors
- API error handling for non-SDK calls
- Package URL corrections

### Changed

- Added Node permissions for shadow-bin

## [0.13.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.13.0) - 2024-09-06

### Added

- `socket threat-feed` for security threat information

## [0.12.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.12.0) - 2024-08-30

### Added

- Diff Scan command for comparing scan results
- Analytics enhancements and data visualization
- Feature to save analytics data to local files

## [0.11.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.11.0) - 2024-08-05

### Added

- Organization listing capability

## [0.10.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.10.0) - 2024-07-17

### Added

- Analytics command with graphical data visualization
- Interactive charts and graphs

## [0.9.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.9.0) - 2023-12-01

### Added

- Automatic latest version fetching for `socket info`
- Package scoring integration
- Human-readable issue rendering with clickable links
- Enhanced package analysis with scores

### Changed

- Smart defaults for package version resolution
- Improved issue visualization and reporting

## [0.8.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.8.0) - 2023-08-10

### Added

- Configuration-based warnings from settings
- Enhanced `socket npm` installation safety checks

### Changed

- Dropped Node 14 support (EOL April 2023)
- Added Node 16 manual testing due to c8 segfault issues

## [0.7.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.7.1) - 2023-06-13

### Added

- Python report creation capabilities
- CLI login/logout functionality

### Fixed

- Lockfile handling to ensure saves on `socket npm install`
- Report creation issues
- Python uploads via CLI

### Changed

- Switched to base64 encoding for certain operations

## [0.6.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.6.0) - 2023-04-11

### Added

- Enhanced update notifier for npm wrapper
- TTY IPC to mitigate sub-shell prompts

## [0.5.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.5.0) - 2023-03-16

### Added

- npm/npx wrapper commands (`socket npm`, `socket npx`)
- npm provenance and publish action support

### Changed

- Reusable consistent flags across commands

## [0.4.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.4.0) - 2023-01-20

### Added

- Persistent authentication - CLI remembers API key for full duration
- Comprehensive TypeScript integration and type checks
- Enhanced development tooling and dependencies

## [0.3.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.3.0) - 2022-12-13

### Added

- Support for globbed input and ignores for package scanning
- `--strict` and `--all` flags to commands
- Configuration support using `@socketsecurity/config`

### Changed

- Improved error handling and messaging
- Stricter TypeScript configuration

### Fixed

- Improved tests

## [0.2.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.1) - 2022-11-23

### Added

- Update notifier to inform users of new CLI versions

## [0.2.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.2.0) - 2022-11-23

### Added

- New `socket report view` for viewing existing reports
- `--view` flag to `report create` for immediate viewing
- Enhanced report creation and viewing capabilities

### Changed

- Synced up report create command with report view functionality
- Synced up info command with report view
- Improved examples in `--help` output

### Fixed

- Updated documentation and README with new features

## [0.1.2](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.2) - 2022-11-17

### Added

- Node 19 testing support

### Changed

- Improved documentation

## [0.1.1](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.1) - 2022-11-07

### Changed

- Extended README documentation

### Fixed

- Removed accidental debug code

## [0.1.0](https://github.com/SocketDev/socket-cli/releases/tag/v0.1.0) - 2022-11-07

### Added

- Initial Socket CLI release
- `socket info` for package security information
- `socket report create` for generating security reports
- Basic CLI infrastructure and configuration
