# e2e scratch isolation

End-to-end tests run the real CLI, which means they run code that wants to
write to a home directory: config files, package-manager caches, credential
stores. Left alone, a test run would scribble on the machine it runs on. The
helpers in `packages/cli/test/helpers/cli-execution.mts` prevent that by
pointing every such variable at a throwaway directory.

There are two helpers because there are two ways a test reaches the CLI, and
they do not pin the same set.

## `executeCliInScratch` - spawning the binary

Use this when the test runs the CLI as a subprocess. It builds a fresh scratch
cwd and a fresh scratch HOME, then hands the child a pinned environment.

| Variable                                 | Points at                    |
| ---------------------------------------- | ---------------------------- |
| `HOME`, `USERPROFILE`                    | the scratch home             |
| `XDG_CONFIG_HOME`                        | `<scratchHome>/.config`      |
| `XDG_CACHE_HOME`                         | `<scratchHome>/.cache`       |
| `XDG_DATA_HOME`                          | `<scratchHome>/.local/share` |
| `XDG_STATE_HOME`                         | `<scratchHome>/.local/state` |
| `npm_config_cache`, `NPM_CONFIG_CACHE`   | `<scratchHome>/.npm`         |
| `npm_config_prefix`, `NPM_CONFIG_PREFIX` | `<scratchHome>/.npm-global`  |
| `PNPM_HOME`                              | `<scratchHome>/.pnpm`        |
| `YARN_CACHE_FOLDER`                      | `<scratchHome>/.yarn-cache`  |
| `PIP_CACHE_DIR`                          | `<scratchHome>/.pip-cache`   |
| `CARGO_HOME`                             | `<scratchHome>/.cargo`       |
| `GRADLE_USER_HOME`                       | `<scratchHome>/.gradle`      |

npm reads both the lowercase `npm_config_*` and uppercase `NPM_CONFIG_*` forms,
so both are set and neither can win by accident.

There is deliberately **no** `npm_config_userconfig` pin. `HOME` already decides
where npm looks for the user `.npmrc`, so pinning it separately would be a
second source of truth for the same path.

## `withScratchHome` - calling internals in-process

Use this when the test calls socket-cli functions directly instead of spawning
the binary. It swaps the environment for the duration of one callback and
restores it afterward, deleting any variable that was previously unset.

It pins a **smaller set** than `executeCliInScratch`: `HOME`, `USERPROFILE`, the
four `XDG_*` variables, the npm cache and prefix pairs, `PNPM_HOME`, and
`YARN_CACHE_FOLDER`. It does not pin `PIP_CACHE_DIR`, `CARGO_HOME`, or
`GRADLE_USER_HOME`. If an in-process test drives pip, cargo, or gradle, those
tools will use the developer's real caches.

Because it mutates the current process's environment, it is not safe under
`it.concurrent`. Vitest runs tests within a file serially by default and gives
each file its own worker process, so the default configuration is fine.

## What is deliberately not isolated

The developer's `SOCKET_API_KEY` and the real OS keychain stay readable. A test
can therefore authenticate as the developer, which is intended. What the scratch
HOME prevents is the reverse direction: the CLI cannot persist a new token, or
any other config, back into the developer's own files.

Both helpers remove their scratch trees with `safeDelete()` even when the test
fails.
