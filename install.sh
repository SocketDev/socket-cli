#!/usr/bin/env bash
# Socket CLI installation script.
# Downloads and installs the appropriate Socket CLI binary for your platform.

set -euo pipefail

# Colors for output.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
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

step() {
  echo -e "${CYAN}→${NC} $1"
}

socket_brand() {
  echo -e "${PURPLE}⚡${NC} $1"
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
      echo ""
      info "Socket CLI supports Linux, macOS, and Windows."
      info "If you think this is an error, please open an issue at:"
      info "https://github.com/SocketDev/socket-cli/issues"
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
      echo ""
      info "Socket CLI supports x64 and arm64 architectures."
      info "If you think this is an error, please open an issue at:"
      info "https://github.com/SocketDev/socket-cli/issues"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

# Get the latest version from npm registry.
get_latest_version() {
  local package_name="$1"
  local version

  # Try using curl with npm registry API.
  if command -v curl &> /dev/null; then
    version=$(curl -fsSL "https://registry.npmjs.org/${package_name}/latest" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/"version": *"\([^"]*\)"/\1/')
  # Fallback to wget.
  elif command -v wget &> /dev/null; then
    version=$(wget -qO- "https://registry.npmjs.org/${package_name}/latest" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/"version": *"\([^"]*\)"/\1/')
  else
    error "Neither curl nor wget found on your system"
    echo ""
    info "Please install curl or wget to continue:"
    info "  macOS:   brew install curl"
    info "  Ubuntu:  sudo apt-get install curl"
    info "  Fedora:  sudo dnf install curl"
    exit 1
  fi

  if [ -z "$version" ]; then
    error "Failed to fetch latest version from npm registry"
    echo ""
    info "This might be a temporary network issue. Please try again."
    info "If the problem persists, check your internet connection."
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

  step "Detecting your platform..."
  platform=$(detect_platform)
  success "Platform detected: ${BOLD}$platform${NC}"

  # Construct package name.
  package_name="@socketbin/cli-${platform}"

  step "Fetching latest version from npm..."
  version=$(get_latest_version "$package_name")
  success "Found version ${BOLD}$version${NC}"

  # Construct download URL from npm registry.
  download_url="https://registry.npmjs.org/${package_name}/-/cli-${platform}-${version}.tgz"

  socket_brand "Downloading Socket CLI..."

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

  success "Package downloaded successfully"

  # Extract tarball.
  step "Capturing lightning in a bottle ⚡"
  tar -xzf "$temp_tarball" -C "$install_dir"

  # Get Socket CLI version from extracted package.
  local cli_version
  if [ -f "${install_dir}/package/package.json" ]; then
    cli_version=$(grep -o '"version": *"[^"]*"' "${install_dir}/package/package.json" | head -1 | sed 's/"version": *"\([^"]*\)"/\1/')
    if [ -n "$cli_version" ]; then
      success "Socket CLI ${BOLD}v${cli_version}${NC} (build ${version})"
    fi
  fi

  # Find the binary (it's in package/bin/socket or package/bin/socket.exe).
  if [ "$platform" = "win32-x64" ] || [ "$platform" = "win32-arm64" ]; then
    binary_path="${install_dir}/package/bin/socket.exe"
  else
    binary_path="${install_dir}/package/bin/socket"
  fi

  if [ ! -f "$binary_path" ]; then
    error "Binary not found at expected path: $binary_path"
    echo ""
    info "This might be a temporary issue with the package. Try again in a moment."
    exit 1
  fi

  # Make binary executable (Unix-like systems).
  if [ "$platform" != "win32-x64" ] && [ "$platform" != "win32-arm64" ]; then
    chmod +x "$binary_path"

    # Clear macOS quarantine attribute.
    if [ "$platform" = "darwin-x64" ] || [ "$platform" = "darwin-arm64" ]; then
      xattr -d com.apple.quarantine "$binary_path" 2>/dev/null || true
      success "Cleared macOS security restrictions"
    fi
  fi

  # Clean up tarball.
  rm "$temp_tarball"

  success "Binary ready at ${BOLD}$binary_path${NC}"

  # Create symlink in user's local bin directory.
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  symlink_path="${bin_dir}/socket"

  # Remove existing symlink if present.
  if [ -L "$symlink_path" ] || [ -f "$symlink_path" ]; then
    step "Replacing existing installation..."
    rm "$symlink_path"
  fi

  # Create symlink.
  step "Creating command shortcut..."
  ln -s "$binary_path" "$symlink_path"
  success "Command ready: ${BOLD}socket${NC}"

  echo ""

  # Check if ~/.local/bin is in PATH.
  if [[ ":$PATH:" != *":${bin_dir}:"* ]]; then
    warning "Almost there! One more step needed..."
    echo ""
    echo "  Add ${BOLD}~/.local/bin${NC} to your PATH by adding this line to your shell profile:"
    echo "  ${BOLD}(~/.bashrc, ~/.zshrc, ~/.bash_profile, or ~/.profile)${NC}"
    echo ""
    echo "    ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo ""
    echo "  Then restart your shell or run: ${CYAN}source ~/.zshrc${NC} (or your shell config)"
    echo ""
  else
    success "Your PATH is already configured perfectly!"
  fi

  echo ""
  if [ -n "$cli_version" ]; then
    socket_brand "${BOLD}Socket CLI v${cli_version} installed successfully!${NC}"
  else
    socket_brand "${BOLD}Socket CLI installed successfully!${NC}"
  fi
  echo ""
  info "Quick start:"
  echo -e "  ${CYAN}socket --help${NC}           Get started with Socket"
  echo -e "  ${CYAN}socket self-update${NC}      Update to the latest version"
  echo ""
  socket_brand "Happy securing!"
}

# Main execution.
main() {
  echo ""
  echo -e "${PURPLE}${BOLD}⚡ Socket CLI Installer ⚡${NC}"
  echo -e "${BOLD}═══════════════════════════${NC}"
  echo ""
  echo "  Secure your dependencies with Socket Security"
  echo ""

  install_socket_cli
}

main "$@"
