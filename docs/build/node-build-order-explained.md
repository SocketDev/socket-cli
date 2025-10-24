# Node.js Build Order Explained

This document clarifies the order of operations in the Node.js custom binary build process and explains why yao-pkg patches are applied before Socket patches.

## TL;DR

**Order**: yao-pkg patches → Socket patches → Build → Binary

This is correct because:
- yao-pkg patches modify the **build system** (V8, PKG infrastructure)
- Socket patches modify **runtime behavior** (JavaScript code)
- Both are applied to **source code** before compilation
- The resulting **binary** is what pkg uses

## Common Confusion

**Misconception**: "yao-pkg needs our binary before it can patch"

**Reality**: yao-pkg provides **patches for Node.js source code**, not tools that operate on binaries. We're not patching yao-pkg's tools; we're using yao-pkg's patches to modify Node.js.

## The Complete Flow

### Phase 1: Source Preparation

```
1. Clone Node.js source code (v24.10.0)
   └─> Downloads ~2GB from nodejs/node repository
   └─> Result: .custom-node-build/node-yao-pkg/ directory
```

### Phase 2: yao-pkg Patches (Infrastructure)

```
2. Apply yao-pkg patches to Node.js SOURCE
   ├─> Modifies V8 engine (deps/v8/)
   │   └─> Enables bytecode compilation without source
   │   └─> Allows pkg to bundle pre-compiled bytecode
   │
   ├─> Modifies Node.js build system (node.gyp, tools/)
   │   └─> Adds PKG bootstrap code
   │   └─> Adds BAKERY placeholder system
   │   └─> Configures for single-file executable support
   │
   └─> Result: Node.js source is now pkg-compatible
```

**What these patches do**:
- **V8 Bytecode**: Allows V8 to load bytecode without original JavaScript source
- **PKG Bootstrap**: Adds special entry point for pkg-built executables
- **BAKERY Placeholder**: System for runtime argument injection

**Files Modified** (examples):
- `deps/v8/src/codegen/compiler.cc` - V8 compilation changes
- `lib/internal/bootstrap/node.js` - Bootstrap modifications
- `src/node.cc` - Node.js core changes
- `node.gyp` - Build system changes

### Phase 3: Socket Patches (Behavior)

```
3. Apply Socket patches to Node.js SOURCE
   └─> Modifies lib/sea.js (JavaScript file)
       ├─> Changes: const { isSea, ... } = internalBinding('sea');
       └─> To:      const isSea = () => true;
                    const { ... } = internalBinding('sea');
```

**What this patch does**:
- Makes `require('node:sea').isSea()` always return `true`
- Required because pkg executables need to behave as Single Executable Applications
- Without this, pkg binaries can't properly detect their embedded code

**Files Modified**:
- `lib/sea.js` - Single file, simple JavaScript change

### Phase 4: Build

```
4. Configure Node.js build
   └─> ./configure --with-intl=small-icu --without-npm ...

5. Build Node.js binary
   └─> make -j10 (30-60 minutes depending on CPU)
   └─> Result: .custom-node-build/node-yao-pkg/out/Release/node
```

**Result**: A Node.js binary that:
- ✅ Can load V8 bytecode (yao-pkg patch)
- ✅ Has PKG bootstrap system (yao-pkg patch)
- ✅ Reports as SEA (Socket patch)
- ✅ Works with pkg to create single-file executables

### Phase 5: Post-Build

```
6. Strip debug symbols
   └─> 82MB → 54MB

7. Code sign (macOS ARM64)
   └─> Ad-hoc signing

8. Install to pkg cache
   └─> Copy to ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64
```

### Phase 6: Usage

```
9. User runs: pnpm exec pkg .
   └─> pkg tool uses our custom Node.js binary from cache
   └─> Creates single-file executable with embedded code
   └─> Executable works because:
       ├─> V8 can load bytecode (yao-pkg patch)
       ├─> PKG bootstrap loads code (yao-pkg patch)
       └─> isSea() returns true (Socket patch)
```

## Why This Order?

### Why yao-pkg First?

**yao-pkg patches modify infrastructure**:
- V8 engine internals (C++)
- Node.js build system (gyp files)
- Core Node.js runtime (C++)

**These must be applied first** because they change how Node.js:
- Compiles (build system changes)
- Starts up (bootstrap changes)
- Executes code (V8 changes)

### Why Socket Second?

**Socket patches modify behavior**:
- JavaScript runtime behavior (lib/sea.js)
- Pure JavaScript changes
- No C++ or build system changes

**These must be applied after** because:
- They depend on the infrastructure being correct
- They're simple overlays on top of yao-pkg's infrastructure
- They don't affect the build system itself

### Why Not the Other Way?

If we applied Socket patches first, then yao-pkg patches:
- ❌ yao-pkg patches might conflict with our changes
- ❌ yao-pkg patches might overwrite our changes
- ❌ Build system changes wouldn't see our modifications

## Dependency Graph

```
Node.js Source Code (v24.10.0)
         ↓
    [yao-pkg patches]
         ├─> V8 Bytecode Support
         ├─> PKG Bootstrap System
         └─> Build System Changes
         ↓
    [Socket patches]
         └─> SEA Detection Override
         ↓
    [Build Process]
         └─> Compile to Binary
         ↓
    Custom Node.js Binary
         ↓
    [pkg tool uses it]
         └─> Single-file Executable
```

## What If We Reversed The Order?

### Scenario: Socket Patches → yao-pkg Patches

```
1. Apply Socket patch to lib/sea.js
   └─> isSea = () => true

2. Apply yao-pkg patches
   └─> Might modify lib/sea.js in conflicting way
   └─> Could overwrite our changes
   └─> Context might not match anymore
```

**Result**: Patch conflicts or lost changes

### Scenario: Both at Once

```
1. Merge patches into one file
```

**Problems**:
- Hard to maintain separate concerns
- Can't update yao-pkg independently
- Harder to debug which patch caused issues
- Loses modularity

## Real-World Analogy

Think of building a custom car:

1. **yao-pkg patches** = Modifying the **engine and chassis**
   - Change how the engine works internally
   - Modify the frame structure
   - Add special fuel injection system

2. **Socket patches** = Installing **custom dashboard software**
   - Changes what the speedometer displays
   - Modifies instrument cluster behavior
   - Pure software change, no engine mods

**Order**:
1. First: Modify engine (yao-pkg) - Must be done before software
2. Then: Install dashboard software (Socket) - Depends on engine being ready
3. Finally: Drive the car (Build) - Compiles everything together

## Verification

You can verify this order is correct by checking what each patch modifies:

### Check yao-pkg Patch

```bash
head -100 .custom-node-build/patches/node.v24.10.0.cpp.patch

# You'll see:
# - deps/v8/... (V8 engine files)
# - src/node.cc (Core Node.js C++)
# - node.gyp (Build system)
# - lib/internal/bootstrap/... (Bootstrap code)
```

### Check Socket Patch

```bash
cat build/patches/socket/enable-sea-for-pkg-binaries-v24.patch

# You'll see:
# - lib/sea.js (Single JavaScript file)
# - Simple behavior change
```

**No overlap** = Safe to apply in sequence

## What About "yao needs our bin"?

This might refer to a different part of the process:

**What might be confused**:
- We need yao-pkg's **patches** (not binary) to build our Node.js
- pkg tool (the binary) uses our **Node.js binary** to create executables
- But pkg tool is already built - we don't build it

**Correct understanding**:
- yao-pkg project provides: Patches for Node.js
- We apply those patches to: Node.js source
- We build: Custom Node.js binary
- pkg tool uses: Our custom Node.js binary
- Result: Single-file executables

## Summary

**The order is correct**:
1. ✅ yao-pkg patches (infrastructure: V8, build system, bootstrap)
2. ✅ Socket patches (behavior: SEA detection)
3. ✅ Build (compile everything)
4. ✅ Result: Binary that works with pkg

**Why it works**:
- Infrastructure first (yao-pkg)
- Behavior second (Socket)
- No conflicts or overwrites
- Clean separation of concerns

**Common confusion cleared**:
- We're patching Node.js **source**, not binaries
- yao-pkg provides **patches**, not a tool that needs our binary
- The resulting **binary** is what pkg uses
- Order is: patch → patch → build → binary, not: binary → patch

---

**Last Updated**: 2025-10-15
**Applies To**: Socket CLI v1.0.80+
