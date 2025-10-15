# @socketbin NPM Organization Setup Checklist

> **⚠️ STATUS: NOT STARTED**
> This checklist is for setting up the @socketbin npm organization when the decision is made to pursue npm-based binary distribution. The organization has not been created yet.

## ❌ Not Started
- [ ] Create @socketbin organization on npm

## 🔧 Organization Configuration

### 1. Security Settings (npmjs.com → Organization Settings)
- [ ] **Enable 2FA requirement** for all members
  - Settings → Security → Require two-factor authentication
- [ ] **Set package creation** to "Restricted" (owners only)
  - Settings → Package Creation → Restricted
- [ ] **Add team members** (if needed)
  - Members → Invite → Add Socket team members as owners

### 2. Trusted Publishing Setup

#### Configure GitHub as Trusted Publisher:
1. Go to: https://www.npmjs.com/settings/socketbin/integrations
2. Click "Add Trusted Publisher"
3. Add configuration:
   ```
   Repository: SocketDev/socket-cli
   Workflow: .github/workflows/publish-socketbin.yml
   Environment: (leave blank for now)
   ```
4. Save configuration

#### NPM Token for GitHub Actions:
1. Create automation token:
   - Go to: https://www.npmjs.com/settings/~/tokens
   - Click "Generate New Token" → "Granular Access Token"
   - Name: `socket-cli-github-actions`
   - Expiration: 1 year (or as per policy)
   - Packages: Select "@socketbin" scope
   - Permissions: "Read and Write"

2. Add to GitHub repository:
   - Go to: https://github.com/SocketDev/socket-cli/settings/secrets/actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: (paste token from npm)

### 3. Package Publishing Settings
- [ ] **Verify scope visibility**: Public packages only
- [ ] **Set up package provenance**:
  - Each @socketbin/* package will show ✓ Verified publisher
  - Automatic with trusted publishing configured

## 📦 Initial Package Setup

### First Package Test (Dry Run):
```bash
# Build a test binary locally
pnpm run build --sea -- --platform=darwin --arch=arm64

# Generate test package
node scripts/generate-binary-package.mjs \
  --platform=darwin \
  --arch=arm64 \
  --version=0.0.1-test

# Check generated package
cd packages/binaries/cli-darwin-arm64
npm pack --dry-run
```

### Verify Package Structure:
```
packages/binaries/cli-darwin-arm64/
├── package.json (with correct @socketbin/cli-darwin-arm64 name)
├── README.md
└── bin/
    └── cli (the actual binary)
```

## 🚀 First Deployment

### 1. Test Workflow (Dry Run):
```bash
# Trigger workflow with dry-run
gh workflow run publish-socketbin.yml \
  -f version=0.0.1-test \
  -f dry-run=true
```

### 2. Publish Test Version:
```bash
# Publish a test version to verify everything works
gh workflow run publish-socketbin.yml \
  -f version=0.0.1-test \
  -f dry-run=false
```

### 3. Verify Published Packages:
Check that packages appear at:
- https://www.npmjs.com/package/@socketbin/cli-darwin-arm64
- https://www.npmjs.com/package/@socketbin/cli-darwin-x64
- https://www.npmjs.com/package/@socketbin/cli-linux-arm64
- https://www.npmjs.com/package/@socketbin/cli-linux-x64
- https://www.npmjs.com/package/@socketbin/cli-win32-arm64
- https://www.npmjs.com/package/@socketbin/cli-win32-x64

Each should show:
- ✓ Published by socketbin
- ✓ Verified publisher badge (if provenance is working)

### 4. Test Installation:
```bash
# Test installing the main package
npm install -g socket@0.0.1-test

# Verify it works
socket --version
```

## 🐛 Troubleshooting

### If Provenance Isn't Working:
1. Verify `id-token: write` permission in workflow
2. Check that workflow path matches trusted publisher config exactly
3. Ensure using `npm publish --provenance` flag

### If Package Not Found:
1. Check npm scope spelling: `@socketbin` (not @socketbinary, etc.)
2. Verify package was published as public: `--access public`
3. Check optionalDependencies versions match published versions

### If Binary Doesn't Execute:
1. Verify binary permissions (should be executable)
2. Check platform detection in dispatcher script
3. Test with direct binary path: `node_modules/@socketbin/cli-*/bin/cli`

## 📋 Final Production Checklist

Before releasing v1.x:
- [ ] All 6 platform binaries build successfully
- [ ] Test installation on each platform
- [ ] Provenance badges appear on all packages
- [ ] Main `socket` package installs correctly
- [ ] Update documentation to reference new install method
- [ ] Plan migration communication for existing users

## 🔄 Migration Plan

### Phase 1: Parallel Publishing (Current)
- Continue publishing to GitHub releases (existing flow)
- Also publish to @socketbin/* (new flow)
- Main package still uses postinstall

### Phase 2: Soft Migration (Next)
- Update main package to prefer @socketbin
- Keep postinstall as fallback
- Monitor adoption metrics

### Phase 3: Full Migration (Future)
- Remove postinstall completely
- Archive old GitHub releases
- Update all documentation

## 📊 Success Metrics

Monitor after deployment:
- Download counts per @socketbin/* package
- Install success rate (no more postinstall failures!)
- Platform distribution (which OS/arch most common)
- Issue reports related to installation

## 🔗 Important URLs

- **Organization**: https://www.npmjs.com/org/socketbin
- **Settings**: https://www.npmjs.com/settings/socketbin
- **Packages**: https://www.npmjs.com/~socketbin
- **GitHub Workflow**: [publish-socketbin.yml](.github/workflows/publish-socketbin.yml)

---

*Created: 2024-10-07*
*Status: Organization created, awaiting configuration*