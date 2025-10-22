import { z } from 'zod'

export type PatchManifest = z.infer<typeof PatchManifestSchema>

export type PatchRecord = z.infer<typeof PatchRecordSchema>

export const PatchRecordSchema = z.object({
  description: z.string().optional(),
  exportedAt: z.string(),
  files: z.record(
    z.string(), // File path.
    z.object({
      beforeHash: z.string(),
      afterHash: z.string(),
    }),
  ),
  license: z.string().optional(),
  tier: z.string().optional(),
  uuid: z.string().optional(),
  vulnerabilities: z
    .record(
      z.string(), // Vulnerability ID like "GHSA-jrhj-2j3q-xf3v".
      z.object({
        cves: z.array(z.string()),
        summary: z.string(),
        severity: z.string(),
        description: z.string(),
        patchExplanation: z.string(),
      }),
    )
    .optional(),
  // Status tracking fields.
  status: z.enum(['downloaded', 'applied', 'failed']).optional(),
  downloadedAt: z.string().optional(),
  appliedAt: z.string().optional(),
  appliedTo: z.array(z.string()).optional(),
})

export const PatchManifestSchema = z.object({
  patches: z.record(
    // Package identifier like "npm:simplehttpserver@0.0.6".
    z.string(),
    PatchRecordSchema,
  ),
})
