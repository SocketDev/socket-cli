# TODO

## CLI Features

### Self-Update Command
- [ ] Add `socket update` command to self-update the CLI
- [ ] Check for latest version from npm registry
- [ ] Download and replace current installation
- [ ] Support for both npm-installed and SEA binary versions
- [ ] Show current version vs latest version
- [ ] Add `--check` flag to only check for updates without installing
- [ ] Add `--force` flag to force update even if on latest version

### SEA Binary Welcome Flow
- [ ] Add secret `--welcome` flag for initial SEA invocation
- [ ] Trigger automatic download of @socketsecurity/cli when --welcome is passed
- [ ] Show welcome message with Socket branding
- [ ] Display download progress bar
- [ ] Verify checksum of downloaded package
- [ ] Cache the downloaded version properly

### Curl Installation Script
- [ ] Create install.sh script for curl-based installation
- [ ] Script URL: https://raw.githubusercontent.com/SocketDev/socket-cli/main/install.sh
- [ ] Detect OS and architecture automatically
- [ ] Download appropriate SEA binary from GitHub releases
- [ ] Install to standard location:
  - macOS/Linux: /usr/local/bin/socket
  - Windows: %LOCALAPPDATA%\socket\socket.exe
- [ ] Add to PATH if needed
- [ ] Support custom installation directory with SOCKET_INSTALL_DIR env var
- [ ] Example usage: `curl -sSfL https://install.socket.dev | sh`

### Binary Storage in Release Branch
- [ ] Store SEA binaries in `release` branch of socket-cli repo
- [ ] Directory structure:
  ```
  release/
  ├── latest/
  │   ├── socket-darwin-arm64
  │   ├── socket-darwin-x64
  │   ├── socket-linux-arm64
  │   ├── socket-linux-x64
  │   ├── socket-win-arm64.exe
  │   └── socket-win-x64.exe
  └── v{version}/
      └── (same structure as latest)
  ```
- [ ] Update release branch automatically on new releases
- [ ] Keep last 5 versions for rollback capability
- [ ] Add version.json with metadata about each release

## Testing Improvements

### Critical Path Tests (Partial Progress)
- [x] Identified most critical untested utilities
- [x] Add tests for get-output-kind.mts (38 imports, HIGH) - WORKING
- [x] Add tests for fail-msg-with-badge.mts (38 imports, HIGH) - WORKING
- [ ] Fix tests for sdk.mts (72 imports, CRITICAL) - written but needs mocking fixes
- [ ] Fix tests for check-input.mts (38 imports, HIGH) - written but needs mocking fixes
- [ ] Fix tests for serialize-result-json.mts (35 imports, HIGH) - written but needs mocking fixes
- [ ] Add tests for meow-with-subcommands.mts (71 imports, CRITICAL)
- [ ] Add tests for api.mts (29 imports, CRITICAL)
- [ ] Add tests for determine-org-slug.mts (18 imports, HIGH)

### Coverage Goals
- [ ] Reach 75% code coverage (currently at 52.81%)
- [ ] Reach 85% code coverage
- [ ] Reach 90% code coverage (stretch goal)

## Documentation

- [ ] Document SEA binary distribution model
- [ ] Add installation guide for each platform
- [ ] Document environment variables for configuration
- [ ] Create troubleshooting guide for common issues