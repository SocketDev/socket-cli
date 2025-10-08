# Socket CLI Babel Plugins

This document explains the custom Babel plugins used to transform Socket CLI code during the build process.

## Overview

Socket CLI uses custom Babel plugins to ensure code compatibility and enable size optimizations:

1. **`babel-plugin-strict-mode.mjs`** - Transforms loose-mode code to strict-mode
2. **`babel-plugin-remove-icu.mjs`** - Removes ICU dependencies (optional)

## Strict Mode Plugin

### Purpose

Ensures all code runs correctly in strict mode by transforming problematic patterns that are allowed in loose mode but forbidden in strict mode.

### Location

`scripts/babel/babel-plugin-strict-mode.mjs`

### Transformations

#### 1. Octal Numeric Literals

Legacy octal literals (starting with `0`) are converted to decimal equivalents.

**Before:**
```javascript
var x = 0123  // Octal literal (83 in decimal)
var y = 0755  // Octal literal (493 in decimal)
```

**After:**
```javascript
'use strict'
/* Strict-mode: Transformed octal 0123 → 83 */
var x = 83
/* Strict-mode: Transformed octal 0755 → 493 */
var y = 493
```

#### 2. Octal Escape Sequences in Strings

Octal escape sequences in strings are converted to proper escape sequences or hex escapes.

**Before:**
```javascript
var str1 = 'Hello\012World'   // \012 = newline
var str2 = 'Tab\011here'      // \011 = tab
var str3 = '\033[31mRed\033[0m'  // \033 = ESC
```

**After:**
```javascript
'use strict'
/* Strict-mode: Transformed octal escapes */
var str1 = 'Hello\nWorld'
/* Strict-mode: Transformed octal escapes */
var str2 = 'Tab\there'
/* Strict-mode: Transformed octal escapes */
var str3 = '\x1b[31mRed\x1b[0m'
```

**Common Octal Escape Mappings:**
- `\10` → `\b` (backspace)
- `\11` → `\t` (tab)
- `\12` → `\n` (line feed)
- `\13` → `\v` (vertical tab)
- `\14` → `\f` (form feed)
- `\15` → `\r` (carriage return)
- `\16`-`\377` → `\xNN` (hex escape)

#### 3. Template Literals

Octal escapes in template literals are also transformed:

**Before:**
```javascript
const msg = `Line1\012Line2`
```

**After:**
```javascript
'use strict'
/* Strict-mode: Transformed octal escapes in template */
const msg = `Line1\nLine2`
```

#### 4. With Statements

`with` statements cannot be safely transformed, so the plugin throws a compilation error:

**Before:**
```javascript
with (obj) {
  x = 1
}
```

**After:**
```
ERROR: "with" statement is not allowed in strict mode and cannot be safely transformed.
Please refactor your code to avoid using "with" statements.
```

#### 5. 'use strict' Directive

Automatically adds `'use strict'` directive to files that don't have it:

**Before:**
```javascript
function foo() {
  return 42
}
```

**After:**
```javascript
'use strict'

function foo() {
  return 42
}
```

### Statistics

The plugin tracks and reports transformations:

```javascript
/*
Strict Mode Transformation Stats:
  - Octal literals converted: 5
  - Octal escapes transformed: 12
  - With statements found: 0
  - Strict directives added: 1
  Total transformations: 18
*/
```

### Always Enabled

This plugin is **always enabled** in Socket CLI builds. It ensures compatibility and catches potential issues early.

---

## ICU Removal Plugin

### Purpose

Transforms ICU-dependent code into ICU-free alternatives, allowing Node.js to be built with `--without-intl` to save ~8-10MB.

### Location

`scripts/babel/babel-plugin-remove-icu.mjs`

### Status

**Disabled by default** - Only enable if building with `--without-intl` Node.js.

### Transformations

#### 1. Number Formatting

Transforms `.toLocaleString()` calls to simple comma-separated formatting:

**Before:**
```javascript
const count = 1234567
console.log(`Found ${count.toLocaleString()} vulnerabilities`)
```

**After:**
```javascript
function __formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/* ICU-free: Transformed toLocaleString() → __formatNumber() */
console.log(`Found ${__formatNumber(count)} vulnerabilities`)
// Output: "Found 1,234,567 vulnerabilities"
```

#### 2. Date Formatting

Transforms date formatting methods to ISO format:

**Before:**
```javascript
const date = new Date()
console.log(`Scanned at ${date.toLocaleDateString()}`)
console.log(`Time: ${date.toLocaleTimeString()}`)
```

**After:**
```javascript
function __formatDate(date) {
  return date.toISOString().split('T')[0]
}

/* ICU-free: Transformed toLocaleDateString() → __formatDate() */
console.log(`Scanned at ${__formatDate(date)}`)
// Output: "Scanned at 2025-10-07"

/* ICU-free: Transformed toLocaleTimeString() → ISO time */
console.log(`Time: ${date.toISOString().split('T')[1]}`)
```

#### 3. String Comparison

Transforms `.localeCompare()` to basic string comparison:

**Before:**
```javascript
packages.sort((a, b) => a.name.localeCompare(b.name))
```

**After:**
```javascript
function __simpleCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/* ICU-free: Transformed localeCompare() → __simpleCompare() */
packages.sort((a, b) => __simpleCompare(a.name, b.name))
```

⚠️ **Note:** This uses byte comparison, not locale-aware sorting. `'ä'` may not sort correctly with non-ASCII characters.

#### 4. Intl.* APIs

Transforms `Intl.*` APIs to simple wrappers:

**Before:**
```javascript
const formatter = new Intl.NumberFormat()
console.log(formatter.format(1234567))

const dateFormatter = new Intl.DateTimeFormat()
console.log(dateFormatter.format(new Date()))
```

**After:**
```javascript
function __formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/* WARNING: Intl.NumberFormat removed - using basic number formatting */
const formatter = {
  format(num) {
    return __formatNumber(num)
  }
}
console.log(formatter.format(1234567))
// Output: "1,234,567"

/* WARNING: Intl.DateTimeFormat removed - using basic date formatting */
const dateFormatter = {
  format(date) {
    return date.toISOString()
  }
}
console.log(dateFormatter.format(new Date()))
// Output: "2025-10-07T11:30:00.000Z"
```

#### 5. Unicode Regular Expressions

Transforms Unicode property escapes to character classes:

**Before:**
```javascript
const letterRegex = /\p{Letter}/u
const digitRegex = /\p{Number}/u
const spaceRegex = /\p{White_Space}/u
```

**After:**
```javascript
/* ICU-free: Transformed unicode regex → character class */
const letterRegex = /[a-zA-Z]/
/* ICU-free: Transformed unicode regex → character class */
const digitRegex = /[0-9]/
/* ICU-free: Transformed unicode regex → character class */
const spaceRegex = /\s/
```

**Supported Transformations:**
- `\p{Letter}`, `\p{L}`, `\p{Alphabetic}` → `[a-zA-Z]`
- `\p{Number}`, `\p{N}`, `\p{Digit}`, `\p{Nd}` → `[0-9]`
- `\p{Space}`, `\p{White_Space}` → `\s`
- `\p{ASCII}` → `[\x00-\x7F]`

⚠️ **Complex patterns not supported:**
```javascript
/\p{Script=Greek}/u  // ❌ Will add warning comment
// WARNING: Complex unicode regex may not work without ICU!
```

### Statistics

The plugin tracks and reports transformations:

```javascript
/*
ICU Removal Stats:
  - toLocaleString() calls: 8
  - toLocaleDateString() calls: 3
  - toLocaleTimeString() calls: 2
  - localeCompare() calls: 12
  - Intl.* API usage: 5
  - Unicode regex patterns: 7
  Total transformations: 37
*/
```

### Limitations

When ICU is removed, the following features are lost:

❌ **No real locale support** (only English-style formatting)
❌ **No timezone support** beyond UTC
❌ **No currency formatting** (`Intl.NumberFormat` with `style: 'currency'`)
❌ **No plural rules** (`Intl.PluralRules`)
❌ **No locale-aware sorting** (simple byte comparison only)
❌ **No date/time localization** (ISO format only)
❌ **Limited Unicode regex** (only basic character classes)

### When to Enable

Enable this plugin only if:

✅ Building pkg binaries where every MB matters
✅ English-only CLI tool (no internationalization needed)
✅ Willing to trade locale support for ~8-10MB size reduction
✅ Ready to test all CLI output thoroughly

### How to Enable

#### Step 1: Enable the Babel Plugin

Edit `.config/babel.config.js`:

```javascript
module.exports = {
  presets: ['@babel/preset-react', '@babel/preset-typescript'],
  plugins: [
    // ... other plugins ...
    path.join(babelPluginsPath, 'babel-plugin-strict-mode.mjs'),
    path.join(babelPluginsPath, 'babel-plugin-inline-require-calls.js'),
    path.join(babelPluginsPath, 'transform-set-proto-plugin.mjs'),
    path.join(babelPluginsPath, 'transform-url-parse-plugin.mjs'),
    // Uncomment to enable ICU removal:
    path.join(babelPluginsPath, 'babel-plugin-remove-icu.mjs'),  // ← Uncomment this line
  ],
}
```

#### Step 2: Rebuild Node.js WITHOUT ICU

Edit `scripts/build-yao-pkg-node.sh` and change configure options:

```bash
./configure \
  --without-intl \    # ← Change from --with-intl=small-icu
  --without-npm \
  --without-corepack \
  --without-inspector \
  --without-amaro \
  --without-sqlite
```

Then rebuild:

```bash
cd .custom-node-build/node-yao-pkg
git reset --hard v24.9.0
git clean -fdx
patch -p1 < ../patches/node.v24.9.0.cpp.patch
./configure --without-intl --without-npm --without-corepack --without-inspector --without-amaro --without-sqlite
make -j$(sysctl -n hw.ncpu)
```

#### Step 3: Rebuild Socket CLI

```bash
cd /Users/jdalton/projects/socket-cli
pnpm run build:dist
```

#### Step 4: Test Thoroughly

Test all CLI functionality:

```bash
# Test help output
pnpm exec socket --help
pnpm exec socket scan --help

# Test number formatting (package counts, file sizes)
pnpm exec socket info some-package

# Test date display
pnpm exec socket scan .

# Run unit tests
pnpm run test:unit
```

### Size Impact

| Configuration | Node.js Binary Size | ICU Plugin | Impact |
|---------------|-------------------|-----------|---------|
| Current | 82.7 MB | Disabled | Baseline |
| With ICU removal | ~74-76 MB | Enabled | **-8-10 MB** |

**Note:** The actual size reduction comes from building Node.js with `--without-intl`. The Babel plugin just makes the code work without ICU.

---

## Plugin Execution Order

Plugins run in this order (defined in `.config/babel.config.js`):

1. `@babel/preset-typescript` (preset)
2. `@babel/preset-react` (preset)
3. `@babel/plugin-proposal-export-default-from`
4. `@babel/plugin-transform-export-namespace-from`
5. `@babel/plugin-transform-runtime`
6. **`babel-plugin-strict-mode.mjs`** ⭐ (fixes loose-mode code first)
7. `babel-plugin-inline-require-calls.js`
8. `transform-set-proto-plugin.mjs`
9. `transform-url-parse-plugin.mjs`
10. `babel-plugin-remove-icu.mjs` (disabled by default, runs last if enabled)

**Why this order?**
- Strict-mode transformations run early to fix fundamental issues
- ICU removal runs last to transform final API calls

---

## Development

### Testing Plugins

To see the transformed output:

```bash
# Build with transformations
pnpm run build:dist:src

# Check transformed code
cat dist/cli.js | head -200

# Look for plugin comments
grep -n "Strict-mode:" dist/*.js
grep -n "ICU-free:" dist/*.js
```

### Adding a New Plugin

1. Create file in `scripts/babel/` with `.mjs` extension
2. Add `@fileoverview` header
3. Export default function returning Babel plugin
4. Add to `.config/babel.config.js`
5. Test with `pnpm run build:dist:src`

See `scripts/babel/README.md` for detailed instructions.

---

## Related Documentation

- [Babel Plugin Development Guide](../scripts/babel/README.md)
- [yao-pkg Build Documentation](./YAO_PKG_BUILD.md)
- [Node.js ICU Documentation](https://nodejs.org/api/intl.html)
- [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md)

---

## Troubleshooting

### Plugin Not Running

If transformations aren't being applied:

1. Check plugin is uncommented in `.config/babel.config.js`
2. Rebuild: `pnpm run build:dist:src`
3. Check for Babel errors: `pnpm run build:dist 2>&1 | grep -i error`

### ICU Plugin Enabled But Code Still Works

If you enabled the ICU plugin but code using `Intl.*` still works:

- Node.js may still have ICU enabled (`--with-intl=small-icu`)
- Rebuild Node.js with `--without-intl` (see Step 2 above)
- Verify with: `PKG_EXECPATH=PKG_INVOKE_NODEJS ./out/Release/node -e "console.log(typeof Intl)"`
  - Should output: `undefined`

### Tests Failing After Enabling ICU Removal

Some tests may fail because they expect real locale support:

1. Update test expectations for ICU-free output
2. Mock `Intl.*` APIs in tests if needed
3. Check test snapshots: `pnpm run test:unit:update`

---

## Summary

Socket CLI uses custom Babel plugins to:

1. **Ensure strict-mode compatibility** (always enabled)
2. **Optionally remove ICU dependencies** for ~8-10MB size savings

The strict-mode plugin is production-ready and always enabled. The ICU removal plugin is optional and should only be enabled when building size-optimized pkg binaries with custom Node.js builds.
