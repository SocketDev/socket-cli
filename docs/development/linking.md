# Socket Project Linking for Development

## Overview

For developing socket-cli alongside its Socket dependencies (@socketsecurity/registry, @socketsecurity/sdk), you can use pnpm's built-in linking mechanisms.

**Note:** socket-cli uses published npm packages by default. Local linking is only needed when actively developing dependencies.

## What Can Be Linked

| Project | Can Link To |
|---------|------------|
| socket-cli | @socketsecurity/registry, @socketsecurity/sdk |
| socket-sdk-js | @socketsecurity/registry |
| socket-packageurl-js | @socketsecurity/registry |

## Developer Workflow

### Option 1: Using .pnpmfile.cjs (Manual)

Create a `.pnpmfile.cjs` file in your project root (gitignored):

```javascript
function readPackage(pkg) {
  if (pkg.dependencies?.['@socketsecurity/registry']) {
    pkg.dependencies['@socketsecurity/registry'] = 'link:../socket-registry/registry'
  }
  if (pkg.dependencies?.['@socketsecurity/sdk']) {
    pkg.dependencies['@socketsecurity/sdk'] = 'link:../socket-sdk-js'
  }
  return pkg
}

module.exports = {
  hooks: {
    readPackage
  }
}
```

Then run:
```bash
pnpm install
```

### Option 2: Using pnpm link (Per-Project)

```bash
# In the dependency project
cd ../socket-registry/registry
pnpm link --global

# In socket-cli
cd ../../socket-cli
pnpm link --global @socketsecurity/registry
```

### Making Changes

1. **Edit dependency code**:
   ```bash
   cd ../socket-registry/registry
   # Make changes
   pnpm build
   ```

2. **Changes are immediately available** in linked projects (no publish needed)

### Reset to Published Packages

```bash
# Remove .pnpmfile.cjs if using Option 1
rm .pnpmfile.cjs
pnpm install

# Or unlink if using Option 2
pnpm unlink @socketsecurity/registry
pnpm install
```

## CI/Production Behavior

**Nothing special needed!**

Since `.pnpmfile.cjs` is gitignored:
- CI never sees local overrides
- `pnpm install` uses normal package.json dependencies
- Always gets stable, published packages from npm

## Troubleshooting

### Changes Not Reflected
- Ensure dependency is built: `cd ../socket-registry/registry && pnpm build`
- Check .pnpmfile.cjs exists: `ls -la .pnpmfile.cjs`
- Re-run: `pnpm install`

### CI Issues
- CI should never see .pnpmfile.cjs (it's gitignored)
- If CI fails, ensure .pnpmfile.cjs is in .gitignore
- CI always uses published packages (no setup needed)

## Key Principle

**Development linking is a local-only concern.** The repository stays clean, and CI/production always uses stable, published packages.