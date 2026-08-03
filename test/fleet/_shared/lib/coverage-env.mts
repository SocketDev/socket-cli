/**
 * @file Prepare a Vitest worker's environment for subprocess coverage. The
 *   parent Vitest process reads `COVERAGE` while loading its config, before
 *   worker setup runs. Workers may therefore delete that flag without
 *   disabling the active provider, preventing test-spawned Vitest children
 *   from enabling coverage and clearing the parent's shared `.tmp` reports.
 *   `NODE_V8_COVERAGE` remains inherited by ordinary Node children so their
 *   subprocess-only execution can be merged by the fleet coverage runner.
 */

export function prepareSubprocessCoverageEnv(env: NodeJS.ProcessEnv): void {
  const rawDir = env['FLEET_CHILD_V8_COVERAGE_DIR']
  if (!rawDir) {
    return
  }
  env['NODE_V8_COVERAGE'] ??= rawDir
  delete env['COVERAGE']
}
