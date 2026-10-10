declare module 'postject' {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: {
      machoSegmentName?: string
      overwrite?: boolean
      sentinelFuse?: string
    },
  ): Promise<void>
}
