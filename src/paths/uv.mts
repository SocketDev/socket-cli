import pins from '../sea/stage/uv-pins.json' with { type: 'json' }

export function uvReleaseUrl(archive: string): string {
  return `${pins.repository}/releases/download/${pins.version}/${archive}`
}

export function uvLicenseUrl(filename: string): string {
  return `${pins.repository}/raw/${pins.version}/${filename}`
}
