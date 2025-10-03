/** @fileoverview Type definitions for Socket CLI threat feed commands. Defines threat feed response structure and threat result objects. */

export interface ThreadFeedResponse {
  results: ThreatResult[]
  nextPage: string
}

export type ThreatResult = {
  createdAt: string
  description: string
  id: number
  locationHtmlUrl: string
  packageHtmlUrl: string
  purl: string
  removedAt: string | null
  threatType: string
}
