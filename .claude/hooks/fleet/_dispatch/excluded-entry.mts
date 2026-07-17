/*
 * @file Entry for the snapshot-EXCLUDED hooks bundle (`excluded-bundle.cjs`).
 *   Hooks tagged `@dispatch-snapshot-exclude` carry module-eval graphs V8's
 *   `--build-snapshot` refuses to serialize (native [Foreign] handles — an
 *   SDK client binding node:http's HTTPParser, module-eval semver, …), so
 *   they can't be frozen into the startup snapshot. This sibling bundle
 *   packages exactly that set; `dispatch-snapshot-entry.mts`'s
 *   deserialize-main requires it LAZILY at runtime (guided by the frozen
 *   EXCLUDED_HOOK_HINTS) and splices the entries into the dispatch. The
 *   normal `index.cjs` path never loads this file — its `bundle.cjs`
 *   carries the FULL table.
 */

export { DISPATCH_TABLE as EXCLUDED_TABLE } from './dispatch-table-excluded.mts'
