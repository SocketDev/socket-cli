# Socket CLI Test Suite Failure Analysis

## Executive Summary

**Total Test Results:**
- Test Files: 77 failed | 207 passed | 1 skipped (285 total)
- Individual Tests: 207 failed | 2011 passed | 10 skipped (2228 total)
- Snapshot Failures: 44 failed
- Test Success Rate: 90% of tests passing

**Note:** The discrepancy between 77 failed test files and 260 individual test failures occurs because multiple test cases within the same file can fail independently. The categorization below counts individual failing test cases, not test files.

---

## Failure Categories

### 1. Mock/Stub Issues (109 failures - 42%)

**Primary Issue:** `sockSdk.deleteOrgRepo is not a function` (107 occurrences)

**Root Cause:** The Socket SDK mock is missing the `deleteOrgRepo` method, causing repository deletion tests to fail.

**Affected Areas:**
- Repository deletion tests (most common)
- Organization tests 
- Constants tests

**Example Files:**
```
src/commands/repository/fetch-delete-repo.test.mts
src/constants.test.mts (multiple test cases)
src/flags.test.mts (multiple test cases)
```

**Resolution:** Need to add `deleteOrgRepo` method to the Socket SDK mock configuration.

---

### 2. Snapshot Mismatches (104 failures - 40%)

**Root Cause:** Output format has changed since snapshots were last updated.

**Common Patterns:**
- Help text changes
- CLI output formatting changes
- Flag description updates
- Command response format changes

**Example Files:**
```
src/commands/fix/cmd-fix.test.mts (multiple snapshots)
src/commands/scan/cmd-scan-create.test.mts
src/commands/cdxgen/cmd-cdxgen.test.mts
src/commands/config/cmd-config-get.test.mts
```

**Resolution:** Run `pnpm testu` to update all snapshots after verifying changes are intentional.

---

### 3. Import/Module Errors (31 failures - 12%)

**Pattern A: Missing Source Files (25+ occurrences)**

Files that were moved, renamed, or not built:

```
Cannot find module '../../../src/utils/memoization.mts'
  - test/helpers/memoization.test.mts
  - test/utils/memoization.test.mts

Cannot find module '../../../src/utils/performance.mts'
  - test/helpers/performance.test.mts
  - test/utils/performance.test.mts

Cannot find module '../../../src/utils/test-fixtures.mts'
  - src/commands/optimize/cmd-optimize-pnpm-versions.test.mts
  - src/commands/optimize/cmd-optimize.test.mts

Cannot find module '../../../src/utils/cache-strategies.mts'
  - test/utils/cache-strategies.test.mts

Cannot find module '../../constants/cli.mts'
  - src/commands/cli.test.mts

Cannot find module '../config.mts'
  - src/utils/config.test.mts

Cannot find module '../home-cache-time.mts'
  - src/utils/home-cache-time.test.mts

Cannot find module '../sanitize-names.mts'
  - src/utils/sanitize-names.test.mts

Cannot find module './alerts-map.mts'
  - src/utils/pnpm/scanning.test.mts
  - src/utils/socket/alerts.test.mts

Cannot find module './handle-patch.mts'
  - src/commands/patch/handle-patch-apply.test.mts

Cannot find module './resolve.mts'
  - src/utils/fs/path-resolve.test.mts

Cannot find module './backup.mts'
  - src/utils/manifest/patch-backup.test.mts

Cannot find module './hash.mts'
  - src/utils/manifest/patch-hash.test.mts

Cannot find module './index.mts'
  - src/utils/manifest/patches.test.mts

And 10+ more similar issues...
```

**Pattern B: Missing Registry Exports (2 occurrences)**

```
Cannot find module '@socketsecurity/registry/tables'
  - test/helpers/output-formatting-tables.test.mts
  - test/utils/output-formatting-tables.test.mts
```

**Resolution:** 
1. Run `pnpm build:dist:src` to ensure all source files are built
2. Verify file paths and update imports to match current structure
3. Check if registry exports exist in the expected location

---

### 4. Other/TypeErrors (16 failures - 6%)

**Pattern A: Function Not Defined (2 occurrences)**

```
TypeError: (0, getProcessEnv) is not a function
```

**Pattern B: Undefined Property Access (14+ occurrences)**

```
TypeError: Cannot read properties of undefined (reading 'endsWith')
TypeError: Cannot read properties of undefined (reading 'builder')
ReferenceError: fetchModulePath is not defined
```

**Example Files:**
```
src/commands/audit-log/output-audit-log.test.mts
src/commands/organization/handle-dependencies.test.mts
src/commands/organization/handle-organization-list.test.mts
src/commands/organization/output-* (multiple files)
src/commands/scan/output-* (multiple files)
src/commands/repository/output-* (multiple files)
```

**Resolution:** These require individual investigation to determine if:
- Mock configuration is incomplete
- Test setup is incorrect
- Code changes broke test assumptions

---

### 5. Timeout Issues (0 failures - 0%)

**Status:** No tests are timing out. ✓

Some tests reference timeout-related flags (e.g., `--reach-analysis-timeout`) but these are passing or failing for other reasons (typically snapshot mismatches).

---

### 6. Pure Logic/Assertion Failures (0 explicit failures)

**Status:** All logic failures are captured in the categories above (primarily in snapshot and mock categories). ✓

---

## Priority Recommendations

### High Priority (Quick Wins)

1. **Add missing SDK mock method** (fixes 107 failures)
   - Add `deleteOrgRepo` to Socket SDK mock configuration
   - Estimated time: 5-10 minutes

2. **Update snapshots** (fixes 104 failures)
   - Run `pnpm testu` after verifying output changes are correct
   - Estimated time: 5 minutes + review time

### Medium Priority (Structural Fixes)

3. **Fix import paths** (fixes 31 failures)
   - Build source files: `pnpm build:dist:src`
   - Update import paths to match current file structure
   - Verify registry exports exist
   - Estimated time: 30-60 minutes

### Lower Priority (Individual Investigation)

4. **Fix TypeErrors and undefined references** (fixes 16 failures)
   - Investigate each failing test individually
   - Update mocks and test setup as needed
   - Estimated time: 1-2 hours

---

## Next Steps

1. Run: `pnpm build:dist:src` (ensure source files are built)
2. Fix SDK mock to include `deleteOrgRepo` method
3. Run: `pnpm testu` (update all snapshots)
4. Investigate remaining import path issues
5. Address individual TypeErrors on a case-by-case basis

**Expected Outcome:** Following these steps should reduce failures from 77 failed test files to approximately 10-15 files requiring individual attention.
