# Untrusted cwd

Running a tool inside a repository you do not trust. The checkout is
attacker-authored input: its files, its `.git/config`, its config files, its
environment, and anything it can get onto `PATH`. The tool runs with the user's
credentials, so every resolution the checkout can influence is a code-execution
primitive.

## PATH trust inversion

Resolution is the gap, not shell quoting. Argument arrays already stop shell
injection; what a hostile checkout attacks is *which file gets executed*.

- **Establish the protected root first.** Walk up from the current directory to
  the OUTERMOST `.git` marker and protect from there, so a nested worktree
  cannot escape through its parent.
- **Drop hostile PATH entries.** An entry is dropped when it is relative, when
  it is empty, or when its `realpath` lands inside the protected root. Realpath,
  not the literal string: a symlink into the repo is the same attack.
- **A hit inside the root poisons its entry.** Finding the candidate under the
  protected root does not mean "skip this one and keep looking in the same
  directory". That directory is attacker-influenced, so record it and remove it
  from PATH entirely.
- **Enumerate non-runnable hits anyway.** On Windows a `.bat` / `.cmd` match can
  never be selected (`execFile` cannot launch one), but its presence still
  proves attacker influence, so it poisons its PATH entry like any other hit.
- **Return a sanitized environment alongside the path.** The resolver's result
  is the canonical absolute executable path PLUS an environment whose `PATH` is
  rebuilt without the poisoned entries. Spawn the absolute path with that
  environment. A hardened resolution followed by a bare-name spawn throws the
  whole result away.
- **Fail closed.** No trusted candidate means refuse with a real error. Never
  fall back to the bare name.

## Two traps

- **An empty PATH entry means the current directory.** `PATH=/usr/bin::/bin`,
  a leading `:`, and a trailing `:` all resolve relative to cwd on every
  platform. Filter empty entries before anything else.
- **Windows `which` prepends `process.cwd()` before every PATH entry.** This is
  deliberate cmd.exe emulation in the common resolvers, so a repository that
  ships `git.exe` / `npm.cmd` / `node.exe` in its root wins with no PATH
  manipulation at all. Neutralize it caller-side by passing an explicit `path`
  list instead of letting the resolver read the ambient environment. The same
  trap returns through `shell: true` on Windows: cmd.exe searches the current
  directory first, so a resolved absolute path must stay absolute and quoted
  rather than being reduced back to a bare basename for PATHEXT re-resolution.
- **Key the resolution cache on the effective PATH.** A cache keyed on the bare
  command name leaks one poisoned lookup into every later spawn in the process,
  including after the tool has moved on to a directory it trusts. Key on
  `` `${command}\0${effectivePath}` ``.

## Strict by default, with an explicit fallback tier

A strict-only resolver breaks legitimate use. `node_modules/.bin` is how tools
normally run under `pnpm run`, and it sits inside the very project root the
strict resolver protects, so a strict-only primitive refuses the ordinary case.

The primitive is therefore strict by default and exposes a tri-state fallback:
strict (nothing under the protected root), allow the project's own
`node_modules/.bin`, or unfiltered. A caller that knows its working directory is
trusted opts down explicitly, per call. The default never widens implicitly, and
the widest tier is never where a failed strict lookup lands.

## Git hygiene

A `git` spawn against a repository you do not own carries all of these, every
time. A single helper module is the only way the tool spawns git, so the set
cannot drift between call sites.

<details>
<summary><b>The seven flags every git spawn carries</b> - stripped <code>GIT_*</code> vars, <code>GIT_TERMINAL_PROMPT=0</code>, empty <code>core.hooksPath</code> and <code>credential.helper</code>, both <code>protocol.allow</code> keys, <code>--end-of-options</code>, clone by exact SHA</summary>

- **Strip every `GIT_*` variable** from the child environment. `GIT_DIR`,
  `GIT_INDEX_FILE`, `GIT_CONFIG_*`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, and
  `GIT_EXTERNAL_DIFF` each redirect git somewhere the caller did not choose.
- **`GIT_TERMINAL_PROMPT=0`** so a network operation fails instead of hanging on
  a credential prompt the user cannot see under `stdio: 'ignore'`.
- **`-c core.hooksPath=`** (empty) so the checkout's own hooks do not run as the
  user during a commit or checkout the tool performs. The same flag against the
  FLEET repo skips the fleet's own `.git-hooks/` chain, so `no-revert-guard`
  phrase-gates it there; the carve-out that keeps this idiom working is a `-C` /
  `--git-dir` naming a repository outside the one the command acts on.
- **`-c credential.helper=`** (empty). A repo-local
  `credential.helper = !sh -c '…'` executes on any network operation.
- **`-c protocol.allow=never` AND `-c protocol.ext.allow=never`.** Both. Verified
  empirically: a repository's own `protocol.ext.allow = always` beats the generic
  `protocol.allow` key, and a remote URL of the form `ext::sh -c …` is remote
  code execution on the next fetch, `ls-remote`, or `remote show`.
- **`--end-of-options` before any ref** the repository or the environment
  supplies. A branch value beginning `--upload-pack=…` reaching
  `git ls-remote --heads origin <branch>` is argument injection, and branch
  values originate from CI environment variables and repo config.
- **Clone by exact SHA and verify.** `git init`, a `--depth=1` fetch of a full
  40/64-hex commit id, `checkout --detach FETCH_HEAD`, then assert
  `rev-parse HEAD` equals the pin. Accept only `https:` / `ssh:` URLs with no
  embedded credentials, query, or fragment.

</details>

## Config from the scanned repo is untrusted input too

A repository's own config file is data the attacker wrote: a tool config, a
manifest, a dotfile. Optional is not the same as safe, and "the field has a
sensible default" is not validation. Without an explicit user opt-in, such a
file must never:

- **choose an executable** to run, or contribute arguments to one;
- **name a path that is read** outside the project;
- **name a path that is written**, anywhere. An unvalidated output path is
  arbitrary file overwrite, which is code execution on the next shell via a
  shell rc file and credential tampering via `~/.gitconfig` / `~/.npmrc`.

Three follow-through rules make the opt-in real:

<details>
<summary><b>Making the opt-in real</b> - containment as resolve plus realpath compared against the root, gating the ignition flag rather than the last door, and never searching above the project for config</summary>

- **Containment is resolve + realpath + compare against the root.**
  `path.join(root, value)` does NOT contain a path, so `../../../etc/passwd`
  escapes it. Apply the containment check at the sink as well as the source, so
  the sink is safe regardless of caller.
- **Gate the ignition key, not only the last door.** When a repo-controlled flag
  is what turns a whole subsystem on, gating the executable that subsystem picks
  leaves the subsystem itself running on the repo's say-so. Gate the flag. A
  conventional default path (`./gradlew`) is still a script the untrusted repo
  ships, so "it matches the convention" fails as a trust decision.
- **Do not search above the project for config.** A walk-up loader lets a file
  in a parent directory, `$HOME`, or `/tmp` supply defaults for an unrelated
  checkout, which widens every finding above from "the repo ships a file" to
  "anything above the working directory ships a file".

</details>

Environment variables the repo can set are the same surface: a `.envrc` is
auto-loaded by direnv, so a `*_LOCAL_PATH`-style override that bypasses checksum
verification is repo-controlled in practice.

## Secret hygiene at the boundary

Two habits pair with the above, because a hostile resolution pays off only when
something valuable reaches the process it captured.

- **Never pass a token in argv to a bare-name executable.** Redacting the token
  from the debug line and then handing the real value to whatever `git` resolved
  to protects the log, not the token.
- **Redact on the way out.** A single last-mile redactor on every error path
  covers `key=` / `token=` / `secret=` shapes, provider token prefixes, `Bearer`
  headers, URL userinfo, and query parameters including percent-encoded
  variants. Test it with paired arrays of synthetic credential shapes and their
  exact expected redactions.

## Enforcement

The `socket/no-which-for-local-bin` oxlint rule holds the PATH-trust-inversion
discipline at edit time: it flags a bare-name resolution (`which`/`command -v`/
`where`, or an unfiltered PATH walk) for a project-local binary instead of the
hardened resolver described above. Bypass for a genuine global lookup:
`// socket-lint: allow which-lookup`.
