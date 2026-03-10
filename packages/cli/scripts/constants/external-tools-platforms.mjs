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
 * Socket-Patch Platform Coverage (v2.0.0):
 * socket-patch is a Rust binary from https://github.com/SocketDev/socket-patch.
 * As of v2.0.0, the following builds are available:
 *   - socket-patch-aarch64-apple-darwin.tar.gz      (darwin-arm64)
 *   - socket-patch-x86_64-apple-darwin.tar.gz       (darwin-x64)
 *   - socket-patch-aarch64-unknown-linux-gnu.tar.gz (linux-arm64 glibc)
 *   - socket-patch-x86_64-unknown-linux-musl.tar.gz (linux-x64 musl)
 *   - socket-patch-aarch64-pc-windows-msvc.zip      (win32-arm64)
 *   - socket-patch-x86_64-pc-windows-msvc.zip       (win32-x64)
 *
 * MISSING BUILDS (using fallbacks):
 *   - linux-x64 (glibc): Using musl build as fallback. Musl binaries are statically
 *     linked and run on glibc systems without issues.
 *   - linux-arm64-musl: Using glibc build as fallback. This may have compatibility
 *     issues on Alpine/musl systems. TODO: Request musl build from socket-patch team.
 *
 * Tool Binary Naming Conventions:
 * - Python: cpython-{version}-{arch}-{os}-{abi}-install_only.tar.gz.
 * - Trivy: trivy_{version}_{OS}-{ARCH}.tar.gz or .zip.
 * - TruffleHog: trufflehog_{version}_{os}_{arch}.tar.gz.
 * - OpenGrep: opengrep-core_{os}_{arch}.tar.gz or .zip.
 * - Socket-Patch: socket-patch-{rust-target}.tar.gz or .zip.
 */
export const PLATFORM_MAP_TOOLS = {
  __proto__: null,

  // macOS ARM64 (Apple Silicon) - all native arm64.
  'darwin-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_osx_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-apple-darwin-install_only.tar.gz',
    sfw: 'sfw-free-macos-arm64',
    'socket-patch': 'socket-patch-aarch64-apple-darwin.tar.gz',
    trivy: 'trivy_0.69.2_macOS-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_arm64.tar.gz',
  },

  // macOS Intel - all native x86_64.
  'darwin-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_osx_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-apple-darwin-install_only.tar.gz',
    sfw: 'sfw-free-macos-x86_64',
    'socket-patch': 'socket-patch-x86_64-apple-darwin.tar.gz',
    trivy: 'trivy_0.69.2_macOS-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_amd64.tar.gz',
  },

  // Linux ARM64 (glibc) - all native aarch64.
  'linux-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-unknown-linux-gnu-install_only.tar.gz',
    sfw: 'sfw-free-linux-arm64',
    'socket-patch': 'socket-patch-aarch64-unknown-linux-gnu.tar.gz',
    trivy: 'trivy_0.69.2_Linux-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_arm64.tar.gz',
  },

  // Linux ARM64 (musl/Alpine) - all native aarch64.
  'linux-arm64-musl': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_aarch64.tar.gz',
    python:
      'cpython-3.11.14+20260203-aarch64-unknown-linux-musl-install_only.tar.gz',
    sfw: 'sfw-free-musl-linux-arm64',
    // FALLBACK: socket-patch v2.0.0 doesn't provide aarch64-unknown-linux-musl build.
    // Using glibc build as fallback. This may have compatibility issues on Alpine/musl.
    // The glibc binary requires glibc to be present, which Alpine doesn't have by default.
    // TODO: Request aarch64-unknown-linux-musl build from socket-patch team.
    // Tracking: https://github.com/SocketDev/socket-patch/issues/XXX
    'socket-patch': 'socket-patch-aarch64-unknown-linux-gnu.tar.gz', // FALLBACK: glibc build.
    trivy: 'trivy_0.69.2_Linux-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_arm64.tar.gz',
  },

  // Linux x86_64 (glibc) - all native x86_64.
  'linux-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-unknown-linux-gnu-install_only.tar.gz',
    sfw: 'sfw-free-linux-x86_64',
    // FALLBACK: socket-patch v2.0.0 doesn't provide x86_64-unknown-linux-gnu build.
    // Using musl build as fallback. Musl binaries are statically linked and run
    // on glibc systems without issues (the reverse is not true).
    // This is a safe fallback that works reliably.
    // TODO: Request x86_64-unknown-linux-gnu build from socket-patch team for consistency.
    'socket-patch': 'socket-patch-x86_64-unknown-linux-musl.tar.gz', // FALLBACK: musl build (works on glibc).
    trivy: 'trivy_0.69.2_Linux-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_amd64.tar.gz',
  },

  // Linux x86_64 (musl/Alpine) - all native x86_64.
  'linux-x64-musl': {
    __proto__: null,
    opengrep: 'opengrep-core_linux_x86.tar.gz',
    python:
      'cpython-3.11.14+20260203-x86_64-unknown-linux-musl-install_only.tar.gz',
    sfw: 'sfw-free-musl-linux-x86_64',
    'socket-patch': 'socket-patch-x86_64-unknown-linux-musl.tar.gz',
    trivy: 'trivy_0.69.2_Linux-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_amd64.tar.gz',
  },

  // Windows ARM64 - Python, TruffleHog, and socket-patch are native arm64.
  // Trivy, OpenGrep, and sfw use x64 binaries (Windows 11 ARM64 emulates x64).
  'win32-arm64': {
    __proto__: null,
    opengrep: 'opengrep-core_windows_x86.zip', // x64 emulated.
    python:
      'cpython-3.11.14+20260203-aarch64-pc-windows-msvc-install_only.tar.gz', // native arm64.
    sfw: 'sfw-free-windows-x86_64.exe', // x64 emulated.
    'socket-patch': 'socket-patch-aarch64-pc-windows-msvc.zip', // native arm64.
    trivy: 'trivy_0.69.2_windows-64bit.zip', // x64 emulated.
    trufflehog: 'trufflehog_3.93.1_windows_arm64.tar.gz', // native arm64.
  },

  // Windows x86_64 - all native x86_64.
  'win32-x64': {
    __proto__: null,
    opengrep: 'opengrep-core_windows_x86.zip',
    python:
      'cpython-3.11.14+20260203-x86_64-pc-windows-msvc-install_only.tar.gz',
    sfw: 'sfw-free-windows-x86_64.exe',
    'socket-patch': 'socket-patch-x86_64-pc-windows-msvc.zip',
    trivy: 'trivy_0.69.2_windows-64bit.zip',
    trufflehog: 'trufflehog_3.93.1_windows_amd64.tar.gz',
  },
}
