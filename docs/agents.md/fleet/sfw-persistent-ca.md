# Socket Firewall persistent CA

Companion to the Socket Firewall CA rule in `template/base/CLAUDE.md`. Policy:
**the fleet's sfw CA is a stable per-user file, never a per-invocation
throwaway.** A throwaway CA cannot be added to an OS trust store, and every
client that carries its own TLS stack verifies against that store — so an
ephemeral CA breaks them all while Node clients keep working and hide the bug.

## Why an ephemeral CA breaks non-Node clients

sfw is a MITM proxy: it terminates TLS, inspects the package fetch, and re-signs
the response with its own CA. The client has to trust that CA or the handshake
fails.

`getCaKeyPair()` (firewall `src/lib/cli/cliCaKeyPair.ts`) adopts an existing CA
only when `SFW_CA_CERT_PATH` **and** `SFW_CA_KEY_PATH` are both set **and** both
files exist. Miss any of those four conditions and it calls
`generateCaKeyPair(tmpdir)` — a brand-new CA in a brand-new temp directory, per
invocation. Two consecutive runs land in two different `sfw-XXXXXX/` dirs.

sfw then injects the right env into the wrapped child: `SSL_CERT_FILE`,
`SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `CARGO_HTTP_CAINFO`, `PIP_CERT`,
`YARN_HTTPS_CA_FILE_PATH`, `GIT_SSL_CAINFO`. That injection is what makes the
setup look healthy:

- **Node clients keep working.** Node reads `NODE_EXTRA_CA_CERTS` at startup and
  appends the file to its bundled root set. A fresh path every run is fine —
  the var is fresh too.
- **Clients with their own TLS stack do not.** pnpm's tarball fetcher is Rust
  (`pacquet_tarball::fetch_tarball`, rustls); it does not consult
  `NODE_EXTRA_CA_CERTS`, and rustls rejects the re-signed chain with
  `invalid peer certificate: UnknownIssuer`. cargo, uv, and Go land in the same
  class.

The failure is intermittent in the worst way: a cached install never downloads a
tarball, so it never touches TLS for that package. The break shows up only on a
**new** dependency download — a cache miss, a fresh checkout, a bumped version.

## Status: the env wiring is correct and currently INERT

Measured on both binaries with identical env:

- **sfw-enterprise honors `SFW_CA_CERT_PATH`** — the wrapped child receives the
  path that was exported.
- **sfw-free ignores it** — the child receives
  `/var/folders/.../T/sfw-<random>/socketFirewallCa.crt`. Its entrypoint calls
  `getCaKeyPair(tmpdir, false, {})` with an EMPTY external config, so the env
  pair is never read, then overwrites it in the child env with the throwaway
  path. That is a build property, not an operator misconfiguration.

<details>
<summary><b>Two mechanisms, and why the verdict is INERT</b>: the enterprise-vs-free table for the env pair, the pending <code>sfw ca init/trust/path</code> default pair, and why <code>setup:sfw-ca</code> withholds the OS-trust command</summary>

So there are **two mechanisms, and the env pair is not the load-bearing one**:

| mechanism | honored by | status |
| --- | --- | --- |
| `SFW_CA_CERT_PATH` / `SFW_CA_KEY_PATH` in the child env | enterprise only | wired here, works on enterprise |
| a persistent pair at the location the build reads by default | both, once shipped | the load-bearing path; pending upstream |

The pending firewall change (`sfw ca init/trust/path`) gives free mode a
persistent DEFAULT pair — `resolveExistingCaKeyPair` prefers the env pair when
both files exist and otherwise falls back to `getPersistentCaPaths()`, today
`~/.socket/sfw/ca.{crt,key}`. It does **not** teach free mode to read
`SFW_CA_*` from the environment; that gap survives the change. On a machine
running the free build, exporting the env pair will stay inert before and after.

Until such a build is racked, generating and trusting a persistent CA changes
nothing at runtime, and this repo says so rather than reporting success.
`setup:sfw-ca` probes what a wrapped child actually receives and prints an
`INERT` verdict — withholding the OS-trust command, because trusting a root the
proxy never signs with accomplishes nothing.

</details>

## The mechanism

One stable pair, generated once, trusted once:

1. `pnpm run setup:sfw-ca` generates `~/.socket/sfw/ca.{crt,key}`
   through openssl, with the same subject and extensions the firewall's own
   generator uses (`CN=Socket Security CA, O=Socket Security`,
   `basicConstraints critical CA:TRUE`, `keyUsage critical keyCertSign`). Key
   `0600`, cert `0644`, directory `0700`. Idempotent — a second run regenerates
   nothing and re-reports the trust verdict. `--force` is the only way to
   replace an existing pair.
2. The step **prints** the OS trust command and stops. Installing a root CA
   needs root, and a setup step does not get to take sudo. On macOS it also
   probes `security find-certificate -c "Socket"` first, so a re-run on an
   already-trusted box is a clean no-op instead of a repeated ask.
3. Every surface that hands an environment to a package manager exports the
   pair, guarded on the files existing:
   - the wrapper generator `scripts/fleet/setup/tools-sfw.mjs`, which writes
     `~/.socket/_wheelhouse/bin/*` — the wrappers PATH resolves,
   - the shell-rc bridge
     `.claude/hooks/fleet/setup-security-tools/lib/shell-rc-bridge.mts`, which
     covers a tool invoked outside a wrapper.

The guard is evaluated by the **shell at run time**, not at generation time, so
one generated wrapper is correct both before and after the CA exists. A machine
that never runs `setup:sfw-ca` is left as it was.

## Why the CA env is not a `FLEET_ENV` knob

`FLEET_ENV` (`.claude/hooks/fleet/_shared/fleet-env.mts`) is the no-phone-home
posture: static values, universal across every surface, and **required in every
workflow `env:`** by `workflow-envs-have-full-fleet-env`. The CA pair is neither
static nor universal — the value is a per-user path and CI has no CA at all.
Adding it there would force a knob into CI that can never be satisfied. It ships
as its own list in `.claude/hooks/fleet/_shared/sfw-ca.mts`, which keeps the CA
wiring and the CI telemetry gates independently correct.

## Why `~/.socket/sfw`, and how it coexists with the layout migration

The pair only does anything if it sits where the build looks for it. The
firewall's `getPersistentCaDir()` (`src/lib/cli/caPaths.ts`) resolves
`~/.socket/sfw`, and `getPersistentCaPaths()` names the halves `ca.crt` /
`ca.key`. Both values live in this repo as `SFW_CA_HOME_RELATIVE_DIR` and
`SFW_CA_BASENAME` in `.claude/hooks/fleet/_shared/sfw-ca.mts` — one string each,
which every absolute path, shell fragment, and check message derives from, so
an upstream rename is a one-line follow.

<details>
<summary><b>Coexisting with the <code>_wheelhouse</code> layout migration</b>: <code>LEGACY_SFW_DIR</code>, the two ways a rename collides, and the entry-by-entry <code>ensureWheelhouseLayout()</code> that skips <code>SFW_CA_FILENAMES</code></summary>

That directory has two owners. It is also `LEGACY_SFW_DIR` in
`scripts/fleet/install-sfw.mts`: on a machine that predates the `_wheelhouse`
rename, `ensureWheelhouseLayout()` used to `renameSync` the whole thing to
`~/.socket/_wheelhouse`. Left alone that collides two ways — a migration would
carry `ca.{crt,key}` out from under both the build and the OS trust entry, and
on a machine that never had a legacy install the mere act of creating the CA dir
would fake a migration into being.

They coexist, with the layout function made CA-aware rather than the CA moved:

- `legacySfwPayloadEntries()` is the payload the migration owns — everything in
  `~/.socket/sfw` except `SFW_CA_FILENAMES`.
- `ensureWheelhouseLayout()` moves that payload **entry by entry** into
  `~/.socket/_wheelhouse` instead of renaming the directory, and skips the
  migration entirely when the only thing there is the CA.

So `~/.socket/sfw` survives the migration holding exactly the pair, which is
what sfw reads. Picking the other side — keeping the CA under the wheelhouse
umbrella and teaching sfw to find it — is not available: free mode never reads
`SFW_CA_CERT_PATH` at all, so a pair anywhere but the default location is inert
by construction.

</details>

## Enforcement

`scripts/fleet/check/sfw-ca-env-is-wired.mts` runs in `check --all`, in two
legs:

- **Source (always).** Calls the real generators and asserts the emitted CA
  block is byte-identical to `sfwCaPosixExportLines()` /
  `sfwCaWindowsExportLines()`, on POSIX, on Windows, and in the shell-rc block.
  It also asserts the HOME-relative path the shell fragment hardcodes still
  agrees with the absolute path `getSfwCaDir()` resolves — the one place the two
  derivations could drift.
- **Machine (this box).** Every real-tool wrapper in
  `~/.socket/_wheelhouse/bin` must carry the exports; one generated before the
  wiring landed is stale and silently unprotected. Regenerate with
  `node scripts/fleet/setup/tools.mjs`.

Absent wrappers or an absent CA pair are a **loud skip**, never a pass — CI has
neither, and a green line for a leg that did not run is the false-green this
repo's checks exist to prevent.

The dep-0 wrapper generator inlines the shell fragment rather than importing it:
`tools-sfw.mjs` runs on the system Node before `node_modules` exists, so it
cannot import a `.mts`. The source leg is what keeps that inline copy from
drifting.

## Verifying it took

```bash
# The wrapper PATH resolves must carry the pair.
grep -c SFW_CA_CERT_PATH "$(command -v pnpm)"

# The child sees it.
pnpm exec node -e 'console.log(process.env.SFW_CA_CERT_PATH)'

# The re-signed chain now verifies against the system store.
openssl s_client -connect registry.npmjs.org:443 -prexit </dev/null 2>&1 | head -20
```
