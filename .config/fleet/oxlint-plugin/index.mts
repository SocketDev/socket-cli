/**
 * @file Fleet oxlint plugin. Custom rules that encode the fleet's CLAUDE.md
 *   style guide as lint errors with autofix where the rewrite is unambiguous.
 *   Why a plugin instead of a separate scanner: oxlint's native plugin surface
 *   integrates with the existing `pnpm run lint` pipeline, inherits oxlint's
 *   AST + sourcemap + fix-application machinery, and keeps the rule set
 *   discoverable via `oxlint --rules`. Wiring: `.config/oxlintrc.json` adds
 *   this plugin via `jsPlugins: ["./oxlint-plugin/index.mts"]` and enables
 *   rules under the `socket/` namespace.
 */

import exportTopLevelFunctions from './rules/export-top-level-functions.mts'
import inclusiveLanguage from './rules/inclusive-language.mts'
import maxFileLines from './rules/max-file-lines.mts'
import noBareCryptoNamedUsage from './rules/no-bare-crypto-named-usage.mts'
import noCachedForOnIterable from './rules/no-cached-for-on-iterable.mts'
import noConsolePreferLogger from './rules/no-console-prefer-logger.mts'
import noDefaultExport from './rules/no-default-export.mts'
import noDynamicImportOutsideBundle from './rules/no-dynamic-import-outside-bundle.mts'
import noEslintBiomeConfigRef from './rules/no-eslint-biome-config-ref.mts'
import noFetchPreferHttpRequest from './rules/no-fetch-prefer-http-request.mts'
import noFileScopeOxlintDisable from './rules/no-file-scope-oxlint-disable.mts'
import noInlineDeferAsync from './rules/no-inline-defer-async.mts'
import noInlineLogger from './rules/no-inline-logger.mts'
import noLoggerNewlineLiteral from './rules/no-logger-newline-literal.mts'
import noNpxDlx from './rules/no-npx-dlx.mts'
import noPlaceholders from './rules/no-placeholders.mts'
import noProcessCwdInScriptsHooks from './rules/no-process-cwd-in-scripts-hooks.mts'
import noPromiseRace from './rules/no-promise-race.mts'
import noPromiseRaceInLoop from './rules/no-promise-race-in-loop.mts'
import noSrcImportInTestExpect from './rules/no-src-import-in-test-expect.mts'
import noStatusEmoji from './rules/no-status-emoji.mts'
import noStructuredClonePreferJson from './rules/no-structured-clone-prefer-json.mts'
import noSyncRmInTestLifecycle from './rules/no-sync-rm-in-test-lifecycle.mts'
import noUnderscoreIdentifier from './rules/no-underscore-identifier.mts'
import noWhichForLocalBin from './rules/no-which-for-local-bin.mts'
import optionalExplicitUndefined from './rules/optional-explicit-undefined.mts'
import personalPathPlaceholders from './rules/personal-path-placeholders.mts'
import preferAsyncSpawn from './rules/prefer-async-spawn.mts'
import preferCachedForLoop from './rules/prefer-cached-for-loop.mts'
import preferEllipsisChar from './rules/prefer-ellipsis-char.mts'
import preferEnvAsBoolean from './rules/prefer-env-as-boolean.mts'
import preferErrorMessage from './rules/prefer-error-message.mts'
import preferExistsSync from './rules/prefer-exists-sync.mts'
import preferFunctionDeclaration from './rules/prefer-function-declaration.mts'
import preferMockImport from './rules/prefer-mock-import.mts'
import preferNodeBuiltinImports from './rules/prefer-node-builtin-imports.mts'
import preferNodeModulesDotCache from './rules/prefer-node-modules-dot-cache.mts'
import preferNonCapturingGroup from './rules/prefer-non-capturing-group.mts'
import preferPureCallForm from './rules/prefer-pure-call-form.mts'
import preferSafeDelete from './rules/prefer-safe-delete.mts'
import preferSeparateTypeImport from './rules/prefer-separate-type-import.mts'
import preferSpawnOverExecsync from './rules/prefer-spawn-over-execsync.mts'
import preferStableSelfImport from './rules/prefer-stable-self-import.mts'
import preferStaticTypeImport from './rules/prefer-static-type-import.mts'
import preferUndefinedOverNull from './rules/prefer-undefined-over-null.mts'
import socketApiTokenEnv from './rules/socket-api-token-env.mts'
import sortBooleanChains from './rules/sort-boolean-chains.mts'
import sortEqualityDisjunctions from './rules/sort-equality-disjunctions.mts'
import sortNamedImports from './rules/sort-named-imports.mts'
import sortObjectLiteralProperties from './rules/sort-object-literal-properties.mts'
import sortRegexAlternations from './rules/sort-regex-alternations.mts'
import sortSetArgs from './rules/sort-set-args.mts'
import sortSourceMethods from './rules/sort-source-methods.mts'
import useFleetCanonicalApiTokenGetter from './rules/use-fleet-canonical-api-token-getter.mts'

/**
 * @type {import('eslint').ESLint.Plugin}
 */
const plugin = {
  meta: {
    name: 'socket',
    version: '0.5.0',
  },
  rules: {
    'export-top-level-functions': exportTopLevelFunctions,
    'inclusive-language': inclusiveLanguage,
    'max-file-lines': maxFileLines,
    'no-bare-crypto-named-usage': noBareCryptoNamedUsage,
    'no-cached-for-on-iterable': noCachedForOnIterable,
    'no-console-prefer-logger': noConsolePreferLogger,
    'no-default-export': noDefaultExport,
    'no-dynamic-import-outside-bundle': noDynamicImportOutsideBundle,
    'no-eslint-biome-config-ref': noEslintBiomeConfigRef,
    'no-fetch-prefer-http-request': noFetchPreferHttpRequest,
    'no-file-scope-oxlint-disable': noFileScopeOxlintDisable,
    'no-inline-defer-async': noInlineDeferAsync,
    'no-inline-logger': noInlineLogger,
    'no-logger-newline-literal': noLoggerNewlineLiteral,
    'no-npx-dlx': noNpxDlx,
    'no-placeholders': noPlaceholders,
    'no-process-cwd-in-scripts-hooks': noProcessCwdInScriptsHooks,
    'no-promise-race': noPromiseRace,
    'no-promise-race-in-loop': noPromiseRaceInLoop,
    'no-src-import-in-test-expect': noSrcImportInTestExpect,
    'no-status-emoji': noStatusEmoji,
    'no-structured-clone-prefer-json': noStructuredClonePreferJson,
    'no-sync-rm-in-test-lifecycle': noSyncRmInTestLifecycle,
    'no-underscore-identifier': noUnderscoreIdentifier,
    'no-which-for-local-bin': noWhichForLocalBin,
    'optional-explicit-undefined': optionalExplicitUndefined,
    'personal-path-placeholders': personalPathPlaceholders,
    'prefer-async-spawn': preferAsyncSpawn,
    'prefer-cached-for-loop': preferCachedForLoop,
    'prefer-ellipsis-char': preferEllipsisChar,
    'prefer-env-as-boolean': preferEnvAsBoolean,
    'prefer-error-message': preferErrorMessage,
    'prefer-exists-sync': preferExistsSync,
    'prefer-function-declaration': preferFunctionDeclaration,
    'prefer-mock-import': preferMockImport,
    'prefer-node-builtin-imports': preferNodeBuiltinImports,
    'prefer-node-modules-dot-cache': preferNodeModulesDotCache,
    'prefer-non-capturing-group': preferNonCapturingGroup,
    'prefer-pure-call-form': preferPureCallForm,
    'prefer-safe-delete': preferSafeDelete,
    'prefer-separate-type-import': preferSeparateTypeImport,
    'prefer-spawn-over-execsync': preferSpawnOverExecsync,
    'prefer-stable-self-import': preferStableSelfImport,
    'prefer-static-type-import': preferStaticTypeImport,
    'prefer-undefined-over-null': preferUndefinedOverNull,
    'socket-api-token-env': socketApiTokenEnv,
    'sort-boolean-chains': sortBooleanChains,
    'sort-equality-disjunctions': sortEqualityDisjunctions,
    'sort-named-imports': sortNamedImports,
    'sort-object-literal-properties': sortObjectLiteralProperties,
    'sort-regex-alternations': sortRegexAlternations,
    'sort-set-args': sortSetArgs,
    'sort-source-methods': sortSourceMethods,
    'use-fleet-canonical-api-token-getter': useFleetCanonicalApiTokenGetter,
  },
}

export default plugin
