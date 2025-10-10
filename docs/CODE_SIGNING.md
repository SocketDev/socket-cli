# Code Signing Documentation

This document describes the code signing process for Socket CLI binaries across different platforms.

## Overview

Code signing is essential for distributing binaries that users can run without security warnings or failures. The requirements vary by platform:

- **macOS ARM64 (Apple Silicon)**: **REQUIRED** - Binaries will not run without a signature
- **macOS x64 (Intel)**: Recommended - Users get Gatekeeper warnings for unsigned binaries
- **Windows**: Optional - Prevents "Unknown Publisher" warnings
- **Linux**: Optional - GPG signatures for verification

## Architecture

All code signing functionality is centralized in `scripts/build/code-signing.mjs` to provide:

1. Consistent API across all build scripts
2. Automatic tool detection and fallback mechanisms
3. Platform-specific handling with sensible defaults
4. Clear error messages and recovery strategies

## Usage

### Basic Usage

```javascript
import { signBinary } from './code-signing.mjs'

// Auto-detect platform and sign accordingly
const result = await signBinary('/path/to/binary')
if (!result.success) {
  console.error(`Signing failed: ${result.message}`)
}
```

### Platform-Specific Signing

```javascript
import { signMacOSBinary, signWindowsBinary, signLinuxBinary } from './code-signing.mjs'

// macOS signing
const macResult = await signMacOSBinary('/path/to/binary', {
  identity: '-',  // Use '-' for ad-hoc, or specify certificate
  force: true     // Re-sign even if already signed
})

// Windows signing (requires certificate)
const winResult = await signWindowsBinary('/path/to/binary.exe', {
  certificatePath: '/path/to/cert.pfx',
  certificatePassword: 'password',
  description: 'Socket CLI',
  url: 'https://socket.dev'
})

// Linux GPG signing
const linuxResult = await signLinuxBinary('/path/to/binary', {
  keyId: 'YOUR_GPG_KEY_ID',
  armor: true  // Create ASCII-armored .asc file
})
```

## macOS Code Signing

### Requirements

macOS binaries, especially for ARM64 (Apple Silicon), must be signed to run. The signing tools in order of preference:

1. **codesign** (native macOS tool)
   - Available on all macOS systems with Xcode Command Line Tools
   - Supports both ad-hoc and certificate signing
   - Command: `codesign --sign - --force /path/to/binary`

2. **ldid** (cross-platform alternative)
   - Can be installed via Homebrew: `brew install ldid`
   - Works on Linux for cross-compilation
   - Useful for CI/CD environments
   - Command: `ldid -S /path/to/binary`

### Ad-hoc vs Certificate Signing

**Ad-hoc signing** (using identity '-'):
- No certificate required
- Binary runs on the machine that signed it
- Users on other machines may need to approve via System Preferences
- Sufficient for open source distributions

**Certificate signing**:
- Requires Apple Developer certificate ($99/year)
- Binaries run without warnings on all machines
- Required for App Store distribution
- Example: `--identity "Developer ID Application: Your Name (TEAMID)"`

### Critical for ARM64

ARM64 binaries **MUST** be signed or macOS will refuse to run them with error:
```
killed: 9
```

The build scripts will fail the build if an ARM64 binary cannot be signed.

## Windows Code Signing

### Requirements

Windows signing uses Authenticode and requires:

1. **Code signing certificate** (.pfx file)
   - Can be purchased from DigiCert, Sectigo, etc.
   - Or use self-signed for internal distribution

2. **signtool.exe**
   - Part of Windows SDK
   - Must be in PATH

### Configuration

Set environment variables:
```bash
export WINDOWS_CERT_PATH=/path/to/certificate.pfx
export WINDOWS_CERT_PASSWORD=your_password
```

Or pass directly to signing function:
```javascript
await signWindowsBinary(binaryPath, {
  certificatePath: '/path/to/cert.pfx',
  certificatePassword: 'password'
})
```

### Timestamp Server

The code uses DigiCert's timestamp server by default to ensure signatures remain valid after certificate expiration:
```
http://timestamp.digicert.com
```

## Linux Code Signing

Linux uses GPG signatures for verification rather than embedded signing.

### Setup

1. Generate GPG key if needed:
```bash
gpg --gen-key
```

2. Sign binary:
```javascript
await signLinuxBinary('/path/to/binary', {
  keyId: 'YOUR_KEY_ID'
})
```

This creates a detached signature file:
- `.asc` for ASCII-armored signatures (default)
- `.sig` for binary signatures

### Verification

Users can verify signatures with:
```bash
gpg --verify binary.asc binary
```

## CI/CD Integration

### GitHub Actions

The signing module automatically detects CI environments and adjusts behavior:

```yaml
- name: Sign Binary
  run: |
    # For macOS runners, codesign is available
    # For Linux runners building macOS binaries, ldid is auto-installed
    node scripts/build/build-binary.mjs
```

### Cross-Compilation

When building macOS binaries on Linux (common in CI):

1. The module attempts to use `ldid`
2. If not available, tries to install it automatically
3. Falls back to warnings for x64, fails for ARM64

## Build Script Integration

The code signing module is integrated into several build scripts:

1. **build-binary.mjs**: Signs Node.js SEA binaries
2. **build-stub.mjs**: Signs yao-pkg compiled binaries
3. **post-process.mjs**: Post-processing signing after binary modifications

Each script uses the centralized `signBinary()` function for consistency.

## Configuration

The module exports `SIGNING_CONFIG` for runtime configuration:

```javascript
import { SIGNING_CONFIG } from './code-signing.mjs'

// Disable Windows signing if certificate not available
SIGNING_CONFIG.windows.enabled = false

// Force specific tool for macOS
SIGNING_CONFIG.macos.tool = 'ldid'
```

## Troubleshooting

### macOS Issues

**"killed: 9" error**
- Binary is not signed (critical for ARM64)
- Solution: Ensure signing tools are available

**"unverified developer" warning**
- Binary is ad-hoc signed
- Solution: Users must approve in System Preferences > Security & Privacy

**codesign fails with "malformed binary"**
- Binary was modified after compilation by pkg
- Solution: Use ldid which handles this case better

### Windows Issues

**"Unknown Publisher" warning**
- Binary is not signed with Authenticode
- Solution: Obtain and use a code signing certificate

**signtool not found**
- Windows SDK not installed or not in PATH
- Solution: Install Windows SDK and add to PATH

### Linux Issues

**GPG key not found**
- Specified key ID doesn't exist
- Solution: Generate key with `gpg --gen-key`

## Security Considerations

1. **Never commit certificates or passwords** to version control
2. Use environment variables or secure secret management for credentials
3. Ad-hoc signing is sufficient for open source projects
4. Certificate signing provides better user experience but requires annual fees
5. Always use timestamp servers to extend signature validity

## Testing

To test signing without building:

```javascript
import { signBinary, isMacOSBinarySigned } from './scripts/build/code-signing.mjs'

// Test sign
const result = await signBinary('./test-binary')
console.log('Sign result:', result)

// Verify signature (macOS)
const isSigned = await isMacOSBinarySigned('./test-binary')
console.log('Is signed:', isSigned)
```

## References

- [Apple Code Signing Guide](https://developer.apple.com/documentation/security/code_signing_guide)
- [Windows Authenticode Signing](https://docs.microsoft.com/en-us/windows/win32/seccrypto/authenticode)
- [GPG Signature Verification](https://www.gnupg.org/gph/en/manual/x135.html)
- [ldid Project](https://github.com/xerub/ldid)