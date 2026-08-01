/*
 * @file Napi block of the socket-wheelhouse config: a native-addon member's
 *   declaration of WHICH napi `.node` targets it ships and, optionally, a
 *   per-target GitHub Actions runner override. The canonical publish workflow's
 *   per-platform build phase derives its matrix from this via
 *   `scripts/fleet/publish-infra/napi-matrix.mts`, so no member hardcodes its
 *   own `targets.mts` (the drift that silently broke stuie's publish when that
 *   file moved). Present only in a native-addon member; an unset block means
 *   the repo has no per-platform matrix build and uses the single-runner path.
 */

import { Type } from '@sinclair/typebox'

import { NAPI_TARGETS } from '../util/napi-targets.mts'

export const NapiSchema = Type.Object(
  {
    platforms: Type.Array(
      Type.Union(NAPI_TARGETS.map(target => Type.Literal(target))),
      {
        description:
          'The napi targets this repo ships a .node addon for — the fleet-canonical NAPI_TARGETS (napi-rs vocabulary: -gnu/-musl/-msvc explicit, win32 not win). Drives the canonical CI build matrix; one build job per target.',
        minItems: 1,
      },
    ),
    runners: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          'Optional per-target GitHub Actions runner overrides (napi target → runner label), for a repo needing a non-default image (e.g. darwin-x64 pinned to a specific intel-mac runner). Targets without an override use the fleet default runner.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Native napi .node addon distribution: which platform targets this repo builds + publishes, plus optional per-target runner overrides. Drives the canonical per-platform build matrix so no member hardcodes its own targets list.',
  },
)
