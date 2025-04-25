export type StringKeyValueObject = { [key: string]: string }

export type OutputKind = 'json' | 'markdown' | 'text'

export type CliJsonResult<T = unknown> =
  | { ok: true; message?: string; data: T }
  | { ok: false; message: string; data: string | undefined }
