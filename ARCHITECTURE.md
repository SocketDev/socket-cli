# Socket CLI Architecture

## Overview

The Socket CLI is a TypeScript-based command-line tool for security analysis and package management. It's designed with modularity and maintainability in mind, using a clear separation of concerns.

## Directory Structure

```
socket-cli/
├── src/                      # Source code
│   ├── cli.mts              # Main CLI entry point
│   ├── commands.mts         # Command registry
│   ├── constants.mts        # Shared constants
│   ├── types.mts            # Type definitions
│   ├── commands/            # Command implementations
│   ├── utils/               # Shared utilities
│   ├── shadow/              # Package manager shadows
│   ├── sea/                 # Single Executable Application
│   └── external/            # External dependencies
├── bin/                     # Binary entry points
├── dist/                    # Compiled output
├── scripts/                 # Build and utility scripts
├── test/                    # Test files
└── .config/                 # Configuration files
```

## Core Concepts

### 1. Command Pattern
Each command follows a consistent pattern:
- `cmd-*.mts` - CLI interface and flag parsing
- `handle-*.mts` - Business logic implementation
- `output-*.mts` - Output formatting
- `fetch-*.mts` - API data fetching

### 2. Shadow Binaries
The CLI can act as a shadow for npm, npx, and pnpm, intercepting and enhancing their functionality:
- Located in `src/shadow/`
- Provides security scanning during package operations
- Transparent to the end user

### 3. Utils Organization
Utilities are grouped by function to reduce cognitive load:
- **API & Network** - API client and HTTP utilities
- **Error Handling** - Centralized error types and handlers
- **Output & Formatting** - Consistent output formatting
- **File System** - File operations and path handling
- **Package Management** - Package manager detection and operations

### 4. Constants Management
Constants are imported from `@socketsecurity/registry` and extended with CLI-specific values:
- Shared constants from registry
- CLI-specific constants
- Environment variables
- Configuration keys

## Key Design Patterns

### Result/Either Pattern
Used throughout for error handling:
```typescript
type CResult<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string; code?: number }
```

### Lazy Loading
Heavy dependencies are loaded only when needed to improve startup time.

### Configuration Cascade
Configuration is resolved in order:
1. Command-line flags
2. Environment variables
3. Local config file (.socketrc)
4. Global config file
5. Default values

## Build System

### Rollup Configuration
- Main build uses Rollup for tree-shaking and optimization
- Separate configs for different build targets
- JSON files are inlined during build

### TypeScript Compilation
- Uses `.mts` extensions for ES modules
- Compiled with `tsgo` for better performance
- Type definitions generated separately

## Testing Strategy

### Unit Tests
- Located alongside source files as `*.test.mts`
- Focus on individual function behavior
- Run with Vitest

### Integration Tests
- Located in `test/integration/`
- Test command flows end-to-end
- Mock external API calls

## Performance Considerations

### Startup Time
- Minimal dependencies loaded at startup
- Commands lazy-loaded on demand
- Constants use lazy getters

### Memory Usage
- Configurable memory limits via flags
- Streaming for large data sets
- Efficient caching strategies

## Security

### API Token Management
- Tokens never logged or displayed
- Stored securely in system keychain when possible
- Validated before use

### Package Scanning
- Real-time scanning during installs
- Comprehensive vulnerability database
- Configurable risk policies

## Extension Points

### Custom Commands
Commands can be added by:
1. Creating files in `src/commands/`
2. Following the command pattern
3. Registering in `src/commands.mts`

### Plugins
Future support planned for plugins via:
- Standard plugin interface
- Dynamic loading
- Isolated execution context

## Best Practices

1. **Keep files focused** - Single responsibility per file
2. **Use TypeScript strictly** - No `any` types without good reason
3. **Document exports** - JSDoc for all public APIs
4. **Test thoroughly** - Aim for high coverage
5. **Handle errors gracefully** - Use Result pattern
6. **Optimize imports** - Import only what's needed
7. **Follow patterns** - Consistency reduces cognitive load

## Common Tasks

### Adding a New Command
1. Create `src/commands/[name]/cmd-[name].mts`
2. Implement command logic in `handle-[name].mts`
3. Add output formatting in `output-[name].mts`
4. Register in `src/commands.mts`
5. Add tests

### Adding a Utility
1. Choose appropriate category in `src/utils/`
2. Create focused utility file
3. Export from category index if applicable
4. Document with JSDoc
5. Add unit tests

### Updating Constants
1. Check if constant exists in `@socketsecurity/registry`
2. If shared, add to registry
3. If CLI-specific, add to `src/constants.mts`
4. Use descriptive names
5. Group related constants