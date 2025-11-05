# Babel AST Transforms

Source code transformations using Babel AST walkers + magic-string.

## Pattern: Babel AST + magic-string

**All transforms in this directory follow this pattern:**

1. **Parse with Babel** - Get AST for analysis
2. **Walk with Babel traverse** - Find nodes to transform
3. **Edit with magic-string** - Surgical source modifications
4. **Preserve source maps** - magic-string maintains mappings

**Rationale:**

- Babel AST for parsing and semantic analysis
- magic-string for precise edits without re-printing
- Combines AST analysis with source-level modifications

## Example Transform

```javascript
import MagicString from 'magic-string'
const { parse } = await import('@babel/parser')
const traverse = (await import('@babel/traverse')).default
const t = await import('@babel/types')

async function transform(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const magicString = new MagicString(content)

  // 1. Parse
  const ast = parse(content, { sourceType: 'module' })

  // 2. Walk
  traverse(ast, {
    Identifier(path) {
      if (path.node.name === 'oldName') {
        // 3. Edit with magic-string (not Babel transform)
        magicString.overwrite(
          path.node.start,
          path.node.end,
          'newName'
        )
      }
    }
  })

  // 4. Write
  await fs.writeFile(filePath, magicString.toString(), 'utf8')
}
```

## Required Dependencies (Pinned)

```json
{
  "@babel/parser": "7.28.4",
  "@babel/traverse": "7.28.4",
  "@babel/types": "7.28.4",
  "magic-string": "0.30.19"
}
```

**Always pin versions for source transforms** to ensure consistent behavior across builds.

## Available Transforms

### `transform-commonjs-exports.mjs`

Fixes TypeScript-compiled CommonJS exports for better compatibility.

**Transforms:**
- `exports.default = value` → `module.exports = value`
- Removes `__esModule` markers
- Fixes `.default` accessor in imports

**Usage:**

```javascript
import { transformFile, fixImports } from './transform-commonjs-exports.mjs'

// Transform exports
const result = await transformFile('dist/lib/constants/WIN32.js')

// Fix imports
await fixImports('dist/lib/path.js', fixedModules)
```

**Why needed:**

TypeScript compiles `export default X` to `exports.default = X`, requiring `.default` accessor in CommonJS. This transform makes it work without `.default`:

```javascript
// Before: require('./WIN32').default
// After:  require('./WIN32')
```

## Creating New Transforms

1. **Create `transform-<name>.mjs`** in this directory
2. **Follow the pattern**: Babel AST + magic-string
3. **Export functions**: `transformFile()`, etc.
4. **Document**: Add section to this README
5. **Pin versions**: Use exact dependency versions

### Transform Template

```javascript
/**
 * @fileoverview Transform description.
 * Uses Babel AST walkers + magic-string for surgical transformations.
 */

import { promises as fs } from 'node:fs'
import MagicString from 'magic-string'

// Pinned versions required:
// - @babel/parser@7.28.4
// - @babel/traverse@7.28.4
// - @babel/types@7.28.4
// - magic-string@0.30.19

const { parse } = await import('@babel/parser')
const traverse = (await import('@babel/traverse')).default
const t = await import('@babel/types')

function parseCode(code) {
  return parse(code, {
    sourceType: 'module',
    // Add parser plugins as needed
  })
}

export async function transformFile(filePath, options = {}) {
  const content = await fs.readFile(filePath, 'utf8')
  const magicString = new MagicString(content)
  let modified = false

  try {
    const ast = parseCode(content)

    traverse(ast, {
      // Add visitors
      Identifier(path) {
        // Check conditions
        if (shouldTransform(path.node)) {
          // Use magic-string for edits
          magicString.overwrite(
            path.node.start,
            path.node.end,
            'newValue'
          )
          modified = true
        }
      }
    })

    if (modified) {
      await fs.writeFile(filePath, magicString.toString(), 'utf8')
      return { modified: true }
    }
  } catch (e) {
    // Handle parse errors
  }

  return { modified: false }
}
```

## Babel Plugins vs Transforms

**Babel Plugins** (`registry/plugins/`):
- Run **during** Babel's transformation pipeline
- Use Babel's transformation API
- Return AST nodes
- Example: `babel-plugin-inline-require-calls.mjs`

**Standalone Transforms** (`scripts/babel/`):
- Run **after** compilation as post-processing
- Use Babel AST for analysis only
- Use magic-string for source edits
- Example: `transform-commonjs-exports.mjs`

**When to use each:**

| Use Case | Tool |
|----------|------|
| Babel pipeline | Babel Plugin |
| Post-build fixes | Standalone Transform |
| Rollup integration | Babel Plugin |
| Script automation | Standalone Transform |

## Integration with Build

### Rollup `writeBundle` Hook (Recommended)

Integrate transforms directly into Rollup's build pipeline using the `writeBundle` hook:

```javascript
// .config/rollup.dist.config.mjs
import fastGlob from 'fast-glob'
import {
  fixImports,
  transformFile,
} from '../scripts/babel/transform-commonjs-exports.mjs'

export default {
  // ... other config
  plugins: [
    // ... other plugins
    {
      name: 'transform-commonjs-exports',
      async writeBundle() {
        const files = await fastGlob('**/*.js', {
          absolute: true,
          cwd: distPath,
        })

        const fixedModules = new Set()

        // First pass: transform exports.default to module.exports
        for (const file of files) {
          const result = await transformFile(file)
          if (result.modified && result.moduleName) {
            fixedModules.add(result.moduleName)
          }
        }

        // Second pass: fix .default accessors in imports
        for (const file of files) {
          await fixImports(file, fixedModules)
        }
      },
    },
  ],
}
```

### Standalone Script (Alternative)

For projects not using Rollup, run as a standalone script:

```javascript
// scripts/fix-commonjs-exports.mjs
import { transformFile, fixImports } from './babel/transform-commonjs-exports.mjs'
import fastGlob from 'fast-glob'

const files = await fastGlob('dist/**/*.js')
const fixedModules = new Set()

// First pass: transform exports
for (const file of files) {
  const result = await transformFile(file)
  if (result.modified) {
    fixedModules.add(result.moduleName)
  }
}

// Second pass: fix imports
for (const file of files) {
  await fixImports(file, fixedModules)
}
```

```json
// package.json
{
  "scripts": {
    "build": "tsgo && node scripts/fix-commonjs-exports.mjs"
  }
}
```

## Best Practices

1. **Always use magic-string** - Don't use Babel's code generator for transforms
2. **Pin dependency versions** - Source transforms need stability
3. **Parse once** - Cache AST if walking multiple times
4. **Handle errors gracefully** - Skip unparseable files
5. **Test thoroughly** - Verify source maps still work
6. **Document transformations** - Explain why each transform is needed

## Performance

- Babel parsing (optimized C++ parser)
- AST analysis (JavaScript object traversal)
- magic-string edits (string slicing, no re-parsing)
- No code generation (skips Babel's printer)

< 10ms per file for most transforms.

## References

- [Babel Parser](https://babeljs.io/docs/babel-parser)
- [Babel Traverse](https://babeljs.io/docs/babel-traverse)
- [Babel Types](https://babeljs.io/docs/babel-types)
- [magic-string](https://github.com/rich-harris/magic-string)
