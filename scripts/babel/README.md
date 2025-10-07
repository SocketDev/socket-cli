# Babel Plugins for Socket CLI

This directory contains custom Babel plugins used to transform Socket CLI code during the build process.

## Plugins

### Core Transformation Plugins

#### `babel-plugin-inline-require-calls.js`
Inlines `require()` calls for better bundling performance.

#### `transform-set-proto-plugin.mjs`
Transforms `__proto__` assignments into `Object.setPrototypeOf()` calls for strict mode compatibility.

**Before:**
```javascript
Foo.prototype.__proto__ = Bar.prototype
```

**After:**
```javascript
Object.setPrototypeOf(Foo.prototype, Bar.prototype)
```

#### `transform-url-parse-plugin.mjs`
Optimizes URL parsing operations.

---

### Strict Mode Plugin

#### `babel-plugin-strict-mode.mjs`
Transforms loose-mode JavaScript into strict-mode compatible code.

**Transformations:**
1. **Octal literals** → Decimal numbers
2. **Octal escape sequences** → Proper escape sequences
3. **With statements** → Error (cannot be safely transformed)
4. **Adds 'use strict'** directive if missing

**Example Transformations:**

```javascript
// Before:
var x = 0123  // Octal literal
var str = 'Hello\012World'  // Octal escape

// After:
'use strict'
var x = 83  // Decimal (0123 in octal = 83)
var str = 'Hello\nWorld'  // Proper escape (\012 = \n)
```

**Octal Escape Mappings:**
- `\0` → `\0` (null)
- `\10` → `\b` (backspace)
- `\11` → `\t` (tab)
- `\12` → `\n` (line feed)
- `\13` → `\v` (vertical tab)
- `\14` → `\f` (form feed)
- `\15` → `\r` (carriage return)
- `\16`-`\377` → `\xNN` (hex escape)

**Usage:**
This plugin is **always enabled** in the build pipeline (see `.config/babel.config.js`).

---

### ICU Removal Plugin

#### `babel-plugin-remove-icu.mjs`
Transforms ICU-dependent code into ICU-free alternatives, allowing Node.js to be built with `--without-intl`.

**⚠️ Important:** This plugin is **disabled by default** because:
1. It requires building Node.js with `--without-intl` (saves ~8-10MB)
2. Transforms are lossy (no real locale support, just formatting)
3. Should only be used if binary size is critical

**Transformations:**

##### 1. Number Formatting
```javascript
// Before:
count.toLocaleString()
(1234567).toLocaleString()

// After:
__formatNumber(count)  // → "1,234,567"
__formatNumber(1234567)
```

##### 2. Date Formatting
```javascript
// Before:
new Date().toLocaleDateString()
new Date().toLocaleTimeString()

// After:
__formatDate(new Date())  // → "2025-10-07"
// ISO time format
```

##### 3. String Comparison
```javascript
// Before:
str1.localeCompare(str2)

// After:
__simpleCompare(str1, str2)  // Basic < > comparison
```

##### 4. Intl.* APIs
```javascript
// Before:
new Intl.NumberFormat().format(num)
new Intl.DateTimeFormat().format(date)

// After:
{ format: (num) => __formatNumber(num) }
{ format: (date) => date.toISOString() }
```

##### 5. Unicode Regular Expressions
```javascript
// Before:
/\p{Letter}/u
/\p{Number}/u

// After:
/[a-zA-Z]/
/[0-9]/
```

**Helper Functions Generated:**
```javascript
function __formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function __formatDate(date) {
  return date.toISOString().split('T')[0]
}

function __formatDateTime(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function __simpleCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
```

**Limitations:**
- ❌ No real locale support (only English-style formatting)
- ❌ No timezone support beyond UTC
- ❌ No currency formatting
- ❌ No plural rules
- ❌ No locale-aware sorting (simple byte comparison only)

**When to Use:**
- Building pkg binaries where every MB matters
- English-only CLI tool
- Willing to trade locale support for ~8-10MB size reduction

**How to Enable:**

1. Uncomment the plugin in `.config/babel.config.js`:
```javascript
plugins: [
  // ... other plugins ...
  path.join(babelPluginsPath, 'babel-plugin-remove-icu.mjs'),  // Uncomment this line
]
```

2. Rebuild Node.js with `--without-intl`:
```bash
cd .custom-node-build/node-yao-pkg
git reset --hard v24.9.0
git clean -fdx
patch -p1 < ../patches/node.v24.9.0.cpp.patch

./configure \
  --without-intl \
  --without-npm \
  --without-corepack \
  --without-inspector \
  --without-amaro \
  --without-sqlite \
  --without-node-snapshot \
  --without-node-code-cache

make -j$(sysctl -n hw.ncpu)
```

3. Rebuild Socket CLI:
```bash
pnpm run build:dist
```

**Testing:**
After enabling, verify all CLI output still works:
```bash
# Test number formatting
pnpm exec socket scan --help

# Test date display
pnpm exec socket info some-package

# Test full CLI functionality
pnpm run test:unit
```

---

## Plugin Execution Order

Plugins run in this order (defined in `.config/babel.config.js`):

1. `@babel/preset-typescript` (preset)
2. `@babel/preset-react` (preset)
3. `@babel/plugin-proposal-export-default-from`
4. `@babel/plugin-transform-export-namespace-from`
5. `@babel/plugin-transform-runtime`
6. **`babel-plugin-strict-mode.mjs`** ⭐ (fixes loose-mode code)
7. `babel-plugin-inline-require-calls.js`
8. `transform-set-proto-plugin.mjs`
9. `transform-url-parse-plugin.mjs`
10. `babel-plugin-remove-icu.mjs` (disabled by default)

---

## Development

### Adding a New Plugin

1. Create a new file in `scripts/babel/` with the `.mjs` extension
2. Add `@fileoverview` header with description
3. Export a default function that returns a Babel plugin:

```javascript
/** @fileoverview Brief description of what the plugin does */

export default function myPlugin({ types: t }) {
  return {
    name: 'my-plugin-name',
    visitor: {
      // AST visitor methods
      Identifier(path) {
        // Transform code
      }
    }
  }
}
```

4. Add the plugin to `.config/babel.config.js`:
```javascript
plugins: [
  // ...
  path.join(babelPluginsPath, 'my-new-plugin.mjs'),
]
```

### Testing Plugins

Build and test the transformed output:
```bash
# Build with transformations
pnpm run build:dist:src

# Check transformed code
cat dist/cli.js | head -100

# Run tests
pnpm run test:unit
```

---

## Size Impact

| Plugin | Binary Size Impact | Purpose |
|--------|-------------------|---------|
| `babel-plugin-strict-mode.mjs` | ~0 bytes | Code compatibility |
| `babel-plugin-remove-icu.mjs` | **-8-10MB** | Remove ICU dependency |

**Note:** The size reduction comes from building Node.js with `--without-intl`, not the plugin itself. The plugin just makes the code work without ICU.

---

## References

- [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md)
- [Babel Types API](https://babeljs.io/docs/en/babel-types)
- [AST Explorer](https://astexplorer.net/) - Visualize AST transformations
- [Node.js ICU Documentation](https://nodejs.org/api/intl.html)
- [Socket CLI Build Documentation](../../docs/YAO_PKG_BUILD.md)
