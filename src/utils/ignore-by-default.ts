const ignoredDirs = [
  // Taken from ignore-by-default:
  // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
  '.git', // Git repository files, see <https://git-scm.com/>
  '.log', // Log files emitted by tools such as `tsserver`, see <https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29>
  '.nyc_output', // Temporary directory where nyc stores coverage data, see <https://github.com/bcoe/nyc>
  '.sass-cache', // Cache folder for node-sass, see <https://github.com/sass/node-sass>
  '.yarn', // Where node modules are installed when using Yarn, see <https://yarnpkg.com/>
  'bower_components', // Where Bower packages are installed, see <http://bower.io/>
  'coverage', // Standard output directory for code coverage reports, see <https://github.com/gotwarlost/istanbul>
  'node_modules', // Where Node modules are installed, see <https://nodejs.org/>
  // Taken from globby:
  // https://github.com/sindresorhus/globby/blob/v14.0.2/ignore.js#L11-L16
  'flow-typed'
] as const

const ignoredDirPatterns = ignoredDirs.map(i => `**/${i}`)

export function directories() {
  return [...ignoredDirs]
}

export function directoryPatterns() {
  return [...ignoredDirPatterns]
}
