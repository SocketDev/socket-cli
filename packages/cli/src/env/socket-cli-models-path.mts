/**
 * SOCKET_CLI_MODELS_PATH environment variable snapshot.
 * Specifies the directory containing NLP model files (ONNX models and tokenizers).
 */

import { env } from 'node:process'

export const SOCKET_CLI_MODELS_PATH = env['SOCKET_CLI_MODELS_PATH']
