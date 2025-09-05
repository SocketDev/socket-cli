import { z } from 'zod'

export type PatchManifest = z.infer<typeof PatchManifestSchema>

export type PatchRecord = z.infer<typeof PatchRecordSchema>

export const PatchRecordSchema = z.object({
  exportedAt: z.string(),
  files: z.record(
    z.string(), // File path
    z.object({
      beforeHash: z.string(),
      afterHash: z.string(),
    }),
  ),
  vulnerabilities: z.record(
    z.string(), // Vulnerability ID like "GHSA-jrhj-2j3q-xf3v"
    z.object({
      cves: z.array(z.string()),
      summary: z.string(),
      severity: z.string(),
      description: z.string(),
      patchExplanation: z.string(),
    }),
  ),
})

export const PatchManifestSchema = z.object({
  patches: z.record(
    // Package identifier like "npm:simplehttpserver@0.0.6".
    z.string(),
    PatchRecordSchema,
  ),
})
