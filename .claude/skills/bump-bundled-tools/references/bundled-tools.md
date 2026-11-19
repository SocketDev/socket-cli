# Tools bundled in the native CLI

| Tool and type | Pin | Staging path | Target and status | Skill |
| --- | --- | --- | --- | --- |
| `socket-patch` executable | `dependencies.@socketsecurity/socket-patch` in `package.json` | `src/sea/build-sea.mts` → `resources/socket-patch` | Built for targets with a matching locked platform package; the manifest records its digest. | [bump-socket-patch](../../bump-socket-patch/SKILL.md) |
| `uv` executable | `src/sea/stage/uv-pins.json` | `src/sea/stage/uv.mts` → `tools/uv` | Target archives are checksum-verified; the manifest records each binary digest. | [bump-uv](../../bump-uv/SKILL.md) |
| `cdxgen` JavaScript API | `devDependencies.@cyclonedx/cdxgen` in `package.json` | `.config/rollup.cdxgen-sea.config.mjs` and `src/sea/build-sea.mts` → `tools/cdxgen` | `darwin-arm64` only; capability stays disabled until provenance and notices are resolved. | [bump-cdxgen](../../bump-cdxgen/SKILL.md) |
| `synp` JavaScript package | `devDependencies.synp` in `package.json` | `src/sea/stage/synp.mts` → `tools/synp` | `darwin-arm64` only; Yarn Classic stays disabled until provenance and notices are resolved. | [bump-synp](../../bump-synp/SKILL.md) |

Node is the SEA runtime; use [bump-node-sea](../../bump-node-sea/SKILL.md).
Coana runs from a Socket API download; use [bump-coana](../../bump-coana/SKILL.md).
The .NET facts helper is built from source and requires a compatible .NET SDK.
Socket Python CLI has no version pin or VFS staging step in this repo.
