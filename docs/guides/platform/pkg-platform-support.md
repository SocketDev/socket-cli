# pkg Platform Support for Socket CLI

## Overview

Socket CLI pkg binaries are built for all major platforms and architectures, ensuring maximum compatibility across desktop environments, Docker containers, and cloud infrastructure.

## Supported Platforms

The `pkg.json` configuration targets these platforms:

```json
{
  "targets": [
    "node24-macos-arm64",    // Apple Silicon Macs (M1/M2/M3/M4)
    "node24-macos-x64",      // Intel Macs
    "node24-linux-arm64",    // ARM64 Linux
    "node24-linux-x64",      // x86_64 Linux
    "node24-win-arm64",      // Windows on ARM
    "node24-win-x64"         // Windows x86_64
  ]
}
```

## Platform Details

### macOS

#### node24-macos-arm64
- **Architecture:** Apple Silicon (ARM64)
- **Devices:** MacBook Pro/Air M1/M2/M3/M4, Mac Mini M1/M2/M4, Mac Studio, iMac M1/M3/M4
- **Minimum OS:** macOS 13.5+ (Ventura)
- **Docker:** Not applicable (macOS doesn't run native Docker containers)

#### node24-macos-x64
- **Architecture:** Intel x86_64
- **Devices:** Intel-based Macs (2010-2020)
- **Minimum OS:** macOS 13.5+ (Ventura)
- **Rosetta 2:** Can also run on Apple Silicon via Rosetta 2 translation
- **Docker:** Not applicable

### Linux

#### node24-linux-x64 ⭐ Most Common Docker Platform
- **Architecture:** x86_64 (AMD64)
- **OS:** Any modern Linux distribution
  - Ubuntu 18.04+
  - Debian 10+
  - Alpine Linux 3.14+
  - Amazon Linux 2/2023
  - Red Hat Enterprise Linux 8+
  - CentOS 8+
  - Fedora 36+
- **Glibc:** 2.27+ (Ubuntu 18.04+)
- **Musl:** Supported (Alpine Linux)
- **Docker:** ✅ **Most common Docker platform**
  - `FROM ubuntu:22.04`
  - `FROM node:24-alpine`
  - `FROM node:24-bullseye`
  - `FROM amazonlinux:2023`
  - Standard `linux/amd64` architecture

#### node24-linux-arm64
- **Architecture:** ARM64 (aarch64)
- **OS:** Any modern ARM64 Linux distribution
  - Ubuntu 18.04+ on ARM
  - Debian 10+ on ARM
  - Alpine Linux 3.14+ on ARM
  - Amazon Linux 2023 (Graviton)
- **Devices/Platforms:**
  - AWS EC2 Graviton instances (c7g, m7g, r7g, t4g series)
  - AWS Lambda (Graviton2)
  - Raspberry Pi 3/4/5 (64-bit OS)
  - NVIDIA Jetson
  - ARM-based servers (Ampere Altra, AWS Graviton)
- **Docker:** ✅ **Growing Docker platform**
  - `FROM arm64v8/ubuntu:22.04`
  - `FROM arm64v8/alpine:latest`
  - `--platform linux/arm64`
  - AWS Graviton containers
  - Raspberry Pi containers

### Windows

#### node24-win-x64
- **Architecture:** x86_64 (AMD64)
- **OS:** Windows 10+ (64-bit)
- **Minimum Version:** Windows 10 1903 (May 2019) or newer
- **Server:** Windows Server 2019+
- **Docker:** Windows containers (rare for Node.js)

#### node24-win-arm64
- **Architecture:** ARM64
- **Devices:**
  - Surface Pro X
  - Windows 11 on ARM
  - Qualcomm Snapdragon-based PCs
- **OS:** Windows 11+ on ARM
- **Emulation:** Can run x64 binaries via emulation, but native ARM64 is faster
- **Docker:** Not common

---

## Docker Compatibility

### Primary Docker Targets

Socket CLI pkg binaries are optimized for Docker containers:

#### 1. linux-x64 (Most Common)

**Standard Docker images:**
```dockerfile
# Ubuntu-based
FROM ubuntu:22.04
COPY pkg-binaries/socket-linux-x64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket

# Alpine-based (smaller)
FROM alpine:3.19
COPY pkg-binaries/socket-linux-x64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket

# Official Node.js image
FROM node:24-slim
COPY pkg-binaries/socket-linux-x64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket
```

**Works on:**
- ✅ Standard x86_64 servers (Intel/AMD)
- ✅ AWS EC2 (non-Graviton)
- ✅ Google Cloud Platform
- ✅ Azure VMs
- ✅ DigitalOcean
- ✅ Heroku
- ✅ Render
- ✅ Fly.io
- ✅ Most CI/CD platforms

#### 2. linux-arm64 (AWS Graviton, ARM Servers)

**Graviton-optimized images:**
```dockerfile
# Ubuntu ARM64
FROM arm64v8/ubuntu:22.04
COPY pkg-binaries/socket-linux-arm64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket

# Alpine ARM64
FROM arm64v8/alpine:3.19
COPY pkg-binaries/socket-linux-arm64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket

# Multi-arch build
FROM --platform=linux/arm64 node:24-slim
COPY pkg-binaries/socket-linux-arm64 /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket
```

**Works on:**
- ✅ AWS EC2 Graviton2/3/4 (c7g, m7g, r7g, t4g)
- ✅ AWS Lambda (ARM64)
- ✅ AWS Fargate (ARM64)
- ✅ Oracle Cloud Ampere A1
- ✅ Raspberry Pi (64-bit OS)
- ✅ ARM-based Kubernetes clusters

### Multi-Architecture Docker Images

Build images that work on both x86_64 and ARM64:

```dockerfile
# Dockerfile.multiarch
FROM --platform=$BUILDPLATFORM node:24-slim AS builder
ARG TARGETARCH

# Copy appropriate binary based on architecture
COPY pkg-binaries/socket-linux-${TARGETARCH} /usr/local/bin/socket
RUN chmod +x /usr/local/bin/socket

# Build multi-arch image
docker buildx build --platform linux/amd64,linux/arm64 -t myorg/socket:latest .
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  socket-scanner:
    image: ubuntu:22.04
    volumes:
      - ./pkg-binaries/socket-linux-x64:/usr/local/bin/socket:ro
      - ./project:/workspace
    working_dir: /workspace
    command: socket scan create --json
    platform: linux/amd64  # or linux/arm64
```

---

## Platform Testing

### Test Each Platform Binary

```bash
# macOS ARM64 (Apple Silicon)
./pkg-binaries/socket-macos-arm64 --version

# macOS x64 (Intel)
./pkg-binaries/socket-macos-x64 --version

# Linux x64 (Docker)
docker run --rm -v ./pkg-binaries:/bin ubuntu:22.04 /bin/socket-linux-x64 --version

# Linux ARM64 (Docker)
docker run --rm --platform linux/arm64 -v ./pkg-binaries:/bin arm64v8/ubuntu:22.04 /bin/socket-linux-arm64 --version

# Windows x64
.\pkg-binaries\socket-win-x64.exe --version
```

### Verify Docker Compatibility

```bash
# Test in Alpine (musl libc)
docker run --rm -v ./pkg-binaries:/app alpine:3.19 /app/socket-linux-x64 --version

# Test in Ubuntu (glibc)
docker run --rm -v ./pkg-binaries:/app ubuntu:22.04 /app/socket-linux-x64 --version

# Test in Debian
docker run --rm -v ./pkg-binaries:/app debian:12 /app/socket-linux-x64 --version

# Test in Amazon Linux
docker run --rm -v ./pkg-binaries:/app amazonlinux:2023 /app/socket-linux-x64 --version
```

---

## Binary Sizes

Expected binary sizes for each platform:

| Platform | Approximate Size | Notes |
|----------|-----------------|-------|
| linux-x64 | ~90-110 MB | Most optimized |
| linux-arm64 | ~90-110 MB | Same as x64 |
| macos-arm64 | ~90-110 MB | Code-signed |
| macos-x64 | ~90-110 MB | Code-signed |
| win-x64 | ~95-115 MB | .exe format |
| win-arm64 | ~95-115 MB | .exe format |

**Size breakdown:**
- Node.js runtime: ~82-85 MB (custom optimized build)
- Socket CLI code (bytecode): ~5-8 MB
- Assets (translations, requirements.json): ~1-2 MB
- Overhead (pkg metadata): ~2-5 MB

---

## Cloud Platform Support

### AWS

#### x86_64 (Intel/AMD)
- ✅ EC2: t3, t2, m5, m6i, c5, c6i, r5, r6i
- ✅ Lambda: x86_64 runtime
- ✅ Fargate: x86_64
- ✅ ECS: x86_64

#### ARM64 (Graviton)
- ✅ EC2: t4g, m7g, c7g, r7g (Graviton2/3/4)
- ✅ Lambda: arm64 runtime
- ✅ Fargate: arm64
- ✅ ECS: arm64

### Google Cloud Platform

- ✅ Compute Engine: x86_64 instances
- ✅ Cloud Run: x86_64 containers
- ✅ GKE: x86_64 nodes

### Microsoft Azure

- ✅ Virtual Machines: x86_64
- ✅ Container Instances: x86_64
- ✅ AKS: x86_64 nodes

### Other Cloud Providers

- ✅ DigitalOcean Droplets: x86_64
- ✅ Linode: x86_64
- ✅ Vultr: x86_64
- ✅ Heroku: x86_64
- ✅ Render: x86_64
- ✅ Fly.io: x86_64 and arm64

---

## CI/CD Platform Support

### GitHub Actions

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    arch: [x64, arm64]

steps:
  - name: Test Socket CLI
    run: |
      chmod +x ./pkg-binaries/socket-${{ matrix.os }}-${{ matrix.arch }}
      ./pkg-binaries/socket-${{ matrix.os }}-${{ matrix.arch }} --version
```

### GitLab CI

```yaml
test:linux:x64:
  image: ubuntu:22.04
  script:
    - ./pkg-binaries/socket-linux-x64 --version

test:linux:arm64:
  image: arm64v8/ubuntu:22.04
  tags:
    - arm64
  script:
    - ./pkg-binaries/socket-linux-arm64 --version
```

### CircleCI

```yaml
jobs:
  test-linux:
    docker:
      - image: ubuntu:22.04
    steps:
      - run: ./pkg-binaries/socket-linux-x64 --version

  test-macos:
    macos:
      xcode: "15.0"
    steps:
      - run: ./pkg-binaries/socket-macos-arm64 --version
```

---

## Libc Compatibility

### glibc (Most Linux Distributions)

Socket CLI binaries are built with:
- **Minimum glibc:** 2.27 (Ubuntu 18.04, Debian 10)
- **Compatible with:**
  - Ubuntu 18.04+
  - Debian 10+
  - Red Hat Enterprise Linux 8+
  - CentOS 8+
  - Fedora 36+
  - Amazon Linux 2/2023

### musl libc (Alpine Linux)

Socket CLI binaries work on musl-based distributions:
- ✅ Alpine Linux 3.14+
- ✅ Alpine-based Docker images
- ✅ Lightweight containers

**Note:** The same binary works on both glibc and musl systems because Node.js is statically compiled with all dependencies.

---

## Cross-Platform Building

### Building for All Platforms

To build binaries for all platforms, you need:

1. **Custom Node.js for each platform:**
   - Build on native hardware, OR
   - Use GitHub Actions matrix, OR
   - Use Docker emulation (slow)

2. **GitHub Actions workflow:**

```yaml
name: Build pkg Binaries

on: [push]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: node24-linux-x64
          - os: ubuntu-latest
            target: node24-linux-arm64  # Uses QEMU
          - os: macos-13
            target: node24-macos-x64
          - os: macos-14  # M1
            target: node24-macos-arm64
          - os: windows-latest
            target: node24-win-x64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU (for ARM64)
        if: matrix.target == 'node24-linux-arm64'
        uses: docker/setup-qemu-action@v3

      - name: Build custom Node.js
        run: pnpm run build:yao-pkg:node

      - name: Build pkg binary
        run: pnpm run build:yao-pkg

      - uses: actions/upload-artifact@v4
        with:
          name: socket-${{ matrix.target }}
          path: pkg-binaries/*
```

---

## Recommendations

### For Desktop Users
- **macOS:** Use `socket-macos-arm64` (Apple Silicon) or `socket-macos-x64` (Intel)
- **Windows:** Use `socket-win-x64` (most common)
- **Linux:** Use `socket-linux-x64` (most common)

### For Docker/Containers
- **Primary:** `socket-linux-x64` (99% of Docker hosts)
- **ARM/Graviton:** `socket-linux-arm64` (AWS Graviton, ARM servers)
- **Alpine:** Both `socket-linux-x64` and `socket-linux-arm64` work

### For CI/CD
- **GitHub Actions:** `socket-linux-x64` (default runners)
- **GitLab CI:** `socket-linux-x64` (default runners)
- **CircleCI:** `socket-linux-x64` (default Linux executor)
- **AWS CodeBuild:** `socket-linux-x64` or `socket-linux-arm64` (Graviton)

### For Cloud Deployments
- **AWS Lambda:** `socket-linux-x64` or `socket-linux-arm64`
- **AWS Fargate:** `socket-linux-x64` or `socket-linux-arm64`
- **Google Cloud Run:** `socket-linux-x64`
- **Azure Container Instances:** `socket-linux-x64`

---

## Troubleshooting

### "No such file or directory" on Linux

**Cause:** Missing dynamic linker or wrong architecture.

**Fix:**
```bash
# Check binary architecture
file pkg-binaries/socket-linux-x64
# Should show: ELF 64-bit LSB executable, x86-64

# Verify you're on the right platform
uname -m
# Should show: x86_64 (for linux-x64) or aarch64 (for linux-arm64)
```

### "Cannot execute binary file: Exec format error"

**Cause:** Wrong architecture (e.g., trying to run arm64 on x64).

**Fix:** Use the correct binary for your platform.

### "Permission denied"

**Cause:** Binary not executable.

**Fix:**
```bash
chmod +x pkg-binaries/socket-*
```

---

## Summary

Socket CLI pkg binaries provide **maximum compatibility** across:

- ✅ **Desktop platforms** (macOS, Windows, Linux)
- ✅ **Docker containers** (Ubuntu, Alpine, Debian, Amazon Linux)
- ✅ **Cloud platforms** (AWS, GCP, Azure, DigitalOcean)
- ✅ **ARM architecture** (Apple Silicon, AWS Graviton, Raspberry Pi)
- ✅ **x86_64 architecture** (Intel/AMD servers and desktops)
- ✅ **CI/CD platforms** (GitHub Actions, GitLab CI, CircleCI)

The `node24-linux-x64` binary covers **99% of Docker use cases**, while `node24-linux-arm64` provides optimal performance on ARM-based infrastructure like AWS Graviton.
