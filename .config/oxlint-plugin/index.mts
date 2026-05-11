/**
 * @fileoverview Fleet oxlint plugin. Custom rules that encode the
 * fleet's CLAUDE.md style guide as lint errors with autofix where
 * the rewrite is unambiguous.
 *
 * Why a plugin instead of a separate scanner: oxlint's native plugin
 * surface integrates with the existing `pnpm run lint` pipeline,
 * inherits oxlint's AST + sourcemap + fix-application machinery, and
 * keeps the rule set discoverable via `oxlint --rules`.
 *
 * Wiring: `.config/oxlintrc.json` adds this plugin via `jsPlugins:
 * ["./oxlint-plugin/index.mts"]` and enables rules under the
 * `socket/` namespace.
 */

import exportTopLevelFunctions from './rules/export-top-level-functions.mts'
import inclusiveLanguage from './rules/inclusive-language.mts'
import maxFileLines from './rules/max-file-lines.mts'
import noConsolePreferLogger from './rules/no-console-prefer-logger.mts'
import noDefaultExport from './rules/no-default-export.mts'
import noDynamicImportOutsideBundle from './rules/no-dynamic-import-outside-bundle.mts'
import noFetchPreferHttpRequest from './rules/no-fetch-prefer-http-request.mts'
import noInlineLogger from './rules/no-inline-logger.mts'
import noNpxDlx from './rules/no-npx-dlx.mts'
import noPlaceholders from './rules/no-placeholders.mts'
import noPromiseRace from './rules/no-promise-race.mts'
import noPromiseRaceInLoop from './rules/no-promise-race-in-loop.mts'
import noStatusEmoji from './rules/no-status-emoji.mts'
import personalPathPlaceholders from './rules/personal-path-placeholders.mts'
import preferAsyncSpawn from './rules/prefer-async-spawn.mts'
import preferCachedForLoop from './rules/prefer-cached-for-loop.mts'
import preferExistsSync from './rules/prefer-exists-sync.mts'
import preferFunctionDeclaration from './rules/prefer-function-declaration.mts'
import preferNodeBuiltinImports from './rules/prefer-node-builtin-imports.mts'
import preferSafeDelete from './rules/prefer-safe-delete.mts'
import preferSeparateTypeImport from './rules/prefer-separate-type-import.mts'
import preferUndefinedOverNull from './rules/prefer-undefined-over-null.mts'
import socketApiTokenEnv from './rules/socket-api-token-env.mts'
import sortEqualityDisjunctions from './rules/sort-equality-disjunctions.mts'
import sortNamedImports from './rules/sort-named-imports.mts'
import sortRegexAlternations from './rules/sort-regex-alternations.mts'
import sortSetArgs from './rules/sort-set-args.mts'
import sortSourceMethods from './rules/sort-source-methods.mts'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'socket',
    version: '0.5.0',
  },
  rules: {
    'export-top-level-functions': exportTopLevelFunctions,
    'inclusive-language': inclusiveLanguage,
    'max-file-lines': maxFileLines,
    'no-console-prefer-logger': noConsolePreferLogger,
    'no-default-export': noDefaultExport,
    'no-dynamic-import-outside-bundle': noDynamicImportOutsideBundle,
    'no-fetch-prefer-http-request': noFetchPreferHttpRequest,
    'no-inline-logger': noInlineLogger,
    'no-npx-dlx': noNpxDlx,
    'no-placeholders': noPlaceholders,
    'no-promise-race': noPromiseRace,
    'no-promise-race-in-loop': noPromiseRaceInLoop,
    'no-status-emoji': noStatusEmoji,
    'personal-path-placeholders': personalPathPlaceholders,
    'prefer-async-spawn': preferAsyncSpawn,
    'prefer-cached-for-loop': preferCachedForLoop,
    'prefer-exists-sync': preferExistsSync,
    'prefer-function-declaration': preferFunctionDeclaration,
    'prefer-node-builtin-imports': preferNodeBuiltinImports,
    'prefer-safe-delete': preferSafeDelete,
    'prefer-separate-type-import': preferSeparateTypeImport,
    'prefer-undefined-over-null': preferUndefinedOverNull,
    'socket-api-token-env': socketApiTokenEnv,
    'sort-equality-disjunctions': sortEqualityDisjunctions,
    'sort-named-imports': sortNamedImports,
    'sort-regex-alternations': sortRegexAlternations,
    'sort-set-args': sortSetArgs,
    'sort-source-methods': sortSourceMethods,
  },
}

export default plugin
