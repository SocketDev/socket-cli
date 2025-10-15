# Testing Custom Node.js Build

## ⚠️ Important Understanding

The custom Node.js binary built with yao-pkg patches is **NOT meant to be run standalone**. It is specifically designed to be used as a base by `@yao-pkg/pkg` when creating executable bundles.

### Why Can't We Run It Standalone?

1. **Always-on SEA mode**: Our Socket modification makes `isSea()` always return `true`
2. **pkg bootstrap**: The binary includes pkg bootstrap code that expects to be wrapped
3. **Intended use**: pkg embeds assets into the binary and sets up the proper environment

### The Correct Testing Approach

Test the **complete workflow**: Build → pkg → Test executable

```
Custom Node Binary → pkg wraps it → Socket CLI executable → Test that!
```

## 🧪 Testing Workflows

### Option 1: Full Workflow Test (Recommended)

Test the complete pkg workflow from building Socket CLI to testing the executable:

```bash
# Build Socket CLI + create pkg executable + test
node scripts/test-pkg-workflow.mjs

# Skip steps if already done:
node scripts/test-pkg-workflow.mjs --skip-build     # Skip pnpm build
node scripts/test-pkg-workflow.mjs --skip-pkg       # Skip pkg creation
```

**What it tests**:
- Custom Node binary exists in pkg cache
- Socket CLI builds successfully with `pnpm build`
- pkg creates executable using custom Node
- Executable runs and responds to commands

### Option 2: Manual Testing

If you prefer to test manually:

```bash
# 1. Verify custom Node is in cache
ls -lh ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed

# 2. Build Socket CLI
pnpm run build

# 3. Create pkg executable
pnpm exec pkg .

# 4. Test the executable
./pkg-binaries/socket-macos-arm64 --version
./pkg-binaries/socket-macos-arm64 --help
./pkg-binaries/socket-macos-arm64 scan --help
```

### Option 3: Integration Test

Run the existing integration test that tests the full pkg workflow:

```bash
node scripts/test-yao-pkg-integration.mjs
```

## ❌ What NOT To Do

**DO NOT try to run the custom Node binary directly**:

```bash
# ❌ This will FAIL:
~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed --version

# ❌ This will also FAIL:
PKG_EXECPATH='' ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed --version
```

**Why?** The binary has been modified to always run in SEA mode for pkg compatibility. It's not a general-purpose Node.js binary.

## 🔍 Verification Steps

After building the custom Node binary:

### Step 1: Verify Build
```bash
node scripts/verify-node-build.mjs
```

**Note**: This verification has limitations. It tests the source modifications but cannot fully test the binary's standalone functionality (which is expected).

### Step 2: Test pkg Workflow
```bash
node scripts/test-pkg-workflow.mjs
```

This is the **definitive test** that validates the custom Node works correctly with pkg.

## 📊 What Each Test Validates

| Test | What It Checks | Pass Criteria |
|------|---------------|---------------|
| `verify-node-build.mjs` | Source modifications, file integrity | ⚠️ Partial (binary tests will fail) |
| `test-pkg-workflow.mjs` | Complete pkg workflow | ✅ Full validation |
| `test-yao-pkg-integration.mjs` | Integration with pkg | ✅ Full validation |

## 🎯 Success Criteria

The custom Node.js build is successful when:

1. ✅ Build completes without errors
2. ✅ Binary is installed to pkg cache (~54MB)
3. ✅ pkg can create executables using it
4. ✅ Socket CLI executable runs correctly
5. ✅ Executable responds to commands (`--version`, `--help`, etc.)

## 🐛 Troubleshooting

### "Cannot find module" Errors

If you see errors like:
```
Error: Cannot find module '--version'
```

This means you're trying to run the custom Node binary standalone, which won't work. Use the pkg workflow test instead.

### pkg Fails to Find Binary

If pkg can't find the custom Node:

```bash
# Check if binary exists in cache
ls -lh ~/.pkg-cache/v3.5/

# Rebuild if needed
node scripts/build-yao-pkg-node.mjs --clean
```

### Executable Crashes or Doesn't Work

1. Verify the build completed successfully
2. Run verification: `node scripts/verify-node-build.mjs`
3. Check Socket CLI built correctly: `pnpm run build`
4. Try rebuilding everything: `node scripts/build-yao-pkg-node.mjs --clean`

## 📚 Related Documentation

- [Build System Overview](./BUILD-SYSTEM-SUMMARY.md)
- [Quick Reference](./node-build-quick-reference.md)
- [Build Improvements](./technical/build-improvements-2025-10-15.md)

---

**Key Takeaway**: The custom Node binary is a **build artifact** for pkg, not a standalone Node.js replacement. Always test via the pkg workflow!
