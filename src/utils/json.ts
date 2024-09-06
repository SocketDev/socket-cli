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

export function isParsableJSON(jsonUTF: string): boolean {
  try {
    JSON.parse(jsonUTF)
    return true
  } catch {}
  return false
}

export function parseJSONObject(jsonUTF: string): JSONObject | null {
  try {
    const value = JSON.parse(jsonUTF)
    if (isObjectObject(value)) {
      return value
    }
  } catch {}
  return null
}
