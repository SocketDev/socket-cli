# SDK v3.0.0: File Validation with Callback Pattern

## Executive Summary

Add automatic file validation in `uploadManifestFiles()` and `createOrgFullScan()` with callback hooks for custom error handling. This protects all SDK consumers while giving CLI control over error messages.

## Problem Statement

**Current State:**
- SDK reads files without validation
- Yarn Berry PnP virtual filesystem causes ENOENT errors
- pnpm symlinks fail in restricted environments
- Each consumer (CLI, CI tools) must implement own validation

**Desired State:**
- SDK validates files automatically before reading
- Consumers can customize error messages via callbacks
- Consistent behavior across all SDK operations
- Backward compatible with existing code

## Design: Hook/Callback Pattern

### API Design

```typescript
/**
 * Result from file validation callback.
 * Allows consumers to customize error handling and logging.
 */
export interface FileValidationResult {
  /**
   * Whether to continue with the operation using validated files.
   * If false, the SDK operation will fail with the provided error message.
   */
  shouldContinue: boolean

  /**
   * Optional custom error message if shouldContinue is false.
   * If not provided, SDK will use default error message.
   */
  errorMessage?: string

  /**
   * Optional cause/reason for the error.
   */
  errorCause?: string
}

/**
 * Callback invoked when file validation detects unreadable files.
 * Gives consumers control over error messages and logging.
 *
 * @param validPaths - Files that passed validation (readable)
 * @param invalidPaths - Files that failed validation (unreadable)
 * @param context - Context about the operation (command, orgSlug, etc.)
 * @returns Decision on whether to continue and optional custom error messages
 */
export type FileValidationCallback = (
  validPaths: string[],
  invalidPaths: string[],
  context: {
    operation: 'uploadManifestFiles' | 'createOrgFullScan'
    orgSlug?: string
    [key: string]: unknown
  }
) => FileValidationResult | Promise<FileValidationResult>

/**
 * SDK initialization options (extended for v3.0.0).
 */
export interface SocketSdkOptions {
  apiToken?: string
  apiBaseUrl?: string
  timeout?: number

  /**
   * Callback for file validation events.
   * Called when uploadManifestFiles or createOrgFullScan detects unreadable files.
   *
   * Default behavior (if not provided):
   * - Logs warning for skipped files
   * - Continues with validated files if any exist
   * - Throws error if all files are skipped
   *
   * @since v3.0.0
   */
  onFileValidation?: FileValidationCallback
}
```

### Implementation in SDK

```typescript
// In sdk/src/socket-sdk-class.ts

class SocketSdk {
  #apiToken: string
  #apiBaseUrl: string
  #timeout: number
  #onFileValidation?: FileValidationCallback

  constructor(options: SocketSdkOptions) {
    this.#apiToken = options.apiToken ?? ''
    this.#apiBaseUrl = options.apiBaseUrl ?? 'https://api.socket.dev/v0/'
    this.#timeout = options.timeout ?? 30000
    this.#onFileValidation = options.onFileValidation
  }

  async uploadManifestFiles(
    orgSlug: string,
    filepaths: string[]
  ): Promise<SocketSdkResult<'uploadManifestFiles'>> {
    // Validate file readability.
    const { validPaths, invalidPaths } = validateFiles(filepaths)

    // If validation callback provided, invoke it.
    if (this.#onFileValidation && invalidPaths.length > 0) {
      const result = await this.#onFileValidation(
        validPaths,
        invalidPaths,
        {
          operation: 'uploadManifestFiles',
          orgSlug,
        }
      )

      if (!result.shouldContinue) {
        return {
          ok: false,
          message: result.errorMessage ?? 'File validation failed',
          cause: result.errorCause ?? 'Some files could not be read',
        }
      }
    }

    // Default behavior if no callback.
    if (invalidPaths.length > 0 && !this.#onFileValidation) {
      // Log warning but continue with validated files.
      console.warn(
        `Warning: ${invalidPaths.length} files skipped (unreadable). ` +
        `This may occur with Yarn Berry PnP or pnpm symlinks.`
      )
    }

    // Fail if all files were skipped.
    if (validPaths.length === 0) {
      return {
        ok: false,
        message: 'No readable manifest files found',
        cause:
          'All files failed validation. This may occur with Yarn Berry PnP virtual filesystem. ' +
          'Try: Run `yarn install` or use `nodeLinker: node-modules` in .yarnrc.yml',
      }
    }

    // Continue with validated files.
    return await this.#uploadManifestFilesInternal(orgSlug, validPaths)
  }

  createOrgFullScan(
    orgSlug: string,
    packagePaths: string[],
    options?: CreateOrgFullScanOptions
  ): Promise<SocketSdkResult<'CreateOrgFullScan'>> {
    // Similar validation pattern.
    const { validPaths, invalidPaths } = validateFiles(packagePaths)

    if (this.#onFileValidation && invalidPaths.length > 0) {
      const result = await this.#onFileValidation(
        validPaths,
        invalidPaths,
        {
          operation: 'createOrgFullScan',
          orgSlug,
          ...options,
        }
      )

      if (!result.shouldContinue) {
        return {
          ok: false,
          message: result.errorMessage ?? 'File validation failed',
          cause: result.errorCause ?? 'Some files could not be read',
        }
      }
    }

    // Default behavior (same as uploadManifestFiles).
    if (invalidPaths.length > 0 && !this.#onFileValidation) {
      console.warn(`Warning: ${invalidPaths.length} files skipped (unreadable)`)
    }

    if (validPaths.length === 0) {
      return {
        ok: false,
        message: 'No readable manifest files found',
        cause: 'All files failed validation',
      }
    }

    return await this.#createOrgFullScanInternal(orgSlug, validPaths, options)
  }
}
```

### Usage in Socket CLI

```typescript
// In socket-cli/src/utils/socket/sdk.mts

import { validateFiles } from '@socketsecurity/lib/fs'
import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'
import { debug } from '@socketsecurity/lib/debug'

export async function setupSdk(options?: SetupSdkOptions): Promise<CResult<SocketSdk>> {
  const apiToken = getDefaultApiToken()
  const apiBaseUrl = getDefaultApiBaseUrl()

  const sockSdk = new SocketSdk({
    apiToken,
    apiBaseUrl,

    // SDK v3.0.0: Custom file validation callback.
    onFileValidation: (validPaths, invalidPaths, context) => {
      if (invalidPaths.length > 0) {
        // CLI-specific logging.
        logger.warn(
          `Skipped ${invalidPaths.length} ${pluralize('file', { count: invalidPaths.length })} that could not be read`
        )
        debug('Skipped files may be in Yarn Berry virtual FS, pnpm symlinks, or excluded by .gitignore')

        // Log each skipped file in debug mode.
        for (const filepath of invalidPaths) {
          debug(`Skipped unreadable file: ${filepath}`)
        }
      }

      // Continue if we have at least one valid file.
      if (validPaths.length > 0) {
        return {
          shouldContinue: true,
        }
      }

      // No valid files - provide CLI-specific error message.
      return {
        shouldContinue: false,
        errorMessage: 'No readable manifest files found',
        errorCause:
          'All discovered files could not be read.\n' +
          'This may occur with:\n' +
          '  - Yarn Berry PnP: Run `yarn install` or use `nodeLinker: node-modules` in .yarnrc.yml\n' +
          '  - pnpm: Check symlink permissions in your environment\n' +
          '  - CI/CD: Ensure files are properly checked out and accessible\n' +
          '  - Report issue with project details: https://github.com/SocketDev/socket-cli/issues',
      }
    },
  })

  return { ok: true, data: sockSdk }
}
```

### Alternative: Simpler Callback (Optional)

If the full callback pattern is too complex, we can use a simpler approach:

```typescript
export interface SocketSdkOptions {
  // ... existing options

  /**
   * Optional logger for file validation warnings.
   * If not provided, SDK will use console.warn.
   * Set to null to disable validation warnings.
   *
   * @since v3.0.0
   */
  fileValidationLogger?: ((message: string) => void) | null
}

// Usage in CLI:
const sockSdk = new SocketSdk({
  apiToken,
  apiBaseUrl,
  fileValidationLogger: (message) => {
    logger.warn(message)
    debug('See https://github.com/SocketDev/socket-cli/issues for support')
  },
})
```

## Benefits

### For SDK
- ✅ Automatic protection against ENOENT errors
- ✅ Consistent validation across all file operations
- ✅ Backward compatible (callback is optional)
- ✅ Single source of truth for validation logic

### For CLI
- ✅ Custom error messages with CLI branding
- ✅ Integration with CLI logger (colors, formatting)
- ✅ Control over warning/error thresholds
- ✅ Debug mode support for detailed logging

### For Other Consumers
- ✅ Default behavior works out of the box
- ✅ Can customize for their logging framework
- ✅ Protection without any changes required

## Backward Compatibility

**v3.0.0 is a breaking change**, but the validation callback is **optional**:

```typescript
// v2.x code (still works in v3.0.0)
const sdk = new SocketSdk({ apiToken })
await sdk.uploadManifestFiles(orgSlug, files)
// ✅ Works with default behavior (warns + continues)

// v3.0.0 code (with custom callback)
const sdk = new SocketSdk({
  apiToken,
  onFileValidation: (valid, skipped, ctx) => {
    // Custom handling
    return { shouldContinue: valid.length > 0 }
  }
})
await sdk.uploadManifestFiles(orgSlug, files)
// ✅ Uses custom callback
```

## Testing Strategy

### Unit Tests (SDK)
```typescript
describe('SocketSdk file validation', () => {
  it('should validate files before upload', async () => {
    const sdk = new SocketSdk({ apiToken: 'test' })
    const files = ['/real/package.json', '/virtual/.pnp.cjs/file.json']

    // Mock validateFiles to return skipped files
    const result = await sdk.uploadManifestFiles('org', files)

    expect(result.ok).toBe(true) // Should succeed with valid files
  })

  it('should invoke callback when files are skipped', async () => {
    const callback = vi.fn(() => ({ shouldContinue: true }))
    const sdk = new SocketSdk({
      apiToken: 'test',
      onFileValidation: callback,
    })

    await sdk.uploadManifestFiles('org', ['/unreadable.json'])

    expect(callback).toHaveBeenCalledWith(
      [], // no valid files
      ['/unreadable.json'], // skipped
      expect.objectContaining({ operation: 'uploadManifestFiles' })
    )
  })

  it('should fail when callback returns shouldContinue: false', async () => {
    const sdk = new SocketSdk({
      apiToken: 'test',
      onFileValidation: () => ({
        shouldContinue: false,
        errorMessage: 'Custom error',
        errorCause: 'Custom cause',
      }),
    })

    const result = await sdk.uploadManifestFiles('org', ['/file.json'])

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Custom error')
    expect(result.cause).toBe('Custom cause')
  })
})
```

### Integration Tests (CLI)
```typescript
describe('socket scan with file validation', () => {
  it('should warn about skipped Yarn Berry files', async () => {
    // Create Yarn Berry project with .pnp.cjs
    const workspace = await createYarnBerryWorkspace()

    const { result } = await executeCliCommand(['scan', 'create'])

    expectOutput(result).stdoutContains('Skipped')
    expectOutput(result).stdoutContains('could not be read')
  })

  it('should fail when all files are unreadable', async () => {
    // Setup workspace with only unreadable files
    const workspace = await createWorkspaceWithUnreadableFiles()

    const { result } = await executeCliCommand(['scan', 'create'])

    expectOutput(result).failed()
    expectOutput(result).stderrContains('No readable manifest files')
  })
})
```

## Rollout Plan

### Phase 1: SDK v3.0.0 (socket-sdk-js)
1. Add `validateFiles` import from `@socketsecurity/lib/fs`
2. Add `onFileValidation` callback to `SocketSdkOptions`
3. Implement validation in `uploadManifestFiles()`
4. Implement validation in `createOrgFullScan()`
5. Add unit tests for validation logic
6. Add callback tests
7. Update SDK documentation

### Phase 2: CLI Integration (socket-cli)
1. Update to socket-sdk v3.0.0
2. Implement `onFileValidation` callback in `setupSdk()`
3. Remove manual validation from `coana-fix.mts` (now handled by SDK)
4. Add integration tests with Yarn Berry workspace
5. Update CLI documentation

### Phase 3: Validation (Post-Deployment)
1. Monitor Sentry for ENOENT errors (should decrease)
2. Track callback invocations via telemetry
3. Gather feedback from enterprise customers using Yarn Berry

## Open Questions

1. **Should the callback be sync or async?**
   - **Recommendation**: Async (Promise<FileValidationResult>) for flexibility
   - Allows CLI to fetch additional context if needed

2. **Should we validate all file operations or just uploads?**
   - **Recommendation**: Just uploads/scans (operations that read multiple files)
   - Don't validate single-file reads (too invasive)

3. **Should we track which package manager caused skipped files?**
   - **Recommendation**: Add to context object for telemetry
   - Helps us understand which PM has the most issues

4. **Should the default behavior fail or warn?**
   - **Recommendation**: Warn and continue if some files valid, fail if all skipped
   - Most forgiving while still preventing broken uploads

5. **Should we expose validateFiles as a public SDK method?**
   - **Recommendation**: Yes, export from SDK for consumers who want manual validation
   - Useful for testing and custom workflows

## Migration Guide

### For CLI Maintainers

**Before (manual validation in CLI)**:
```typescript
// coana-fix.mts
const { validPaths, invalidPaths } = validateFiles(files)
if (invalidPaths.length > 0) {
  logger.warn(`Skipped ${invalidPaths.length} files`)
}
await sockSdk.uploadManifestFiles(orgSlug, validPaths)
```

**After (callback in SDK)**:
```typescript
// utils/socket/sdk.mts
const sockSdk = new SocketSdk({
  apiToken,
  onFileValidation: (valid, skipped, ctx) => {
    if (skipped.length > 0) {
      logger.warn(`Skipped ${skipped.length} files`)
    }
    return { shouldContinue: valid.length > 0 }
  }
})

// coana-fix.mts (no manual validation needed)
await sockSdk.uploadManifestFiles(orgSlug, files)
```

### For External Consumers

**No changes required** - default behavior handles validation automatically.

**Optional customization**:
```typescript
const sdk = new SocketSdk({
  apiToken: process.env.SOCKET_API_TOKEN,

  // Add custom logging to your framework
  onFileValidation: (valid, skipped) => {
    if (skipped.length > 0) {
      myLogger.warning(`${skipped.length} files skipped`)
    }
    return { shouldContinue: valid.length > 0 }
  }
})
```

## Timeline

- **Week 1**: Implement validation in socket-lib (John-David + team)
- **Week 2**: Implement SDK callback pattern (John-David + team)
- **Week 3**: SDK unit tests + documentation
- **Week 4**: CLI integration + testing
- **Week 5**: Beta testing with Yarn Berry projects
- **Week 6**: GA release (SDK v3.0.0 + CLI update)

## Success Metrics

- ✅ Reduction in ENOENT errors (Sentry alerts)
- ✅ Zero reported Yarn Berry issues after release
- ✅ Successful uploads from pnpm in CI environments
- ✅ Positive feedback from enterprise customers

---

**Status**: Design complete, awaiting approval from John-David.
**Next Step**: Implement in socket-sdk-js repo.
