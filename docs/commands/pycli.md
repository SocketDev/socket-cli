# Socket Python CLI

## `socket pycli`

Pass arguments directly to the `socketsecurity` Python CLI for features that
are not available in the Node.js CLI:

```sh
socket pycli --enable-sarif --strict-blocking .
```

The Python CLI owns these options after `pycli`. Use `socket pycli --help` for
its help. Common uses include license output, SARIF, GitLab Dependency Scanning,
strict policy blocking, and webhook notifications.
