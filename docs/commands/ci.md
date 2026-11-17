# `socket ci`

Run a security scan in CI. This alias for `socket scan create --report`
uses the default organization for your Socket API token and exits with a
nonzero status if the scan fails your security policy.

```sh
socket ci
```

Use `--auto-manifest` to include locally generated manifests for supported
projects. Run `socket ci --help` for all options.
