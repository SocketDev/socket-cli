import path from 'node:path'
import runnerImages from './runner-images.json' with { type: 'json' }

export const CANONICAL_JS_IDENTIFIER = 'javascript-typescript'
export const ALWAYS_EXPECTED_LANGUAGES = Object.freeze(['actions'])
export const EXCLUDED_PATH_SEGMENT = 'fixtures'
export const CODEQL_LANGUAGE_GLOBS = Object.freeze({
  __proto__: null,
  'c-cpp': Object.freeze([
    '*.c',
    '*.cc',
    '*.cpp',
    '*.cxx',
    '*.h',
    '*.hh',
    '*.hpp',
  ]),
  csharp: Object.freeze(['*.cs']),
  go: Object.freeze(['*.go']),
  'java-kotlin': Object.freeze(['*.java', '*.kt']),
  [CANONICAL_JS_IDENTIFIER]: Object.freeze([
    '*.cjs',
    '*.cts',
    '*.js',
    '*.jsx',
    '*.mjs',
    '*.mts',
    '*.ts',
    '*.tsx',
  ]),
  python: Object.freeze(['*.py']),
  ruby: Object.freeze(['*.rb']),
  rust: Object.freeze(['*.rs']),
  swift: Object.freeze(['*.swift']),
})

const extensions = new Map()
for (const [language, globs] of Object.entries(CODEQL_LANGUAGE_GLOBS)) {
  for (const glob of globs) {
    extensions.set(glob.slice(1), language)
  }
}

function normalizePath(file) {
  return path.posix.normalize(file.replaceAll('\\', '/'))
}

function hasPathSegment(file, segment) {
  let start = 0
  for (let i = 0, { length } = file; i <= length; i += 1) {
    if (i === length || file.charCodeAt(i) === 47 /* '/' */) {
      if (file.slice(start, i) === segment) {
        return true
      }
      start = i + 1
    }
  }
  return false
}

function sourcePaths(gitPaths) {
  const sources = []
  for (const file of gitPaths) {
    const fileName = normalizePath(file)
    if (fileName !== '.' && !hasPathSegment(fileName, EXCLUDED_PATH_SEGMENT)) {
      sources.push(fileName)
    }
  }
  return sources
}

export function presentCodeqlLanguages(gitPaths) {
  const languages = new Set(ALWAYS_EXPECTED_LANGUAGES)
  for (const file of sourcePaths(gitPaths)) {
    const extension = path.posix.extname(file).toLowerCase()
    const language = extensions.get(extension)
    if (language) {
      languages.add(language)
    }
  }
  return [...languages].toSorted()
}

export function planCodeqlMatrix(gitPaths) {
  const kotlin = sourcePaths(gitPaths).some(file =>
    file.toLowerCase().endsWith('.kt'),
  )
  return {
    __proto__: null,
    include: presentCodeqlLanguages(gitPaths).map(language => ({
      __proto__: null,
      language,
      'build-mode':
        language === 'go' ||
        language === 'swift' ||
        (language === 'java-kotlin' && kotlin)
          ? 'autobuild'
          : 'none',
      runner:
        runnerImages.roles[language === 'swift' ? 'macos-arm64' : 'linux-x64']
          .label,
    })),
  }
}
