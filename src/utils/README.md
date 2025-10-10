# Utils Directory Organization Guide

## Directory Structure

The utils directory contains shared utilities used across the Socket CLI. To reduce cognitive load, utilities are organized by their primary function:

### API & Network (`api-*.mts`, `http.mts`)
- `api.mts` - Main API client and request handling
- `api-types.mts` - TypeScript types for API responses
- `api-wrapper.mts` - High-level API wrapper functions
- `http.mts` - HTTP utilities and helpers

### Command & CLI (`cmd-*.mts`, `meow-*.mts`)
- `cmd.mts` - Command execution utilities
- `command-builder.mts` - Build command structures
- `command-logger.mts` - Log command execution
- `meow-with-subcommands.mts` - Meow CLI framework extensions

### Error Handling (`error-*.mts`, `fail-*.mts`)
- `errors.mts` - Error type definitions
- `error-display.mts` - Format errors for display
- `error-filter.mts` - Filter and categorize errors
- `error-handler.mts` - Central error handling
- `fail-msg-with-badge.mts` - Format failure messages
- `result.mts` - Result/Either pattern implementation

### Output & Formatting (`output*.mts`, `*format*.mts`, `color*.mts`)
- `output.mts` - Main output handler
- `output-formatting.mts` - Format output for different modes
- `simple-output.mts` - Simplified output helpers
- `color-or-markdown.mts` - Choose between colored or markdown output
- `markdown.mts` - Markdown formatting utilities

### File System (`fs.mts`, `glob.mts`, `path*.mts`)
- `fs.mts` - File system operations
- `glob.mts` - File globbing utilities
- `path-resolve.mts` - Path resolution helpers

### Package Management (`package-*.mts`, `npm-*.mts`, `pnpm.mts`)
- `package-manager.mts` - Detect and use package managers
- `package-environment.mts` - Package environment detection
- `npm-config.mts` - NPM configuration utilities
- `pnpm.mts` - PNPM-specific utilities

### Process & Execution (`process-*.mts`, `spawn.mts`)
- `process-runner.mts` - Run processes with retries
- `spawn.mts` - Spawn child processes
- `coana-spawn.mts` - Spawn Coana processes
- `shadow-runner.mts` - Run shadow binaries

### Git & Version Control (`git*.mts`)
- `git.mts` - Git operations
- `git-url.mts` - Parse and build git URLs
- `github.mts` - GitHub API utilities

### Security & Validation (`socket-*.mts`, `purl*.mts`)
- `socket-package-alert.mts` - Package security alerts
- `purl.mts` - Package URL (PURL) utilities
- `purl-to-ghsa.mts` - Convert PURLs to GitHub Security Advisories

### Configuration (`config*.mts`, `filter-*.mts`)
- `config.mts` - Main configuration loader
- `filter-config.mts` - Filter configuration options
- `registry.mts` - Package registry utilities

### Interactive & UI (`ink*.mts`, `bordered-*.mts`, `ask-*.mts`)
- `ink.mts` - Ink React components
- `bordered-input.mts` - Bordered input components
- `ask-mode.mts` - Interactive prompt mode

### Update & Version Management (`update-*.mts`)
- `update-checker.mts` - Check for CLI updates
- `update-manager.mts` - Manage CLI updates

### Caching (`cache-*.mts`)
- `cache-strategies.mts` - Different caching strategies

### Utilities & Helpers
- `alerts-map.mts` - Map alert types to display
- `check-input.mts` - Validate user input
- `constants-runtime.mts` - Runtime constants
- `debug.mts` - Debug utilities
- `dlx-*.mts` - DLX (package runner) utilities
- `log.mts` - Logging utilities
- `objects.mts` - Object manipulation utilities
- `normalize-options.mts` - Normalize command options
- `requirements.mts` - API requirements configuration
- `sdk.mts` - Socket SDK utilities
- `serialize-*.mts` - Serialization utilities
- `translations.mts` - Alert translations
- `visitor.mts` - AST visitor pattern utilities

## Best Practices

1. **Group imports** - Import related utilities together
2. **Use specific imports** - Import only what you need
3. **Avoid circular dependencies** - Check imports carefully
4. **Keep utilities focused** - Each file should have a single responsibility
5. **Document exports** - Use JSDoc for public functions

## Common Patterns

### Error Handling
```typescript
import { InputError, AuthError } from './utils/errors.mts'
import { outputError } from './utils/error-display.mts'
```

### Output Formatting
```typescript
import { outputResult } from './utils/output.mts'
import { formatMarkdown } from './utils/markdown.mts'
```

### API Calls
```typescript
import { setupSdk } from './utils/sdk.mts'
import { apiWrapper } from './utils/api-wrapper.mts'
```