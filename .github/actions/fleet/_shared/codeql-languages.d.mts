export declare const CANONICAL_JS_IDENTIFIER: string
export declare const ALWAYS_EXPECTED_LANGUAGES: readonly string[]
export declare const EXCLUDED_PATH_SEGMENT: string
export declare const CODEQL_LANGUAGE_GLOBS: Readonly<Record<string, readonly string[]>>

export interface CodeqlMatrixEntry {
  language: string
  'build-mode': 'autobuild' | 'none'
  runner: 'macos-latest' | 'ubuntu-latest'
}

export declare function presentCodeqlLanguages(gitPaths: readonly string[]): string[]
export declare function planCodeqlMatrix(gitPaths: readonly string[]): { include: CodeqlMatrixEntry[] }
