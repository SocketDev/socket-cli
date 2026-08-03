/*
 * @file The two-tier private-repository matcher for `no-private-repo-leak-guard`.
 *
 *   The QUALIFIED tier matches an `owner/repo` reference — bare, as
 *   `owner/repo#123`, as `owner/repo@sha`, or inside a
 *   `https://github.com/owner/repo/...` URL — and always blocks when that pair
 *   is private. Such a reference is unambiguous: nobody writes
 *   `acme/ledger-internal` by accident, and the pair names the private
 *   repository whether or not the word itself is distinctive.
 *
 *   The BARE tier matches a private repository's name written on its own. It
 *   fires on a word boundary, and only for a name that is DISCRIMINATIVE (see
 *   {@link isDiscriminativeRepoName}). A repository named `docs` or `action`
 *   would otherwise block every sentence containing that word, and a guard that
 *   fires on ordinary English gets bypassed reflexively until it enforces
 *   nothing.
 *
 *   The two are layered, not redundant. The qualified match is exhaustive and
 *   skips no name, so a repository whose name the bare match declines is still
 *   caught the moment it is written the way people actually cite repositories.
 */

import type { RepoRoster } from './roster.mts'

/**
 * Shortest bare name eligible for the bare-name match. A name of three
 * characters or fewer (`ui`, `api`, `cli`, `sdk`) collides with ordinary
 * technical prose far more often than it names the repository.
 */
export const MIN_BARE_NAME_LENGTH = 4

/**
 * Single-token repository names that read as ordinary words. A name is skipped
 * by the bare-name match when it is BOTH undifferentiated (one lowercase token,
 * no hyphen / underscore / dot / digit to mark it as a slug) AND listed here.
 *
 * Two groups, both chosen on one test — "would a sentence in a PR body
 * plausibly contain this word without referring to the repository?":
 *
 * - Everyday English at or above four letters (`about`, `first`, `where`), which
 *   a repository name may coincide with but prose uses constantly.
 * - Generic software nouns (`build`, `config`, `parser`, `runner`), the
 *   vocabulary of every engineering discussion.
 *
 * Deliberately EXCLUDED: coined or evocative single words — `wheelhouse`,
 * `phoenix`, `lighthouse`, a product codename. Those are precisely the names
 * whose appearance in public prose IS the disclosure, and prose almost never
 * reaches for them incidentally.
 */
export const COMMON_WORD_COLLISIONS: ReadonlySet<string> = new Set([
  'about',
  'above',
  'action',
  'actions',
  'admin',
  'after',
  'again',
  'agent',
  'agents',
  'alert',
  'alerts',
  'another',
  'apps',
  'assets',
  'audit',
  'auth',
  'back',
  'base',
  'basics',
  'batch',
  'because',
  'before',
  'below',
  'beta',
  'between',
  'blog',
  'board',
  'book',
  'both',
  'branch',
  'bridge',
  'browser',
  'budget',
  'build',
  'builder',
  'cache',
  'catalog',
  'chart',
  'charts',
  'chat',
  'check',
  'checks',
  'client',
  'cloud',
  'code',
  'command',
  'common',
  'compare',
  'compose',
  'config',
  'connect',
  'console',
  'content',
  'context',
  'control',
  'core',
  'could',
  'daemon',
  'dashboard',
  'data',
  'database',
  'default',
  'demo',
  'deploy',
  'design',
  'desktop',
  'diff',
  'docs',
  'down',
  'draft',
  'during',
  'each',
  'edge',
  'editor',
  'engine',
  'error',
  'errors',
  'event',
  'events',
  'example',
  'examples',
  'export',
  'extension',
  'feed',
  'field',
  'file',
  'files',
  'filter',
  'first',
  'form',
  'forms',
  'from',
  'gateway',
  'graph',
  'group',
  'guide',
  'guides',
  'have',
  'help',
  'here',
  'home',
  'hook',
  'hooks',
  'host',
  'image',
  'images',
  'import',
  'index',
  'infra',
  'input',
  'inside',
  'install',
  'interface',
  'internal',
  'into',
  'issue',
  'issues',
  'items',
  'jobs',
  'json',
  'just',
  'keys',
  'label',
  'labs',
  'later',
  'layout',
  'legacy',
  'library',
  'like',
  'line',
  'link',
  'list',
  'load',
  'loader',
  'local',
  'logger',
  'login',
  'logs',
  'lookup',
  'made',
  'mail',
  'main',
  'make',
  'manager',
  'many',
  'market',
  'media',
  'menu',
  'merge',
  'message',
  'meta',
  'metrics',
  'mobile',
  'mock',
  'model',
  'models',
  'module',
  'monitor',
  'more',
  'most',
  'move',
  'name',
  'need',
  'network',
  'next',
  'node',
  'note',
  'notes',
  'notify',
  'object',
  'once',
  'only',
  'open',
  'other',
  'output',
  'over',
  'package',
  'page',
  'pages',
  'panel',
  'parser',
  'part',
  'patch',
  'payload',
  'payments',
  'pipeline',
  'platform',
  'player',
  'plugin',
  'plugins',
  'policy',
  'portal',
  'post',
  'preview',
  'private',
  'product',
  'profile',
  'project',
  'projects',
  'proxy',
  'public',
  'query',
  'queue',
  'quick',
  'react',
  'reader',
  'record',
  'registry',
  'release',
  'render',
  'report',
  'reports',
  'request',
  'research',
  'result',
  'review',
  'roadmap',
  'route',
  'router',
  'rules',
  'runner',
  'sample',
  'sandbox',
  'schema',
  'scripts',
  'search',
  'secret',
  'server',
  'service',
  'services',
  'session',
  'setup',
  'shared',
  'shell',
  'shop',
  'should',
  'signal',
  'site',
  'some',
  'source',
  'spec',
  'stack',
  'staging',
  'stats',
  'status',
  'storage',
  'store',
  'stream',
  'style',
  'styles',
  'support',
  'sync',
  'system',
  'table',
  'takes',
  'team',
  'template',
  'templates',
  'test',
  'tests',
  'that',
  'them',
  'theme',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'time',
  'token',
  'tools',
  'topic',
  'trace',
  'tracker',
  'under',
  'update',
  'upload',
  'used',
  'user',
  'users',
  'utils',
  'value',
  'vault',
  'vendor',
  'version',
  'very',
  'view',
  'wallet',
  'want',
  'watch',
  'website',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'worker',
  'workers',
  'would',
  'your',
])

// require-regex-comment: a run of path-ish characters. `owner/repo` pairs are
// read out of these runs rather than matched directly, so
// `github.com/owner/repo` still yields the `owner/repo` pair (a single regex
// consumes `github.com/owner` and misses it). `#`, `@`, and whitespace end a
// run, so `owner/repo#12` parses cleanly.
const PATH_RUN_RE = /[A-Za-z0-9][A-Za-z0-9._/-]*/g

// require-regex-comment: a repository name is a slug rather than a plain word
// when it carries a separator or a digit — `acme-ledger`, `ledger2`,
// `ledger.core` are unmistakable; `ledger` is not.
const SLUG_SHAPE_RE = /[\d._-]/

// require-regex-comment: regex metacharacters that can appear in a GitHub
// repository name, escaped before the name is embedded in a boundary pattern.
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g

/**
 * A qualified reference found in prose.
 */
export interface QualifiedRef {
  readonly owner: string
  readonly repo: string
}

/**
 * One reason the prose is refused.
 */
export interface LeakFinding {
  readonly reference: string
  readonly source: string
  readonly tier: 'bare' | 'qualified'
}

/**
 * Every `owner/repo` pair the text contains, including pairs embedded in a URL
 * path. Case is preserved; callers lowercase before comparing.
 */
export function qualifiedRepoRefs(text: string): QualifiedRef[] {
  const refs: QualifiedRef[] = []
  const runs = text.match(PATH_RUN_RE) ?? []
  for (let i = 0, { length } = runs; i < length; i += 1) {
    const segments = runs[i]!.split('/')
    for (let j = 0, segCount = segments.length - 1; j < segCount; j += 1) {
      const owner = segments[j]!
      const repo = segments[j + 1]!
      if (owner && repo) {
        refs.push({ owner, repo })
      }
    }
  }
  return refs
}

/**
 * True when a bare occurrence of `name` is a meaningful signal rather than an
 * ordinary word. See {@link COMMON_WORD_COLLISIONS} for why both filters exist.
 */
export function isDiscriminativeRepoName(name: string): boolean {
  if (name.length < MIN_BARE_NAME_LENGTH) {
    return false
  }
  if (SLUG_SHAPE_RE.test(name)) {
    return true
  }
  return !COMMON_WORD_COLLISIONS.has(name.toLowerCase())
}

/**
 * True when `name` appears in `text` as a standalone token. The boundary is
 * hyphen- and underscore-aware, so `acme-ledger` does not match inside
 * `acme-ledger-docs` — a different repository.
 */
export function containsBareRepoName(text: string, name: string): boolean {
  const escaped = name.replace(REGEX_META_RE, '\\$&')
  // require-regex-comment: `(?<![\w-])` / `(?![\w-])` are word-plus-hyphen
  // boundaries around the escaped repository name, matched case-insensitively
  // because GitHub resolves repository names without regard to case.
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)
}

/**
 * Scan one prose string against the rosters of every owner whose private
 * repositories must not be disclosed. Findings are deduplicated by repository,
 * and a qualified hit suppresses the bare hit for the same repository so the
 * block message names each leak once.
 */
export function scanProseForPrivateRepos(
  text: string,
  sourceLabel: string,
  rosters: readonly RepoRoster[],
): LeakFinding[] {
  const findings: LeakFinding[] = []
  const seen = new Set<string>()
  const byOwner = new Map<string, RepoRoster>()
  for (let i = 0, { length } = rosters; i < length; i += 1) {
    byOwner.set(rosters[i]!.owner, rosters[i]!)
  }
  const refs = qualifiedRepoRefs(text)
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const { owner, repo } = refs[i]!
    const roster = byOwner.get(owner.toLowerCase())
    const key = repo.toLowerCase()
    if (!roster?.privateNames.has(key) || seen.has(key)) {
      continue
    }
    seen.add(key)
    findings.push({
      reference: `${owner}/${repo}`,
      source: sourceLabel,
      tier: 'qualified',
    })
  }
  for (let i = 0, { length } = rosters; i < length; i += 1) {
    const roster = rosters[i]!
    for (const name of roster.privateNames) {
      if (seen.has(name) || !isDiscriminativeRepoName(name)) {
        continue
      }
      if (!containsBareRepoName(text, name)) {
        continue
      }
      seen.add(name)
      findings.push({ reference: name, source: sourceLabel, tier: 'bare' })
    }
  }
  return findings
}
