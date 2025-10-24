# Node.js Patch Metadata Format

This document describes the metadata format used in Node.js patches for the Socket CLI build system.

## Overview

Patches can include metadata in header comments to help the build system validate compatibility, detect conflicts, and provide better error messages.

## Metadata Format

Metadata is specified in comments at the **beginning of the patch file** using special directives:

```patch
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
# @requires: yao-pkg-patches
# @conflicts: alternative-sea-patch
#
# This patch modifies lib/sea.js to always return true for isSea()
# enabling pkg binaries to use Node.js SEA APIs.
#
diff --git a/lib/sea.js b/lib/sea.js
...
```

## Metadata Directives

### `@node-versions`

**Purpose**: Specify which Node.js versions the patch is compatible with.

**Format**: Comma-separated list of version specifiers.

**Version Specifiers**:
- **Exact version**: `v24.10.0` - Only this version
- **Version range**: `v24.9.0-v24.9.5` - Inclusive range
- **Version and above**: `v24.10.0+` - This version and all later versions

**Examples**:
```patch
# Single version
# @node-versions: v24.10.0

# Multiple specific versions
# @node-versions: v24.10.0, v24.10.1, v24.10.2

# Version range
# @node-versions: v24.9.0-v24.9.5

# Version and above
# @node-versions: v24.10.0+

# Complex specification
# @node-versions: v24.9.0-v24.9.5, v24.10.0+
```

**Validation**:
- If `@node-versions` is present, the patch will only be applied to matching Node.js versions
- If omitted, the patch is assumed compatible with all versions (use with caution!)

### `@description`

**Purpose**: Brief description of what the patch does.

**Format**: Single-line text description.

**Examples**:
```patch
# @description: Enable SEA detection for pkg binaries
# @description: Fix V8 include paths for v24.9.0 build
# @description: Remove deprecated API usage
```

**Usage**:
- Displayed during patch validation
- Helps users understand what the patch does
- Keep it concise (one line)

### `@requires`

**Purpose**: List other patches or conditions that must be satisfied.

**Format**: Comma-separated list of dependency names.

**Examples**:
```patch
# Single dependency
# @requires: yao-pkg-patches

# Multiple dependencies
# @requires: yao-pkg-patches, socket-base-modifications
```

**Validation**:
- Build system warns if required patches are missing
- Helps ensure patches are applied in correct order

### `@conflicts`

**Purpose**: List patches that conflict with this one.

**Format**: Comma-separated list of conflicting patch names.

**Examples**:
```patch
# Single conflict
# @conflicts: alternative-sea-implementation

# Multiple conflicts
# @conflicts: old-v8-fix, deprecated-sea-patch
```

**Validation**:
- Build system errors if conflicting patches are present
- Prevents incompatible patches from being applied together

## Complete Examples

### Example 1: SEA Detection Patch

```patch
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
# @requires: yao-pkg-patches
#
# This patch modifies lib/sea.js to always return true for isSea()
# which enables pkg binaries to use Node.js Single Executable Application APIs.
#
# The yao-pkg fork requires this modification to properly detect and handle
# embedded JavaScript code in single-file executables.
#
diff --git a/lib/sea.js b/lib/sea.js
index 1234567..8901234 100644
--- lib/sea.js
+++ lib/sea.js
@@ -1,7 +1,8 @@
 'use strict';
 const {
   ArrayBufferPrototypeSlice,
 } = primordials;

-const { isSea, getAsset: getAssetInternal } = internalBinding('sea');
+const isSea = () => true;
+const { getAsset: getAssetInternal } = internalBinding('sea');
```

### Example 2: V8 Include Path Fix (Version-Specific)

```patch
# @node-versions: v24.9.0-v24.9.5
# @description: Fix V8 include paths for v24.9.0 build
# @conflicts: v24.10.0-patches
#
# Node.js v24.9.x has incorrect V8 include paths that cause build failures.
# This patch removes the "src/" prefix from V8 internal includes.
#
# IMPORTANT: Do NOT use this patch with v24.10.0+ - those versions have
# correct include paths already!
#
diff --git a/deps/v8/src/heap/cppgc/heap-page.h b/deps/v8/src/heap/cppgc/heap-page.h
index 1234567..8901234 100644
--- deps/v8/src/heap/cppgc/heap-page.h
+++ deps/v8/src/heap/cppgc/heap-page.h
@@ -9,7 +9,7 @@
 #include <atomic>
 #include <memory>

-#include "src/base/iterator.h"
+#include "base/iterator.h"
```

### Example 3: Combined Modifications

```patch
# @node-versions: v24.10.0+
# @description: Socket CLI Node.js modifications for pkg support
# @requires: yao-pkg-patches
#
# Combined patch that applies all Socket CLI modifications:
# 1. Enable SEA detection (lib/sea.js)
# 2. Remove deprecated APIs
# 3. Configure for minimal binary size
#
diff --git a/lib/sea.js b/lib/sea.js
...
diff --git a/lib/internal/bootstrap/node.js b/lib/internal/bootstrap/node.js
...
```

## Best Practices

### 1. Always Specify Version Compatibility

```patch
# ✅ GOOD: Explicit version specification
# @node-versions: v24.10.0+

# ❌ BAD: No version specification (assumes all versions work)
```

### 2. Use Descriptive Names

```patch
# ✅ GOOD: Clear description
# @description: Enable SEA detection for pkg binaries

# ❌ BAD: Vague description
# @description: Fix stuff
```

### 3. Document Conflicts

```patch
# ✅ GOOD: Explicitly mark conflicts
# @node-versions: v24.9.0-v24.9.5
# @conflicts: v24.10.0-patches
# @description: Fix V8 includes (v24.9.x only)

# ❌ BAD: No conflict information
# Could be applied with v24.10.0 patches, causing build failure
```

### 4. Include Context in Comments

```patch
# ✅ GOOD: Explain why the patch is needed
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
#
# This patch is required because pkg needs to detect when running
# as a single executable application. The yao-pkg fork expects
# isSea() to return true in all pkg-built binaries.
#
# Without this patch, pkg binaries will fail to load embedded code.

# ❌ BAD: No context
# @node-versions: v24.10.0+
# @description: Change isSea
```

### 5. Test Version Ranges Carefully

```patch
# ✅ GOOD: Tested on specific versions
# @node-versions: v24.10.0, v24.10.1
# @description: Enable SEA detection

# ⚠️  CAUTION: Broad version range (test thoroughly!)
# @node-versions: v24.10.0+
# @description: Enable SEA detection
```

## Validation Flow

When you run the build script, patch validation happens in this order:

1. **File Integrity Check**
   - Verify patch file is not empty
   - Verify patch file is not an HTML error page
   - Verify patch contains diff markers

2. **Metadata Parsing**
   - Extract `@node-versions`, `@description`, `@requires`, `@conflicts`
   - Parse version specifiers

3. **Version Compatibility Check**
   - Compare Node.js version against `@node-versions`
   - Reject patch if version doesn't match

4. **Content Analysis**
   - Detect what files the patch modifies
   - Detect V8 include modifications
   - Detect SEA modifications

5. **Conflict Detection**
   - Check if multiple patches modify same files
   - Check if patches have conflicting `@conflicts` declarations
   - Check if patches are compatible with Node.js version

6. **Application**
   - Apply patches in order if all validation passes
   - Fall back to direct modifications if patches fail

## Error Messages

### Version Incompatibility

```
❌ INVALID: Patch supports v24.9.0-v24.9.5 but you're using v24.10.0
```

**Fix**: Use a patch compatible with your Node.js version.

### Corrupted Patch

```
❌ INVALID: Patch file contains HTML (probably download error)
```

**Fix**: Re-download the patch file.

### Patch Conflicts

```
❌ ERROR: Patches modify V8 includes but v24.10.0 doesn't need this fix
```

**Fix**: Remove incompatible V8 patches for v24.10.0+.

## Advanced: Programmatic Validation

You can validate patches programmatically using the patch validator:

```javascript
import { validatePatch, analyzePatchContent } from './scripts/lib/patch-validator.mjs'

// Validate a patch
const validation = await validatePatch('path/to/patch.patch', 'v24.10.0')
if (!validation.valid) {
  console.error(`Invalid: ${validation.reason}`)
} else {
  console.log(`Valid: ${validation.metadata.description}`)
}

// Analyze patch content
const content = await readFile('patch.patch', 'utf8')
const analysis = analyzePatchContent(content)
console.log(`Modifies ${analysis.modifiesFiles.length} files`)
console.log(`V8 includes: ${analysis.modifiesV8Includes}`)
console.log(`SEA detection: ${analysis.modifiesSEA}`)
```

## Related Documentation

- [Build System Improvements](./technical/build-system-improvements.md) - Complete build system documentation
- [Patch Implementation Plan](./socket-patch-implementation-plan.md) - Original patch system design
- [Node.js Patch Progress](./socket-patch-progress.md) - Patch development history

---

**Last Updated**: 2025-10-15
**Applies To**: Socket CLI v1.0.80+
