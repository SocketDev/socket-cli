# Migrating from socket patch setup

Socket Patch v5 removed setup and the postinstall hooks it configured. Choose
a patch mode instead:

- **Hosted:** Preview lockfile changes with socket patch scan --dry-run, then
  run socket patch scan to rewrite dependency files to use Socket's patch
  service.
- **Vendored:** Run socket patch scan --mode vendored and commit the patched
  artifacts under .socket/vendor/ with the lockfile changes.
- **Agent:** Run socket patch scan --mode agent, then run socket patch apply
  after each dependency install in CI.

See [scan](scan.md) and [apply](apply.md) for details.
