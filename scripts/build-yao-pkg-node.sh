#!/usr/bin/env bash
set -euo pipefail

# Build custom Node.js v24.9.0 with yao-pkg patches
# This produces a patched Node binary for use with @yao-pkg/pkg

NODE_VERSION="v24.9.0"
BUILD_DIR="/Users/jdalton/projects/socket-cli/.custom-node-build"
NODE_DIR="$BUILD_DIR/node-yao-pkg"
PATCH_FILE="$BUILD_DIR/patches/node.v24.9.0.cpp.patch"

echo "🔨 Building yao-pkg patched Node.js $NODE_VERSION"

# Ensure patch file exists
if [ ! -f "$PATCH_FILE" ]; then
  echo "❌ Patch file not found: $PATCH_FILE"
  echo "   Download it first:"
  echo "   curl -sL https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.9.0.cpp.patch -o $PATCH_FILE"
  exit 1
fi

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Clone Node.js if not already present
if [ ! -d "node-yao-pkg" ]; then
  echo "📥 Cloning Node.js $NODE_VERSION..."
  git clone --depth 1 --branch "$NODE_VERSION" https://github.com/nodejs/node.git node-yao-pkg
  cd node-yao-pkg
else
  echo "📂 Using existing Node.js clone..."
  cd node-yao-pkg
  # Reset to clean state
  git reset --hard "$NODE_VERSION"
  git clean -fdx
fi

# Apply yao-pkg patch
echo "🩹 Applying yao-pkg patch..."
if patch -p1 --dry-run < "$PATCH_FILE" > /dev/null 2>&1; then
  patch -p1 < "$PATCH_FILE"
  echo "✅ Patch applied successfully"
else
  echo "❌ Patch failed to apply"
  echo "   Checking patch status..."
  patch -p1 --dry-run < "$PATCH_FILE" || true
  exit 1
fi

# Configure with small-icu (yao-pkg standard)
echo "⚙️  Configuring Node.js..."
./configure \
  --with-intl=small-icu \
  --without-npm \
  --without-corepack

# Build with optimizations
echo "🏗️  Building Node.js (this will take 30-60 minutes)..."
echo "   Using $(sysctl -n hw.ncpu) CPU cores"

# Build using all available cores
make -j$(sysctl -n hw.ncpu)

# Test the binary
echo "✅ Testing binary..."
./out/Release/node --version
./out/Release/node -e "console.log('Hello from yao-pkg patched Node.js!')"

# Sign for macOS ARM64
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  echo "🔏 Signing binary for macOS ARM64..."
  codesign --sign - --force ./out/Release/node
  codesign -dv ./out/Release/node 2>&1 | grep -E "Signature|Identifier"
fi

# Report size
echo ""
echo "🎉 Build complete!"
echo "   Binary: $NODE_DIR/out/Release/node"
echo "   Size: $(du -h "$NODE_DIR/out/Release/node" | cut -f1)"
echo ""
echo "📝 To use with yao-pkg, update pkg.json:"
echo '   {'
echo '     "node": "'$NODE_DIR/out/Release/node'",'
echo '     ...'
echo '   }'
