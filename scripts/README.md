# Socket CLI Build Scripts

This directory contains all build, test, and utility scripts for the Socket CLI project.

## Directory Structure

```
scripts/
├── build/           # Binary building and compilation scripts
├── babel/           # Babel plugins and transformations
├── rollup/          # Rollup plugins and configurations
├── utils/           # Shared utilities
└── *.mjs           # Top-level command scripts
```

## Top-Level Scripts

### Core Commands
- `build.mjs` - Main build orchestrator
- `test.mjs` - Test runner with coverage
- `lint.mjs` - Code linting
- `check.mjs` - Run all checks (lint, types, tests)
- `clean.mjs` - Clean build artifacts
- `fix.mjs` - Auto-fix code issues

### Publishing
- `publish.mjs` - Publish to npm
- `publish-yao.mjs` - Publish yao-pkg binaries
- `publish-sea.mjs` - Publish SEA binaries
- `bump.mjs` - Version bumping

### Utilities
- `cover.mjs` - Generate coverage reports
- `taze.mjs` - Update dependencies
- `update.mjs` - Update various project files
- `claude.mjs` - AI assistant integration

## Subdirectories

### `/build`
Binary building infrastructure:
- `build-binary.mjs` - Build standalone binaries
- `build-stub.mjs` - Build stub/SEA binaries
- `build-socket-node.mjs` - Build custom Node.js
- `code-signing.mjs` - Centralized code signing
- `post-process.mjs` - Binary post-processing
- See [build/README.md](build/README.md) for details

### `/babel`
Custom Babel plugins:
- `babel-plugin-inline-const-enum.mjs` - Inline const enums
- `babel-plugin-inline-process-env.mjs` - Inline environment variables
- `babel-plugin-remove-icu.mjs` - Remove ICU imports
- `babel-plugin-strict-mode.mjs` - Add strict mode
- `babel-plugin-strip-debug.mjs` - Strip debug code
- `transform-set-proto-plugin.mjs` - Transform __proto__ usage
- `transform-url-parse-plugin.mjs` - Transform URL parsing

### `/rollup`
Rollup build plugins:
- `socket-modify-plugin.mjs` - Socket-specific modifications
- `transform-ink-plugin.mjs` - Transform Ink React components

### `/utils`
Shared utilities:
- `changed-test-mapper.mjs` - Map changed files to tests
- `coverage.mjs` - Coverage utilities
- `fs.mjs` - File system helpers
- `git.mjs` - Git operations
- `packages.mjs` - Package management
- `path-helpers.mjs` - Path utilities
- `run-command.mjs` - Command execution
- `suppress-warnings.mjs` - Warning suppression
- `tests.mjs` - Test utilities
- `trash.mjs` - Safe file deletion

## Common Patterns

### Script Structure
Most scripts follow this pattern:
```javascript
#!/usr/bin/env node
import { parseArgs } from 'node:util'
// ... imports

async function main() {
  const { values } = parseArgs({
    options: { /* ... */ }
  })

  // Script logic
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}
```

### Shared Constants
Common constants are in `constants.mjs`:
```javascript
import { ROOT_DIR, BUILD_DIR, DIST_DIR } from './constants.mjs'
```

### Logging
Use the centralized logger:
```javascript
import { logger } from './logger.mjs'

logger.log('Info message')
logger.success('Success message')
logger.warn('Warning message')
logger.error('Error message')
```

## Usage Examples

### Build the project
```bash
node scripts/build.mjs
```

### Run tests with coverage
```bash
node scripts/test.mjs --coverage
```

### Build a binary for specific platform
```bash
node scripts/build/build-binary.mjs --platform=linux --arch=x64
```

### Clean all build artifacts
```bash
node scripts/clean.mjs
```

### Check code (lint + types + tests)
```bash
node scripts/check.mjs
```

## Code Signing

All code signing is centralized in `build/code-signing.mjs`. See [CODE_SIGNING.md](../docs/CODE_SIGNING.md) for detailed documentation.

## Environment Variables

Key environment variables used by scripts:

- `CI` - Set in CI environments
- `GITHUB_ACTIONS` - GitHub Actions specific
- `NODE_ENV` - Development/production mode
- `WINDOWS_CERT_PATH` - Windows signing certificate
- `WINDOWS_CERT_PASSWORD` - Certificate password

## Dependencies

Scripts use both project dependencies and some global tools:

### Required npm packages
- `yoctocolors-cjs` - Terminal colors
- `@yao-pkg/pkg` - Binary packaging
- `rollup` - Module bundling
- `vitest` - Test runner

### Optional system tools
- `codesign` - macOS code signing
- `ldid` - Alternative macOS signing
- `signtool` - Windows signing
- `gpg` - Linux signing
- `upx` - Binary compression

## Adding New Scripts

1. Create `.mjs` file in appropriate directory
2. Add shebang: `#!/usr/bin/env node`
3. Use ES modules and async/await
4. Follow existing patterns for argument parsing
5. Document in this README

## Maintenance

- Keep scripts focused on single responsibilities
- Extract shared logic to `/utils`
- Use TypeScript-compatible JSDoc comments
- Test scripts with `--dry-run` when applicable
- Document any external tool requirements