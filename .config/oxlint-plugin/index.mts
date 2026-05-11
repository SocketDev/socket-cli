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

import exportTopLevelFunctions from './rules/export-top-level-functions.mts'
import noConsolePreferLogger from './rules/no-console-prefer-logger.mts'
import noDynamicImportOutsideBundle from './rules/no-dynamic-import-outside-bundle.mts'
import noFetchPreferHttpRequest from './rules/no-fetch-prefer-http-request.mts'
import noInlineLogger from './rules/no-inline-logger.mts'
import noPromiseRaceInLoop from './rules/no-promise-race-in-loop.mts'
import noStatusEmoji from './rules/no-status-emoji.mts'
import noTodoComments from './rules/no-todo-comments.mts'
import preferExistsSync from './rules/prefer-exists-sync.mts'
import preferSafeDelete from './rules/prefer-safe-delete.mts'
import preferUndefinedOverNull from './rules/prefer-undefined-over-null.mts'
import sortSetArgs from './rules/sort-set-args.mts'
import sortSourceMethods from './rules/sort-source-methods.mts'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: 'socket',
    version: '0.3.0',
  },
  rules: {
    'export-top-level-functions': exportTopLevelFunctions,
    'no-console-prefer-logger': noConsolePreferLogger,
    'no-dynamic-import-outside-bundle': noDynamicImportOutsideBundle,
    'no-fetch-prefer-http-request': noFetchPreferHttpRequest,
    'no-inline-logger': noInlineLogger,
    'no-promise-race-in-loop': noPromiseRaceInLoop,
    'no-status-emoji': noStatusEmoji,
    'no-todo-comments': noTodoComments,
    'prefer-exists-sync': preferExistsSync,
    'prefer-safe-delete': preferSafeDelete,
    'prefer-undefined-over-null': preferUndefinedOverNull,
    'sort-set-args': sortSetArgs,
    'sort-source-methods': sortSourceMethods,
  },
}

export default plugin
