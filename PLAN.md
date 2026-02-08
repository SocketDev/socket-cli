# Implementation Plan: Node v25.5.0 Update and binject --update-config Integration

## Overview

This plan details the steps to update Socket CLI to use Node v25.5.0 and integrate the new `binject --update-config` feature to enable built-in update checking in SEA binaries, eliminating the need for the bootstrap package download mechanism in SEA mode.

## Current State Analysis

### What We Have Now
1. **Node Version**: Currently using v24.12.0 (in `.node-version`)
2. **Bootstrap Flow**: SEA binaries use bootstrap package that downloads `@socketsecurity/cli` from npm on first run
3. **Update Checking**: CLI package has its own update checking in `src/utils/update/manager.mts`
4. **self-update Command**: Exists in `src/commands/self-update/` but downloads full CLI package from npm registry

### What's Available in socket-btm
1. **Node v25.5.0**: Latest node-smol release `node-smol-20260127-c26068a` includes Node v25.5.0
2. **binject --update-config**: New flag to embed update configuration directly in SEA binaries
3. **Built-in Update Checker**: node-smol compressed binaries include update checking in C code (`update_checker.h`, `update_config.h`)
4. **Self-Contained Updates**: Compressed binaries can check GitHub releases and notify users without needing to download npm packages

## Architecture Changes

### Old Flow (Current)
```
SEA Binary (node-smol)
  → Bootstrap Code (embedded)
    → Downloads @socketsecurity/cli package from npm
      → Runs CLI from downloaded package
        → CLI checks for updates via npm registry
          → Shows notification
```

### New Flow (Proposed)
```
SEA Binary (node-smol with --update-config, CLI embedded in SEA blob)
  → C stub decompresses and loads
    → Built-in C update checker reads embedded config
      → Checks GitHub releases API directly (async, non-blocking)
      → If update available: Shows notification on exit
    → Executes CLI directly from embedded code (no download!)
      → User runs: socket self-update (when ready)
        → Downloads new socket-cli-YYYYMMDD-HASH release from GitHub
          → Replaces SEA binary atomically
```

## Implementation Steps

### Phase 1: Update Node Version
**Files to modify:**
- `.node-version`: Change from `24.12.0` to `25.5.0`
- `package.json`: Update `engines.node` from `>=24.10.0` to `>=25.5.0`
- `packages/cli/src/env/socket-cli-sea-node-version.mts`: Document/update references

**Verification:**
- Run `pnpm run build` to ensure compatibility
- Run `pnpm test` to verify all tests pass with new Node version
- Build SEA binaries for all platforms
- Test basic CLI operations with new binaries

### Phase 2: Integrate binject --update-config

#### 2.1 Update Build Scripts
**File: `packages/cli/scripts/sea-build-utils.mjs`**

Modify `injectSeaBlob()` function to:
1. Create `update-config.json` with Socket CLI update configuration
2. Pass `--update-config` flag to binject during injection
3. Configuration should include:
   - `url`: `https://api.github.com/repos/SocketDev/socketbin/releases` (or wherever @socketbin packages are published)
   - `tag`: Pattern to match release tags (e.g., `@socketbin/cli-*`)
   - `binname`: `socket`
   - `command`: `self-update`
   - `skip_env`: `SOCKET_SKIP_UPDATE_CHECK`
   - `interval`: 86400000 (24 hours)
   - `notify_interval`: 86400000 (24 hours)

**Implementation:**
```javascript
// In injectSeaBlob function, before calling binject
const updateConfigPath = path.join(path.dirname(blobPath), 'update-config.json')
const updateConfig = {
  url: 'https://api.github.com/repos/SocketDev/socket-cli/releases',
  tag: 'socket-cli-*', // Matches: socket-cli-20260127-abc1234
  binname: 'socket',
  command: 'self-update',
  skip_env: 'SOCKET_SKIP_UPDATE_CHECK',
  interval: 86400000,
  notify_interval: 86400000,
  prompt: false,
  prompt_default: 'n'
}
await fs.writeFile(updateConfigPath, JSON.stringify(updateConfig, null, 2))

// Add --update-config to binject args
const binjectArgs = [
  'inject',
  '--executable', nodeBinary,
  '--output', outputPath,
  '--sea', blobPath,
  '--vfs-compat',
  '--update-config', updateConfigPath  // NEW
]
```

#### 2.2 Detect SEA Mode with Embedded Config
**File: `packages/cli/src/utils/sea/detect.mts`**

Add function to detect if running in SEA mode with embedded update config:
```typescript
export function hasEmbeddedUpdateConfig(): boolean {
  // Check if we're in a node-smol binary with embedded update config
  // The C code will handle this automatically, but we need to know
  // for conditional logic (skip npm-based update checks)
  return isSeaBinary() && /* check for some marker */
}
```

#### 2.3 Remove Bootstrap for SEA Mode
**Files to modify:**
- `packages/bootstrap/src/bootstrap-sea.mts`
- `packages/cli/src/cli-entry.mts`

**Strategy:**
- SEA binaries now have CLI code embedded directly in the SEA blob
- No need for bootstrap download mechanism in SEA mode
- Bootstrap package still used for npm wrapper binaries (npx socket)

**Implementation:**
1. **SEA Entry Point**: Modify to execute CLI directly from embedded code
   - Check if running in SEA mode
   - If yes: Execute CLI entry point directly
   - No bootstrap, no download

2. **Bootstrap Package**: Keep only for npm wrapper
   - `bootstrap-npm.mts` still downloads CLI for npx/npm usage
   - `bootstrap-sea.mts` removed or simplified to direct execution

3. **Build Process**: Ensure CLI dist is included in SEA blob
   - SEA config includes full CLI bundle
   - No external dependencies needed at runtime

#### 2.4 Update self-update Command
**File: `packages/cli/src/commands/self-update/handle-self-update.mts`**

Modify to download from GitHub releases for SEA mode:
1. If in SEA mode:
   - Fetch latest `socket-cli-*` release from GitHub
   - Download appropriate platform binary from release assets
   - Verify integrity (checksums)
   - Replace current binary atomically
   - No npm/tarball extraction needed (binaries are direct assets)
2. If in regular mode (npm/pnpm/yarn):
   - Use existing package manager update instructions

**Key Changes:**
```typescript
// At the start of handleSelfUpdate
if (isSeaBinary()) {
  // New path: Download socket-cli-YYYYMMDD-HASH from GitHub releases
  // Asset names: socket-{platform}-{arch}[.exe]
  // Use downloadSocketBtmRelease() helper from @socketsecurity/lib
  const binaryPath = await downloadSocketBtmRelease({
    tool: 'socket-cli',
    bin: 'socket',
    // ... options
  })
  // Replace current binary (existing atomic replacement logic)
} else {
  // Existing path: Show package manager update instructions
}
```

#### 2.5 Conditional Update Checking
**File: `packages/cli/src/utils/update/manager.mts`**

Modify update checking logic:
1. If in SEA mode with embedded config: Skip CLI-side update checks (C stub handles it)
2. Otherwise: Use existing npm-based update checking

```typescript
export async function scheduleUpdateCheck(options: UpdateManagerOptions) {
  // Skip if running in node-smol with embedded update config
  // The C stub will handle update checking
  if (hasEmbeddedUpdateConfig()) {
    return
  }

  // Existing logic for npm-based updates
  // ...
}
```

### Phase 3: Testing Strategy

#### 3.1 Unit Tests
- Test update config generation
- Test detection of embedded config mode
- Test self-update logic branches
- Test bootstrap skip logic

#### 3.2 Integration Tests
1. Build SEA binary with `--update-config`
2. Verify binary size and functionality
3. Test update notification display (mock GitHub API)
4. Test self-update command flow
5. Test skip via `SOCKET_SKIP_UPDATE_CHECK=1`

#### 3.3 E2E Tests
1. Build production SEA binaries for all platforms
2. Run on fresh systems (no prior Socket installation)
3. Verify first-run experience
4. Trigger update check
5. Test full update cycle

### Phase 4: Documentation Updates

**Files to update:**
- `CLAUDE.md`: Document new update mechanism, environment variables
- `README.md`: Update installation and update instructions
- `packages/cli/README.md`: Document self-update behavior
- Add migration guide for users

## Environment Variables

New environment variables to document:
- `SOCKET_SKIP_UPDATE_CHECK`: Skip update checking in SEA mode (existing, document usage)
- `SOCKET_CLI_LOCAL_PATH`: Override for local development (existing)
- `SOCKET_BTM_NODE_SMOL_TAG`: Override node-smol version for builds (existing)
- `SOCKET_BTM_BINJECT_TAG`: Override binject version for builds (existing)

## Backward Compatibility

### For npm/pnpm/yarn Installed CLI
- No changes needed
- Continue using package manager update commands
- Update checking via npm registry still works

### For Existing SEA Binaries (Pre-Update)
- Old binaries without embedded config continue working
- Bootstrap download mechanism remains functional
- Can update to new version via `self-update`
- After update, new binary has embedded config

### For New SEA Binaries (Post-Update)
- Embedded update config enabled by default
- Self-contained, no bootstrap download needed
- Update notifications from C stub
- `self-update` downloads from GitHub releases

## Risks and Mitigations

### Risk 1: Node v25.5.0 Compatibility
**Mitigation:**
- Run full test suite before release
- Test on multiple platforms
- Keep fallback to v24.x if issues arise

### Risk 2: Update Config Breaking Changes
**Mitigation:**
- Version the update config format
- Add validation at build time
- Document schema clearly

### Risk 3: GitHub API Rate Limits
**Mitigation:**
- Use exponential backoff (already in C code)
- Cache update check results (already implemented)
- Support GH_TOKEN for authenticated requests

### Risk 4: Binary Size Increase
**Mitigation:**
- Update config is only 1112 bytes
- Node v25.5.0 should have similar size to v24.x
- Monitor binary sizes in CI

## Success Criteria

1. ✅ CLI builds successfully with Node v25.5.0
2. ✅ All tests pass with new Node version
3. ✅ SEA binaries include embedded update config
4. ✅ Update notifications work in SEA mode
5. ✅ `self-update` command works for SEA binaries
6. ✅ Bootstrap download still works for non-config binaries
7. ✅ No regression in npm/pnpm/yarn installed versions
8. ✅ Binary size remains acceptable (<20MB per platform)

## Timeline Estimate

- **Phase 1** (Node Update): 1-2 hours
  - Update version files
  - Test build and run tests
  - Fix any compatibility issues

- **Phase 2** (binject Integration): 4-6 hours
  - Modify build scripts
  - Update detection logic
  - Modify bootstrap and self-update
  - Update conditional checks

- **Phase 3** (Testing): 3-4 hours
  - Write/update unit tests
  - Run integration tests
  - E2E testing on multiple platforms

- **Phase 4** (Documentation): 1-2 hours
  - Update all relevant docs
  - Write migration guide

**Total Estimate**: 9-14 hours

## Decisions Made

1. **Release Location**: Both GitHub and NPM
   - Publish @socketbin packages to NPM registry for package manager installs
   - Also publish as GitHub releases for SEA binary updates
   - Dual publishing provides flexibility and fallback options

2. **Tag Pattern**: Following socket-btm convention
   - Tag format: `socket-cli-YYYYMMDD-HASH` (e.g., `socket-cli-20260127-abc1234`)
   - Update config pattern: `socket-cli-*`
   - Consistent with other socket-btm tools (node-smol, binject, etc.)
   - Date-based versioning aligns with frequent build cadence

3. **Bootstrap Transition**: Remove immediately for SEA mode
   - SEA binaries will have CLI code embedded in blob
   - No bootstrap download needed (true self-contained)
   - Cleaner architecture, better user experience
   - Bootstrap package still used for npm wrapper binaries

4. **Self-Contained Binaries**: Yes, embed CLI code
   - CLI code bundled in SEA blob via `--sea` flag
   - Eliminates bootstrap download on first run
   - Faster startup, works offline
   - Smaller attack surface (no npm package download)

## Notes

- The C code in node-smol stubs (`update_checker.h`) already handles:
  - HTTP requests via embedded libcurl
  - Version comparison
  - Glob pattern matching
  - Rate limiting and retries
  - CI/TTY detection

- We just need to:
  - Generate proper `update-config.json` at build time
  - Pass it to binject with `--update-config`
  - Adjust CLI logic to detect and skip npm-based updates in this mode

- This makes SEA binaries truly self-contained and improves user experience
