import process from 'node:process'

// Hard-fail if Node is below 24. This runs at module load — every hook
// invocation imports this module before doing anything.
const NODE_MIN_MAJOR = 24
const nodeMajor = Number.parseInt(
  process.versions.node.split('.')[0] || '0',
  10,
)
if (nodeMajor < NODE_MIN_MAJOR) {
  // This import-light shared helper does not own a logger. Use raw
  // process.stderr with ASCII (no status-emoji glyph) so the no-status-emoji
  // lint rule stays clean — the recommendation to use logger.fail() does not
  // apply when the entire branch is the logger-unavailable bail.
  // oxlint-disable-next-line socket/no-module-eval-side-effects -- floor bail
  process.stderr.write(
    `\x1b[0;31mHook requires Node >= ${NODE_MIN_MAJOR}.0.0 (have v${process.versions.node})\x1b[0m\n`,
  )
  // oxlint-disable-next-line socket/no-module-eval-side-effects -- floor bail
  process.stderr.write(
    'Install Node 24+ — these hooks rely on default-on .mts type stripping.\n',
  )
  process.exit(1)
}
