#!/usr/bin/env bash
# Socket CLI installation script.
# Downloads and installs the appropriate Socket CLI binary for your platform.

set -euo pipefail

# Colors for output.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored messages.
info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

success() {
  echo -e "${GREEN}✓${NC} $1"
}

error() {
  echo -e "${RED}✗${NC} $1"
}

warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Detect platform and architecture.
detect_platform() {
  local os
  local arch

  # Detect OS.
  case "$(uname -s)" in
    Linux*)
      os="linux"
      ;;
    Darwin*)
      os="darwin"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      os="win32"
      ;;
    *)
      error "Unsupported operating system: $(uname -s)"
      exit 1
      ;;
  esac

  # Detect architecture.
  case "$(uname -m)" in
    x86_64|amd64)
      arch="x64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    *)
      error "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

# Get the latest release version from GitHub.
get_latest_version() {
  local version

  # Try using curl with GitHub API.
  if command -v curl &> /dev/null; then
    version=$(curl -fsSL https://api.github.com/repos/SocketDev/socket-cli/releases/latest | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"\([^"]*\)"/\1/')
  # Fallback to wget.
  elif command -v wget &> /dev/null; then
    version=$(wget -qO- https://api.github.com/repos/SocketDev/socket-cli/releases/latest | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"\([^"]*\)"/\1/')
  else
    error "Neither curl nor wget found. Please install one of them."
    exit 1
  fi

  if [ -z "$version" ]; then
    error "Failed to fetch latest version from GitHub"
    exit 1
  fi

  echo "$version"
}

# Calculate SHA256 hash of a string.
calculate_hash() {
  local str="$1"

  if command -v sha256sum &> /dev/null; then
    echo -n "$str" | sha256sum | cut -d' ' -f1
  elif command -v shasum &> /dev/null; then
    echo -n "$str" | shasum -a 256 | cut -d' ' -f1
  else
    error "Neither sha256sum nor shasum found"
    exit 1
  fi
}

# Download and install Socket CLI.
install_socket_cli() {
  local platform
  local version
  local package_name
  local download_url
  local dlx_dir
  local package_hash
  local install_dir
  local binary_path
  local bin_dir
  local symlink_path

  info "Detecting platform..."
  platform=$(detect_platform)
  success "Platform detected: $platform"

  info "Fetching latest version..."
  version=$(get_latest_version)
  success "Latest version: $version"

  # Construct package name and download URL.
  package_name="@socketbin/cli-${platform}"
  download_url="https://github.com/SocketDev/socket-cli/releases/download/${version}/socketbin-cli-${platform}.tgz"

  info "Downloading Socket CLI from $download_url"

  # Create DLX directory structure.
  dlx_dir="${HOME}/.socket/_dlx"
  mkdir -p "$dlx_dir"

  # Calculate content hash for the package.
  package_hash=$(calculate_hash "${package_name}@${version}")
  install_dir="${dlx_dir}/${package_hash}"

  # Create installation directory.
  mkdir -p "$install_dir"

  # Download tarball to temporary location.
  local temp_tarball="${install_dir}/socket.tgz"

  if command -v curl &> /dev/null; then
    curl -fsSL -o "$temp_tarball" "$download_url"
  elif command -v wget &> /dev/null; then
    wget -qO "$temp_tarball" "$download_url"
  fi

  success "Downloaded tarball"

  # Extract tarball.
  info "Extracting binary..."
  tar -xzf "$temp_tarball" -C "$install_dir"

  # Find the binary (it's in package/bin/socket or package/bin/socket.exe).
  if [ "$platform" = "win32-x64" ] || [ "$platform" = "win32-arm64" ]; then
    binary_path="${install_dir}/package/bin/socket.exe"
  else
    binary_path="${install_dir}/package/bin/socket"
  fi

  if [ ! -f "$binary_path" ]; then
    error "Binary not found at expected path: $binary_path"
    exit 1
  fi

  # Make binary executable (Unix-like systems).
  if [ "$platform" != "win32-x64" ] && [ "$platform" != "win32-arm64" ]; then
    chmod +x "$binary_path"

    # Clear macOS quarantine attribute.
    if [ "$platform" = "darwin-x64" ] || [ "$platform" = "darwin-arm64" ]; then
      xattr -d com.apple.quarantine "$binary_path" 2>/dev/null || true
    fi
  fi

  # Clean up tarball.
  rm "$temp_tarball"

  success "Installed to $binary_path"

  # Create symlink in user's local bin directory.
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  symlink_path="${bin_dir}/socket"

  # Remove existing symlink if present.
  if [ -L "$symlink_path" ] || [ -f "$symlink_path" ]; then
    rm "$symlink_path"
  fi

  # Create symlink.
  ln -s "$binary_path" "$symlink_path"
  success "Created symlink: $symlink_path -> $binary_path"

  # Check if ~/.local/bin is in PATH.
  if [[ ":$PATH:" != *":${bin_dir}:"* ]]; then
    warning "~/.local/bin is not in your PATH"
    echo ""
    echo "Add it to your PATH by adding this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
  else
    success "~/.local/bin is already in your PATH"
  fi

  echo ""
  success "Socket CLI installed successfully!"
  echo ""
  info "Run 'socket --help' to get started"
  info "Run 'socket self-update' to update to the latest version"
}

# Main execution.
main() {
  echo ""
  echo "Socket CLI Installer"
  echo "===================="
  echo ""

  install_socket_cli
}

main "$@"
