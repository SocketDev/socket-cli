/**
 * Canonical names for fleet recovery branches.
 */

const BACKUP_TIME_ZONE = 'America/New_York'
const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: BACKUP_TIME_ZONE,
  year: 'numeric',
})

export const BACKUP_BRANCH_RE = /^backup-\d{8}-\d{6}$/

export function isCanonicalBackupBranch(branch: string): boolean {
  return BACKUP_BRANCH_RE.test(branch)
}

/**
 * Render a GitHub commit timestamp as the fleet's stable backup-ref format.
 */
export function formatBackupBranch(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO commit date: ${isoDate}`)
  }
  const parts = timestampFormatter.formatToParts(date)
  const byType = new Map(parts.map(part => [part.type, part.value]))
  return `backup-${byType.get('year')}${byType.get('month')}${byType.get('day')}-${byType.get('hour')}${byType.get('minute')}${byType.get('second')}`
}
