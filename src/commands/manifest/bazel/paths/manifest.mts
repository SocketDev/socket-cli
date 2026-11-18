import path from 'node:path'

export const BAZEL_AUTO_MANIFEST_DIR_NAME = '.socket-auto-manifest'
export const BAZEL_MANIFESTS_DIR_NAME = 'bazel-manifests'
export const BAZEL_SYNTHETIC_OUTPUT_DIR_NAMES: ReadonlySet<string> = new Set([
  BAZEL_AUTO_MANIFEST_DIR_NAME,
  BAZEL_MANIFESTS_DIR_NAME,
])
export const SOCKET_WORKSPACE_DIR_NAME = '.socket'
export const DEFAULT_BAZEL_MANIFEST_OUTPUT_DISPLAY_PATH = `./${SOCKET_WORKSPACE_DIR_NAME}/${BAZEL_MANIFESTS_DIR_NAME}/`

export function getBazelAutoManifestDirectory(out: string): string {
  return path.join(out, BAZEL_AUTO_MANIFEST_DIR_NAME)
}

export function getDefaultBazelManifestDirectory(repo: string): string {
  return path.join(repo, SOCKET_WORKSPACE_DIR_NAME, BAZEL_MANIFESTS_DIR_NAME)
}
