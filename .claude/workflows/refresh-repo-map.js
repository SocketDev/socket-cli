export const meta = {
  description:
    'Seed/refresh the gitignored repo-map skeleton cache (.repo-map/) for the whole repo, then report coverage + the biggest context-cost savings so agents read skeletons instead of whole files.',
  name: 'refresh-repo-map',
  phases: [
    {
      title: 'Build',
      detail:
        'run make-repo-map --write . to (re)build the full skeleton cache',
    },
    {
      title: 'Report',
      detail: 'read .repo-map/index.txt; roll up coverage + top savings',
    },
  ],
  whenToUse:
    'Seed the repo-map cache on a fresh clone, or force a full rebuild after large refactors. The SessionStart repo-map-refresh hook keeps it warm incrementally between runs, so this full pass is occasional, not per-session. args: { root?: string (subtree to map; default ".") }.',
}

// Normalize args: object, JSON string, or a bare path string (the root).
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    input = { root: input }
  }
}
const root =
  input && typeof input === 'object' && typeof input.root === 'string'
    ? input.root
    : '.'

// Structured output so the build result is machine-checkable, not scraped prose.
const BUILD_SCHEMA = {
  additionalProperties: false,
  properties: {
    filesWritten: { type: 'number' },
    outcome: { enum: ['built', 'failed'], type: 'string' },
    savedPercent: { type: 'number' },
    summaryLine: { type: 'string' },
  },
  required: ['outcome'],
  type: 'object',
}

const REPORT_SCHEMA = {
  additionalProperties: false,
  properties: {
    filesCovered: { type: 'number' },
    savedPercent: { type: 'number' },
    topFiles: { items: { type: 'string' }, type: 'array' },
  },
  required: ['filesCovered'],
  type: 'object',
}

phase('Build')
const build = await agent(
  [
    'Rebuild the repo-map skeleton cache for this repository.',
    '',
    `Run exactly: node scripts/fleet/make-repo-map.mts --write ${root}`,
    '',
    'That walks the source tree, writes one .repo-map/<relpath>.skel per source',
    'file, and refreshes .repo-map/index.txt. It is deterministic, gitignored,',
    'and read-only apart from the .repo-map/ cache — safe to run anytime.',
    '',
    'Report the outcome ("built" on exit 0, else "failed"), and from the tool\'s',
    'stderr summary line the number of skeletons written (filesWritten) and the',
    'saved percentage (savedPercent). Put the raw stderr summary in summaryLine.',
    'Do NOT commit anything — the cache is gitignored generated output.',
  ].join('\n'),
  { label: 'build', phase: 'Build', schema: BUILD_SCHEMA },
)

if (!build || build.outcome !== 'built') {
  log(
    `refresh-repo-map: build phase did not complete cleanly (${JSON.stringify(build)}).`,
  )
  return { build }
}

phase('Report')
const report = await agent(
  [
    'Read .repo-map/index.txt (the repo-map cache roll-up just rebuilt).',
    '',
    'Each body line is `<relpath> (<N> lines, <M> symbols)`. Report:',
    '  - filesCovered: how many files the index lists,',
    '  - savedPercent: the saved % from the index header comment,',
    '  - topFiles: the 5 files with the most lines (biggest whole-file reads a',
    '    skeleton now spares from context — these are where the cache pays most).',
    '',
    'Read only the index file; do not read the individual .skel files.',
  ].join('\n'),
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA },
)

log(
  `refresh-repo-map complete. files=${report?.filesCovered ?? build.filesWritten} saved=${report?.savedPercent ?? build.savedPercent}% — read .repo-map/index.txt to orient, then Read only the span you need.`,
)
return { build, report }
