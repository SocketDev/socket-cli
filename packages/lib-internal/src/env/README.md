# Environment Variables

**Typed environment variable access** — 68 getters across 22 modules.

---

## 🎯 Philosophy

Each environment variable gets its own module with a pure getter function:

```typescript
// src/env/ci.ts
export function getCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1'
}
```

**Benefits:**
- Tree-shakeable (only import what you need)
- Type-safe return values
- Testable via rewire module
- No direct `process.env` access in consuming code

---

## 📋 Available Getters

### CI/CD Detection
```typescript
import { getCI } from '@socketsecurity/lib/env/ci'
import { getGitHubActions } from '@socketsecurity/lib/env/github-actions'

if (getCI()) {
  // Running in CI
}

if (getGitHubActions()) {
  // Running in GitHub Actions specifically
}
```

| Module | Getter | Type | Description |
|--------|--------|------|-------------|
| `ci` | `getCI()` | `boolean` | CI environment detection |
| `github-actions` | `getGitHubActions()` | `boolean` | GitHub Actions detection |

---

### Node.js Environment
```typescript
import { getNodeEnv } from '@socketsecurity/lib/env/node-env'
import { getNodeOptions } from '@socketsecurity/lib/env/node-options'

const env = getNodeEnv() // 'development' | 'production' | 'test' | undefined
const options = getNodeOptions() // NODE_OPTIONS string
```

| Module | Getter | Type | Description |
|--------|--------|------|-------------|
| `node-env` | `getNodeEnv()` | `string \| undefined` | NODE_ENV value |
| `node-options` | `getNodeOptions()` | `string \| undefined` | NODE_OPTIONS value |

---

### GitHub Environment
```typescript
import { GITHUB_REPOSITORY } from '@socketsecurity/lib/env/github-repository'
import { GITHUB_REF_TYPE } from '@socketsecurity/lib/env/github-ref-type'
import { GITHUB_BASE_REF } from '@socketsecurity/lib/env/github-base-ref'

console.log(GITHUB_REPOSITORY) // 'owner/repo'
console.log(GITHUB_REF_TYPE)    // 'branch' | 'tag' | undefined
console.log(GITHUB_BASE_REF)    // 'main' (in PRs)
```

| Module | Export | Type | Description |
|--------|--------|------|-------------|
| `github-repository` | `GITHUB_REPOSITORY` | `string \| undefined` | Repository slug |
| `github-ref-type` | `GITHUB_REF_TYPE` | `string \| undefined` | Ref type |
| `github-base-ref` | `GITHUB_BASE_REF` | `string \| undefined` | PR base branch |
| `github-server-url` | `GITHUB_SERVER_URL` | `string \| undefined` | GitHub server URL |
| `github-api-url` | `GITHUB_API_URL` | `string \| undefined` | GitHub API URL |

---

### Paths & Directories
```typescript
import { getHome } from '@socketsecurity/lib/env/home'
import { getUserProfile } from '@socketsecurity/lib/env/userprofile'
import { getTmpdir } from '@socketsecurity/lib/env/tmpdir'

const homeDir = getHome() || getUserProfile() // Cross-platform home
const tmpDir = getTmpdir() || '/tmp'          // Temp directory
```

| Module | Getter | Type | Description |
|--------|--------|------|-------------|
| `home` | `getHome()` | `string \| undefined` | HOME (Unix) |
| `userprofile` | `getUserProfile()` | `string \| undefined` | USERPROFILE (Windows) |
| `tmpdir` | `getTmpdir()` | `string \| undefined` | TMPDIR |
| `temp` | `getTemp()` | `string \| undefined` | TEMP (Windows) |
| `tmp` | `getTmp()` | `string \| undefined` | TMP (Windows) |
| `xdg-cache-home` | `XDG_CACHE_HOME` | `string \| undefined` | XDG cache |
| `xdg-data-home` | `XDG_DATA_HOME` | `string \| undefined` | XDG data |
| `localappdata` | `LOCALAPPDATA` | `string \| undefined` | Windows local app data |

---

### Terminal & Display
```typescript
import { getTerm` } from '@socketsecurity/lib/env/term'
import { getTty } from '@socketsecurity/lib/env/tty'

const term = getTerm() // 'xterm-256color'
const tty = getTty()   // TTY path
```

| Module | Getter | Type | Description |
|--------|--------|------|-------------|
| `term` | `getTerm()` | `string \| undefined` | TERM value |
| `tty` | `getTty()` | `string \| undefined` | TTY path |

---

### npm Environment
```typescript
import { getNpmConfigCache } from '@socketsecurity/lib/env/npm-config-cache'
import { getNpmConfigUserAgent } from '@socketsecurity/lib/env/npm-config-user-agent'

const cacheDir = getNpmConfigCache()
const userAgent = getNpmConfigUserAgent()
// 'npm/8.19.2 node/v18.12.0 darwin arm64'
```

| Module | Getter | Type | Description |
|--------|--------|------|-------------|
| `npm-config-cache` | `getNpmConfigCache()` | `string \| undefined` | npm cache directory |
| `npm-config-user-agent` | `getNpmConfigUserAgent()` | `string \| undefined` | npm user agent string |

---

### Socket CLI Environment
```typescript
import { SOCKET_CLI_API_BASE_URL } from '@socketsecurity/lib/env/socket-cli-api-base-url'
import { SOCKET_CLI_ACCEPT_RISKS } from '@socketsecurity/lib/env/socket-cli-accept-risks'

const apiUrl = SOCKET_CLI_API_BASE_URL || 'https://api.socket.dev'
const acceptRisks = SOCKET_CLI_ACCEPT_RISKS // boolean
```

**All Socket CLI env modules:**
- `socket-cli-api-base-url`
- `socket-cli-accept-risks`
- `socket-cli-autoload-manifest`
- `socket-cli-config-path`
- `socket-cli-debug-output-dir`
- `socket-cli-disable-spinner`
- ... (and 20+ more)

See source files for complete list.

---

### Test Environment
```typescript
import { isTest } from '@socketsecurity/lib/env/test'
import { RUN_E2E_TESTS } from '@socketsecurity/lib/env/run-e2e-tests'

if (isTest()) {
  // Running in test environment
}

if (RUN_E2E_TESTS) {
  // Run E2E tests
}
```

| Module | Getter/Export | Type | Description |
|--------|---------------|------|-------------|
| `test` | `isTest()` | `boolean` | Test environment detection |
| `run-e2e-tests` | `RUN_E2E_TESTS` | `boolean` | E2E test flag |

---

## 🧪 Testing with Rewire

**Problem:** Testing code that reads environment variables without mutating `process.env`.

**Solution:** Use the rewire module:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { setEnv, clearEnv, resetEnv } from '@socketsecurity/lib/env/rewire'
import { getCI } from '@socketsecurity/lib/env/ci'

describe('CI detection', () => {
  afterEach(() => {
    resetEnv() // Clean up after each test
  })

  it('detects CI=true', () => {
    setEnv('CI', 'true')
    expect(getCI()).toBe(true)
  })

  it('detects CI=1', () => {
    setEnv('CI', '1')
    expect(getCI()).toBe(true)
  })

  it('returns false when CI unset', () => {
    clearEnv('CI')
    expect(getCI()).toBe(false)
  })
})
```

**Rewire API:**
```typescript
// Set override (doesn't mutate process.env)
setEnv('MY_VAR', 'value')

// Clear single override
clearEnv('MY_VAR')

// Reset all overrides (use in afterEach)
resetEnv()
```

---

## 🔧 Adding New Environment Variables

### 1. Create Module File

```typescript
// src/env/my-var.ts

/**
 * MY_VAR environment variable.
 *
 * Description of what this var does.
 */

/**
 * Get MY_VAR value.
 */
export function getMyVar(): string | undefined {
  return process.env.MY_VAR
}
```

### 2. Export from Index

```typescript
// src/env/index.ts
export { getMyVar } from './my-var'
```

### 3. Add to Package Exports

```json
// package.json
{
  "exports": {
    "./env/my-var": {
      "types": "./dist/env/my-var.d.ts",
      "default": "./dist/env/my-var.js"
    }
  }
}
```

### 4. Add Tests

```typescript
// test/env/my-var.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { setEnv, resetEnv } from '../../src/env/rewire'
import { getMyVar } from '../../src/env/my-var'

describe('getMyVar', () => {
  afterEach(() => resetEnv())

  it('returns MY_VAR value', () => {
    setEnv('MY_VAR', 'test-value')
    expect(getMyVar()).toBe('test-value')
  })

  it('returns undefined when unset', () => {
    expect(getMyVar()).toBeUndefined()
  })
})
```

---

## 💡 Design Patterns

### Pattern 1: Boolean Detection

```typescript
export function getCI(): boolean {
  const ci = process.env.CI
  return ci === 'true' || ci === '1'
}
```

**Use for:** Feature flags, environment detection

---

### Pattern 2: String Value

```typescript
export function getNodeEnv(): string | undefined {
  return process.env.NODE_ENV
}
```

**Use for:** Configuration values, paths

---

### Pattern 3: Direct Export (Constants)

```typescript
export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY
```

**Use for:** Values read once at startup

---

### Pattern 4: Fallback Chain

```typescript
export function getHomeDir(): string {
  return getHome() || getUserProfile() || '/tmp'
}
```

**Use for:** Cross-platform values with fallbacks

---

## 📊 Module Organization

```
env/
├── rewire.ts          # Test utilities
├── index.ts           # Re-exports all getters
├── ci.ts              # CI detection
├── github-*.ts        # GitHub Actions vars (5 modules)
├── node-*.ts          # Node.js vars (2 modules)
├── npm-*.ts           # npm vars (2 modules)
├── socket-cli-*.ts    # Socket CLI vars (20+ modules)
├── home.ts            # HOME
├── userprofile.ts     # USERPROFILE (Windows)
├── tmp*.ts            # Temp directory vars (3 modules)
├── xdg-*.ts           # XDG vars (2 modules)
└── ...                # And more!
```

**Total:** 22 modules, 68+ getters/exports

---

## 🔗 Related Modules

- [../constants/](../constants/) — Constants (Node, npm, platform)
- [../stdio/](../stdio/) — Terminal I/O (uses env for detection)
- [../logger.ts](../logger.ts) — Logger (uses env for formatting)

---

## 📚 Examples

### Example 1: Cross-Platform Home Directory

```typescript
import { getHome } from '@socketsecurity/lib/env/home'
import { getUserProfile } from '@socketsecurity/lib/env/userprofile'

function getHomeDir(): string {
  const home = getHome() || getUserProfile()
  if (!home) {
    throw new Error('Could not determine home directory')
  }
  return home
}
```

### Example 2: CI Environment Customization

```typescript
import { getCI } from '@socketsecurity/lib/env/ci'
import { Spinner } from '@socketsecurity/lib/spinner'

function createSpinner(text: string) {
  if (getCI()) {
    // No spinner in CI
    console.log(text)
    return { start: () => {}, stop: () => {} }
  }

  return Spinner({ text })
}
```

### Example 3: GitHub Actions Context

```typescript
import { getGitHubActions } from '@socketsecurity/lib/env/github-actions'
import { GITHUB_REPOSITORY } from '@socketsecurity/lib/env/github-repository'
import { GITHUB_REF_TYPE } from '@socketsecurity/lib/env/github-ref-type'

if (getGitHubActions()) {
  console.log(`Running in GitHub Actions`)
  console.log(`Repository: ${GITHUB_REPOSITORY}`)
  console.log(`Ref type: ${GITHUB_REF_TYPE}`)
}
```

---

## 💡 Tips

- **One module per env var** — Keeps imports minimal
- **Use rewire for tests** — Don't mutate `process.env`
- **Boolean for flags** — `=== 'true' || === '1'`
- **Direct exports for constants** — Read once at startup
- **Fallback chains for cross-platform** — `getHome() || getUserProfile()`

---

## 📚 Documentation

- **[Getting Started Guide](../../docs/getting-started.md)** — Quick setup for contributors
- **[CLAUDE.md](../../CLAUDE.md)** — Development standards and patterns
- **[Main README](../../README.md)** — Package overview and API reference

**Complete list of all 68 getters available in source files.**
