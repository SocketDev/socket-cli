# Socket Project Linking for Development

## Overview

A simple system for linking Socket projects during local development:
- **Local development**: Uses filesystem links to sibling projects
- **CI/production**: Uses published npm packages

The key: `.pnpmfile.cjs` files are **generated locally** and **gitignored**, so they never affect CI/production.

## How It Works

### For Developers

```bash
# Enable local linking (clones dependencies if needed)
node scripts/setup-links.mjs

# Use GitHub main branches
node scripts/setup-links.mjs main --all

# Reset to published packages
node scripts/setup-links.mjs published --all
```

This generates `.pnpmfile.cjs` files that redirect dependencies:
- `local` → `link:../socket-registry/registry`
- `main` → `github:SocketDev/socket-registry#main`
- `published` → removes .pnpmfile.cjs (uses package.json)

### For CI/Production

**Nothing special needed!**

Since `.pnpmfile.cjs` is gitignored:
- CI never sees these files
- `pnpm install` uses normal package.json dependencies
- Always gets stable, published packages from npm

## What Can Be Linked

| Project | Can Link To |
|---------|------------|
| socket-cli | @socketsecurity/registry, @socketsecurity/sdk |
| socket-sdk-js | @socketsecurity/registry |
| socket-packageurl-js | @socketsecurity/registry |

## Developer Workflow

### Initial Setup

```bash
cd socket-cli

# Setup local linking (auto-clones dependencies if needed)
node scripts/setup-links.mjs

# This creates .pnpmfile.cjs (gitignored) and runs pnpm install
```

### Making Changes

1. **Edit dependency code**:
   ```bash
   cd ../socket-registry/registry
   # Make changes
   pnpm build
   ```

2. **Changes are immediately available** in linked projects (no publish needed)

### Testing Different Versions

```bash
# Test with local code
node scripts/setup-links.mjs local
pnpm test

# Test with GitHub main branch
node scripts/setup-links.mjs main
pnpm test

# Test with published packages (like CI)
node scripts/setup-links.mjs published
pnpm test
```

## How GitHub/CI Handles This

### What Gets Committed

✅ **Committed to repo:**
- `scripts/setup-links.mjs` - The setup tool
- `package.json` - Normal dependencies (unchanged)

❌ **NOT committed (gitignored):**
- `.pnpmfile.cjs` - Local overrides
- `.env.local` - Local environment

### CI Behavior

```yaml
# In GitHub Actions
jobs:
  test:
    steps:
      - uses: actions/checkout@v5
      - run: pnpm install  # Uses package.json normally
      # .pnpmfile.cjs doesn't exist, so no overrides applied
```

**Result:** CI always uses stable, published packages

## Examples

### Setup All Projects for Local Development

```bash
node scripts/setup-links.mjs --all
```

### Work on socket-registry Changes

```bash
# In socket-cli, link to local registry
node scripts/setup-links.mjs local

# Make changes in registry
cd ../socket-registry/registry
vim src/lib/logger.ts
pnpm build

# Changes immediately available in socket-cli
cd ../../socket-cli
pnpm test  # Uses your local changes
```

### Test socket-cli with Local SDK

```bash
# socket-cli can link both registry and SDK
node scripts/setup-links.mjs local socket-cli

# This creates overrides for both:
# @socketsecurity/registry → ../socket-registry/registry
# @socketsecurity/sdk → ../socket-sdk-js
```

### Reset to Production Mode

```bash
# Remove all overrides
node scripts/setup-links.mjs published --all

# Now uses npm packages like production
```

## Benefits

1. **Clean Repository**: No linking configuration in the repo
2. **CI Simplicity**: CI just runs `pnpm install` normally
3. **Developer Flexibility**: Easy switching between local/main/published
4. **Auto-Setup**: Clones missing dependencies automatically
5. **No Accidents**: Can't accidentally commit local paths

## Troubleshooting

### Changes Not Reflected
- Ensure dependency is built: `cd ../socket-registry/registry && pnpm build`
- Check .pnpmfile.cjs exists: `ls -la .pnpmfile.cjs`
- Re-run setup: `node scripts/setup-links.mjs local`

### CI Issues
- CI should never see .pnpmfile.cjs (it's gitignored)
- If CI fails, ensure .pnpmfile.cjs is in .gitignore
- CI always uses published packages (no setup needed)

### Missing Dependencies
- Script auto-clones from GitHub if not found locally
- Or manually clone: `git clone https://github.com/SocketDev/socket-registry.git ../socket-registry`

## Key Principle

**Development linking is a local-only concern.** The repository stays clean, and CI/production always uses stable, published packages. The `.pnpmfile.cjs` mechanism is invisible to anyone not actively developing locally.