/*
 * @file Docker block of the socket-wheelhouse config: per-repo Docker
 *   infrastructure declared as data. `prebakes` is the layered base-image
 *   manifest (bases named by toolchain), driving the prebake build + the
 *   downstream `FROM` references.
 */

import { Type } from '@sinclair/typebox'

export const PrebakePinsGoSchema = Type.Object(
  {
    version: Type.String(),
    sha256: Type.Object(
      {
        amd64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
        arm64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    description: 'Go toolchain version + per-arch sha256.',
  },
)

export const PrebakePinsRustupSchema = Type.Object(
  {
    version: Type.String(),
    sha256: Type.Object(
      {
        amd64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
        arm64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    description:
      'rustup-init version + per-arch sha256 (mirrors the .sha256 rustup publishes beside each binary).',
  },
)

export const PrebakePinsSchema = Type.Object(
  {
    description: Type.Optional(Type.String()),
    ubuntuDigest: Type.Optional(
      Type.String({
        pattern: '^sha256:[0-9a-f]{64}$',
        description: 'Digest the ubuntu roots FROM, pinning the OS layer.',
      }),
    ),
    ubuntuTag: Type.Optional(
      Type.String({
        description: 'Human-readable ubuntu tag the digest corresponds to.',
      }),
    ),
    aptSnapshot: Type.Optional(
      Type.String({
        pattern: '^[0-9]{8}T[0-9]{6}Z$',
        description:
          'Snapshot timestamp (YYYYMMDDTHHMMSSZ) apt is pinned to, freezing transitive deps.',
      }),
    ),
    go: Type.Optional(PrebakePinsGoSchema),
    rustup: Type.Optional(PrebakePinsRustupSchema),
    emsdkVersion: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
    description: 'Maximally-pinned build inputs injected as build-args.',
  },
)

export const PrebakeEntrySchema = Type.Object(
  {
    name: Type.String({
      pattern: '^[a-z0-9][a-z0-9._/-]*$',
      description: 'Image name. Toolchain-named, not output-named.',
    }),
    status: Type.Union([Type.Literal('active'), Type.Literal('planned')], {
      description:
        '`active` = built + pushed today; `planned` = designed only.',
    }),
    from: Type.String({
      description:
        'Parent image: another prebake `name`, or an external `<image>:<tag>`.',
    }),
    vendorSource: Type.Optional(
      Type.String({
        description:
          'Upstream recipe this layer is built from when vendored rather than pulled.',
      }),
    ),
    dockerfile: Type.Optional(
      Type.String({
        // Wheelhouse fleet recipes (docker/fleet/), member repo-owned recipes
        // (docker/repo/), or a monorepo package's recipe (packages/*/docker/).
        pattern:
          '^(?:packages/[a-z0-9-]+/docker|docker/(?:fleet|repo))/[a-z0-9-]+\\.Dockerfile$',
        description: 'Repo-relative path to the Dockerfile that builds it.',
      }),
    ),
    installs: Type.Array(Type.String(), {
      description: 'Toolchains/packages this layer adds on top of `from`.',
    }),
    libc: Type.Optional(
      Type.Array(Type.Union([Type.Literal('glibc'), Type.Literal('musl')]), {
        description: 'libc variants built.',
      }),
    ),
    platforms: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Target platforms (Docker `os/arch`).',
      }),
    ),
    tagFrom: Type.Optional(
      Type.String({
        description: 'Source of the content hash deciding when to rebuild.',
      }),
    ),
    warmTargets: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Intermediate Dockerfile stages baked cache-only (--target, no tag/push) BEFORE the full build, so a final-stage failure cannot cancel and lose their in-flight layers.',
      }),
    ),
    project: Type.Optional(
      Type.String({ description: 'Build-cache project id, if any.' }),
    ),
    consumers: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Repos / builders that FROM this base.',
      }),
    ),
    purpose: Type.String({
      minLength: 1,
      description: 'Why this layer exists and what lands on it.',
    }),
  },
  {
    additionalProperties: false,
    description: 'One prebaked base image.',
  },
)

export const PrebakesSchema = Type.Object(
  {
    description: Type.Optional(Type.String()),
    registry: Type.String({
      description: 'Registry images are pushed to / pulled from.',
    }),
    registryDescription: Type.Optional(
      Type.String({
        description:
          'What the registry namespace is for, including the long-form browse URL when the registry value is a short form.',
      }),
    ),
    pins: Type.Optional(PrebakePinsSchema),
    prebakes: Type.Array(PrebakeEntrySchema, {
      description: 'Each prebaked base image, ordered bottom-up.',
    }),
  },
  {
    additionalProperties: false,
    description: 'Layered prebaked base-image manifest.',
  },
)

export const DockerSchema = Type.Object(
  {
    prebakes: Type.Optional(PrebakesSchema),
  },
  {
    additionalProperties: false,
    description:
      'Per-repo Docker infrastructure (opt-in; only repos maintaining base images set this).',
  },
)
