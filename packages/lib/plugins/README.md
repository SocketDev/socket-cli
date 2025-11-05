# Babel Plugins

Babel transformation plugins exported by `@socketsecurity/lib`.

## `babel-plugin-inline-require-calls`

**Replaces `/*@__INLINE__*/` marked require() calls with literal values.**

```javascript
// Before
const CHAR_FORWARD_SLASH = /*@__INLINE__*/ require('./constants/CHAR_FORWARD_SLASH')

// After
const CHAR_FORWARD_SLASH = 47 /* was: require('./constants/CHAR_FORWARD_SLASH') */
```

Supports: string, number, boolean, null, undefined

## `babel-plugin-strip-debug`

**Removes DEBUG code blocks.**

```javascript
// Before
if (DEBUG) { console.log('debug') }
DEBUG && expression
const x = DEBUG ? dev : prod

// After
// Removed
// Removed
const x = prod
```

Patterns: `if (DEBUG)`, `DEBUG &&`, `DEBUG ? a : b`

## `babel-plugin-inline-process-env`

**Replaces process.env values with literals for dead code elimination.**

```javascript
// Before
if (process.env.NODE_ENV === 'production') { prodCode() } else { devCode() }

// After (with env: { NODE_ENV: 'production' })
if ('production' === 'production') { prodCode() } else { devCode() }

// After Rollup tree-shaking
prodCode()
```

Coerces types: 'true' → boolean, '42' → number

## `babel-plugin-inline-const-enum`

**Inlines TypeScript enum member access.**

```javascript
// Before
if (response.status === HttpStatus.OK) { return StatusCode.Success }

// After
if (response.status === 200) { return 0 }
```

Note: Use TypeScript's `const enum` instead when possible.

## Configuration

```javascript
// .config/babel.config.js
const path = require('node:path')
const pluginsPath = path.join(__dirname, '..', 'plugins')

module.exports = {
  plugins: [
    path.join(pluginsPath, 'babel-plugin-inline-require-calls.js'),
  ]
}
```
