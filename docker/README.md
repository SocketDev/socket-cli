# Socket CLI Docker Build Environment

This directory contains Docker configurations for building Socket CLI binaries across different platforms and architectures.

## 🎯 Purpose

Building binaries for different architectures (especially ARM) from an x86_64 host requires cross-compilation. Docker provides a consistent build environment and allows us to target multiple architectures using QEMU emulation.

## 📋 Prerequisites

1. **Docker Desktop** (macOS/Windows) or **Docker Engine** (Linux)
2. **Docker Buildx** (included in Docker Desktop, may need installation on Linux)
3. **QEMU** for cross-platform emulation

### Setup Docker Buildx

```bash
# Create and use a new builder instance
docker buildx create --name socket-builder --use

# Verify it's working
docker buildx inspect --bootstrap

# List available platforms
docker buildx ls
```

## 🏗️ Building Binaries

### Build All Linux Architectures

```bash
# From the socket-cli root directory
docker compose -f docker/docker-compose.build.yml up

# This will build binaries for:
# - Linux x64
# - Linux ARM64
# - Linux ARMv7
```

### Build Specific Architecture

```bash
# Build only ARM64
docker compose -f docker/docker-compose.build.yml up build-linux-arm64

# Build only ARMv7
docker compose -f docker/docker-compose.build.yml up build-linux-armv7
```

### Manual Docker Build

```bash
# Build for ARM64
docker buildx build \
  --platform linux/arm64 \
  --build-arg ARCH=arm64 \
  --build-arg NODE_VERSION=20 \
  -f docker/build-arm.dockerfile \
  -t socket-cli:linux-arm64 \
  --load \
  .

# Extract the binary
docker run --rm -v $(pwd)/dist:/output socket-cli:linux-arm64 \
  sh -c "cp /usr/local/bin/socket /output/socket-linux-arm64"
```

## 🪟 Windows Binary Building

**Important:** Windows binaries CANNOT be built from macOS/Linux using Docker because:

1. Windows binaries require Windows-specific tools (MSVC, Windows SDK)
2. Docker on macOS/Linux only runs Linux containers
3. Wine is not reliable for Node.js compilation

### Recommended Approaches for Windows Binaries

#### Option 1: GitHub Actions (Recommended)
- Free for public repositories
- Supports Windows, macOS, and Linux runners
- See `.github/workflows/release-sea.yml` for the workflow

#### Option 2: Windows VM
- Use Parallels, VMware, or VirtualBox on macOS
- Use native Windows or WSL2 on Windows
- Requires Windows license

#### Option 3: Cloud Build Services
- Azure DevOps (free tier available)
- AppVeyor (free for open source)
- CircleCI (Windows support with paid plans)

## 📦 Output

Built binaries will be placed in the `dist/` directory:

```
dist/
├── socket-linux-x64      # Linux x64 binary
├── socket-linux-arm64    # Linux ARM64 binary
├── socket-linux-armv7    # Linux ARMv7 binary
└── socket-win-x64.exe    # Windows binary (built on Windows/CI)
```

## 🔧 Customization

### Changing Node.js Version

Edit `docker-compose.build.yml` and update the `NODE_VERSION` arg:

```yaml
args:
  NODE_VERSION: 22  # Change to desired version
```

### Adding New Architectures

Add a new service to `docker-compose.build.yml`:

```yaml
build-linux-riscv64:
  build:
    args:
      ARCH: riscv64
      NODE_VERSION: 20
    platforms:
      - linux/riscv64
  # ... rest of configuration
```

## 💰 Cost Considerations

### Local Builds
- **Free** - Uses your local machine
- **Performance** - ARM emulation is slower than native
- **Time** - ARM64 build can take 10-30 minutes on x86_64

### GitHub Actions
- **Free** for public repositories (2,000 minutes/month)
- **Paid** for private repositories
- **Fast** - Native runners for each platform

### Cloud Services
- **Azure DevOps** - 1,800 minutes free/month
- **AppVeyor** - Free for open source
- **CircleCI** - Limited free tier

## 🚀 Performance Tips

1. **Use native builders when possible** - ARM builds on ARM hardware are much faster
2. **Enable Docker BuildKit** - `export DOCKER_BUILDKIT=1`
3. **Use cache mounts** - Preserve pnpm cache between builds
4. **Parallel builds** - Use `docker compose up -d` for parallel execution

## 🐛 Troubleshooting

### "No matching platform" error
```bash
# Install QEMU support
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

### Slow ARM builds
This is expected when emulating ARM on x86_64. Consider using:
- Native ARM hardware (Raspberry Pi, ARM Mac)
- Cloud ARM instances (AWS Graviton, Oracle Ampere)
- GitHub Actions with ARM runners

### Out of memory
Increase Docker memory limit in Docker Desktop settings (recommended: 8GB+)

## 📚 Resources

- [Docker Buildx Documentation](https://docs.docker.com/buildx/working-with-buildx/)
- [QEMU User Emulation](https://www.qemu.org/docs/master/user/index.html)
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [Yao-pkg Documentation](https://github.com/yao-pkg/pkg)