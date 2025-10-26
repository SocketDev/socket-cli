# Socket CLI Test Helpers

Comprehensive test helper library for Socket CLI, providing utilities for CLI execution, output validation, result assertions, and workspace management.

## Overview

This test helper library provides a fluent, type-safe API for testing Socket CLI functionality. It addresses common testing patterns and significantly reduces boilerplate code while improving test readability and maintainability.

## Quick Start

```typescript
import {
  executeCliCommand,
  expectOutput,
  createTestWorkspace
} from '../helpers/index.mts'

describe('socket scan', () => {
  it('should scan workspace successfully', async () => {
    const workspace = await createTestWorkspace({
      packageJson: {
        name: 'test-app',
        dependencies: { express: '^4.18.0' }
      }
    })

    const result = await executeCliCommand(['scan'], { cwd: workspace.path })

    expectOutput(result)
      .succeeded()
      .stdoutContains('express')
      .stderrEmpty()

    await workspace.cleanup()
  })
})
```

## Modules

### 1. CLI Execution (`cli-execution.mts`)

Execute Socket CLI commands with enhanced result handling and automatic configuration isolation.

**Key Functions:**
- `executeCliCommand(args, options)` - Execute CLI with enhanced result
- `expectCliSuccess(args, options)` - Assert command succeeds
- `expectCliError(args, expectedCode, options)` - Assert command fails
- `executeCliJson<T>(args, options)` - Execute and parse JSON output
- `executeCliWithRetry(args, maxRetries, delay, options)` - Retry on failure
- `executeBatchCliCommands(commands, options)` - Execute multiple commands
- `executeCliWithTiming(args, options)` - Measure execution time

**Example:**
```typescript
const { data, result } = await executeCliJson<ScanResult>(['scan', 'create'])
expect(data.id).toBeDefined()
```

### 2. Output Assertions (`output-assertions.mts`)

Fluent assertion API for validating CLI output with comprehensive matchers.

**Key Functions:**
- `expectOutput(result)` - Fluent assertion builder
- `expectStdoutContainsAll(output, expected)` - Validate multiple strings
- `expectOrderedPatterns(output, patterns)` - Validate pattern order
- `expectValidJson<T>(output)` - Validate and parse JSON
- `expectLineCount(output, expected)` - Validate line count
- `expectNoAnsiCodes(output)` - Validate plain text

**Example:**
```typescript
expectOutput(result)
  .succeeded()
  .stdoutContains('Usage')
  .stdoutContains(/options/i)
  .stderrEmpty()
```

### 3. Result Assertions (`result-assertions.mts`)

Type-safe assertions for Socket's `CResult<T>` pattern used throughout the CLI codebase.

**Key Functions:**
- `expectResult<T>(result)` - Fluent assertion builder
- `expectSuccess<T>(result)` - Extract data from success result
- `expectFailure<T>(result)` - Extract error from failure result
- `expectSuccessWithData<T>(result, expected)` - Validate success data
- `expectFailureWithMessage<T>(result, message, code)` - Validate error
- `expectAllSuccess<T>(results)` - Validate array of results
- `extractSuccessData<T>(results)` - Extract all success data
- `extractErrorMessages<T>(results)` - Extract all error messages

**Example:**
```typescript
expectResult(result)
  .isSuccess()
  .hasData()
  .dataContains({ id: 'scan-123' })
  .withData(data => {
    expect(data.status).toBe('completed')
  })
```

### 4. Workspace Helpers (`workspace-helper.mts`)

Create and manage temporary test workspaces with package manifests, lockfiles, and configurations.

**Key Functions:**
- `createTestWorkspace(config)` - Create temporary workspace
- `withTestWorkspace(config, testFn)` - Auto-cleanup workspace
- `createWorkspaceWithLockfile(packageManager, deps)` - Create with lockfile
- `createMonorepoWorkspace(packages)` - Create monorepo structure
- `createWorkspaceWithSocketConfig(config)` - Create with .socketrc.json
- `setupPackageJson(workspace, deps, devDeps)` - Setup package.json

**Example:**
```typescript
await withTestWorkspace(
  {
    packageJson: { name: 'test-app' },
    files: [{ path: 'index.js', content: 'console.log("hello")' }]
  },
  async (workspace) => {
    const result = await executeCliCommand(['scan'], { cwd: workspace.path })
    expect(result.status).toBe(true)
  }
)
```

### 5. Existing Helpers

The library also re-exports existing helpers:

- **constants.mts** - Test constants (timeouts, URLs, tokens)
- **environment.mts** - Test environment setup
- **fixtures.mts** - Test data fixtures
- **mocks.mts** - Mock SDK and API functions
- **test-fixtures.mts** - Temporary fixture management

## Benefits

### Code Reduction

Typical test savings:

| Pattern | Before | After | Lines Saved |
|---------|--------|-------|-------------|
| CLI Execution | 10-15 lines | 2-3 lines | 7-12 lines |
| Output Validation | 5-8 lines | 1-3 lines | 4-5 lines |
| Workspace Setup | 15-20 lines | 3-5 lines | 12-15 lines |
| Result Validation | 3-5 lines | 1-2 lines | 2-3 lines |

**Overall: 100-200 lines saved per 10 test files**

### Improved Readability

**Before:**
```typescript
const binPath = path.join(__dirname, '../../bin/cli.js')
const result = await spawn(process.execPath, [binPath, 'scan', '--json', '--config', '{}'])
expect(result.code).toBe(0)
const json = JSON.parse(stripAnsi(result.stdout.trim()))
expect(json.id).toBeDefined()
```

**After:**
```typescript
const { data, result } = await executeCliJson(['scan'])
expectOutput(result).succeeded()
expect(data.id).toBeDefined()
```

### Type Safety

All helpers are fully typed with TypeScript, providing:
- Autocomplete in IDEs
- Type checking for parameters
- Type inference for results
- Generic support for custom types

### Error Messages

Improved error messages that show:
- Expected vs actual values
- Command that was executed
- Full stdout/stderr output
- Stack traces with context

## Usage Patterns

### Basic CLI Test

```typescript
describe('socket scan', () => {
  it('should display help', async () => {
    const result = await expectCliSuccess(['scan', '--help'])

    expectOutput(result)
      .stdoutContains('Usage')
      .stdoutContains('Options')
  })
})
```

### JSON Output Test

```typescript
describe('socket scan --json', () => {
  it('should return JSON', async () => {
    const { data } = await executeCliJson<ScanResult>(['scan', 'create'])

    expect(data.id).toBeDefined()
    expect(data.status).toBe('completed')
  })
})
```

### Workspace Test

```typescript
describe('socket scan with workspace', () => {
  it('should scan dependencies', async () => {
    await withTestWorkspace(
      {
        packageJson: {
          dependencies: { express: '^4.18.0' }
        }
      },
      async (workspace) => {
        const result = await executeCliCommand(['scan'], {
          cwd: workspace.path
        })

        expectOutput(result)
          .succeeded()
          .stdoutContains('express')
      }
    )
  })
})
```

### Result Validation Test

```typescript
describe('SDK API calls', () => {
  it('should validate result', async () => {
    const result = await mockApiCall()

    expectResult(result)
      .isSuccess()
      .hasData()
      .dataContains({ id: 'scan-123' })
  })
})
```

### Error Handling Test

```typescript
describe('socket scan errors', () => {
  it('should handle invalid arguments', async () => {
    const result = await expectCliError(['scan'], 1)

    expectOutput(result)
      .stderrContains('Missing required')
      .exitCode(1)
  })
})
```

## Best Practices

### 1. Use Auto-Cleanup

Always use `withTestWorkspace` or explicit cleanup:

```typescript
// Good: Auto-cleanup
await withTestWorkspace(config, async (workspace) => {
  // test code
})

// Good: Explicit cleanup
const workspace = await createTestWorkspace(config)
try {
  // test code
} finally {
  await workspace.cleanup()
}
```

### 2. Isolate Configuration

Always use `isolateConfig: true` (default) to prevent user config pollution:

```typescript
// Good: Isolated (default)
await executeCliCommand(['scan'])

// Good: Explicit isolation
await executeCliCommand(['scan'], { isolateConfig: true })

// Risky: Uses user's config
await executeCliCommand(['scan'], { isolateConfig: false })
```

### 3. Use Fluent Assertions

Chain assertions for readability:

```typescript
// Good: Fluent and readable
expectOutput(result)
  .succeeded()
  .stdoutContains('express')
  .stdoutContains('lodash')
  .stderrEmpty()

// Bad: Verbose
expect(result.status).toBe(true)
expect(result.stdout).toContain('express')
expect(result.stdout).toContain('lodash')
expect(result.stderr).toBe('')
```

### 4. Type Your Results

Use generics for type safety:

```typescript
// Good: Type-safe
const { data } = await executeCliJson<ScanResult>(['scan'])
expect(data.id).toBeDefined() // TypeScript knows about 'id'

// Bad: No type safety
const { data } = await executeCliJson(['scan'])
expect((data as any).id).toBeDefined() // Manual casting
```

### 5. Use Descriptive Test Names

```typescript
// Good: Clear what's being tested
it('should display usage information with --help flag', async () => {
  // test
})

// Bad: Vague
it('should work', async () => {
  // test
})
```

## Testing the Helpers

Run the example tests to verify helpers work correctly:

```bash
pnpm run test test/helpers/example-usage.test.mts
```

## Migration Guide

See [examples.md](./examples.md) for detailed migration examples and before/after comparisons.

## API Documentation

Full API documentation with examples is available in:
- [examples.md](./examples.md) - Comprehensive usage examples
- Individual module files - JSDoc documentation

## Contributing

When adding new helpers:

1. **Follow existing patterns** - Use fluent APIs and type safety
2. **Add JSDoc comments** - Document parameters and return types
3. **Include examples** - Show usage in JSDoc
4. **Write tests** - Add to `example-usage.test.mts`
5. **Update examples.md** - Add comprehensive examples
6. **Export from index** - Add to `index.mts`

## License

Same as Socket CLI (MIT)

## Support

For issues or questions:
- Check [examples.md](./examples.md) for usage patterns
- Review existing tests in `test/` directory
- Open an issue in the Socket CLI repository
