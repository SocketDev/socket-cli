# Package Management Utilities

**npm, pnpm, yarn, bun utilities** — 11 modules for package manager operations.

---

## 📦 What's Included

```
packages/
├── detect-pm.ts          # Detect package manager (npm/pnpm/yarn/bun)
├── install.ts            # Install dependencies
├── link.ts               # Link packages
├── unlink.ts             # Unlink packages
├── list.ts               # List installed packages
├── outdated.ts           # Check for outdated packages
├── parse-lockfile.ts     # Parse lockfiles (package-lock, pnpm-lock, yarn.lock)
├── resolve-version.ts    # Resolve package versions
├── fetch-metadata.ts     # Fetch package metadata from registry
├── validate-manifest.ts  # Validate package.json
└── extract-dependencies.ts # Extract dependency lists
```

---

## 🔍 Package Manager Detection

**Detect which package manager a project uses:**

```typescript
import { detectPackageManager } from '@socketsecurity/lib/packages/detect-pm'

const pm = await detectPackageManager('/path/to/project')
// Returns: 'npm' | 'pnpm' | 'yarn' | 'bun' | undefined

// With fallback
const pm = await detectPackageManager(cwd) || 'npm'
```

**Detection logic:**
1. Check for lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`)
2. Check `packageManager` field in `package.json`
3. Check `npm_config_user_agent` env var
4. Return `undefined` if unable to determine

---

## 📥 Installing Dependencies

```typescript
import { installDependencies } from '@socketsecurity/lib/packages/install'

await installDependencies({
  cwd: '/path/to/project',
  pm: 'pnpm',              // Optional, auto-detected if omitted
  production: true,        // --production flag
  frozen: true             // --frozen-lockfile (pnpm), --frozen (yarn)
})
```

**Translates to:**
- npm: `npm install --production --frozen-lockfile`
- pnpm: `pnpm install --prod --frozen-lockfile`
- yarn: `yarn install --production --frozen-lockfile`
- bun: `bun install --production --frozen-lockfile`

---

## 🔗 Link/Unlink Packages

**Link a package for local development:**

```typescript
import { linkPackage } from '@socketsecurity/lib/packages/link'

await linkPackage({
  cwd: '/path/to/consumer',
  package: '/path/to/local/package',
  pm: 'pnpm'
})
```

**Unlink:**

```typescript
import { unlinkPackage } from '@socketsecurity/lib/packages/unlink'

await unlinkPackage({
  cwd: '/path/to/consumer',
  packageName: '@my/package',
  pm: 'pnpm'
})
```

---

## 📋 List Installed Packages

```typescript
import { listPackages } from '@socketsecurity/lib/packages/list'

const packages = await listPackages({
  cwd: '/path/to/project',
  depth: 0,           // 0 = top-level only
  production: true    // Exclude devDependencies
})

// Returns: Map<string, PackageInfo>
for (const [name, info] of packages) {
  console.log(`${name}@${info.version}`)
}
```

**PackageInfo:**
```typescript
interface PackageInfo {
  name: string
  version: string
  path: string
  dependencies?: Map<string, PackageInfo>
}
```

---

## 🔄 Check for Outdated Packages

```typescript
import { getOutdatedPackages } from '@socketsecurity/lib/packages/outdated'

const outdated = await getOutdatedPackages({
  cwd: '/path/to/project'
})

// Returns: Array<OutdatedPackage>
for (const pkg of outdated) {
  console.log(`${pkg.name}: ${pkg.current} → ${pkg.latest}`)
}
```

**OutdatedPackage:**
```typescript
interface OutdatedPackage {
  name: string
  current: string
  wanted: string   // Satisfies semver range
  latest: string   // Absolute latest version
  type: 'dependencies' | 'devDependencies' | 'peerDependencies'
}
```

---

## 🔐 Parse Lockfiles

**Parse any lockfile format:**

```typescript
import { parseLockfile } from '@socketsecurity/lib/packages/parse-lockfile'

const lockfile = await parseLockfile('/path/to/project')

// Auto-detects format and returns unified structure
console.log(lockfile.packages)
// Map of package names to versions and metadata
```

**Supported formats:**
- `package-lock.json` (npm v1-3)
- `pnpm-lock.yaml` (pnpm v5-9)
- `yarn.lock` (yarn v1-4)
- `bun.lockb` (bun)

**Unified output:**
```typescript
interface Lockfile {
  lockfileVersion: number
  packages: Map<string, LockfilePackage>
}

interface LockfilePackage {
  version: string
  resolved?: string
  integrity?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
```

---

## 🎯 Resolve Package Versions

```typescript
import { resolveVersion } from '@socketsecurity/lib/packages/resolve-version'

const version = await resolveVersion({
  name: 'lodash',
  range: '^4.17.0',
  registry: 'https://registry.npmjs.org'
})

console.log(version) // '4.17.21' (latest matching ^4.17.0)
```

---

## 📊 Fetch Package Metadata

```typescript
import { fetchPackageMetadata } from '@socketsecurity/lib/packages/fetch-metadata'

const metadata = await fetchPackageMetadata('lodash')

console.log(metadata.name)           // 'lodash'
console.log(metadata.version)        // Latest version
console.log(metadata['dist-tags'])   // { latest: '4.17.21', ... }
console.log(metadata.versions)       // All versions metadata
```

**With specific version:**
```typescript
const metadata = await fetchPackageMetadata('lodash@4.17.21')
// Returns metadata for that specific version
```

---

## ✅ Validate package.json

```typescript
import { validateManifest } from '@socketsecurity/lib/packages/validate-manifest'

const errors = validateManifest({
  name: '@my/package',
  version: '1.0.0',
  // ... rest of package.json
})

if (errors.length > 0) {
  console.error('Invalid package.json:')
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
}
```

**Validates:**
- Required fields (`name`, `version`)
- Name format (scoped vs unscoped)
- Version format (semver)
- Dependencies format
- Scripts format
- Exports/imports format

---

## 📝 Extract Dependencies

```typescript
import { extractDependencies } from '@socketsecurity/lib/packages/extract-dependencies'

const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'))

const deps = extractDependencies(manifest)

console.log(deps.dependencies)      // Map<string, string>
console.log(deps.devDependencies)   // Map<string, string>
console.log(deps.peerDependencies)  // Map<string, string>
console.log(deps.optionalDependencies) // Map<string, string>
```

**Options:**
```typescript
const deps = extractDependencies(manifest, {
  includeDev: false,         // Exclude devDependencies
  includePeer: false,        // Exclude peerDependencies
  includeOptional: false     // Exclude optionalDependencies
})
```

---

## 🔧 Advanced: Custom Registry

**All functions support custom registries:**

```typescript
import { fetchPackageMetadata } from '@socketsecurity/lib/packages/fetch-metadata'

const metadata = await fetchPackageMetadata('lodash', {
  registry: 'https://custom-registry.example.com'
})
```

---

## 💡 Common Patterns

### Pattern 1: Auto-Detect PM and Install

```typescript
import { detectPackageManager } from '@socketsecurity/lib/packages/detect-pm'
import { installDependencies } from '@socketsecurity/lib/packages/install'

async function setupProject(cwd: string) {
  const pm = await detectPackageManager(cwd) || 'npm'

  console.log(`Using ${pm}`)

  await installDependencies({ cwd, pm })
}
```

### Pattern 2: Check Outdated and Suggest Updates

```typescript
import { getOutdatedPackages } from '@socketsecurity/lib/packages/outdated'

async function checkForUpdates(cwd: string) {
  const outdated = await getOutdatedPackages({ cwd })

  if (outdated.length === 0) {
    console.log('All packages up to date!')
    return
  }

  console.log(`${outdated.length} packages have updates:`)
  for (const pkg of outdated) {
    console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest}`)
  }
}
```

### Pattern 3: Validate Before Publish

```typescript
import { validateManifest } from '@socketsecurity/lib/packages/validate-manifest'
import { readJsonFile } from '@socketsecurity/lib/fs'

async function validateBeforePublish() {
  const manifest = await readJsonFile('./package.json')
  const errors = validateManifest(manifest)

  if (errors.length > 0) {
    console.error('Cannot publish: package.json is invalid')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  console.log('package.json is valid ✓')
}
```

---

## 🧪 Testing

All package utilities can be tested with mocked filesystems:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { detectPackageManager } from '../detect-pm'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn()
}))

describe('detectPackageManager', () => {
  it('detects pnpm from lockfile', async () => {
    // Mock pnpm-lock.yaml exists
    vi.mocked(access).mockResolvedValue(undefined)

    const pm = await detectPackageManager('/fake/path')
    expect(pm).toBe('pnpm')
  })
})
```

---

## 📊 Package Manager Support Matrix

| Feature | npm | pnpm | yarn | bun |
|---------|-----|------|------|-----|
| Install | ✅ | ✅ | ✅ | ✅ |
| Link/Unlink | ✅ | ✅ | ✅ | ✅ |
| List packages | ✅ | ✅ | ✅ | ⚠️ |
| Outdated check | ✅ | ✅ | ✅ | ⚠️ |
| Lockfile parse | ✅ | ✅ | ✅ | ✅ |

✅ Full support | ⚠️ Partial support

---

## 🔗 Related Modules

- [../../constants/packages.ts](../../constants/packages.ts) — Package constants
- [../../env/npm-*.ts](../../env/) — npm environment variables
- [../fs/](../fs/) — File system utilities
- [../spawn.ts](../spawn.ts) — Process spawning

---

## 💡 Tips

- **Always detect PM first** — Use `detectPackageManager()` before operations
- **Respect lockfiles** — Use `frozen: true` in CI
- **Cache metadata** — Package metadata is expensive to fetch
- **Handle errors** — Package operations can fail (network, permissions)
- **Test with mocks** — Mock filesystem and network for fast tests

---

## 📚 Documentation

- **[Getting Started Guide](../../../docs/getting-started.md)** — Quick setup for contributors
- **[CLAUDE.md](../../../CLAUDE.md)** — Development standards and patterns
- **[Main README](../../../README.md)** — Package overview and API reference

**See individual module files for complete API documentation and advanced options.**
