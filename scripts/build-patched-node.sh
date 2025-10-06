#!/usr/bin/env bash
set -euo pipefail

# Build Node.js v22.19.0 with yao-pkg patches + aggressive optimizations
VARIANT="${1:-optimized}"
NODE_VERSION="v22.19.0"
BUILD_DIR="/Users/jdalton/projects/socket-cli/.custom-node-build"
NODE_DIR="$BUILD_DIR/node-patched"
PATCH_FILE="/tmp/node.v22.19.0.cpp.patch"

echo "🔨 Building patched Node.js $NODE_VERSION ($VARIANT variant)"

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Clone Node.js if not already present
if [ ! -d "node-patched" ]; then
  echo "📥 Cloning Node.js $NODE_VERSION..."
  git clone --depth 1 --branch "$NODE_VERSION" https://github.com/nodejs/node.git node-patched
  cd node-patched
else
  echo "📂 Using existing Node.js clone..."
  cd node-patched
  # Reset to clean state
  git reset --hard HEAD
  git clean -fd
fi

# Apply yao-pkg patch
echo "🩹 Applying yao-pkg patches..."
if [ ! -f "$PATCH_FILE" ]; then
  echo "❌ Patch file not found: $PATCH_FILE"
  echo "   Downloading from yao-pkg/pkg-fetch..."
  curl -L -o "$PATCH_FILE" https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v22.19.0.cpp.patch
fi

git apply "$PATCH_FILE" --verbose

# Clean previous build
echo "🧹 Cleaning previous build..."
make clean 2>/dev/null || true

# Configure with optimizations
echo "⚙️  Configuring Node.js..."
./configure \
  --enable-lto \
  --with-intl=small-icu \
  --without-npm \
  --without-corepack

# Build with optimizations
echo "🏗️  Building Node.js (this will take 30-60 minutes)..."
echo "   Using $(sysctl -n hw.ncpu) CPU cores"

# Set compiler flags for aggressive optimization
export CFLAGS="-O3 -flto"
export CXXFLAGS="-O3 -flto"
export LDFLAGS="-flto"

# Build using all available cores
make -j$(sysctl -n hw.ncpu)

# Test the binary
echo "✅ Testing binary..."
./out/Release/node --version
./out/Release/node -e "console.log('Hello from patched Node.js!')"

# Report size
echo ""
echo "🎉 Build complete!"
echo "   Binary: $NODE_DIR/out/Release/node"
echo "   Size: $(du -h "$NODE_DIR/out/Release/node" | cut -f1)"
echo ""
echo "📝 To use with yao-pkg:"
echo "   export PKG_NODE_PATH=\"$NODE_DIR/out/Release/node\""
echo "   pnpm exec pkg . --targets node22-macos-arm64"
