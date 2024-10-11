import { isObjectObject } from './objects'

export type JSONArray = JSONValue[]

export type JSONObject = { [key: string]: JSONValue }

export type JSONValue =
  | boolean
  | null
  | number
  | string
  | JSONArray
  | JSONObject

export function indentedStringify(
  jsonValue: JSONValue,
  indent: string
): string {
  return JSON.stringify(jsonValue, null, 2).replace(
    /(?<=\n)\s*/g,
    `$&${indent}`
  )
}

export function isParsableJSON(jsonStr: string): boolean {
  try {
    JSON.parse(jsonStr)
    return true
  } catch {}
  return false
}

export function parseJSONObject(jsonStr: string): JSONObject | null {
  try {
    const value = JSON.parse(jsonStr)
    if (isObjectObject(value)) {
      return value
    }
  } catch {}
  return null
}
