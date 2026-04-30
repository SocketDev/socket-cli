// Service catalog for auth-rotation-reminder.
//
// Each entry tells the hook how to detect whether a CLI is currently
// authenticated and how to log it out. `optional: true` means the hook
// silently skips the service if the binary isn't on PATH (most are
// optional — most devs have a subset of these installed).
//
// Detection commands MUST exit 0 when authenticated and non-zero when
// not. Output goes to /dev/null; the hook reads only the exit code.
//
// Logout commands run unconditionally when the hook is in auto-logout
// mode. They should be idempotent — re-running them on an already
// logged-out CLI is fine.

export interface Service {
  // Stable id used in skip-list files and error messages. Never rename
  // without a deprecation cycle — devs encode these in their personal
  // `.skip` lists.
  id: string
  // Display name for output.
  name: string
  // Command + args that exit 0 if logged in, non-zero otherwise.
  detectCmd: readonly string[]
  // Command + args that performs the logout. Must be idempotent.
  logoutCmd: readonly string[]
  // Skip silently when the binary isn't on PATH. False means the
  // hook reports "binary missing" as a finding (rare — only for
  // first-class fleet CLIs we expect every dev to have).
  optional: boolean
  // Optional human-readable doc URL surfaced when the hook reports the
  // logout. Empty when no canonical doc page exists.
  docUrl?: string
}

// Default skip-list seeds. Devs can extend via the per-user
// `~/.claude/hooks/auth-rotation/services-skip` (one id per line)
// or per-repo `.claude/auth-rotation.services-skip` files.
//
// `gh` is seeded because Claude Code itself uses `gh` for `gh pr edit`
// etc. — auto-revoking it mid-session would break the agent.
export const DEFAULT_SKIP_IDS = ['gh'] as const

export const SERVICES: readonly Service[] = [
  {
    id: 'npm',
    name: 'npm',
    detectCmd: ['npm', 'whoami'],
    logoutCmd: ['npm', 'logout'],
    optional: true,
    docUrl: 'https://docs.npmjs.com/cli/v11/commands/npm-logout',
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    detectCmd: ['pnpm', 'whoami'],
    logoutCmd: ['pnpm', 'logout'],
    optional: false,
    docUrl: 'https://pnpm.io/id/11.x/cli/logout',
  },
  {
    id: 'yarn',
    name: 'yarn',
    // Yarn Berry's logout lives under `npm` namespace; Yarn Classic's
    // is bare. We try Berry first (the modern default), fall back to
    // Classic. Detection is the same: `npm whoami` from inside a
    // yarn-managed registry. Yarn doesn't expose a portable whoami,
    // so we approximate by checking for a yarn auth token in
    // `~/.yarnrc.yml` via grep — too fragile to ship; use logout-only
    // (idempotent: clears nothing if nothing's there).
    detectCmd: ['yarn', '--version'],
    logoutCmd: ['yarn', 'npm', 'logout'],
    optional: true,
  },
  {
    id: 'gcloud',
    name: 'gcloud',
    // `gcloud auth list` exits 0 always; we check whether any non-empty
    // active account is reported. Wrap with sh -c to chain.
    detectCmd: [
      'sh',
      '-c',
      'gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .',
    ],
    logoutCmd: ['gcloud', 'auth', 'revoke', '--all', '--quiet'],
    optional: true,
    docUrl: 'https://cloud.google.com/sdk/gcloud/reference/auth/revoke',
  },
  {
    id: 'aws-sso',
    name: 'aws (sso)',
    // `aws sts get-caller-identity` succeeds when authenticated.
    // sts is the universal probe across all AWS auth flavors.
    detectCmd: ['aws', 'sts', 'get-caller-identity'],
    // `aws sso logout` only clears SSO cache. For non-SSO creds, the
    // dev would have to remove `~/.aws/credentials` themselves; we
    // don't touch that file because it might hold long-lived keys
    // intentionally. SSO-only is the conservative default.
    logoutCmd: ['aws', 'sso', 'logout'],
    optional: true,
  },
  {
    id: 'gh',
    name: 'gh (GitHub CLI)',
    detectCmd: ['gh', 'auth', 'status'],
    logoutCmd: ['gh', 'auth', 'logout', '--hostname', 'github.com'],
    optional: true,
    docUrl: 'https://cli.github.com/manual/gh_auth_logout',
  },
  {
    id: 'vault',
    name: 'vault',
    detectCmd: ['vault', 'token', 'lookup'],
    // `token revoke -self` revokes the active token; survives the
    // logout safely (re-auth via `vault login` next session).
    logoutCmd: ['vault', 'token', 'revoke', '-self'],
    optional: true,
  },
  {
    id: 'docker',
    name: 'docker',
    // No portable "am I logged in" — `docker info` returns mixed data.
    // Approximate via `docker system info` filter.
    detectCmd: [
      'sh',
      '-c',
      'docker info 2>/dev/null | grep -q "^ Username:"',
    ],
    // Without a registry arg, `docker logout` clears the default index.
    logoutCmd: ['docker', 'logout'],
    optional: true,
  },
  {
    id: 'socket',
    name: 'socket',
    // `socket whoami` (when present in the cli) is the canonical probe.
    // The cli emits exit 0 when authenticated.
    detectCmd: ['socket', 'whoami'],
    // `socket logout` clears the local API token from settings.
    logoutCmd: ['socket', 'logout'],
    optional: true,
  },
] as const
