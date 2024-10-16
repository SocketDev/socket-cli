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

export function parseJSONObject(jsonStr: string): JSONObject | null {
  try {
    const value = JSON.parse(jsonStr)
    if (isObjectObject(value)) {
      return value
    }
  } catch {}
  return null
}
