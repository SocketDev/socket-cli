# Node.js Patch Creation Guide

Complete guide for creating, testing, and maintaining Node.js patches for the Socket CLI build system.

## Overview

This guide shows you how to:
1. Create new patches for Node.js modifications
2. Add proper metadata headers
3. Test patches before committing
4. Regenerate patches for new Node.js versions

## When to Create Patches

Create patches when:
- ✅ You need to modify Node.js source for a specific version
- ✅ The modifications are stable and repeatable
- ✅ You want to version-control the changes
- ✅ You need to share modifications with the team

**Don't create patches** when:
- ❌ Modifications change frequently
- ❌ You're still experimenting
- ❌ Direct modifications are simpler

## Quick Start

```bash
# 1. Build Node.js with direct modifications
node scripts/build-yao-pkg-node.mjs --clean

# 2. Generate patches from the modified source
node scripts/generate-node-patches.mjs --version=v24.10.0

# 3. Test the generated patches
node scripts/build-yao-pkg-node.mjs --clean --verify
```

## Step-by-Step: Creating a New Patch

### Step 1: Start with Clean Source

```bash
# Clean build directory
rm -rf .custom-node-build/node-yao-pkg/

# Clone fresh Node.js source
cd .custom-node-build
git clone --depth 1 --branch v24.10.0 https://github.com/nodejs/node.git node-yao-pkg
cd node-yao-pkg
```

### Step 2: Create a Git Branch

```bash
# Create a branch for your changes
git checkout -b socket-modifications
```

### Step 3: Apply yao-pkg Patches First

```bash
# Apply yao-pkg patches (infrastructure must be in place)
patch -p1 < ../.custom-node-build/patches/node.v24.10.0.cpp.patch
```

**Why?** Socket patches should be applied AFTER yao-pkg patches to avoid conflicts.

### Step 4: Make Your Modifications

Edit the files you need to modify. For example, to enable SEA detection:

```bash
# Edit lib/sea.js
nano lib/sea.js
```

Make your changes:
```javascript
// Before:
const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');

// After:
const isSea = () => true;
const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');
```

### Step 5: Commit Your Changes

```bash
# Stage the changes
git add lib/sea.js

# Commit with descriptive message
git commit -m "Enable SEA detection for pkg binaries"
```

### Step 6: Generate the Patch

```bash
# Generate patch from the commit
git format-patch -1 HEAD

# This creates: 0001-Enable-SEA-detection-for-pkg-binaries.patch
```

### Step 7: Add Metadata

Open the generated patch and add metadata at the top:

```patch
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
# @requires: yao-pkg-patches
#
# Overrides the isSea binding to always return true, making pkg binaries
# report as Single Executable Applications for consistency.
#
# This is required for pkg to properly detect and load embedded code.

From abc123def456... Mon Sep 17 00:00:00 2001
From: Your Name <your.email@example.com>
Date: Mon, 15 Oct 2025 12:00:00 -0700
Subject: [PATCH] Enable SEA detection for pkg binaries

---
 lib/sea.js | 3 ++-
 1 file changed, 2 insertions(+), 1 deletion(-)

diff --git a/lib/sea.js b/lib/sea.js
index 1234567..8901234 100644
--- a/lib/sea.js
+++ b/lib/sea.js
@@ -3,7 +3,8 @@ const {
   ArrayBufferPrototypeSlice,
 } = primordials;

-const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');
+const isSea = () => true;
+const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');
 const { TextDecoder } = require('internal/encoding');
 const { validateString } = require('internal/validators');
 const {
--
2.39.0
```

### Step 8: Name and Move the Patch

```bash
# Rename with descriptive name
mv 0001-Enable-SEA-detection-for-pkg-binaries.patch \
   enable-sea-for-pkg-binaries-v24-10-0.patch

# Move to Socket patches directory
mv enable-sea-for-pkg-binaries-v24-10-0.patch \
   ../../build/patches/socket/
```

### Step 9: Test the Patch

```bash
# Clean and rebuild using the patch
cd ../..
node scripts/build-yao-pkg-node.mjs --clean
```

**Expected output**:
```
Validating Socket Patches
Found 1 patch(es) for v24.10.0
Checking integrity, compatibility, and conflicts...

Validating enable-sea-for-pkg-binaries-v24-10-0.patch...
  📝 Enable SEA detection for pkg binaries
  ✓ Modifies SEA detection
  ✅ Valid

✅ All Socket patches validated successfully
✅ No conflicts detected

Testing Socket Patch Application
Running dry-run to ensure patches will apply cleanly...

Testing enable-sea-for-pkg-binaries-v24-10-0.patch...
  ✅ Will apply cleanly

Applying Socket Patches
Applying enable-sea-for-pkg-binaries-v24-10-0.patch...
✅ enable-sea-for-pkg-binaries-v24-10-0.patch applied
```

### Step 10: Verify the Build

```bash
# Verify the modifications were applied correctly
node scripts/verify-node-build.mjs
```

### Step 11: Commit the Patch

```bash
# Add the patch to version control
git add build/patches/socket/enable-sea-for-pkg-binaries-v24-10-0.patch
git commit -m "Add SEA detection patch for Node.js v24.10.0"
```

## Patch Naming Conventions

### Format

```
<action>-<what>-<version>.patch
```

### Examples

```bash
# Good names:
enable-sea-for-pkg-binaries-v24-10-0.patch
fix-v8-include-paths-v24-9-0.patch
remove-deprecated-api-v24-10-0.patch

# Bad names:
patch1.patch
my-fix.patch
node-modifications.patch
```

### Version Patterns

```bash
# Specific version
enable-sea-v24-10-0.patch      # Only v24.10.0

# Version range (generic)
enable-sea-v24.patch           # All v24.x.x
```

**Best practice**: Use specific version numbers for clarity.

## Metadata Reference

### Required Fields

```patch
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
```

### Optional Fields

```patch
# @requires: yao-pkg-patches
# @conflicts: alternative-sea-patch
```

### Example: Complete Metadata

```patch
# @node-versions: v24.10.0, v24.10.1, v24.10.2
# @description: Enable SEA detection for pkg binaries
# @requires: yao-pkg-patches
# @conflicts: alternative-sea-implementation
#
# Long-form description:
# This patch modifies lib/sea.js to always return true for isSea()
# enabling pkg binaries to use Node.js SEA APIs correctly.
#
# The modification is required because pkg needs to detect when
# running as a single executable application.
```

## Testing Patches

### Manual Testing

```bash
# Test patch application (dry-run)
cd .custom-node-build/node-yao-pkg
patch -p1 --dry-run < ../../build/patches/socket/your-patch.patch

# If successful, apply it
patch -p1 < ../../build/patches/socket/your-patch.patch
```

### Automated Testing

```bash
# Run full build with verification
node scripts/build-yao-pkg-node.mjs --clean --verify

# Run integration test
node scripts/test-yao-pkg-integration.mjs
```

### Validation Testing

```bash
# Test patch validator
node -e "
import { validatePatch } from './scripts/lib/patch-validator.mjs';
const result = await validatePatch(
  'build/patches/socket/your-patch.patch',
  'v24.10.0'
);
console.log(result);
"
```

## Regenerating Patches for New Versions

When a new Node.js version is released:

### Option 1: Automatic Regeneration

```bash
# Try applying existing patches to new version
node scripts/build-yao-pkg-node.mjs --version=v24.11.0 --clean

# If it fails, regenerate:
node scripts/regenerate-node-patches.mjs --version=v24.11.0
```

### Option 2: Manual Regeneration

```bash
# 1. Clone new Node.js version
cd .custom-node-build
rm -rf node-yao-pkg
git clone --depth 1 --branch v24.11.0 https://github.com/nodejs/node.git node-yao-pkg
cd node-yao-pkg

# 2. Apply yao-pkg patches
patch -p1 < ../patches/node.v24.11.0.cpp.patch

# 3. Make your modifications again
# (Edit files as needed)

# 4. Generate new patches
git add .
git commit -m "Socket modifications for v24.11.0"
git format-patch -1 HEAD

# 5. Add metadata and move to patches directory
mv 0001-*.patch ../../build/patches/socket/enable-sea-v24-11-0.patch
```

## Common Scenarios

### Scenario 1: Modify Single File

**Goal**: Change one JavaScript file

**Steps**:
1. Edit the file
2. `git add <file>`
3. `git commit -m "Description"`
4. `git format-patch -1 HEAD`
5. Add metadata
6. Move to patches directory

### Scenario 2: Modify Multiple Files

**Goal**: Change several files in one patch

**Steps**:
1. Edit all files
2. `git add <file1> <file2> <file3>`
3. `git commit -m "Description"`
4. `git format-patch -1 HEAD`
5. Add metadata
6. Move to patches directory

### Scenario 3: Multiple Independent Changes

**Goal**: Create separate patches for different concerns

**Steps**:
1. Edit first set of files
2. `git add <files>`
3. `git commit -m "First change"`
4. Edit second set of files
5. `git add <files>`
6. `git commit -m "Second change"`
7. `git format-patch -2 HEAD` (creates 2 patches)
8. Add metadata to both
9. Move both to patches directory

### Scenario 4: Update Existing Patch

**Goal**: Fix an existing patch

**Steps**:
1. Start fresh: `rm -rf .custom-node-build/node-yao-pkg`
2. Clone and apply yao-pkg patches
3. Make the CORRECTED modifications
4. Generate new patch
5. Replace old patch file

## Troubleshooting

### Patch Won't Apply

**Symptoms**:
```
File to patch:
```

**Causes**:
- Wrong strip level (`-p0` vs `-p1`)
- Context doesn't match Node.js version
- File structure changed

**Fix**:
```bash
# Try different strip level
patch -p0 < patch.patch  # For paths without a/ b/
patch -p1 < patch.patch  # For Git-format paths

# Check patch context
head -50 patch.patch  # See what line numbers it expects

# Regenerate for correct version
```

### Validation Fails

**Symptoms**:
```
❌ INVALID: Patch supports v24.9.0 but you're using v24.10.0
```

**Fix**:
```patch
# Update @node-versions in patch header
# @node-versions: v24.9.0, v24.10.0
```

### Conflicts with Other Patches

**Symptoms**:
```
⚠️  WARNING: Multiple patches modify lib/sea.js
```

**Fix**:
- Combine patches into one
- Or mark as conflicting:
```patch
# @conflicts: other-patch-name
```

### Dry-Run Fails

**Symptoms**:
```
❌ Cannot apply: Patch dry-run failed with exit code 1
```

**Fix**:
```bash
# Check patch manually
cd .custom-node-build/node-yao-pkg
patch -p1 --dry-run < ../../build/patches/socket/your-patch.patch

# See specific errors
# Regenerate if needed
```

## Best Practices

### DO

- ✅ **Test thoroughly** - Always test patches with `--clean` build
- ✅ **Add clear metadata** - Version requirements, description, dependencies
- ✅ **Use descriptive names** - `enable-sea-v24-10-0.patch`, not `patch1.patch`
- ✅ **Keep patches focused** - One concern per patch when possible
- ✅ **Document why** - Explain the purpose in metadata
- ✅ **Version patches** - Include Node.js version in filename

### DON'T

- ❌ **Don't skip metadata** - Always include `@node-versions` and `@description`
- ❌ **Don't guess versions** - Test patches on actual Node.js versions
- ❌ **Don't mix concerns** - Don't combine unrelated changes in one patch
- ❌ **Don't use wildcards loosely** - `v24+` might break on v25.0.0
- ❌ **Don't forget to test** - Always verify patches apply and build succeeds

## Automation Scripts

### Generate Patches Script

Create `scripts/generate-node-patches.mjs`:

```javascript
#!/usr/bin/env node

import { join } from 'node:path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

const NODE_VERSION = process.argv[2] || 'v24.10.0'
const SOURCE_DIR = join(process.cwd(), '.custom-node-build', 'node-yao-pkg')
const PATCHES_DIR = join(process.cwd(), 'build', 'patches', 'socket')

console.log(`Generating patches for ${NODE_VERSION}...`)

// Generate patches from git commits
const result = await spawn('git', ['format-patch', '-o', PATCHES_DIR, 'HEAD~1..HEAD'], {
  cwd: SOURCE_DIR,
  stdio: 'pipe',
})

if (result.code !== 0) {
  console.error('Failed to generate patches')
  process.exit(1)
}

console.log(`✅ Patches generated in ${PATCHES_DIR}`)
console.log('📝 Don't forget to add metadata headers!')
```

## Quick Reference

```bash
# Create branch
git checkout -b modifications

# Apply yao-pkg patches
patch -p1 < yao-patch.patch

# Make changes
edit files...

# Commit
git add .
git commit -m "Description"

# Generate patch
git format-patch -1 HEAD

# Add metadata (edit file)
nano 0001-*.patch

# Rename and move
mv 0001-*.patch enable-sea-v24-10-0.patch
mv enable-sea-v24-10-0.patch ../../build/patches/socket/

# Test
node scripts/build-yao-pkg-node.mjs --clean --verify
```

## Related Documentation

- **[Patch Metadata Format](./node-patch-metadata.md)** - Metadata specification
- **[Build System](./technical/build-system-improvements.md)** - Build system overview
- **[Quick Reference](./node-build-quick-reference.md)** - Troubleshooting guide

---

**Last Updated**: 2025-10-15
**Applies To**: Socket CLI v1.0.80+
