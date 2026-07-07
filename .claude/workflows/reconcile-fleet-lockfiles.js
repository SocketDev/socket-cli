export const meta = {
  description:
    'Reconcile pnpm-lock.yaml in parallel across fleet repos after a catalog/dependency cascade (one agent per repo; idempotent).',
  name: 'reconcile-fleet-lockfiles',
  phases: [
    {
      title: 'Reconcile',
      detail:
        'one agent per repo: worktree off origin/main → pnpm install (pinned pnpm) → commit+push pnpm-lock.yaml if changed → force-clean worktree',
    },
  ],
  whenToUse:
    'After a template/tool cascade that changed catalog / packageManager / overrides but left repos with a lockfile-less commit (downstream CI --frozen-lockfile then fails). Run this to regenerate + push each repo lockfile in parallel.',
}

// WHY THIS IS A WORKFLOW, NOT A SHELL LOOP:
// Each repo's lockfile reconcile is fully independent — its own remote, its own
// worktree off origin/main, its own pnpm store entry, its own push target — so
// it fans out in parallel with no cross-repo state. Hand-rolling this as
// `for r in …; do reconcile & done; wait` (or re-invoking a long backgrounded
// command) races: multiple instances land on the same repo, spawn competing
// `pnpm install`s, and orphan worktrees. The Workflow runtime gives bounded
// concurrency, one task per repo, structured results, and no leaked PIDs. This
// IS the executable law for "reconcile the fleet's lockfiles in parallel."
//
// SAFE TO RUN OVER THE WHOLE ROSTER: `reconcile-lockfiles.mts` is idempotent —
// a repo whose lockfile already matches its catalog reports `noop` and pushes
// nothing. So this workflow reconciles every roster repo; already-current ones
// are no-ops. Pass `args` to scope to a subset (e.g. the repos a cascade just
// touched); omit `args` to sweep the whole fleet.
//
// args: string[] of repo names to reconcile (subset of the roster). When
// omitted/empty, reconciles the full roster minus any repo with a live
// uncommitted session the caller named via `args.skip`. Shape:
//   - undefined            → reconcile the whole roster
//   - ['socket-lib', …]    → reconcile exactly these
//   - { only?: string[], skip?: string[] } → explicit include/exclude

// The canonical fleet roster (mirrors cascading-fleet/lib/fleet-repos.txt).
// socket-wheelhouse itself is dogfood-zero and excluded — it is the source.
const ROSTER = [
  'socket-addon',
  'socket-bin',
  'socket-btm',
  'socket-cli',
  'socket-lib',
  'socket-mcp',
  'socket-packageurl-js',
  'socket-registry',
  'socket-sdk-js',
  'sdxgen',
  'stuie',
]

function resolveTargets() {
  if (Array.isArray(args) && args.length) {
    return args.filter(r => ROSTER.includes(r))
  }
  if (args && typeof args === 'object') {
    const only = Array.isArray(args.only) ? args.only : undefined
    const skip = Array.isArray(args.skip) ? args.skip : []
    const base = only?.length ? only : ROSTER
    return base.filter(r => ROSTER.includes(r) && !skip.includes(r))
  }
  return ROSTER
}

const TARGETS = resolveTargets()

const RESULT_SCHEMA = {
  additionalProperties: false,
  properties: {
    repo: { type: 'string' },
    outcome: {
      type: 'string',
      enum: [
        'push',
        'noop',
        'skip',
        'fail-install',
        'fail-commit',
        'fail-push',
        'fail-worktree',
        'other',
      ],
      description:
        'The single RESULTS token reconcile-lockfiles emitted for this repo.',
    },
    detail: {
      type: 'string',
      description:
        'Short evidence: the RESULTS line + that no reconcile worktree leaked.',
    },
  },
  required: ['repo', 'outcome'],
  type: 'object',
}

phase('Reconcile')

const results = await parallel(
  TARGETS.map(repo => () => {
    const skipList = ROSTER.filter(r => r !== repo).join(',')
    return agent(
      [
        `Reconcile pnpm-lock.yaml for the single fleet repo "${repo}" after a catalog cascade.`,
        '',
        'Run EXACTLY this one command from the socket-wheelhouse repo — it scopes the reconcile to',
        `just "${repo}" by skipping every other roster repo — and capture its full output:`,
        '',
        '```',
        'PROJECTS="${PROJECTS:-$HOME/projects}"',
        'cd "$PROJECTS/socket-wheelhouse"',
        `node .claude/skills/fleet/cascading-fleet/lib/reconcile-lockfiles.mts --skip "${skipList}"`,
        '```',
        '',
        'That script resolves the sibling repo from $PROJECTS itself, worktrees off the repo default',
        'branch, runs `pnpm install` (repo-pinned pnpm) to regenerate the lockfile against the',
        'cascaded catalog, and IF the lockfile changed commits',
        '`chore(wheelhouse): reconcile pnpm-lock.yaml after cascade` (FLEET_SYNC sentinel) + pushes',
        'direct to the default branch, then force-removes its worktree. It is idempotent and',
        'self-cleaning.',
        '',
        'HARD RULES: run it ONCE (re-invoking races). Do NOT run any other git/pnpm command, do NOT',
        '`git add -A`, do NOT touch any other repo. The install can take minutes on a large repo —',
        'let it finish; do not assume a slow run failed.',
        '',
        `Then read the RESULTS block and report this repo's single token:`,
        `"${repo}|push:<base>" → outcome "push"; "noop:lockfile-current" → "noop";`,
        '"skip:requested"/"skip:no-git" → "skip"; "fail:install"/"fail:commit"/"fail:push"/',
        '"fail:worktree" → the matching fail-*; anything else → "other".',
        `Finally verify no leftover worktree remains: \`git -C "$PROJECTS/${repo}" worktree list | grep reconcile\` must be empty (report it in detail).`,
      ].join('\n'),
      {
        effort: 'low',
        label: `reconcile:${repo}`,
        // haiku: mechanical shell-one-command-and-report task, no reasoning needed
        model: 'claude-haiku-4-5',
        phase: 'Reconcile',
        schema: RESULT_SCHEMA,
      },
    )
  }),
)

const clean = results.filter(Boolean)
const pushed = clean.filter(r => r.outcome === 'push').map(r => r.repo)
const noop = clean.filter(r => r.outcome === 'noop').map(r => r.repo)
const failed = clean
  .filter(r => r.outcome.startsWith('fail'))
  .map(r => `${r.repo}(${r.outcome})`)
log(
  `reconciled: pushed=[${pushed.join(', ')}] noop=[${noop.join(', ')}] failed=[${failed.join(', ')}]`,
)
return { pushed, noop, failed, all: clean }
