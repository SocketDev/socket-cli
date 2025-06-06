export function msAtHome(isoTimeStamp: string): string {
  const timeStart = Date.parse(isoTimeStamp)
  const timeEnd = Date.now()

  const rtf = new Intl.RelativeTimeFormat('en', {
    numeric: 'always',
    style: 'short',
  })

  const delta = timeEnd - timeStart
  if (delta < 60 * 60 * 1000) {
    return rtf.format(-Math.round(delta / (60 * 1000)), 'minute')
    // return Math.round(delta / (60 * 1000)) + ' min ago'
  } else if (delta < 24 * 60 * 60 * 1000) {
    return rtf.format(-(delta / (60 * 60 * 1000)).toFixed(1), 'hour')
    // return (delta / (60 * 60 * 1000)).toFixed(1) + ' hr ago'
  } else if (delta < 7 * 24 * 60 * 60 * 1000) {
    return rtf.format(-(delta / (24 * 60 * 60 * 1000)).toFixed(1), 'day')
    // return (delta / (24 * 60 * 60 * 1000)).toFixed(1) + ' day ago'
  } else {
    return isoTimeStamp.slice(0, 10)
  }
}
