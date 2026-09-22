import {
  ArtifactUploadError,
  runArtifactUploadAction,
} from '../../../../scripts/ci/upload-artifact.mjs'

try {
  await runArtifactUploadAction()
} catch (error) {
  const message =
    error instanceof ArtifactUploadError
      ? error.message
      : 'Artifact upload failed. Where: release artifact action. Saw: an unexpected failure; wanted a completed upload. Fix: inspect runner access and retry the job.'
  process.stderr.write(`::error::${message}\n`)
  process.exitCode = 1
}
