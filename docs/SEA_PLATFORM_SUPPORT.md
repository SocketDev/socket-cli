# Socket CLI SEA Platform Support & Limitations

## Overview

Socket CLI provides Single Executable Application (SEA) binaries for all major platforms and architectures using GitHub Actions native runners and Node.js v24.8.0+ with full SEA support.

## Current Platform Support Matrix

| Platform | x64 | ARM64 |
|----------|-----|-------|
| Linux    | ✅   | ✅     |
| macOS    | ✅   | ✅     |
| Windows  | ✅   | ✅     |

## Implementation Details

### GitHub Actions ARM64 Runners (Updated 2025)

**Good News:** GitHub Actions now provides **free ARM64 runners** for public repositories as of 2025:

- **Linux ARM64**: Available for free in public repos (GA as of August 2025)
- **Windows ARM64**: Available for free in public repos (Preview as of April 2025)

**Key Constraints:**
- ✅ **Public repositories**: ARM64 runners are completely free
- ❌ **Private repositories**: ARM64 runners require paid larger runner plans
- ⏱️ **Queue times**: May experience longer queue times during peak usage

**Runner Labels:**
```yaml
# Free for public repos
runs-on: ubuntu-24.04-arm  # or ubuntu-22.04-arm
runs-on: windows-2022-arm64  # Preview
```

### Windows ARM64 SEA Support

GitHub Actions now supports Windows ARM64 runners and Node.js SEA builds work with current tooling:

#### 1. **Native ARM64 Builds**
```yaml
# Native Windows ARM64 build using ARM64 runner
- os: windows-2022-arm64  # ARM64 runner
  platform: win32
  arch: arm64            # Native compilation
```

**Benefits:**
- Node.js SEA performs optimal platform-native compilation
- No cross-compilation issues with postject compatibility
- Code cache and snapshots work correctly on target architecture

#### 2. **Postject Windows ARM64 Support**
Current implementation status:

**Verified Support (2025):**
- ✅ Node.js provides official Windows ARM64 binaries (v24.8.0+)
- ✅ Postject fully supports Windows ARM64 (confirmed via issue #97)
- ✅ Native GitHub Actions ARM64 runners enable proper builds

**Implementation:**
- Using Node.js v24.8.0+ for official Windows ARM64 support
- Native builds on `windows-2022-arm64` runners
- Full CI testing coverage for Windows ARM64 SEA builds

#### 3. **Windows SEA General Limitations**
From Node.js documentation:

```javascript
// Windows-specific SEA requirements:
// 1. Must use .exe extension
// 2. Signature removal required:
//    signtool remove /s binary.exe
// 3. Code signing certificate needed for distribution
```

**Additional Windows Challenges:**
- Windows Defender may flag unsigned SEA binaries
- Enterprise environments often block unsigned executables
- ARM64 Windows devices are less common in enterprise

### Current Build Strategy

Our current approach builds **all planned binaries** but with different reliability levels:

```typescript
// From scripts/build-sea.mjs
const BUILD_TARGETS: BuildTarget[] = [
  // High reliability (native builds)
  { platform: 'linux',  arch: 'x64',   outputName: 'socket-linux-x64' },
  { platform: 'darwin', arch: 'x64',   outputName: 'socket-macos-x64' },
  { platform: 'darwin', arch: 'arm64', outputName: 'socket-macos-arm64' },
  { platform: 'win32',  arch: 'x64',   outputName: 'socket-win-x64.exe' },

  // Medium reliability (cross-compilation)
  { platform: 'linux',  arch: 'arm64', outputName: 'socket-linux-arm64' },

  // Lower reliability (cross-compilation + platform issues)
  { platform: 'win32',  arch: 'arm64', outputName: 'socket-win-arm64.exe' },
]
```

## Self-Update Platform Detection

The self-update mechanism intelligently handles missing binaries:

```typescript
// Platform detection with fallback
function getExpectedAssetName(): string {
  const platform = process.platform
  const arch = process.arch

  // Maps to actual built binary names
  const platformMap = {
    darwin: 'macos',
    linux: 'linux',
    win32: 'win',  // matches socket-win-*.exe
  }

  const archMap = {
    arm64: 'arm64',
    x64: 'x64',
  }

  const extension = platform === 'win32' ? '.exe' : ''
  return `socket-${platformMap[platform]}-${archMap[arch]}${extension}`
}
```

If a binary doesn't exist in the GitHub release, self-update will:
1. **Fail gracefully** with a clear error message
2. **Suggest alternatives** (e.g., use npm install instead)
3. **Not crash** the existing installation

## Alternative Installation Methods

### NPM Package (Universal)
```bash
# Works on all platforms and architectures
npm install -g socket
```

### Direct Binary Downloads
```bash
# Download platform-specific binaries from GitHub releases
# All major platforms and architectures are supported
```


## Future Roadmap

### Completed (2025)
- [x] **Migrate to native ARM64 runners** for Windows ARM64 builds
- [x] **Enable Windows ARM64** using GitHub Actions ARM64 runners
- [x] **Upgrade to Node.js v24.8.0+** for improved ARM64 support

### Future Enhancements
- [ ] **Code signing** for Windows binaries (requires certificates)
- [ ] **Performance benchmarking** across all platforms

### Long Term (2026+)
- [ ] **Alpine Linux** support (currently not supported by Node.js SEA)
- [ ] **Additional architectures** as Node.js SEA support expands

## Contributing

If you're using an unsupported platform combination:

1. **Try the npm package first** - it works everywhere
2. **Report compatibility issues** with detailed system info
3. **Help test** new platform combinations when available

## References

- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [GitHub Actions ARM64 Runners](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/)
- [Postject GitHub Repository](https://github.com/nodejs/postject)
- [Node.js Windows ARM64 Support](https://github.com/nodejs/node/issues/25998)

---

**Last Updated:** September 2025
**Status:** Living document - updated as platform support evolves