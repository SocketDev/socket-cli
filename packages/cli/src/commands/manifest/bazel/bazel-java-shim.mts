import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

let probed = false

// Verifies `java` is functional in the current execution environment. Bazel
// JVM manifest extraction (rules_jvm_external → Coursier) requires a real
// JDK; the CLI does not attempt to discover Homebrew installs or mutate the
// caller's PATH/JAVA_HOME. If `java -version` fails we throw with an
// actionable message so the surfaced error names the prerequisite directly
// instead of relying on Bazel's downstream diagnostic.
export async function ensureJavaOnPath(): Promise<void> {
  if (probed) {
    return
  }
  try {
    await spawn('java', ['-version'])
    probed = true
  } catch {
    throw new Error(
      'Java is required for Bazel JVM manifest extraction ' +
        '(rules_jvm_external invokes Coursier, which needs a JDK). ' +
        'Install a JDK (e.g. Temurin or OpenJDK) and ensure `java` is on PATH.',
    )
  }
}

// Test-only: clear the per-process cache so tests can re-mock spawn.
export function resetJavaShimCacheForTests(): void {
  probed = false
}
