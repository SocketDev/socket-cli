# Alpine Docker Build Environment

**Purpose**: Builds Socket smol binaries for Alpine Linux using musl libc instead of glibc.

## Why Alpine Needs Docker

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Actions Ubuntu Runner                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Standard Linux Build (glibc)                        │ │
│ │ → Compiles directly on runner                       │ │
│ │ → Works for linux-x64, linux-arm64                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Alpine Linux Build (musl)                           │ │
│ │ → REQUIRES Docker container                         │ │
│ │ → Different libc (musl vs glibc)                    │ │
│ │ → Different system libraries                        │ │
│ │ → alpine-x64, alpine-arm64                          │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Build Flow

```
GitHub Actions Workflow
  ↓
Docker Build
  → FROM alpine:3.19
  → Install: nodejs, npm, python3, make, g++, ninja
  → Install: pnpm@10.20.0
  → Set WORKDIR /workspace
  ↓
Docker Run
  → Mount: socket-cli repo → /workspace
  → Execute: pnpm --filter @socketbin/node-smol-builder run build
  → Output: socket-smol-alpine-{x64,arm64}
```

## Critical Differences

| Aspect | Standard Linux | Alpine Linux |
|--------|----------------|--------------|
| **C Library** | glibc | musl |
| **Build Environment** | Native runner | Docker container |
| **Package Manager** | apt | apk |
| **Binary Compatibility** | Most Linux distros | Alpine only |
| **Size** | Larger | Smaller |

## When This Runs

Triggered by `.github/workflows/build-smol.yml` when:
- Building alpine-x64 or alpine-arm64 platforms
- Smol binary cache miss or force rebuild
- Cross-architecture via Docker Buildx + QEMU

## Container Contents

```dockerfile
FROM alpine:3.19

# Build toolchain
RUN apk add --no-cache \
    nodejs       # Runtime
    npm          # Package manager
    python3      # Node.js build scripts
    make         # Build system
    g++          # C++ compiler
    linux-headers # Kernel headers
    git          # Version control
    ccache       # Compiler cache
    ninja        # Fast build system

# Socket tooling
RUN npm install -g pnpm@10.20.0

WORKDIR /workspace
```

## Platform Mapping

| Matrix Arch | Docker Platform | Binary Output |
|-------------|-----------------|---------------|
| `x64` | `linux/amd64` | `socket-smol-alpine-x64` |
| `arm64` | `linux/arm64` | `socket-smol-alpine-arm64` |

## Cache Strategy

Docker image cached via GitHub Actions cache:
- **Cache key**: `alpine-builder-{x64,arm64}`
- **Scope**: Per architecture
- **Invalidation**: Manual or workflow changes
- **Benefits**: Faster subsequent builds (~30s vs ~5min)

## Related Files

- `Dockerfile.alpine` - This container definition
- `.github/workflows/build-smol.yml` - CI workflow using this
- `../build.mjs` - Build script executed inside container
