# Pre-baked runner image for local Agent CI (`pnpm run ci:local`).
#
# agent-ci runs each workflow job in a container started FROM this file when
# present at `.github/agent-ci.Dockerfile`, and caches the built image by its
# content hash. Baking the toolchain here means a local CI run skips the cold
# per-container bootstrap that the GitHub `setup` action does on every job and
# matrix cell.
#
# What it bakes:
#   - build-essential + pkg-config — the stock runner image ships node/git/
#     curl/jq/unzip but no build toolchain; native deps need these.
#   - The fleet-pinned pnpm, fetched + SRI-verified the same way the
#     socket-registry `setup` action does, so the container's pnpm matches CI.
#
# KEEP PNPM_VERSION + PNPM_SHA256 IN SYNC with socket-registry external-tools.json
# (`pnpm.version` and `pnpm.platforms["linux-x64"].integrity`). The cascade does
# not rewrite this file's values; bump them when external-tools.json bumps pnpm.
FROM ghcr.io/actions/actions-runner:2.335.1@sha256:08c30b0a7105f64bddfc485d2487a22aa03932a791402393352fdf674bda2c29

ARG PNPM_VERSION=11.5.1
# Per-arch SHA-256 of the pnpm release tarball, hex form. Each is the decoded
# `sha256-<base64>` SRI from external-tools.json
# (pnpm.platforms["linux-x64"|"linux-arm64"].integrity). The stock runner image
# is glibc, so the glibc assets are correct (not the -musl variants). The build
# selects by TARGETARCH so the image runs natively on amd64 CI runners AND
# arm64 dev machines (an x64 binary under arm64 emulation fails to find the
# x86-64 dynamic loader).
ARG PNPM_SHA256_AMD64=5cebc2fa002cabc2008075148427e1aa7baaa7df17dd9f5226e2b1b401e83583
ARG PNPM_SHA256_ARM64=6f1e9d36d12a84aafddbbd024f9e98104aa701c888f05f7df5f4149e2fe87479
# Provided automatically by buildkit: "amd64" / "arm64".
ARG TARGETARCH

RUN sudo apt-get update \
 && sudo apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
 && sudo rm -rf /var/lib/apt/lists/*

# Fetch + integrity-verify + install pnpm. `sha256sum -c` fails the build loudly
# on a digest mismatch rather than silently shipping a tampered binary.
#
# The asset extracts to a flat `pnpm` launcher plus a sibling `dist/` tree it
# depends on, so the whole tree lands in /opt/pnpm and the launcher is symlinked
# onto PATH (copying the launcher alone would orphan dist/).
RUN set -eu; \
    case "${TARGETARCH}" in \
      arm64) asset="pnpm-linux-arm64.tar.gz"; sha="${PNPM_SHA256_ARM64}" ;; \
      amd64|"") asset="pnpm-linux-x64.tar.gz"; sha="${PNPM_SHA256_AMD64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${asset}"; \
    tmp="$(mktemp -d)"; \
    curl -fsSL "$url" -o "$tmp/pnpm.tar.gz"; \
    echo "${sha}  $tmp/pnpm.tar.gz" | sha256sum -c -; \
    sudo mkdir -p /opt/pnpm; \
    sudo tar -xzf "$tmp/pnpm.tar.gz" -C /opt/pnpm; \
    sudo chmod 0755 /opt/pnpm/pnpm; \
    sudo ln -sf /opt/pnpm/pnpm /usr/local/bin/pnpm; \
    rm -rf "$tmp"; \
    pnpm --version
