/*
 * @file Capabilities block of the socket-wheelhouse config: the top-level
 *   declaration of which languages beyond JS/TS a repo ships, and where that
 *   code lives. Declaring a capability is the switch that turns on the matching
 *   coverage lane in `pnpm run cover`, folds that lane into the README badge,
 *   and arms the check that a declared lane actually measures something. Three
 *   surfaces name the same vocabulary and must stay in lockstep: this schema,
 *   `VALID_CAPABILITIES` in scripts/repo/sync-scaffolding/repo-shape.mts, and
 *   `LANE_BY_CAPABILITY` in scripts/fleet/cover/lanes.mts.
 */

import { Type } from 'typebox'

export const CapabilitiesSchema = Type.Object(
  {
    cargo: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'This repo ships Rust; the value is the repo-relative paths of the package roots holding it (`["."]` when the Cargo workspace sits at the repo root). Declaring `cargo` activates the `rust` coverage lane in `pnpm run cover`, folds its line coverage into the README badge, and arms the coverage-lanes-are-wired check: a declared capability whose lane measures nothing fails the gate instead of passing silently, while a machine with no cargo toolchain reports an explicit skip. `cargo` also gates capability-tagged fleet hooks at cascade time — an artifact whose header declares `@socket-capability cargo` is installed only into a repo that declares this key (scripts/repo/sync-scaffolding/capabilities.mts).',
      }),
    ),
    cpp: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'This repo ships C/C++; the value is the repo-relative paths of the package roots holding it. Declaring `cpp` activates the `cpp` coverage lane in `pnpm run cover`, folds its line coverage into the README badge, and arms the coverage-lanes-are-wired check: a declared capability whose lane measures nothing fails the gate instead of passing silently, while a machine with no C/C++ toolchain reports an explicit skip.',
      }),
    ),
    go: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'This repo ships Go; the value is the repo-relative paths of the package roots holding it. Declaring `go` activates the `go` coverage lane in `pnpm run cover`, folds its line coverage into the README badge, and arms the coverage-lanes-are-wired check: a declared capability whose lane measures nothing fails the gate instead of passing silently, while a machine with no Go toolchain reports an explicit skip.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Language capabilities beyond JS/TS. Keys must stay in lockstep with VALID_CAPABILITIES in scripts/repo/sync-scaffolding/repo-shape.mts and LANE_BY_CAPABILITY in scripts/fleet/cover/lanes.mts.',
  },
)
