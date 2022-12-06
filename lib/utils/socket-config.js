import { readFile } from 'node:fs/promises'

import Ajv from 'ajv'
import { ErrorWithCause } from 'pony-cause'
import { parse as yamlParse } from 'yaml'

import { isErrnoException } from './type-helpers.js'

/**
 * @typedef SocketYml
 * @property {2} version
 * @property {string[]} [projectIgnorePaths]
 * @property {{ [issueName: string]: boolean }} [issueRules]
 */

/** @type {import('ajv').JSONSchemaType<SocketYml>} */
const socketYmlSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    version: { type: 'integer' },
    projectIgnorePaths: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
    issueRules: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
      nullable: true,
      required: [],
    },
  },
  required: ['version'],
  additionalProperties: true,
}

/**
 * @param {string} filePath
 * @returns {Promise<SocketYml|undefined>}
 */
export async function readSocketConfig (filePath) {
  /** @type {string} */
  let fileContent

  try {
    fileContent = await readFile(filePath, 'utf8')
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return
    }
    throw new ErrorWithCause('Error when reading socket.yml config file', { cause: err })
  }

  /** @type {unknown} */
  let parsedContent

  try {
    parsedContent = yamlParse(fileContent)
  } catch (err) {
    throw new ErrorWithCause('Error when parsing socket.yml config', { cause: err })
  }
  if ((new Ajv()).validate(socketYmlSchema, parsedContent)) {
    return parsedContent
  }
}
