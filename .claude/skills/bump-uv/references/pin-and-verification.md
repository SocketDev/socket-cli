# uv pin and verification

- `src/sea/stage/uv-pins.json` is the complete pin: version, official release base
  URLs, license file hashes, and archive metadata plus SHA-256 for each target.
- `src/sea/stage/uv.mts` accepts only the declared target set and verifies the
  downloaded archive digest before extracting the executable.
- `src/sea/runtime.mts` verifies the embedded executable digest before use.
- Read [SEA build and support notes](../../../../src/sea/README.md) for the
  target platforms and runtime behavior. Keep any target unsupported unless a
  matching upstream asset is available and the build validates it.
