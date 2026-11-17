# `socket cdxgen`

With the npm-installed Socket CLI, generate a CycloneDX software bill of
materials (SBOM) for the current project.

```sh
socket cdxgen --output socket-cdx.json
```

The default lifecycle is `pre-build`, which reads dependency metadata
without running project installs. Run `socket cdxgen --help` for cdxgen
options, including `--type` to select a project type.

Standalone binaries have a separate set of capabilities. They can display
local cdxgen help even when SBOM generation is disabled in the build.
Use the npm-installed CLI to run the example above.
