export function getSocketDevAlertUrl(alertType: string): string {
  return `https://socket.dev/alerts/${alertType}`
}

export function getSocketDevPackageOverviewUrl(
  eco: string,
  name: string,
  version?: string
): string {
  return `https://socket.dev/${eco}/package/${name}${version ? `/overview/${version}` : ''}`
}
