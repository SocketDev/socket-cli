# Trusted-publishing posture

Every fleet member uploads npm bytes through **one** function, and that upload
either authenticates with an OIDC trusted-publisher token or says out loud that
it did not. There is no third state.

## The incident

Five members shipped a byte-identical `.github/workflows/npm-publish.yml` and a
byte-identical `scripts/fleet/npm-publish.mts`. They published under two
different credentials.

pnpm's OIDC token exchange with npm returns 404 in every member:

```text
[WARN] Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE … 404
```

pnpm does not stop there. It falls through to whatever other credential the
environment carries. `actions/setup-node` — which the fleet `setup` action runs
with `registry-url: https://registry.npmjs.org` — writes
`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into the runner's
`.npmrc`. So:

- A member whose `npm-publish` GitHub environment supplies `NODE_AUTH_TOKEN`
  published **successfully**, under a long-lived token, with every log line
  still saying trusted publishing.
- A member with no such secret died on `[E401] Unable to authenticate`.

Same intended mechanism, one green run and one red run, and the difference lived
in a GitHub environment secret that no file in the repo can show you. It stayed
invisible until a release failed.

## The policy

Three lines, and they are enforced on the publish SHAPE, never on an
environment variable:

- **From CI: trusted publishing only.** A publish carrying `NODE_AUTH_TOKEN` /
  `NPM_AUTH_TOKEN` / `NPM_TOKEN` is refused — no exceptions, regardless of
  version or mode. No npm token ever reaches CI.
- **Locally: a `direct` publish is permitted only at exactly `0.0.0`,** the name
  reservation. Any other direct publish is refused, anywhere.
- **Staged real releases are OIDC everywhere.**

## The rule

- **The upload invocation exists once.** `uploadNpmPackage` in
  `scripts/fleet/publish-infra/npm/publish-command.mts` builds the
  `pnpm stage publish` / `pnpm publish` argv, decides `--provenance`, and
  asserts the auth posture. Nothing outside `scripts/fleet/` builds that argv.
  It had drifted into four copies; two gated `--provenance` on `GITHUB_ACTIONS`
  alone, which npm answers with `E422 … repository visibility: "private"`.

- **Orchestration stays repo-local.** Publish order, which commits get
  republished, how an approve batch refreshes its OTP across hundreds of
  packages — that is a member's own business, and socket-registry's ~131
  override packages are the legitimate custom case. Only the upload is shared.

- **The carve-out is the chicken-and-egg, and nothing else.** npm can only
  configure a trusted publisher for a name that ALREADY EXISTS on the registry.
  A brand-new package therefore has no way to bootstrap OIDC, which is why
  `placeholder.mts` publishes a minimal `0.0.0` reservation to claim the name
  first — the constraint is documented in that script's own header. Read it
  before proposing a CI-based first publish; that idea does not survive the
  constraint.

- **The reservation is local-only, and there is no workflow for it.** Nothing in
  `template/base/.github/workflows/` reserves a name today, so nothing needs
  removing — the tree already matches the policy, and the gate below keeps it
  that way. `placeholder.mts` refuses to run under a CI runner at its own entry
  point, with the four-ingredient message, and the auth posture refuses the same
  shape again at the upload as a backstop.

- **No attestation on the reservation.** Its artifact is a `package.json` plus a
  one-line README behind `files: []`, so attesting it would protect nothing —
  and buying that attestation would mean holding a publish token in CI, which is
  the one thing this policy forbids.

- **The version is read from the manifest, not asserted by the caller.**
  `readPublishVersion` reads it off disk. A caller-passed "this is a
  reservation" flag would let any publish claim the one exemption. An unreadable
  manifest yields `undefined`, which matches no carve-out, so it fails closed.

- **Exit 0 is not proof.** The postflight scans the command's captured output
  for the exchange failure whether it exited 0 or not. A publish that
  "succeeded" after `Skipped OIDC` is a failure with a green exit code. Callers
  branch on `postureOk`, not on the exit code alone.

- **There is no environment opt-out.** An env var that converts a refusal into a
  warning is the per-member inconsistency this module exists to remove, so no
  such variable exists. A spec asserts the module names none.

- **Token values never leave the module.** The posture reports variable NAMES
  only; a spec asserts no value reaches the emitted lines.

## Enforcement

`scripts/fleet/check/publish-entrypoints-are-fleet-composed.mts` (strict, in the
release check tier) runs three passes:

1. Every publish-shaped `package.json` script that runs a local `.mts` resolves
   to `scripts/fleet/`, or to a repo-local orchestrator whose import graph
   reaches `scripts/fleet/publish-infra/`.
2. No file outside `scripts/fleet/` builds an npm upload invocation. Comments
   are stripped before the scan, and only argv shapes count — a script that
   *describes* the publish flow is not one running it.
3. No workflow invokes `placeholder.mts`. A reservation wired into CI is a
   policy violation checked in; this catches it at commit time rather than at
   release time.

## The 404 points at the registration, not at pnpm

pnpm and the npm CLI request the **same** exchange path,
`-/npm/v1/oidc/token/exchange/package/<escapedName>` — verified by grepping both
dists. So the fleet-wide 404 is not pnpm endpoint drift and not a pnpm-version
problem: npm is refusing the exchange for the package, which points at the
trusted-publisher registration not matching the claims the run presents
(repository, workflow filename, environment).

Repairing that registration needs a human with an OTP and is out of scope for
any script here; `scripts/fleet/publish-infra/npm/trust-sweep.mts` prints the
expected binding and re-registers it with `--drive`. The posture gate's job is
to make sure a run that hit the 404 never reports itself as a successful trusted
publish.
