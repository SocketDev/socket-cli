# @socketsecurity/bootstrap

⚠️ **DEPRECATED** - This package is obsolete and will be removed in a future release.

## Deprecation Notice

The bootstrap lazy-loading pattern has been replaced by:
1. **`socket` npm package** - Installs platform-specific binaries via optionalDependencies
2. **`@socketsecurity/cli` packages** - Pure JavaScript with lazy tool download
3. **Direct SEA binaries** - Self-contained executables with embedded VFS

## Why Deprecated

The original bootstrap architecture downloaded the full CLI on first run to minimize installation size. This has been superseded by:

- **VFS bundling** - External tools embedded in SEA binaries, extracted on first run
- **Platform binaries** - `socket` package installs correct binary automatically
- **Lazy tool download** - Pure JS packages download tools on-demand, not CLI code

## Migration Guide

**If using bootstrap:**
```bash
# Old (deprecated)
npm install -g @socketsecurity/bootstrap

# New (recommended)
npm install -g socket  # Installs platform binary
# OR
npm install -g @socketsecurity/cli  # Pure JS, lazy downloads tools
```

**If maintaining bootstrap code:**
- All functionality moved to `@socketsecurity/cli` and `socket` packages
- VFS extraction handles tool management
- No lazy CLI download needed

## Legacy Architecture (For Reference)

The bootstrap pattern used:
- **20KB shim** installed initially
- **Downloaded full CLI** (3-5MB) from npm on first run
- **Cached** in `~/.socket/_dlx/`
- **Brotli compression** reduced size by 65-75%
- **IPC handshake** prevented infinite loops

This functionality is no longer needed with the VFS-based distribution model.

---

For current architecture documentation, see:
- `packages/cli/README.md` - Main CLI architecture
- `packages/package-builder/README.md` - Distribution strategy
