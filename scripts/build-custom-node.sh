#!/usr/bin/env bash
set -euo pipefail

# Build custom Node.js v22 with aggressive optimizations for yao-pkg
# This produces a smaller binary by:
# - Using -O3 and -flto optimizations
# - Building with small ICU
# - Zeroing out V8 compile-time flags (done in configure)

VARIANT="${1:-optimized}"
NODE_VERSION="v22.11.0"
BUILD_DIR="/Users/jdalton/projects/socket-cli/.custom-node-build"
NODE_DIR="$BUILD_DIR/node"

echo "🔨 Building custom Node.js $NODE_VERSION ($VARIANT variant)"

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Clone Node.js if not already present
if [ ! -d "node" ]; then
  echo "📥 Cloning Node.js $NODE_VERSION..."
  git clone --depth 1 --branch "$NODE_VERSION" https://github.com/nodejs/node.git
  cd node
else
  echo "📂 Using existing Node.js clone..."
  cd node
fi

# Clean previous build (but don't delete directory)
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
./out/Release/node -e "console.log('Hello from custom Node.js!')"

# Report size
echo ""
echo "🎉 Build complete!"
echo "   Binary: $NODE_DIR/out/Release/node"
echo "   Size: $(du -h "$NODE_DIR/out/Release/node" | cut -f1)"
echo ""
echo "📝 To use with yao-pkg, update package.json:"
echo '   "pkg": {'
echo '     "node": "'$NODE_DIR/out/Release/node'",'
echo '     ...'
echo '   }'
