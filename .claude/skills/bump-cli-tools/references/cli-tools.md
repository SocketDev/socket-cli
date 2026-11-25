# Pinned CLI tools

| Tool | Pin | Delivery | Notes | Skill |
| --- | --- | --- | --- | --- |
| Coana CLI | `COANA_CLI_VERSION` in `src/constants.mts` | Downloaded from the Socket API on first use and cached by the CLI. | Not part of the native executable. | [bump-coana](../../bump-coana/SKILL.md) |
| Socket Patch executable | `dependencies.@socketsecurity/socket-patch` in `package.json` | `src/sea/build-sea.mts` → `resources/socket-patch` | Built for targets with a matching locked platform package; the manifest records its digest. | [bump-socket-patch](../../bump-socket-patch/SKILL.md) |
| `uv` executable | `src/sea/stage/uv-pins.json` | `src/sea/stage/uv.mts` → `tools/uv` | Target archives are checksum-verified; the manifest records each binary digest. | [bump-uv](../../bump-uv/SKILL.md) |
| `cdxgen` JavaScript API | `devDependencies.@cyclonedx/cdxgen` in `package.json` | `.config/rollup.cdxgen-sea.config.mjs` and `src/sea/build-sea.mts` → `tools/cdxgen` | Generates SBOMs for npm and Yarn Classic. | [bump-cdxgen](../../bump-cdxgen/SKILL.md) |
| `synp` JavaScript package | `devDependencies.synp` in `package.json` | `src/sea/stage/synp.mts` → `tools/synp` | Converts Yarn Classic lockfiles for cdxgen. | [bump-synp](../../bump-synp/SKILL.md) |
