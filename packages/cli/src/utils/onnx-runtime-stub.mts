/**
 * ONNX Runtime Stub - Graceful fallback when WASM unavailable.
 *
 * This module provides a stub implementation of onnxruntime-node API.
 * When the real ONNX Runtime isn't available (no WASM or model files),
 * this stub returns null/undefined gracefully instead of throwing errors.
 *
 * Progressive Enhancement Pattern:
 * 1. Try to load real onnxruntime-node
 * 2. If unavailable, use this stub
 * 3. Consumers check for null and fall back to baseline implementations
 */

/**
 * Stub InferenceSession that always fails to create.
 */
class StubInferenceSession {
  static async create(_modelPath: string): Promise<null> {
    // Stub always returns null - indicates model unavailable.
    return null
  }

  async run(_feeds: Record<string, any>): Promise<Record<string, any>> {
    throw new Error('ONNX Runtime not available')
  }
}

/**
 * Stub Tensor class.
 */
class StubTensor {
  type: string
  data: any
  dims: number[]

  constructor(type: string, data: any, dims: number[]) {
    this.type = type
    this.data = data
    this.dims = dims
  }
}

/**
 * Stub ONNX Runtime module.
 * Matches the API of 'onnxruntime-node' but returns null for all operations.
 */
export const stubOnnxRuntime = {
  InferenceSession: StubInferenceSession,
  Tensor: StubTensor,
}

/**
 * Try to load real ONNX Runtime, fall back to stub if unavailable.
 */
export async function loadOnnxRuntime(): Promise<
  typeof stubOnnxRuntime | null
> {
  try {
    // Try to import real ONNX Runtime.
    // @ts-expect-error - onnxruntime-node is an optional dependency for progressive enhancement.
    const onnx = await import('onnxruntime-node')
    return onnx as any
  } catch {
    // ONNX Runtime not available (no WASM build or dependency missing).
    // Return stub for graceful degradation.
    return stubOnnxRuntime
  }
}

/**
 * Check if real ONNX Runtime is available.
 */
export async function isOnnxRuntimeAvailable(): Promise<boolean> {
  try {
    // @ts-expect-error - onnxruntime-node is an optional dependency for progressive enhancement.
    await import('onnxruntime-node')
    return true
  } catch {
    return false
  }
}
