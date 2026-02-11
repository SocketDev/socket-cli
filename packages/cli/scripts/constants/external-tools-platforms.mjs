/**
 * @fileoverview Platform-specific binary mappings for external security tools.
 * Maps Socket CLI platform identifiers to specific binary asset names from each
 * tool's GitHub releases.
 *
 * Used by:
 * - SEA build utils for downloading and packaging security tools
 * - External tools downloader scripts
 */

/**
 * Platform-specific binary mappings for external security tools.
 *
 * Maps Socket CLI platform identifiers (e.g., 'darwin-arm64') to the specific
 * binary asset names from each tool's GitHub releases. All binaries are native
 * for their target architecture except on windows-arm64, where Trivy and OpenGrep
 * use x64 emulation (Windows 11 ARM64 includes transparent x64 emulation).
 *
 * Windows ARM64 Emulation:
 * Trivy and OpenGrep don't provide native ARM64 Windows builds. However, Windows 11
 * ARM64 includes transparent x64 emulation (similar to Rosetta on macOS), so we use
 * x64 binaries on windows-arm64 with no code changes or special invocation needed.
 * The binaries are marked with "(x64 emulated)" comments for clarity.
 *
 * Tool Binary Naming Conventions:
 * - Python: cpython-{version}-{arch}-{os}-{abi}-install_only.tar.gz.
 * - Trivy: trivy_{version}_{OS}-{ARCH}.tar.gz or .zip.
 * - TruffleHog: trufflehog_{version}_{os}_{arch}.tar.gz.
 * - OpenGrep: opengrep-core_{os}_{arch}.tar.gz or .zip.
 */
export const PLATFORM_MAP_TOOLS = {
  __proto__: null,

  // macOS ARM64 (Apple Silicon) - all native arm64.
  'darwin-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_osx_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-apple-darwin-install_only.tar.gz',
    trivy: 'trivy_0.69.1_macOS-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_arm64.tar.gz',
  },

  // macOS Intel - all native x86_64.
  'darwin-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_osx_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-apple-darwin-install_only.tar.gz',
    trivy: 'trivy_0.69.1_macOS-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_amd64.tar.gz',
  },

  // Linux ARM64 (glibc) - all native aarch64.
  'linux-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-unknown-linux-gnu-install_only.tar.gz',
    trivy: 'trivy_0.69.1_Linux-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_arm64.tar.gz',
  },

  // Linux ARM64 (musl/Alpine) - all native aarch64.
  'linux-arm64-musl': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-unknown-linux-musl-install_only.tar.gz',
    trivy: 'trivy_0.69.1_Linux-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_arm64.tar.gz',
  },

  // Linux x86_64 (glibc) - all native x86_64.
  'linux-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-unknown-linux-gnu-install_only.tar.gz',
    trivy: 'trivy_0.69.1_Linux-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_amd64.tar.gz',
  },

  // Linux x86_64 (musl/Alpine) - all native x86_64.
  'linux-x64-musl': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-unknown-linux-musl-install_only.tar.gz',
    trivy: 'trivy_0.69.1_Linux-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_amd64.tar.gz',
  },

  // Windows ARM64 - Python and TruffleHog are native arm64.
  // Trivy and OpenGrep use x64 binaries (Windows 11 ARM64 emulates x64).
  'windows-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_windows_x86.zip', // x64 emulated.
    python:
      'cpython-3.11.14+20260203-aarch64-pc-windows-msvc-install_only.tar.gz', // native arm64.
    trivy: 'trivy_0.69.1_windows-64bit.zip', // x64 emulated.
    trufflehog: 'trufflehog_3.93.1_windows_arm64.tar.gz', // native arm64.
  },

  // Windows x86_64 - all native x86_64.
  'windows-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_windows_x86.zip',
    python:
      'cpython-3.11.14+20260203-x86_64-pc-windows-msvc-install_only.tar.gz',
    trivy: 'trivy_0.69.1_windows-64bit.zip',
    trufflehog: 'trufflehog_3.93.1_windows_amd64.tar.gz',
  },
}
