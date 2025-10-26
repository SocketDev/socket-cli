# Script Simplification Quick Start

**For:** socket-sdk-js, socket-packageurl-js, socket-lib, socket-registry

---

## 🎯 Quick Wins

### 1. Remove Redundant `-ci` Scripts

```bash
# Find all -ci scripts
grep -r '".*-ci"' package.json packages/*/package.json

# Remove them - they're just duplicates!
# Use base commands in CI with flags instead
```

**Example:**
```diff
  {
    "scripts": {
      "lint": "eslint .",
-     "lint-ci": "eslint .",
      "test": "vitest run",
-     "test-ci": "vitest run"
    }
  }
```

### 2. Standardize Test Commands

**Use this pattern everywhere:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 3. Remove Duplicate `:all` Scripts

If base command already does everything, remove the `:all` variant:

```diff
  {
    "scripts": {
      "type": "tsc --noEmit",
-     "type:all": "tsc --noEmit"
    }
  }
```

---

## 📊 Impact

**socket-cli results:**
- **Removed:** 4 redundant `-ci` scripts
- **Saved:** ~15% script count
- **Benefit:** Clearer, more maintainable

---

## 📖 Full Guide

See complete consolidation guide:
- **socket-cli:** `docs/development/script-consolidation-guide.md`
- **GitHub:** https://github.com/SocketDev/socket-cli/blob/main/docs/development/script-consolidation-guide.md

---

## ✅ Quick Audit Checklist

Run these commands in your repo:

```bash
# 1. Show all scripts
cat package.json | jq '.scripts'

# 2. Find -ci aliases (should remove these)
grep -E '"[^"]*-ci"' package.json

# 3. Find duplicate patterns
find packages -name package.json -exec \
  jq -r '.name + ": " + (.scripts.test // "none")' {} \;
```

**Look for:**
- [ ] Any script ending in `-ci`
- [ ] Duplicate scripts in root and packages
- [ ] Inconsistent test command patterns
- [ ] Scripts that do the exact same thing

---

## 🚀 Quick Implementation

```bash
# 1. Backup
cp package.json package.json.backup

# 2. Remove -ci scripts
# Edit package.json, remove all *-ci entries

# 3. Update CI workflows
# Change references from 'lint-ci' to 'lint'

# 4. Test
pnpm run lint
pnpm run test
pnpm run type

# 5. Commit
git add package.json
git commit -m "chore: remove redundant -ci script aliases"
```

---

## 🤝 Share This!

Copy this file to other Socket repos:
```bash
# In each repo:
mkdir -p docs/development
cp /path/to/socket-cli/docs/development/SCRIPT-SIMPLIFICATION-QUICK-START.md \
   docs/development/
```

---

**Questions?** See full guide or reach out to Socket dev team.
