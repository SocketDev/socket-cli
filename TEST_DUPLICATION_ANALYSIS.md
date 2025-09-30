# Test Duplication Analysis - Socket CLI

## Summary

This document analyzes test duplication across the Socket CLI codebase, identifying significant opportunities for consolidation and improved maintainability.

## Major Duplications Found

### 1. Package Manager Malware Detection Tests (Highest Priority)

**Files with nearly identical malware tests:**
- `src/commands/npm/cmd-npm-malware.test.mts`
- `src/commands/npx/cmd-npx-malware.test.mts`
- `src/commands/pnpm/cmd-pnpm-malware.test.mts`
- `src/commands/yarn/cmd-yarn-malware.test.mts`

**Duplication Details:**
- All four files test the exact same malware detection functionality with nearly identical structure
- Each tests: `malware` issueRule, `gptMalware` issueRule, multiple issueRules, and `-c` vs `--config` flags
- Only differences are the command name (`npm exec`, `npx`, `pnpm exec`, `yarn dlx`) and specific command aliases
- All expect the same `"[DryRun]: Bailing now"` output and exit code 0
- Each file has 4-7 nearly identical test cases with the same pattern

**Example duplicated test pattern:**
```typescript
cmdit(
  ['[COMMAND]', 'evil-test-package@1.0.0', FLAG_DRY_RUN, '-c',
   '{"apiToken":"fakeToken","issueRules":{"malware":true}}'],
  'should handle [COMMAND] with -c flag and malware issueRule for evil-test-package',
  async cmd => {
    const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
    expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
    expect(code, 'dry-run [COMMAND] with -c should exit with code 0').toBe(0)
  },
)
```

### 2. Config Command Help Text Duplication

**Files with identical config key documentation:**
- `src/commands/config/cmd-config-get.test.mts`
- `src/commands/config/cmd-config-set.test.mts`
- `src/commands/config/cmd-config-unset.test.mts`
- `src/commands/config/cmd-config-auto.test.mts`

**Duplication Details:**
- All contain identical help text listing all config keys with descriptions
- Same documentation repeated verbatim for: `apiBaseUrl`, `apiProxy`, `apiToken`, `defaultOrg`, `enforcedOrgs`, `org`, `skipAskToPersistDefaultOrg`
- Multiple tests for environment variable handling that are nearly identical across config commands

### 3. Universal Command Test Patterns (65+ files affected)

**Patterns repeated across nearly all command test files:**

**Help Flag Test Pattern (65 files):**
```typescript
cmdit(
  ['[COMMAND]', FLAG_HELP, FLAG_CONFIG, '{}'],
  `should support ${FLAG_HELP}`,
  async cmd => {
    const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
    // ... identical structure
    expect(code, 'explicit help should exit with code 0').toBe(0)
    expect(stderr, 'banner includes base command').toContain('`socket [COMMAND]`')
  },
)
```

**Dry-run Validation Pattern (53 files):**
```typescript
cmdit(
  ['[COMMAND]', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
  'should require args with just dry-run',
  async cmd => {
    // ... nearly identical test logic
  },
)
```

**Common Setup Pattern (70+ files):**
```typescript
describe('[command name]', async () => {
  const { binCliPath } = constants
  // ... rest of tests
})
```

### 4. Banner and Output Assertion Duplication

**Repeated assertions (62 files):**
- `expect(stderr, 'banner includes base command').toContain('[command]')`
- `expect(code, 'explicit help should exit with code 0').toBe(0)`
- Multiple identical CLI banner assertions across tests

### 5. Dry-run Output Pattern (147+ occurrences)

- `expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')` appears 147+ times
- `expect(stdout).toMatchInlineSnapshot('"[DryRun]: No-op, call a sub-command; ok"')` - common variant

## Recommendations for Consolidation

### 1. Create Shared Test Utilities

```typescript
// test/shared-command-tests.mts
export function testCommandHelpFlag(command: string[], expectedHelpText: string) { ... }
export function testCommandDryRun(command: string[], expectedBehavior: string) { ... }
export function testMalwareDetection(packageManager: string, commands: string[][]) { ... }
```

### 2. Extract Config Key Documentation

- Move config key descriptions to a shared constant
- Reference from all config command tests
- Reduces 4x duplication to single source

### 3. Create Malware Test Generator

- Create a parameterized test that takes package manager name and command variants
- Reduce 4 separate files to 1 shared test suite with parameters

### 4. Consolidate Common Assertions

- Extract banner validation, exit code checks, and common output patterns
- Create utility functions for frequent assertion patterns

### 5. Suggested File Structure

```
test/
  shared/
    command-test-patterns.mts    # Help, dry-run, banner tests
    malware-test-suite.mts      # Parameterized malware tests
    config-documentation.mts    # Shared config key docs
    assertion-utils.mts         # Common assertion patterns
```

## Impact Assessment

### Benefits of Consolidation

- **Reduced maintenance burden**: Changes to common patterns only need to be made once
- **Improved consistency**: Shared utilities ensure uniform test behavior
- **Better test coverage**: Easier to ensure all commands have consistent test patterns
- **Reduced codebase size**: Eliminate thousands of lines of duplicated code

### Risks to Consider

- **Test isolation**: Ensure shared utilities don't introduce dependencies between tests
- **Test clarity**: Balance DRY principles with test readability
- **Migration effort**: Significant refactoring required for existing tests

## Priority Order for Consolidation

1. **High Priority**: Malware detection tests (4 files, highest duplication)
2. **Medium Priority**: Config documentation (4 files, easy win)
3. **Medium Priority**: Universal command patterns (65+ files, largest impact)
4. **Low Priority**: Common assertions and output patterns

## Conclusion

The Socket CLI test suite has significant duplication, particularly in malware detection tests and universal command patterns. The most impactful consolidation would be creating shared test utilities for the malware detection functionality and common command test patterns. This would reduce maintenance burden while improving test consistency across the codebase.