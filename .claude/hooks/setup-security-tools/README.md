# setup-security-tools Hook

Sets up two security scanning tools for the Socket CLI project: **AgentShield** and **zizmor**. These tools catch security problems before code is pushed.

## What are these tools?

### AgentShield

AgentShield scans your Claude AI configuration files (like `CLAUDE.md` and anything in `.claude/`) for prompt injection attacks. Think of it as a linter, but instead of checking code style, it checks for ways an attacker could manipulate an AI assistant through crafted instructions.

It is already listed as a dev dependency (`ecc-agentshield`), so `pnpm install` installs it. This setup script just verifies it is accessible.

### zizmor

zizmor is a security scanner for GitHub Actions workflow files (the YAML files in `.github/workflows/`). It looks for common security mistakes like:

- **Template injection**: Using `${{ github.event.pull_request.title }}` directly in a `run:` step, which lets attackers run arbitrary commands
- **Unpinned actions**: Using `actions/checkout@main` instead of a pinned SHA
- **Excessive permissions**: Workflows with `permissions: write-all` when they only need read access
- **Credential exposure**: Secrets passed to steps that do not need them

zizmor is not an npm package, so this script downloads the correct binary for your operating system from GitHub releases.

## How to use

Run the Claude Code command:

```
/setup-security-tools
```

Or run the script directly:

```bash
node .claude/hooks/setup-security-tools/index.mts
```

## What happens when you run it

1. **AgentShield check**: Looks for `agentshield` on your PATH or in node_modules. If found, prints the version. If not, tells you to run `pnpm install`.

2. **zizmor check**: Checks several locations in order:
   - Is `zizmor` already on your PATH? (e.g., installed via `brew install zizmor`)
   - Is there a cached binary at `~/.socket/zizmor/bin/zizmor` with the right version?
   - If neither, downloads the binary:
     1. Picks the right file for your OS and CPU (macOS/Linux/Windows, x64/arm64)
     2. Downloads a `.tar.gz` (or `.zip` on Windows) from GitHub releases
     3. Verifies the SHA-256 checksum matches the expected value
     4. Extracts the binary
     5. Moves it to `~/.socket/zizmor/bin/zizmor`
     6. Makes it executable

3. **Summary**: Reports which tools are ready and which need attention.

## Where things are installed

| What | Where | Purpose |
|------|-------|---------|
| AgentShield | `node_modules/.bin/agentshield` | Installed by pnpm as a devDep |
| zizmor binary | `~/.socket/zizmor/bin/zizmor` | Downloaded from GitHub releases |

## How these tools are used in the project

The pre-push hook (`.git-hooks/pre-push`) runs both tools automatically before every `git push`:

- **AgentShield** failures **block the push** because these are our own config files and should always be clean
- **zizmor** findings are **warnings only** because some workflows intentionally use patterns that zizmor flags (suppressed with `# zizmor: ignore[...]` comments)

You can also run the full security scan with the `/security-scan` Claude Code command.

## Re-running

Safe to run multiple times. The script:
- Skips the AgentShield check if it is already installed
- Skips the zizmor download if the cached binary matches the expected version
- Does not duplicate anything

## Troubleshooting

**"AgentShield not found"** — Run `pnpm install` from the project root. AgentShield is listed as a devDependency (`ecc-agentshield`).

**"Unsupported platform"** — zizmor supports macOS (Intel + Apple Silicon), Linux (x64 + ARM64), and Windows (x64). Other platforms are not supported.

**"SHA-256 mismatch"** — The downloaded file does not match the expected hash. This could mean a corrupt download or a man-in-the-middle attack. Delete `~/.socket/zizmor/` and try again.

**"Expected binary not found after extraction"** — The tarball structure may have changed in a new zizmor release. Check the release page at https://github.com/woodruffw/zizmor/releases.

## Dependencies

This hook uses `@socketsecurity/lib` for HTTP downloads and logging. Install with:

```bash
cd .claude/hooks/setup-security-tools
npm install
```

## Copying to another repo

This hook is self-contained. To add it to another Socket repo:

1. Copy `.claude/hooks/setup-security-tools/` and `.claude/commands/setup-security-tools.md`
2. Run `cd .claude/hooks/setup-security-tools && npm install`
3. Make sure `ecc-agentshield` is a devDependency in the target repo
