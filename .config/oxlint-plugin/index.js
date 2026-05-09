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
 * Wiring: `.oxlintrc.json` adds this plugin via `jsPlugins:
 * ["./.config/oxlint-plugin/index.js"]` and enables rules under the
 * `socket/` namespace.
 */

import exportTopLevelFunctions from './rules/export-top-level-functions.js'
import noConsolePreferLogger from './rules/no-console-prefer-logger.js'
import noDynamicImportOutsideBundle from './rules/no-dynamic-import-outside-bundle.js'
import noFetchPreferHttpRequest from './rules/no-fetch-prefer-http-request.js'
import noInlineLogger from './rules/no-inline-logger.js'
import noStatusEmoji from './rules/no-status-emoji.js'
import preferUndefinedOverNull from './rules/prefer-undefined-over-null.js'
import sortSetArgs from './rules/sort-set-args.js'
import sortSourceMethods from './rules/sort-source-methods.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'socket',
    version: '0.2.0',
  },
  rules: {
    'export-top-level-functions': exportTopLevelFunctions,
    'no-console-prefer-logger': noConsolePreferLogger,
    'no-dynamic-import-outside-bundle': noDynamicImportOutsideBundle,
    'no-fetch-prefer-http-request': noFetchPreferHttpRequest,
    'no-inline-logger': noInlineLogger,
    'no-status-emoji': noStatusEmoji,
    'prefer-undefined-over-null': preferUndefinedOverNull,
    'sort-set-args': sortSetArgs,
    'sort-source-methods': sortSourceMethods,
  },
}

export default plugin
