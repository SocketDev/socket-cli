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

# Detect if running on musl libc (Alpine Linux, etc.).
detect_musl() {
  # Check for Alpine in /etc/os-release.
  if [ -f /etc/os-release ]; then
    if grep -qi 'alpine' /etc/os-release 2>/dev/null; then
      return 0
    fi
  fi

  # Check for musl dynamic linker.
  if [ -f /lib/ld-musl-x86_64.so.1 ] || [ -f /lib/ld-musl-aarch64.so.1 ]; then
    return 0
  fi

  # Check ldd output for musl.
  if command -v ldd &> /dev/null; then
    if ldd --version 2>&1 | grep -qi musl; then
      return 0
    fi
  fi

  return 1
}

# Detect platform and architecture.
detect_platform() {
  local os
  local arch
  local libc_suffix=""

  # Detect OS.
  case "$(uname -s)" in
    Linux*)
      os="linux"
      # Check for musl libc on Linux.
      if detect_musl; then
        libc_suffix="-musl"
      fi
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

  echo "${os}-${arch}${libc_suffix}"
}

# Fetch a URL to stdout, enforcing HTTPS.
fetch_url() {
  local url="$1"

  if command -v curl &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -fsSL "$url"
  elif command -v wget &> /dev/null; then
    wget --https-only -qO- "$url"
  else
    error "Neither curl nor wget found on your system"
    echo ""
    info "Please install curl or wget to continue:"
    info "  macOS:   brew install curl"
    info "  Ubuntu:  sudo apt-get install curl"
    info "  Fedora:  sudo dnf install curl"
    exit 1
  fi
}

# Download a URL to a file, enforcing HTTPS.
fetch_url_to_file() {
  local url="$1"
  local out="$2"

  if command -v curl &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -fsSL -o "$out" "$url"
  elif command -v wget &> /dev/null; then
    wget --https-only -qO "$out" "$url"
  else
    error "Neither curl nor wget found on your system"
    exit 1
  fi
}

# Get the latest version from npm registry.
get_latest_version() {
  local package_name="$1"
  local version

  version=$(fetch_url "https://registry.npmjs.org/${package_name}/latest" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/"version": *"\([^"]*\)"/\1/')

  if [ -z "$version" ]; then
    error "Failed to fetch latest version from npm registry"
    echo ""
    info "This might be a temporary network issue. Please try again."
    info "If the problem persists, check your internet connection."
    exit 1
  fi

  echo "$version"
}

# Get the npm-published integrity string (SSRI format, e.g. "sha512-...") for
# a specific version.
get_published_integrity() {
  local package_name="$1"
  local version="$2"
  local integrity

  integrity=$(fetch_url "https://registry.npmjs.org/${package_name}/${version}" | grep -o '"integrity": *"[^"]*"' | head -1 | sed 's/"integrity": *"\([^"]*\)"/\1/')

  echo "$integrity"
}

# Compute an SSRI-style hash (e.g. "sha512-<base64>") of a file.
compute_integrity() {
  local file="$1"
  local algo="$2"
  local digest

  if command -v openssl &> /dev/null; then
    digest=$(openssl dgst "-${algo}" -binary "$file" | base64 | tr -d '\n')
  elif [ "$algo" = "sha512" ] && command -v shasum &> /dev/null; then
    # Fallback: shasum prints hex; convert to base64.
    digest=$(shasum -a 512 "$file" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
  elif [ "$algo" = "sha256" ] && command -v shasum &> /dev/null; then
    digest=$(shasum -a 256 "$file" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
  else
    error "No tool available to compute ${algo} (need openssl or shasum)"
    exit 1
  fi

  echo "${algo}-${digest}"
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

  # Look up the integrity string the registry published for this exact version.
  step "Fetching published integrity..."
  local expected_integrity
  expected_integrity=$(get_published_integrity "$package_name" "$version")
  if [ -z "$expected_integrity" ]; then
    error "No integrity found in the npm registry metadata for ${package_name}@${version}"
    info "Refusing to install without a published checksum to verify against."
    exit 1
  fi

  # Algorithm prefix from the SSRI string (e.g. "sha512-..." -> "sha512").
  local integrity_algo="${expected_integrity%%-*}"

  # Download tarball to a temporary location outside the install dir so a
  # failed verify can't leave a partial blob where future runs might trust it.
  local temp_tarball
  if command -v mktemp &> /dev/null; then
    temp_tarball=$(mktemp -t socket-cli.XXXXXX.tgz 2>/dev/null || mktemp "${TMPDIR:-/tmp}/socket-cli.XXXXXX")
  else
    temp_tarball="${TMPDIR:-/tmp}/socket-cli.$$.tgz"
  fi
  trap 'rm -f "$temp_tarball"' EXIT

  fetch_url_to_file "$download_url" "$temp_tarball"

  # Verify integrity against the value npm published for this version.
  step "Verifying integrity..."
  local actual_integrity
  actual_integrity=$(compute_integrity "$temp_tarball" "$integrity_algo")
  if [ "$actual_integrity" != "$expected_integrity" ]; then
    error "Integrity check failed for ${package_name}@${version}"
    info "  expected: ${expected_integrity}"
    info "  got:      ${actual_integrity}"
    info "Not installing. Please retry; if this persists, open an issue."
    exit 1
  fi
  success "Integrity verified (${integrity_algo})"

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

  # Clean up tarball (EXIT trap also handles this in error paths).
  rm -f "$temp_tarball"
  trap - EXIT

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
