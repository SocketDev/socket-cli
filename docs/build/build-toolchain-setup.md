# Build Toolchain Setup

Prerequisites and setup instructions for building Socket CLI from source.

## 🎯 Overview

Building Socket CLI requires different toolchains depending on what you're building:

| Component | Required Toolchain |
|-----------|-------------------|
| WASM (Yoga) | Emscripten SDK |
| WASM (ONNX, Models) | Rust + wasm-pack |
| Custom Node.js | Python, GCC/Clang, Make |
| SEA Binaries | Node.js 20+ |
| Cross-platform | Docker + QEMU |

## 📦 Quick Setup (macOS)

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install build essentials
brew install python@3.12 cmake ninja

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git ~/.emsdk
cd ~/.emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

# Add to shell profile (~/.zshrc or ~/.bash_profile)
echo 'source ~/.emsdk/emsdk_env.sh' >> ~/.zshrc

# Install Docker Desktop (for cross-platform builds)
# Download from: https://www.docker.com/products/docker-desktop
```

## 📦 Quick Setup (Linux)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  python3 \
  python3-pip \
  cmake \
  ninja-build \
  ccache \
  libssl-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install Emscripten
git clone https://github.com/emscripten-core/emsdk.git ~/.emsdk
cd ~/.emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

# Add to shell profile
echo 'source ~/.emsdk/emsdk_env.sh' >> ~/.bashrc

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

## 📦 Quick Setup (Windows)

```powershell
# Install Chocolatey (package manager)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install build tools
choco install -y visualstudio2022buildtools visualstudio2022-workload-vctools
choco install -y python cmake ninja

# Install Rust
# Download and run: https://rustup.rs/
rustup target add wasm32-unknown-unknown

# Install wasm-pack
# Download and run: https://rustwasm.github.io/wasm-pack/installer/

# Install Emscripten
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
emsdk install latest
emsdk activate latest
# Run emsdk_env.bat before each build session

# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop
```

## 🔧 Detailed Setup

### Emscripten SDK (for Yoga Layout WASM)

Emscripten compiles C/C++ to WebAssembly.

```bash
# Clone and install
git clone https://github.com/emscripten-core/emsdk.git ~/.emsdk
cd ~/.emsdk
./emsdk install 3.1.70  # Specific version for reproducibility
./emsdk activate 3.1.70

# Verify installation
source ./emsdk_env.sh
emcc --version
# Should output: emcc (Emscripten gcc/clang-like replacement) 3.1.70

# Permanent activation (add to shell profile)
echo 'source ~/.emsdk/emsdk_env.sh' >> ~/.zshrc  # or ~/.bashrc
```

### Rust + wasm-pack (for ONNX Runtime & Models)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Add WASM target
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasi

# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Verify installation
rustc --version
cargo --version
wasm-pack --version
```

### Python + Build Tools (for Node.js)

**macOS:**
```bash
brew install python@3.12
python3 --version  # Should be 3.12+
```

**Linux:**
```bash
sudo apt-get install -y python3 python3-pip
python3 --version  # Should be 3.8+
```

**Windows:**
```powershell
choco install -y python
python --version  # Should be 3.8+
```

### C++ Compiler (for Node.js)

**macOS:**
```bash
# Xcode Command Line Tools
xcode-select --install

# Or install full Xcode from App Store
# Then: xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

**Linux:**
```bash
# GCC (recommended)
sudo apt-get install -y build-essential

# Or Clang
sudo apt-get install -y clang
```

**Windows:**
```powershell
# Visual Studio Build Tools
choco install -y visualstudio2022buildtools visualstudio2022-workload-vctools

# Or full Visual Studio 2022 Community Edition
# Download from: https://visualstudio.microsoft.com/downloads/
```

### Docker (for Cross-Platform Builds)

**macOS:**
```bash
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop

# Enable experimental features in Docker Desktop settings
# Settings > Experimental Features > Enable "Use containerd for pulling and storing images"
```

**Linux:**
```bash
# Install Docker Engine
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Buildx
mkdir -p ~/.docker/cli-plugins
curl -SL https://github.com/docker/buildx/releases/latest/download/buildx-linux-amd64 \
  -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx

# Setup QEMU for ARM emulation
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

**Windows:**
```powershell
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop

# Enable WSL 2 backend in Docker Desktop settings
```

## ✅ Verification

After setup, verify all tools are installed:

```bash
# Node.js & pnpm
node --version       # Should be 20+
pnpm --version       # Should be 9+

# Python
python3 --version    # Should be 3.8+

# C++ compiler
gcc --version        # Linux
clang --version      # macOS
cl.exe               # Windows

# Rust
rustc --version
cargo --version
wasm-pack --version

# Emscripten
emcc --version

# Docker
docker --version
docker buildx version
```

## 📊 Disk Space Requirements

Ensure you have sufficient disk space:

| Component | Required Space |
|-----------|----------------|
| Emscripten SDK | ~1 GB |
| Rust toolchain | ~2 GB |
| Node.js source | ~500 MB |
| Build artifacts (per platform) | ~2 GB |
| Docker images | ~5 GB |
| **Total (single platform)** | **~10 GB** |
| **Total (all platforms)** | **~30 GB** |

## 🚀 Quick Test

Test that your toolchain is working:

```bash
# Test Rust WASM build
cd packages/node-smol-builder/wasm-bundle
cargo build --release --target wasm32-unknown-unknown

# Test Emscripten build
cd packages/yoga-layout
pnpm run build

# Test Node.js build (current platform only)
cd packages/node-smol-builder
pnpm run build
```

## 🐛 Troubleshooting

### Emscripten not found

```bash
# Make sure emsdk is activated
source ~/.emsdk/emsdk_env.sh

# Verify PATH
which emcc

# If not found, add to shell profile
echo 'source ~/.emsdk/emsdk_env.sh' >> ~/.zshrc
```

### Rust target not found

```bash
# Install WASM target
rustup target add wasm32-unknown-unknown

# Verify target is installed
rustup target list --installed | grep wasm32
```

### Python version too old

```bash
# macOS: Use Homebrew
brew install python@3.12
brew link python@3.12

# Linux: Use deadsnakes PPA
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install python3.12
```

### Docker permission denied (Linux)

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again, or:
newgrp docker
```

### Windows: Long path issues

```powershell
# Enable long paths in Windows
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force

# Enable in Git
git config --system core.longpaths true
```

## 📚 References

- [Emscripten Documentation](https://emscripten.org/docs/getting_started/downloads.html)
- [Rust Installation](https://www.rust-lang.org/tools/install)
- [wasm-pack Documentation](https://rustwasm.github.io/wasm-pack/)
- [Node.js Building Guide](https://github.com/nodejs/node/blob/main/BUILDING.md)
- [Docker Buildx](https://docs.docker.com/buildx/working-with-buildx/)
