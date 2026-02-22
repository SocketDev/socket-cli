export function msAtHome(isoTimeStamp: string): string {
  const timeStart = Date.parse(isoTimeStamp)
  if (Number.isNaN(timeStart)) {
    return isoTimeStamp.slice(0, 10)
  }
  const timeEnd = Date.now()

  const rtf = new Intl.RelativeTimeFormat('en', {
    numeric: 'always',
    style: 'short',
  })

  const delta = timeEnd - timeStart
  if (delta < 60 * 60 * 1000) {
    return rtf.format(-Math.round(delta / (60 * 1000)), 'minute')
  }
  if (delta < 24 * 60 * 60 * 1000) {
    return rtf.format(-Math.round(delta / (60 * 60 * 1000)), 'hour')
  }
  if (delta < 7 * 24 * 60 * 60 * 1000) {
    return rtf.format(-Math.round(delta / (24 * 60 * 60 * 1000)), 'day')
  }
  return isoTimeStamp.slice(0, 10)
}
