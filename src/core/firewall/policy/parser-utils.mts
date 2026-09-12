export const firewallVersionSegments = [
  '(?<version>',
  '\\d+(?:\\.\\d+)*',
  '(?:',
  '(?:-+|\\.)',
  '[a-zA-Z0-9]+',
  '(?:[-.][a-zA-Z0-9]+)*',
  ')?',
  '(?:\\+[a-zA-Z0-9.-]+)?',
  ')',
]

export function firewallUrlPath(urlOrPath: string): string {
  return urlOrPath.startsWith('http') ? new URL(urlOrPath).pathname : urlOrPath
}
