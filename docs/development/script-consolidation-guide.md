# Package.json Script Consolidation Guide

**Last Updated:** 2025-10-26
**Applies to:** socket-cli, socket-sdk-js, socket-packageurl-js, socket-lib, socket-registry

---

## 🎯 Goal

Simplify and DRY (Don't Repeat Yourself) npm scripts across Socket monorepo and multi-repo projects by:
- Eliminating redundant `-ci` script aliases
- Standardizing test command patterns
- Reducing duplication between root and package scripts
- Creating consistent patterns across all Socket repositories

---

## 📋 Core Principles

### 1. **Use Flags, Not Aliases**

❌ **Before** (redundant aliases):
```json
{
  "scripts": {
    "check": "eslint src/",
    "check:all": "eslint src/ --max-warnings 0",
    "check-ci": "eslint src/",
    "lint-ci": "eslint src/ --max-warnings 0"
  }
}
```

✅ **After** (single command with flags):
```json
{
  "scripts": {
    "check": "eslint src/",
    "check:all": "eslint src/ --max-warnings 0"
  }
}
```

**In CI workflows:**
```yaml
- name: Lint
  run: pnpm run check:all
```

### 2. **Standardize Test Commands**

All packages should use identical test script patterns:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Benefits:**
- Muscle memory across all projects
- Easy to remember
- Consistent CI configuration

### 3. **Separate Workspace vs Package Concerns**

**Root package.json** (monorepo workspace orchestration):
```json
{
  "scripts": {
    "build": "pnpm --filter './packages/**' run build",
    "test": "pnpm --filter './packages/**' run test",
    "clean": "pnpm --filter './packages/**' run clean"
  }
}
```

**Package package.json** (specific to that package):
```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "clean": "del-cli dist"
  }
}
```

---

## 🔧 Common Patterns

### Builder Packages

**Pattern for all `-builder` packages:**
```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:force": "node scripts/build.mjs --force",
    "clean": "node scripts/clean.mjs"
  }
}
```

### Test Packages

**Standard pattern:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run src/**/*.test.mts",
    "test:e2e": "vitest run e2e/**/*.test.mts"
  }
}
```

### Library Packages

**Minimal pattern:**
```json
{
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "type": "tsc --noEmit"
  }
}
```

---

## 🚫 Anti-Patterns to Avoid

### ❌ Redundant `-ci` Scripts

```json
// DON'T DO THIS
{
  "scripts": {
    "lint": "eslint .",
    "lint-ci": "eslint .",        // Duplicate!
    "test": "vitest run",
    "test-ci": "vitest run"       // Duplicate!
  }
}
```

**Why it's bad:**
- Doubles maintenance burden
- No actual benefit (CI can call `pnpm run lint` directly)
- Creates confusion about which to use

**Solution:** Remove `-ci` aliases, use flags in CI when needed:
```yaml
run: pnpm run lint --max-warnings 0
```

### ❌ Duplicate Root/Package Scripts

```json
// Root package.json
{
  "scripts": {
    "check": "node scripts/check.mjs",
    "lint": "node scripts/lint.mjs"
  }
}

// packages/cli/package.json
{
  "scripts": {
    "check": "node scripts/check.mjs",  // DUPLICATE!
    "lint": "node scripts/lint.mjs"     // DUPLICATE!
  }
}
```

**Solution:** Keep scripts in ONE place:
- If it's a workspace operation → root only
- If it's package-specific → package only
- Use `pnpm --filter` to delegate from root to packages

### ❌ Inconsistent Test Commands

```json
// Package A
{ "test": "vitest run" }

// Package B
{ "test": "node --test" }

// Package C
{ "test": "jest" }
```

**Solution:** Standardize on **one test runner** (preferably Vitest) across all packages.

---

## 📦 Monorepo-Specific Patterns

### Root Workspace Scripts

```json
{
  "scripts": {
    "// Build": "",
    "build": "pnpm --filter './packages/**' run build",
    "build:cli": "pnpm --filter @socketsecurity/cli run build",

    "// Testing": "",
    "test": "pnpm --filter './packages/**' run test",
    "test:all": "pnpm --filter './packages/**' run test",

    "// Quality": "",
    "check": "pnpm --filter './packages/**' run check",
    "lint": "pnpm --filter './packages/**' run lint",
    "type": "pnpm --filter './packages/**' run type",

    "// Maintenance": "",
    "clean": "pnpm --filter './packages/**' run clean",
    "update": "pnpm update -r"
  }
}
```

### Using pnpm Filter Patterns

```bash
# Run in all packages
pnpm --filter './packages/**' run build

# Run in specific package
pnpm --filter @socketsecurity/cli run build

# Run in packages matching pattern
pnpm --filter '*-builder' run build

# Run in packages with dependencies
pnpm --filter '...@socketsecurity/cli' run build
```

---

## 🔄 Migration Checklist

### For Each Repository

- [ ] **Audit current scripts**
  - List all scripts in root package.json
  - List all scripts in packages/*/package.json
  - Identify duplicates and redundancies

- [ ] **Remove `-ci` aliases**
  - Remove `*-ci` scripts from all package.json files
  - Update CI workflows to use base commands with flags

- [ ] **Standardize test commands**
  - Ensure all packages use `vitest run`, `vitest` pattern
  - Add `test:coverage` where needed
  - Remove custom test wrappers

- [ ] **Eliminate duplication**
  - Remove scripts from root that exist in packages
  - Or remove from packages and use `--filter` delegation
  - Keep concerns separated (workspace vs package)

- [ ] **Document conventions**
  - Update CONTRIBUTING.md or similar
  - Add comments in package.json for script categories
  - Share patterns with team

- [ ] **Verify CI still works**
  - Test all workflows locally
  - Ensure no broken script references
  - Update workflow documentation

---

## 📊 Before/After Examples

### Socket CLI (Monorepo)

**Before:**
```json
{
  "scripts": {
    "check": "node scripts/check.mjs",
    "check:all": "node scripts/check.mjs --all",
    "check-ci": "node scripts/check.mjs",           // ❌ Duplicate
    "lint": "node scripts/lint.mjs",
    "lint:all": "node scripts/lint.mjs --all",
    "lint-ci": "node scripts/lint.mjs --all",       // ❌ Duplicate
    "type": "node scripts/type.mjs",
    "type:all": "node scripts/type.mjs",            // ❌ Same as type
    "type-ci": "node scripts/type.mjs",             // ❌ Duplicate
    "test": "node scripts/test-monorepo.mjs",
    "test:all": "node scripts/test-monorepo.mjs --all",
    "test-ci": "node scripts/test-monorepo.mjs --all"  // ❌ Duplicate
  }
}
```

**After:**
```json
{
  "scripts": {
    "check": "node scripts/check.mjs",
    "check:all": "node scripts/check.mjs --all",
    "lint": "node scripts/lint.mjs",
    "lint:all": "node scripts/lint.mjs --all",
    "type": "node scripts/type.mjs",
    "type:all": "node scripts/type.mjs",
    "test": "node scripts/test-monorepo.mjs",
    "test:all": "node scripts/test-monorepo.mjs --all"
  }
}
```

**Savings:** 4 fewer scripts, clearer intent

### Builder Package

**Before:**
```json
// packages/yoga-layout/package.json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:force": "node scripts/build.mjs --force",
    "clean": "node scripts/clean.mjs"
  }
}

// packages/minilm-builder/package.json (identical!)
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:force": "node scripts/build.mjs --force",
    "clean": "node scripts/clean.mjs"
  }
}
```

**After (Option A - Keep as-is, it's consistent):**
```json
// All builder packages use identical pattern
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:force": "node scripts/build.mjs --force",
    "clean": "node scripts/clean.mjs"
  }
}
```

**After (Option B - Workspace delegation):**
```json
// Root
{
  "scripts": {
    "build:builders": "pnpm --filter '*-builder' run build"
  }
}
```

---

## 🎓 Best Practices

### 1. Script Naming Conventions

- Use **`:` for variants**: `build:dev`, `build:prod`, `test:unit`, `test:e2e`
- Use **`--`** for passing flags: `pnpm run test -- --coverage`
- Avoid **`-ci`** suffix (use base command in CI)
- Use **`//` comments** to group related scripts

Example:
```json
{
  "scripts": {
    "// Build": "",
    "build": "tsc",
    "build:watch": "tsc --watch",
    "build:prod": "tsc --build --clean",

    "// Testing": "",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run src/",
    "test:e2e": "vitest run e2e/"
  }
}
```

### 2. Documentation

Add brief comments explaining non-obvious scripts:
```json
{
  "scripts": {
    "bs": "pnpm run build && pnpm exec socket --",
    "// ^ Build + run Socket CLI quickly for testing"
  }
}
```

### 3. Consistency Across Repos

All Socket projects should follow the same patterns:
- Same test commands
- Same script naming
- Same `--filter` patterns in monorepos
- Same CI integration approach

---

## 🚀 Implementation Strategy

### Phase 1: Audit
1. Run this command in each repo:
   ```bash
   cat package.json | jq '.scripts'
   find packages -name package.json -exec jq -r '.name + ": " + (.scripts | keys | join(", "))' {} \;
   ```
2. Create spreadsheet of all scripts across all repos
3. Identify duplicates and inconsistencies

### Phase 2: Standardize
1. Remove all `-ci` aliases
2. Standardize test commands
3. Update CI workflows
4. Test locally

### Phase 3: Simplify
1. Eliminate root/package duplication
2. Consolidate builder patterns
3. Add script comments/documentation
4. Share guide with team

### Phase 4: Maintain
1. Add to code review checklist
2. Update CONTRIBUTING.md
3. Enforce in CI (script linter?)
4. Periodic audits

---

## 📖 Resources

- [pnpm workspace filtering](https://pnpm.io/filtering)
- [pnpm scripts](https://pnpm.io/cli/run)
- [npm scripts best practices](https://docs.npmjs.com/cli/v9/using-npm/scripts#best-practices)

---

## 💬 Questions?

Reach out to the Socket development team or create an issue in the respective repository.

**This guide is a living document.** Please update it as patterns evolve!
