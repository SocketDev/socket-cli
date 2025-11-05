/**
 * @fileoverview Editable package.json manipulation utilities.
 */

import type {
  EditablePackageJsonOptions,
  NormalizeOptions,
  PackageJson,
  SaveOptions,
} from '../packages'
import { isNodeModules } from '../path'
import { normalizePackageJson } from './normalize'
import { resolvePackageJsonDirname } from './paths'

const identSymbol = Symbol.for('indent')
const newlineSymbol = Symbol.for('newline')

// Define the interface for the dynamic class
interface EditablePackageJsonConstructor {
  new (): EditablePackageJsonInstance
  fixSteps: unknown[]
  normalizeSteps: unknown[]
  prepareSteps: unknown[]
  create(
    path: string,
    opts?: EditablePackageJsonOptions,
  ): Promise<EditablePackageJsonInstance>
  fix(path: string, opts?: unknown): Promise<EditablePackageJsonInstance>
  load(
    path: string,
    opts?: EditablePackageJsonOptions,
  ): Promise<EditablePackageJsonInstance>
  normalize(
    path: string,
    opts?: NormalizeOptions,
  ): Promise<EditablePackageJsonInstance>
  prepare(path: string, opts?: unknown): Promise<EditablePackageJsonInstance>
}

/**
 * EditablePackageJson instance interface extending NPMCliPackageJson functionality.
 * Provides enhanced package.json manipulation with Socket-specific features.
 * @extends NPMCliPackageJson (from @npmcli/package-json)
 */
export interface EditablePackageJsonInstance {
  /**
   * The parsed package.json content as a readonly object.
   * @readonly
   */
  content: Readonly<PackageJson>

  /**
   * Create a new package.json file at the specified path.
   * @param path - The directory path where package.json will be created
   */
  create(path: string): this

  /**
   * Apply automatic fixes to the package.json based on npm standards.
   * @param opts - Optional fix configuration
   */
  fix(opts?: unknown | undefined): Promise<this>

  /**
   * Initialize the instance from a content object.
   * @param content - The package.json content object
   */
  fromContent(content: unknown): this

  /**
   * Initialize the instance from a JSON string.
   * @param json - The package.json content as a JSON string
   */
  fromJSON(json: string): this

  /**
   * Load a package.json file from the specified path.
   * @param path - The directory containing the package.json
   * @param create - Whether to create the file if it doesn't exist
   */
  load(path: string, create?: boolean): Promise<this>

  /**
   * Normalize the package.json content according to npm standards.
   * @param opts - Normalization options
   */
  normalize(opts?: NormalizeOptions): Promise<this>

  /**
   * Prepare the package.json for publishing.
   * @param opts - Preparation options
   */
  prepare(opts?: unknown): Promise<this>

  /**
   * Update the package.json content with new values.
   * @param content - Partial package.json object with fields to update
   * @override from NPMCliPackageJson
   */
  update(content: Partial<PackageJson>): this

  /**
   * Save the package.json file to disk.
   * @param options - Save options for formatting and sorting
   * @override from NPMCliPackageJson
   */
  save(options?: SaveOptions | undefined): Promise<boolean>

  /**
   * Synchronously save the package.json file to disk.
   * @param options - Save options for formatting and sorting
   */
  saveSync(options?: SaveOptions | undefined): boolean

  /**
   * Check if the package.json will be saved based on current changes.
   * @param options - Save options to evaluate
   */
  willSave(options?: SaveOptions | undefined): boolean
}

let _EditablePackageJsonClass: EditablePackageJsonConstructor | undefined

let _fs: typeof import('fs') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getFs() {
  if (_fs === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _fs = /*@__PURE__*/ require('node:fs')
  }
  return _fs as typeof import('fs')
}

let _path: typeof import('path') | undefined
/**
 * Lazily load the path module to avoid Webpack errors.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('path')
}

let _util: typeof import('util') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getUtil() {
  if (_util === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _util = /*@__PURE__*/ require('node:util')
  }
  return _util as typeof import('util')
}

/**
 * Get the EditablePackageJson class for package.json manipulation.
 */
/*@__NO_SIDE_EFFECTS__*/
export function getEditablePackageJsonClass(): EditablePackageJsonConstructor {
  if (_EditablePackageJsonClass === undefined) {
    const EditablePackageJsonBase =
      /*@__PURE__*/ require('@npmcli/package-json')
    const { parse, read } =
      /*@__PURE__*/ require('@npmcli/package-json/lib/read-package')
    const { packageSort } =
      /*@__PURE__*/ require('@npmcli/package-json/lib/sort')
    _EditablePackageJsonClass =
      class EditablePackageJson extends (EditablePackageJsonBase as EditablePackageJsonConstructor) {
        static override fixSteps = EditablePackageJsonBase.fixSteps
        static override normalizeSteps = EditablePackageJsonBase.normalizeSteps
        static override prepareSteps = EditablePackageJsonBase.prepareSteps

        _canSave = true
        _path: string | undefined = undefined
        _readFileContent = ''
        _readFileJson: unknown = undefined

        override get content(): Readonly<PackageJson> {
          return super.content
        }

        get filename(): string {
          const path = this._path
          if (!path) {
            return ''
          }
          if (path.endsWith('package.json')) {
            return path
          }
          const nodePath = getPath()
          return nodePath.join(path, 'package.json')
        }

        static override async create(
          path: string,
          opts: EditablePackageJsonOptions = {},
        ) {
          const p = new (
            _EditablePackageJsonClass as EditablePackageJsonConstructor
          )()
          await p.create(path)
          return opts.data ? p.update(opts.data) : p
        }

        static override async fix(path: string, opts: unknown) {
          const p = new (
            _EditablePackageJsonClass as EditablePackageJsonConstructor
          )()
          await p.load(path, true)
          return await p.fix(opts)
        }

        static override async load(
          path: string,
          opts: EditablePackageJsonOptions = {},
        ) {
          const p = new (
            _EditablePackageJsonClass as EditablePackageJsonConstructor
          )()
          // Avoid try/catch if we aren't going to create
          if (!opts.create) {
            return await p.load(path)
          }
          try {
            return await p.load(path)
          } catch (err: unknown) {
            if (
              !(err as Error).message.startsWith('Could not read package.json')
            ) {
              throw err
            }
            return p.create(path)
          }
        }

        static override async normalize(path: string, opts: NormalizeOptions) {
          const p = new (
            _EditablePackageJsonClass as EditablePackageJsonConstructor
          )()
          await p.load(path)
          return await p.normalize(opts)
        }

        static override async prepare(path: string, opts: unknown) {
          const p = new (
            _EditablePackageJsonClass as EditablePackageJsonConstructor
          )()
          await p.load(path, true)
          return await p.prepare(opts)
        }

        override create(path: string) {
          super.create(path)
          ;(this as unknown as { _path: string })._path = path
          return this
        }

        override async fix(opts: unknown = {}) {
          await super.fix(opts)
          return this
        }

        override fromContent(data: unknown) {
          super.fromContent(data)
          ;(this as unknown as { _canSave: boolean })._canSave = false
          return this
        }

        override fromJSON(data: string): this {
          super.fromJSON(data)
          return this
        }

        override async load(path: string, create?: boolean): Promise<this> {
          this._path = path
          const { promises: fsPromises } = getFs()
          let parseErr: unknown
          try {
            this._readFileContent = await read(this.filename)
          } catch (err) {
            if (!create) {
              throw err
            }
            parseErr = err
          }
          if (parseErr) {
            const nodePath = getPath()
            const indexFile = nodePath.resolve(this.path || '', 'index.js')
            let indexFileContent: string
            try {
              indexFileContent = await fsPromises.readFile(indexFile, 'utf8')
            } catch {
              throw parseErr
            }
            try {
              this.fromContent(indexFileContent)
            } catch {
              throw parseErr
            }
            // This wasn't a package.json so prevent saving
            this._canSave = false
            return this
          }
          this.fromJSON(this._readFileContent)
          // Add AFTER fromJSON is called in case it errors.
          this._readFileJson = parse(this._readFileContent)
          return this
        }

        override async normalize(opts: NormalizeOptions = {}): Promise<this> {
          await super.normalize(opts)
          return this
        }

        get path() {
          return this._path
        }

        override async prepare(opts: unknown = {}): Promise<this> {
          await super.prepare(opts)
          return this
        }

        override async save(options?: SaveOptions): Promise<boolean> {
          if (!this._canSave || this.content === undefined) {
            throw new Error('No package.json to save to')
          }
          const { ignoreWhitespace = false, sort = false } = {
            __proto__: null,
            ...options,
          } as SaveOptions
          const {
            [identSymbol]: indent,
            [newlineSymbol]: newline,
            ...rest
          } = this.content as Record<string | symbol, unknown>
          const content = sort ? packageSort(rest) : rest
          const {
            [identSymbol]: _indent,
            [newlineSymbol]: _newline,
            ...origContent
          } = (this._readFileJson || {}) as Record<string | symbol, unknown>

          if (
            ignoreWhitespace &&
            getUtil().isDeepStrictEqual(content, origContent)
          ) {
            return false
          }

          const format =
            indent === undefined || indent === null
              ? '  '
              : (indent as string | number)
          const eol =
            newline === undefined || newline === null
              ? '\n'
              : (newline as string)
          const fileContent = `${JSON.stringify(
            content,
            undefined,
            format,
          )}\n`.replace(/\n/g, eol)

          if (
            !ignoreWhitespace &&
            fileContent.trim() === this._readFileContent.trim()
          ) {
            return false
          }

          const { promises: fsPromises } = getFs()
          await fsPromises.writeFile(this.filename, fileContent)
          this._readFileContent = fileContent
          this._readFileJson = parse(fileContent)
          return true
        }

        override saveSync(options?: SaveOptions): boolean {
          if (!this._canSave || this.content === undefined) {
            throw new Error('No package.json to save to')
          }
          const { ignoreWhitespace = false, sort = false } = {
            __proto__: null,
            ...options,
          } as SaveOptions
          const {
            [Symbol.for('indent')]: indent,
            [Symbol.for('newline')]: newline,
            ...rest
          } = this.content as Record<string | symbol, unknown>
          const content = sort ? packageSort(rest) : rest

          if (
            ignoreWhitespace &&
            getUtil().isDeepStrictEqual(content, this._readFileJson)
          ) {
            return false
          }

          const format =
            indent === undefined || indent === null
              ? '  '
              : (indent as string | number)
          const eol =
            newline === undefined || newline === null
              ? '\n'
              : (newline as string)
          const fileContent = `${JSON.stringify(
            content,
            undefined,
            format,
          )}\n`.replace(/\n/g, eol)

          if (
            !ignoreWhitespace &&
            fileContent.trim() === this._readFileContent.trim()
          ) {
            return false
          }

          const fs = getFs()
          fs.writeFileSync(this.filename, fileContent)
          this._readFileContent = fileContent
          this._readFileJson = parse(fileContent)
          return true
        }

        override update(content: PackageJson): this {
          super.update(content)
          return this
        }

        override willSave(options?: SaveOptions): boolean {
          const { ignoreWhitespace = false, sort = false } = {
            __proto__: null,
            ...options,
          } as SaveOptions as SaveOptions
          if (!this._canSave || this.content === undefined) {
            return false
          }
          const {
            [Symbol.for('indent')]: indent,
            [Symbol.for('newline')]: newline,
            ...rest
          } = this.content as Record<string | symbol, unknown>
          const content = sort ? packageSort(rest) : rest

          if (
            ignoreWhitespace &&
            getUtil().isDeepStrictEqual(content, this._readFileJson)
          ) {
            return false
          }

          const format =
            indent === undefined || indent === null
              ? '  '
              : (indent as string | number)
          const eol =
            newline === undefined || newline === null
              ? '\n'
              : (newline as string)
          const fileContent = `${JSON.stringify(
            content,
            undefined,
            format,
          )}\n`.replace(/\n/g, eol)

          if (
            !ignoreWhitespace &&
            fileContent.trim() === this._readFileContent.trim()
          ) {
            return false
          }
          return true
        }
      } as EditablePackageJsonConstructor
  }
  return _EditablePackageJsonClass as EditablePackageJsonConstructor
}

/**
 * Convert a package.json object to an editable instance.
 */
/*@__NO_SIDE_EFFECTS__*/
export function pkgJsonToEditable(
  pkgJson: PackageJson,
  options?: EditablePackageJsonOptions,
): unknown {
  const { normalize, ...normalizeOptions } = {
    __proto__: null,
    ...options,
  } as EditablePackageJsonOptions
  const EditablePackageJson = getEditablePackageJsonClass()
  return new EditablePackageJson().fromContent(
    normalize ? normalizePackageJson(pkgJson, normalizeOptions) : pkgJson,
  )
}

/**
 * Convert package.json to editable instance with file persistence.
 */
/*@__NO_SIDE_EFFECTS__*/
export async function toEditablePackageJson(
  pkgJson: PackageJson,
  options?: EditablePackageJsonOptions,
): Promise<unknown> {
  const { path: filepath, ...pkgJsonToEditableOptions } = {
    __proto__: null,
    ...options,
  }
  const { normalize, ...normalizeOptions } = pkgJsonToEditableOptions
  if (typeof filepath !== 'string') {
    return pkgJsonToEditable(pkgJson, pkgJsonToEditableOptions)
  }
  const EditablePackageJson = getEditablePackageJsonClass()
  const pkgJsonPath = resolvePackageJsonDirname(filepath)
  return (
    await EditablePackageJson.load(pkgJsonPath, { create: true })
  ).fromJSON(
    `${JSON.stringify(
      normalize
        ? normalizePackageJson(pkgJson, {
            ...(isNodeModules(pkgJsonPath) ? {} : { preserve: ['repository'] }),
            ...normalizeOptions,
          })
        : pkgJson,
      null,
      2,
    )}\n`,
  )
}

/**
 * Convert package.json to editable instance with file persistence synchronously.
 */
/*@__NO_SIDE_EFFECTS__*/
export function toEditablePackageJsonSync(
  pkgJson: PackageJson,
  options?: EditablePackageJsonOptions,
): unknown {
  const { path: filepath, ...pkgJsonToEditableOptions } = {
    __proto__: null,
    ...options,
  }
  const { normalize, ...normalizeOptions } = pkgJsonToEditableOptions
  if (typeof filepath !== 'string') {
    return pkgJsonToEditable(pkgJson, pkgJsonToEditableOptions)
  }
  const EditablePackageJson = getEditablePackageJsonClass()
  const pkgJsonPath = resolvePackageJsonDirname(filepath)
  return new EditablePackageJson().create(pkgJsonPath).fromJSON(
    `${JSON.stringify(
      normalize
        ? normalizePackageJson(pkgJson, {
            ...(isNodeModules(pkgJsonPath) ? {} : { preserve: ['repository'] }),
            ...normalizeOptions,
          })
        : pkgJson,
      null,
      2,
    )}\n`,
  )
}
