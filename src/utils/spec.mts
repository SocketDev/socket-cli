import { NPM } from '../constants.mts'

export function idToNpmPurl(id: string): string {
  return `pkg:${NPM}/${id}`
}
