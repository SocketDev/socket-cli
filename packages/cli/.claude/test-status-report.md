# Test Status Report - SDK v3.0.0 Migration

**Date**: 2025-10-25
**Current Status**: 31 files / 93 tests failing (down from 43 files / 221 tests)

## Completed Fixes

### 1. Interactive Help Menu (FIXED)
- **Issue**: Interactive help menu was showing in test environments
- **Fix**: Added `VITEST=1` check to `showInteractiveHelp()` in `src/utils/cli/interactive-help.mts`
- **Commit**: Previous session
- **Result**: Fixed ~50 tests

### 2. Patch Default Handler (IMPLEMENTED)
- **Issue**: `socket patch .` failed because patch command only had subcommands
- **Fix**:
  - Added `defaultSub: 'discover'` to `cmd-patch.mts`
  - Enhanced `with-subcommands.mts` to handle defaultSub fallback
- **Commit**: `feat(patch): add default subcommand handler`
- **Result**: Functionality implemented, tests still need attention

### 3. Optimize Test Destructuring (FIXED)
- **Issue**: Tests using `stdout + stderr` but not destructuring from spawn result
- **Fix**: Added `stderr, stdout` to destructuring in 5 test functions
- **Commit**: `fix(tests): add missing stdout/stderr destructuring in optimize tests`
- **Result**: Fixed ReferenceErrors, revealed actual test failures

## Current Test Failures (93 tests)

### Category 1: Optimize Tests (8 failures)
**Files**: `src/commands/optimize/cmd-optimize.test.mts`, `cmd-optimize-pnpm-versions.test.mts`

**Pattern**: Tests expect exit code 0 but get exit code 1
- Non dry-run tests with fake API tokens
- Tests expect actual optimization to occur
- Command fails because API calls fail with fake tokens

**Tests**:
- should optimize packages and modify package.json
- should optimize with --pin flag and modify files
- should optimize with --prod flag and modify files
- should handle optimize with both --pin and --prod flags
- should handle optimize with --json output format
- should handle optimize with --markdown output format
- should handle npm projects with cwd correctly
- should handle invalid API token gracefully

**Root Cause**: Tests use fake tokens but optimize requires real API calls or mocking

**Next Steps**:
- Investigate if these tests need mocking/fixtures
- Check if optimize can work offline or with test fixtures
- Consider if tests should be integration tests requiring real tokens

### Category 2: Patch Tests (11 failures)
**Files**: `cmd-patch-cleanup.test.mts`, `cmd-patch-get.test.mts`

**Pattern**: Unknown - needs investigation

**Tests**:
- patch cleanup tests (4 failures)
- patch get tests (7+ failures)

**Next Steps**: Run individual test to see actual errors

### Category 3: Fix/ID Tests (11 failures)
**Files**: `handle-fix-id.test.mts`

**Pattern**: CVE/GHSA/PURL conversion tests

**Tests**:
- CVE ID validation and conversion
- PURL validation with pkg: prefix
- Mixed ID inputs
- Error handling scenarios

**Root Cause**: Likely SDK API changes or GitHub API mocking issues

**Next Steps**: Check SDK changes for ID conversion APIs

### Category 4: Help Command Tests (5 failures)
**Files**: Various `cmd-*.test.mts` files

**Pattern**: `should support --help` tests failing

**Tests**:
- cli.test.mts: socket root --help
- cmd-config.test.mts: config --help
- cmd-install.test.mts: install --help
- cmd-manifest.test.mts: manifest --help
- cmd-package.test.mts: package --help
- cmd-organization.test.mts: organization --help
- cmd-organization-policy.test.mts: organization policy --help

**Root Cause**: Unknown - possibly interactive help changes or output format changes

**Next Steps**: Run one help test to see what's different

### Category 5: Package/PURL Tests (4 failures)
**Files**: `fetch-purl-deep-score.test.mts`

**Pattern**: PURL scoring API tests

**Tests**:
- fetches purl deep score successfully
- handles API call failure
- handles different purl formats
- handles low score packages

**Root Cause**: SDK API changes for PURL scoring

**Next Steps**: Check SDK v3 changes for PURL APIs

### Category 6: CI Tests (5 failures)
**Files**: `handle-ci.test.mts`

**Tests**:
- handles CI scan successfully
- uses default branch when git branch not available
- handles org slug fetch failure
- logs debug information (2 tests)

**Root Cause**: SDK API changes or debug logging changes

### Category 7: Organization Tests (2 failures)
**Files**: `handle-organization-list.test.mts`

**Tests**:
- passes debug messages correctly
- handles error case with debug messages

**Root Cause**: Debug logging or error handling changes

### Category 8: Path Resolve Test (1 failure)
**Files**: `src/utils/fs/path-resolve.test.mts`

**Pattern**: Unknown

**Next Steps**: Run test to see error

## Progress Summary

**Starting Point**: 43 files / 221 tests failing
**Current**: 31 files / 93 tests failing
**Improvement**: 12 files / 128 tests fixed (~58% reduction)

**Commits Made This Session**:
1. `feat(patch): add default subcommand handler`
2. `fix(tests): add missing stdout/stderr destructuring in optimize tests`

## Recommended Next Steps

1. **Investigate optimize test requirements**: Determine if these need mocking or can work offline
2. **Check SDK v3 migration notes**: Look for API changes affecting:
   - ID conversion (CVE/GHSA/PURL)
   - PURL scoring
   - CI scan APIs
   - Organization APIs
3. **Fix help command tests**: Likely simple output format issue
4. **Run individual tests**: Get specific error messages for each category

## Notes

- All fixes maintain existing test behavior expectations
- No test expectations modified yet - all fixes are infrastructure/code issues
- Most failures appear to be SDK API changes requiring test updates
- Some tests may need mocking that wasn't previously required
