/*
 * @file Docs block of the socket-wheelhouse config: the per-repo opt-in for the
 *   fleet doc generators. `docs/api.md` (`scripts/fleet/gen/api-md.mts`) and
 *   the root `llms.txt` (`scripts/fleet/gen/llms-txt.mts`) are export-driven,
 *   so they only make sense in a repo that publishes an export surface. Opt-in
 *   is explicit rather than inferred from an existing file: several members
 *   already ship an `api.md` written by a different generator, and inferring
 *   consent from its presence would let a cascade overwrite it.
 */

import { Type } from 'typebox'

export const DocsSchema = Type.Object(
  {
    apiMd: Type.Optional(
      Type.Boolean({
        description:
          'Generate `docs/api.md` from the package.json `exports` map via `scripts/fleet/gen/api-md.mts`. Off unless set to true.',
      }),
    ),
    llmsTxt: Type.Optional(
      Type.Boolean({
        description:
          'Generate the root `llms.txt` export index from the package.json `exports` map via `scripts/fleet/gen/llms-txt.mts`. Off unless set to true.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Per-repo opt-in for the fleet doc generators. Only a repo with a published export surface sets this; an unset block means neither artifact is generated or gated.',
  },
)
