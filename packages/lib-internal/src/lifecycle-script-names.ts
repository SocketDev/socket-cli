/**
 * @fileoverview NPM lifecycle script names.
 *
 * Standard npm lifecycle hooks that can be defined in package.json scripts.
 * https://docs.npmjs.com/cli/v10/using-npm/scripts#life-cycle-scripts
 */

export default new Set(
  [
    'dependencies',
    'prepublishOnly',
    ...[
      'install',
      'pack',
      'prepare',
      'publish',
      'restart',
      'start',
      'stop',
      'version',
    ].map(n => [`pre${n}`, n, `post${n}`]),
  ].flat(),
)
