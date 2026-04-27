// Canonical path-segment vocabulary shared by the path-guard hook
// (.claude/hooks/path-guard/index.mts) and gate (scripts/check-paths.mts).
//
// Mantra: 1 path, 1 reference. This module is the *one* place stage,
// build-root, mode, and sibling-package vocabulary is defined. Both
// consumers import from here so they can never drift apart.
//
// Synced byte-identically across the Socket fleet via
// socket-repo-template/scripts/sync-scaffolding.mjs (IDENTICAL_FILES).
// When adding a new stage/build-root/mode/sibling, edit this file in
// the template and re-sync.

// "Stage" segments — Rule A core. Two of these spread via `path.join`
// or interpolated into a template literal is a finding outside a
// canonical `paths.mts`. Sourced from build-infra/lib/constants.mts
// `BUILD_STAGES` plus their lowercase directory-name siblings used by
// some builders.
export const STAGE_SEGMENTS = new Set([
  'Compressed',
  'downloaded',
  'Final',
  'Optimized',
  'Release',
  'Stripped',
  'Synced',
  'wasm',
])

// "Build-root" segments — at least one must be present together with
// a stage segment to confirm we're constructing a build output path
// rather than something coincidental. Example: a join that yields
// `<root>/<stage>/<lib>` doesn't fire if no build-root segment is
// present; `<root>/build/<stage>/out/<stage>` does.
export const BUILD_ROOT_SEGMENTS = new Set(['build', 'out'])

// Build-mode segments — a stage segment plus one of these is also a
// finding (`build/<mode>/<arch>/out/<stage>` is the canonical shape).
export const MODE_SEGMENTS = new Set(['dev', 'prod', 'shared'])

// Sibling fleet packages (Rule B). Union of all packages across the
// Socket fleet — the gate is byte-identical via sync-scaffolding, so
// listing every fleet package keeps Rule B firing in any repo. When a
// new package joins the workspace, add it here and propagate via
// `node scripts/sync-scaffolding.mjs --all --fix` from
// socket-repo-template.
export const KNOWN_SIBLING_PACKAGES = new Set([
  // socket-btm
  'bin-infra',
  'binflate',
  'binject',
  'binpress',
  'build-infra',
  'codet5-models-builder',
  'curl-builder',
  'ink-builder',
  'iocraft-builder',
  'libpq-builder',
  'lief-builder',
  'minilm-builder',
  'models',
  'napi-go',
  'node-smol-builder',
  'onnxruntime-builder',
  'opentui-builder',
  'stubs-builder',
  'ultraviolet-builder',
  'yoga-layout-builder',
  // socket-cli
  'cli',
  'package-builder',
  // socket-tui
  'core',
  'react',
  'renderer',
  'ultraviolet',
  'yoga',
  // socket-registry / ultrathink
  'acorn',
  'npm',
])
