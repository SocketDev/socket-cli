# Quality Scan Report — 2026-05-06

**Repo**: socket-cli (branch `main`)
**Scope**: critical, logic, cache, workflow, security (zizmor)
**Method**: `/scanning-quality` skill, two parallel pattern-scan agents + zizmor v1.23.1

## Executive summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 1     |
| Medium   | 4     |
| Low      | 3     |

The codebase is in good shape. No crashes, auth-token leaks, race-condition data corruption, off-by-one bugs, or actions/CI security issues (zizmor: clean across `ci.yml`, `provenance.yml`, `weekly-update.yml`). The notable items are a `safeDelete` policy violation cluster (mechanical sweep), a cross-process config-write race that can lose user edits, and a VFS extraction marker that doesn't invalidate when CLI/tool versions change.

---

## Findings by severity

### High

#### H1. `safeDelete` policy violation — 20 callsites use `fs.unlink` directly

```
File: packages/cli/src/utils/dlx/spawn.mts:225,287,326,1106,1143,1335,1363,1418
      packages/cli/src/utils/dlx/vfs-extract.mts:445,494,495,520,598,607,665
      packages/cli/src/commands/fix/coana-fix.mts:64
      packages/cli/src/commands/fix/ghsa-tracker.mts:106,154
      packages/cli/src/commands/scan/create-scan-from-github.mts:546
      packages/cli/src/bootstrap/node.mts:107
Issue: Direct fs.unlink() instead of safeDelete() from @socketsecurity/lib/fs
Severity: High (policy)
Pattern:
  await fs.unlink(filePath)
Trigger: Any temp-file / lockfile / tarball cleanup path. CLAUDE.md mandates
  safeDelete()/safeDeleteSync() for every delete.
Fix: Replace `await fs.unlink(p)` with `await safeDelete(p, { force: true })`.
  Drop surrounding try/catch — safeDelete swallows ENOENT.
Impact: Bypasses path validation and Windows-lock retry. Some callsites have
  bespoke ENOENT/stale-PID handling that needs per-callsite review against
  safeDelete's contract — not a pure mechanical replace.
```

Suggested follow-up: hand off to `/quality-loop` or open a `refactor(fs): route deletes through safeDelete` PR and review each callsite's existing error handling.

---

### Medium

#### M1. Cross-process config write race loses user edits

```
File: packages/cli/src/utils/config.mts:357-435
Issue: Read-modify-write inside process.nextTick is not atomic across CLI invocations
Severity: Medium
Pattern:
  let _pendingSave = false
  if (!_pendingSave) {
    _pendingSave = true
    process.nextTick(() => {
      _pendingSave = false
      // read existingRaw → editor.update(localConfig) → writeFileSync(...)
    })
  }
Trigger: Two `socket` invocations running concurrently (CI matrix, parallel
  workspace scripts) each modify their in-memory localConfig and each enter
  their own nextTick. The _pendingSave flag debounces within a single process
  but does not serialize across processes — the loser's edit is clobbered.
Fix: Write to `config.json.tmp.<pid>`, re-read live file, deep-merge in-memory
  delta over disk, then `fs.renameSync` (atomic). Or use an O_EXCL lockfile
  dance like the dlx code already does.
Impact: Silent data loss — apiToken can be overwritten by a stale defaultOrg
  save under any concurrent CLI run.
```

#### M2. VFS `.extracted` marker doesn't invalidate on CLI/tool version bump

```
File: packages/cli/src/utils/dlx/vfs-extract.mts:182-207, 407, 655
Issue: Cache marker keyed only on node-smol/version/platform/arch; CLI version
  + bundled tool versions excluded
Severity: Medium
Pattern:
  const hashInput = `${process.version}-${process.platform}-${process.arch}`
  const cacheMarker = path.join(nodeSmolBase, '.extracted')
  await fs.writeFile(cacheMarker, '', 'utf8') // empty marker
Trigger: Reinstall socket-cli with bumped cdxgen/coana/sfw versions onto the
  same Node version — nodeSmolHash unchanged, marker still present, extraction
  skipped, user runs the previous tool versions silently.
Fix: Include CLI version (or hash of bundle-tools.json) in the path, or write
  `{ cliVersion, toolVersions }` JSON into .extracted and validate on read.
Impact: Stale tool execution after CLI upgrade — security correctness issue if
  a tool was updated for a CVE.
```

#### M3. URL validator regex is unanchored on the right and accepts whitespace

```
File: packages/cli/src/utils/validation/common.mts:95
Issue: isUrl regex /^https?:\/\/.+/ has no end anchor; `.` matches anything
  but newline, allowing embedded whitespace.
Severity: Medium
Pattern:
  isUrl: (value, name, outputKind) =>
    checkCommandInput(outputKind, {
      test: /^https?:\/\/.+/.test(value),
Trigger: User supplies --url with embedded whitespace/control chars or trailing newline.
Fix: Use `try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }`.
  If keeping regex, use `/^https?:\/\/\S+$/`.
Impact: Wrong result — invalid URLs accepted; downstream HTTP layer may throw
  or send malformed requests.
```

#### M4. CI stub-package boilerplate duplicated across 4 jobs

```
File: .github/workflows/ci.yml:75-110, 134-169, 200-235, 283-318
Issue: ~100 LOC of identical heredoc blocks creating socketaddon-iocraft stubs
  in lint, type-check, test-sharded, e2e jobs
Severity: Medium
Trigger: Any iocraft API/stub-layout change requires editing four near-identical
  blocks; drift produces "missing export" in only some jobs.
Fix: Extract to .github/actions/create-iocraft-stubs/action.yml (one composite
  action) and replace the 4 inline blocks with
  `uses: ./.github/actions/create-iocraft-stubs`.
Impact: ~200 LOC of drift surface; every iocraft PR must keep four copies synced.
```

---

### Low

#### L1. weekly-update.yml runs tests after a failed build, polluting retry logs

```
File: .github/workflows/weekly-update.yml:140-152
Issue: `set +e` swallows build failure; tests then run against an unbuilt CLI,
  generating a spurious failure log fed to the sonnet retry agent.
Severity: Low
Fix: Short-circuit between build and test:
  if [ "$BUILD_EXIT" -ne 0 ]; then echo "tests-skipped=true"; exit 0; fi
Impact: Wastes CI minutes; inflates token cost / confuses the retry agent.
```

#### L2. weekly-update silently skips on transient registry failure

```
File: .github/workflows/weekly-update.yml:43
Issue: `pnpm outdated 2>/dev/null || true` masks all non-zero exits, including registry 503s.
Severity: Low
Pattern: NPM_UPDATES=$(pnpm outdated 2>/dev/null || true)
Fix: Capture exit code separately; tolerate only the documented "outdated found"
  exit code (pnpm 1). On other non-zero, fail the step.
Impact: Silent skip of weekly updates on transient registry hiccups — the user
  thinks "no updates" when nothing was actually checked.
```

#### L3. Documented but accepted TOCTOU on `dlxManifest.get()` cache key

```
File: packages/cli/src/utils/update/manager.mts:131-140
Issue: Update-check cache key omits node version / install method
Severity: Low (already documented in inline comment as accepted race)
Fix: None required — flagging for visibility.
Impact: Minor extra network requests on TTL-expiry concurrency; bounded.
```

---

## Notable non-findings (verified clean)

- **zizmor (security)**: 0 findings across 3 workflows.
- **Auth-token logging**: `whoami` masks via `${TOKEN_PREFIX}${visiblePrefix}…`; `debugNs` callsites only emit env-var names.
- **Async `forEach`**: zero matches.
- **`fetch()` in src/**: zero — `NetworkUtils.fetch()` in `update/checker.mts:101` is a method name on a wrapper class around `https.request`, not the WHATWG global. (Naming nit: consider renaming to `httpsRequest` to keep grep clean.)
- **`Promise.race` in loops**: only a single-shot timeout in `telemetry/service.mts:137` — safe.
- **`process.exit` framework bypass**: ~40 callsites, all are deliberate child-process exit-code propagation, help/version short-circuit, or final dispatcher exit. Not framework bypasses.
- **`==` / `!=` business-logic bugs**: only intentional `== null` (null+undefined check). Clean.
- **Off-by-one**: Levenshtein DP in `with-subcommands.mts:310-329` uses `<=` correctly with `length+1` allocations.
- **Package-name parsing**: `utils/dlx/spawn.mts:115` regex is fully anchored and handles non-scoped names.
- **`typeof === 'object'` guards**: every match has `&& x !== null` or an enclosing truthy guard.
- **Sort comparators**: all three custom comparators include the zero case.
- **De Morgan filter inversions**: clean.
- **Token cache expiration**: N/A — Socket tokens are long-lived/manually-rotated, not OAuth.
- **Import conventions**: `node:child_process` only appears as type-only imports; no runtime bypass of `@socketsecurity/lib/spawn`.
- **`packages/cli/package.json` scripts**: clean — uses `del-cli`, no `rm`/`cp`/`mv`.

---

## Coverage

- Files scanned (sampled by agents via Grep/Glob): `packages/cli/src/**/*.mts` (excluding tests), `.github/workflows/*.yml`, `packages/cli/package.json`, root `package.json`.
- Skipped: `node_modules/`, `external/`, `packages/build-infra/build/`, `packages/package-builder/build/`.

## Suggested follow-ups

1. **High** → Sweep PR `refactor(fs): route deletes through safeDelete` (H1, 20 callsites). Review per-callsite for ENOENT/stale-PID edge handling.
2. **Medium** → Patch config write race (M1) — small, isolated change in `utils/config.mts`.
3. **Medium** → Bump VFS marker schema (M2) to include CLI/tool versions.
4. **Medium** → Extract iocraft stub composite action (M4).
5. **Medium** → Tighten URL validator (M3).
6. **Low** → Wire build/test short-circuit + outdated exit-code handling in `weekly-update.yml` (L1, L2).

Hand off to `/quality-loop` or open targeted commits per-finding. Don't bundle scan + fixes in one commit (per skill cadence rules).
