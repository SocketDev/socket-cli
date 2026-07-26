/*
 * @file Build/publish axes of the socket-wheelhouse config: repo shape plus the
 *   release source + artifact-kind enums shared by the primary `build` and each
 *   `secondaries[]` channel.
 *
 *   Two orthogonal axes describe a fleet repo:
 *
 *     layout  — package shape: solo vs mono.
 *     native  — native-binary supply-chain role: none / consumer /
 *               producer / both.
 *
 *   Per-language ports (e.g. ultrathink's cpp/go/rust/typescript ports of one
 *   spec) live in `lockstep.json` `lang-parity` rows, not here — the manifest is
 *   the source of truth for parity tracking.
 */

import { Type } from '@sinclair/typebox'

export const RepoSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('solo'), Type.Literal('mono')], {
      description:
        'Package layout. `solo` = one `package.json` at root, no `packages/`. `mono` = pnpm workspaces under `packages/`.',
    }),
  },
  {
    description: 'Repo shape.',
    additionalProperties: false,
  },
)

// A publish channel's release source and artifact kind. Extracted so the
// primary `build` and each `secondaries[]` channel share the EXACT same enums.
export const BuildFromSchema = Type.Union(
  [
    Type.Literal('npm-registry'),
    Type.Literal('github-release'),
    Type.Literal('crates-registry'),
    Type.Literal('go-registry'),
  ],
  {
    description:
      'Release source/target. `npm-registry` = published as an npm package. `github-release` = raw artifacts attached to a GitHub Release. `crates-registry` = published as a Rust crate to crates.io. `go-registry` = the Go module ecosystem — published by pushing a semver tag; proxy.golang.org fetches it, pkg.go.dev indexes it (no registry upload/token).',
  },
)

export const BuildTypeSchema = Type.Union(
  [
    Type.Literal('js'),
    Type.Literal('addon'),
    Type.Literal('binary'),
    Type.Literal('rust'),
    Type.Literal('go'),
  ],
  {
    description:
      'Artifact kind. `js` = plain JS package. `addon` = `.node` native addon. `binary` = a native binary (executable or wasm module — wasm is a binary format, so it lives here, not its own value). `rust` = a native Rust crate (single crate or a Cargo workspace of crates) published to crates.io — no JS build. `go` = a native Go module with no JS build (symmetric to `rust`).',
  },
)

export const BuildRuntimeSchema = Type.Union(
  [Type.Literal('node'), Type.Literal('bun'), Type.Literal('deno')],
  {
    description:
      'JS/TS execution runtime for a `type: js` repo — mirrors package.json `devEngines.runtime.name`. `node` (default, omit to get it) = the fleet standard: pnpm for deps, vitest for tests, node to run. `bun` = a Bun repo (bunfig.toml + bun.lock + `bun test`). `deno` = a Deno repo (deno.json + `deno test`). For any non-node runtime the cascade relaxes its pnpm/vitest/node expectations and keeps the repo’s own toolchain intact. Ignored for native builds (`rust`/`go`/`addon`/`binary`).',
  },
)

export const BuildSchema = Type.Object(
  {
    from: BuildFromSchema,
    type: BuildTypeSchema,
    runtime: Type.Optional(BuildRuntimeSchema),
  },
  {
    description:
      'How the repo is built + released. Drives the release-checksums file cascade + CI breadth. `from: github-release` repos are native producers (socket-btm); `from: npm-registry` + non-`js` type wrap prebuilt native bits (socket-bin/socket-addon); `type: js` is a plain package; `from: crates-registry` + `type: rust` is a native Rust crate (crates.io provides integrity, so no release-checksums cascade).',
    additionalProperties: false,
  },
)

// A secondary publish channel — same `{ from, type }` shape as the primary
// `build`, using the identical enums.
export const SecondarySchema = Type.Object(
  {
    from: BuildFromSchema,
    type: BuildTypeSchema,
  },
  {
    description:
      'An additional publish channel beyond the primary `build`, e.g. `{from:npm-registry, type:addon}` for a `.node` addon shipped alongside a Rust crate.',
    additionalProperties: false,
  },
)
