var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/onnxruntime-web@1.23.0/node_modules/onnxruntime-web/dist/ort.node.min.mjs
var ort_node_min_exports = {};
__export(ort_node_min_exports, {
  InferenceSession: () => InferenceSession2,
  TRACE: () => TRACE,
  TRACE_EVENT_BEGIN: () => TRACE_EVENT_BEGIN,
  TRACE_EVENT_END: () => TRACE_EVENT_END,
  TRACE_FUNC_BEGIN: () => TRACE_FUNC_BEGIN,
  TRACE_FUNC_END: () => TRACE_FUNC_END,
  Tensor: () => Tensor2,
  default: () => zr,
  env: () => env2,
  registerBackend: () => registerBackend
});
module.exports = __toCommonJS(ort_node_min_exports);
var import_module = require("module");

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  InferenceSession: () => InferenceSession2,
  TRACE: () => TRACE,
  TRACE_EVENT_BEGIN: () => TRACE_EVENT_BEGIN,
  TRACE_EVENT_END: () => TRACE_EVENT_END,
  TRACE_FUNC_BEGIN: () => TRACE_FUNC_BEGIN,
  TRACE_FUNC_END: () => TRACE_FUNC_END,
  Tensor: () => Tensor2,
  env: () => env2,
  registerBackend: () => registerBackend
});

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/backend-impl.js
var backends = /* @__PURE__ */ new Map();
var backendsSortedByPriority = [];
var registerBackend = (name, backend, priority) => {
  if (backend && typeof backend.init === "function" && typeof backend.createInferenceSessionHandler === "function") {
    const currentBackend = backends.get(name);
    if (currentBackend === void 0) {
      backends.set(name, { backend, priority });
    } else if (currentBackend.priority > priority) {
      return;
    } else if (currentBackend.priority === priority) {
      if (currentBackend.backend !== backend) {
        throw new Error(`cannot register backend "${name}" using priority ${priority}`);
      }
    }
    if (priority >= 0) {
      const i = backendsSortedByPriority.indexOf(name);
      if (i !== -1) {
        backendsSortedByPriority.splice(i, 1);
      }
      for (let i2 = 0; i2 < backendsSortedByPriority.length; i2++) {
        if (backends.get(backendsSortedByPriority[i2]).priority <= priority) {
          backendsSortedByPriority.splice(i2, 0, name);
          return;
        }
      }
      backendsSortedByPriority.push(name);
    }
    return;
  }
  throw new TypeError("not a valid backend");
};
var tryResolveAndInitializeBackend = async (backendName) => {
  const backendInfo = backends.get(backendName);
  if (!backendInfo) {
    return "backend not found.";
  }
  if (backendInfo.initialized) {
    return backendInfo.backend;
  } else if (backendInfo.aborted) {
    return backendInfo.error;
  } else {
    const isInitializing = !!backendInfo.initPromise;
    try {
      if (!isInitializing) {
        backendInfo.initPromise = backendInfo.backend.init(backendName);
      }
      await backendInfo.initPromise;
      backendInfo.initialized = true;
      return backendInfo.backend;
    } catch (e) {
      if (!isInitializing) {
        backendInfo.error = `${e}`;
        backendInfo.aborted = true;
      }
      return backendInfo.error;
    } finally {
      delete backendInfo.initPromise;
    }
  }
};
var resolveBackendAndExecutionProviders = async (options) => {
  const eps = options.executionProviders || [];
  const backendHints = eps.map((i) => typeof i === "string" ? i : i.name);
  const backendNames = backendHints.length === 0 ? backendsSortedByPriority : backendHints;
  let backend;
  const errors = [];
  const availableBackendNames = /* @__PURE__ */ new Set();
  for (const backendName of backendNames) {
    const resolveResult = await tryResolveAndInitializeBackend(backendName);
    if (typeof resolveResult === "string") {
      errors.push({ name: backendName, err: resolveResult });
    } else {
      if (!backend) {
        backend = resolveResult;
      }
      if (backend === resolveResult) {
        availableBackendNames.add(backendName);
      }
    }
  }
  if (!backend) {
    throw new Error(`no available backend found. ERR: ${errors.map((e) => `[${e.name}] ${e.err}`).join(", ")}`);
  }
  for (const { name, err } of errors) {
    if (backendHints.includes(name)) {
      console.warn(`removing requested execution provider "${name}" from session options because it is not available: ${err}`);
    }
  }
  const filteredEps = eps.filter((i) => availableBackendNames.has(typeof i === "string" ? i : i.name));
  return [
    backend,
    new Proxy(options, {
      get: (target, prop) => {
        if (prop === "executionProviders") {
          return filteredEps;
        }
        return Reflect.get(target, prop);
      }
    })
  ];
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/version.js
var version = "1.23.0";

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/env-impl.js
var logLevelValue = "warning";
var env = {
  wasm: {},
  webgl: {},
  webgpu: {},
  versions: { common: version },
  set logLevel(value) {
    if (value === void 0) {
      return;
    }
    if (typeof value !== "string" || ["verbose", "info", "warning", "error", "fatal"].indexOf(value) === -1) {
      throw new Error(`Unsupported logging level: ${value}`);
    }
    logLevelValue = value;
  },
  get logLevel() {
    return logLevelValue;
  }
};
Object.defineProperty(env, "logLevel", { enumerable: true });

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/env.js
var env2 = env;

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor-conversion-impl.js
var tensorToDataURL = (tensor, options) => {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
  canvas.width = tensor.dims[3];
  canvas.height = tensor.dims[2];
  const pixels2DContext = canvas.getContext("2d");
  if (pixels2DContext != null) {
    let width;
    let height;
    if (options?.tensorLayout !== void 0 && options.tensorLayout === "NHWC") {
      width = tensor.dims[2];
      height = tensor.dims[3];
    } else {
      width = tensor.dims[3];
      height = tensor.dims[2];
    }
    const inputformat = options?.format !== void 0 ? options.format : "RGB";
    const norm = options?.norm;
    let normMean;
    let normBias;
    if (norm === void 0 || norm.mean === void 0) {
      normMean = [255, 255, 255, 255];
    } else {
      if (typeof norm.mean === "number") {
        normMean = [norm.mean, norm.mean, norm.mean, norm.mean];
      } else {
        normMean = [norm.mean[0], norm.mean[1], norm.mean[2], 0];
        if (norm.mean[3] !== void 0) {
          normMean[3] = norm.mean[3];
        }
      }
    }
    if (norm === void 0 || norm.bias === void 0) {
      normBias = [0, 0, 0, 0];
    } else {
      if (typeof norm.bias === "number") {
        normBias = [norm.bias, norm.bias, norm.bias, norm.bias];
      } else {
        normBias = [norm.bias[0], norm.bias[1], norm.bias[2], 0];
        if (norm.bias[3] !== void 0) {
          normBias[3] = norm.bias[3];
        }
      }
    }
    const stride = height * width;
    let rTensorPointer = 0, gTensorPointer = stride, bTensorPointer = stride * 2, aTensorPointer = -1;
    if (inputformat === "RGBA") {
      rTensorPointer = 0;
      gTensorPointer = stride;
      bTensorPointer = stride * 2;
      aTensorPointer = stride * 3;
    } else if (inputformat === "RGB") {
      rTensorPointer = 0;
      gTensorPointer = stride;
      bTensorPointer = stride * 2;
    } else if (inputformat === "RBG") {
      rTensorPointer = 0;
      bTensorPointer = stride;
      gTensorPointer = stride * 2;
    }
    for (let i = 0; i < height; i++) {
      for (let j2 = 0; j2 < width; j2++) {
        const R = (tensor.data[rTensorPointer++] - normBias[0]) * normMean[0];
        const G = (tensor.data[gTensorPointer++] - normBias[1]) * normMean[1];
        const B = (tensor.data[bTensorPointer++] - normBias[2]) * normMean[2];
        const A2 = aTensorPointer === -1 ? 255 : (tensor.data[aTensorPointer++] - normBias[3]) * normMean[3];
        pixels2DContext.fillStyle = "rgba(" + R + "," + G + "," + B + "," + A2 + ")";
        pixels2DContext.fillRect(j2, i, 1, 1);
      }
    }
    if ("toDataURL" in canvas) {
      return canvas.toDataURL();
    } else {
      throw new Error("toDataURL is not supported");
    }
  } else {
    throw new Error("Can not access image data");
  }
};
var tensorToImageData = (tensor, options) => {
  const pixels2DContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d");
  let image;
  if (pixels2DContext != null) {
    let width;
    let height;
    let channels;
    if (options?.tensorLayout !== void 0 && options.tensorLayout === "NHWC") {
      width = tensor.dims[2];
      height = tensor.dims[1];
      channels = tensor.dims[3];
    } else {
      width = tensor.dims[3];
      height = tensor.dims[2];
      channels = tensor.dims[1];
    }
    const inputformat = options !== void 0 ? options.format !== void 0 ? options.format : "RGB" : "RGB";
    const norm = options?.norm;
    let normMean;
    let normBias;
    if (norm === void 0 || norm.mean === void 0) {
      normMean = [255, 255, 255, 255];
    } else {
      if (typeof norm.mean === "number") {
        normMean = [norm.mean, norm.mean, norm.mean, norm.mean];
      } else {
        normMean = [norm.mean[0], norm.mean[1], norm.mean[2], 255];
        if (norm.mean[3] !== void 0) {
          normMean[3] = norm.mean[3];
        }
      }
    }
    if (norm === void 0 || norm.bias === void 0) {
      normBias = [0, 0, 0, 0];
    } else {
      if (typeof norm.bias === "number") {
        normBias = [norm.bias, norm.bias, norm.bias, norm.bias];
      } else {
        normBias = [norm.bias[0], norm.bias[1], norm.bias[2], 0];
        if (norm.bias[3] !== void 0) {
          normBias[3] = norm.bias[3];
        }
      }
    }
    const stride = height * width;
    if (options !== void 0) {
      if (options.format !== void 0 && channels === 4 && options.format !== "RGBA" || channels === 3 && options.format !== "RGB" && options.format !== "BGR") {
        throw new Error("Tensor format doesn't match input tensor dims");
      }
    }
    const step = 4;
    let rImagePointer = 0, gImagePointer = 1, bImagePointer = 2, aImagePointer = 3;
    let rTensorPointer = 0, gTensorPointer = stride, bTensorPointer = stride * 2, aTensorPointer = -1;
    if (inputformat === "RGBA") {
      rTensorPointer = 0;
      gTensorPointer = stride;
      bTensorPointer = stride * 2;
      aTensorPointer = stride * 3;
    } else if (inputformat === "RGB") {
      rTensorPointer = 0;
      gTensorPointer = stride;
      bTensorPointer = stride * 2;
    } else if (inputformat === "RBG") {
      rTensorPointer = 0;
      bTensorPointer = stride;
      gTensorPointer = stride * 2;
    }
    image = pixels2DContext.createImageData(width, height);
    for (let i = 0; i < height * width; rImagePointer += step, gImagePointer += step, bImagePointer += step, aImagePointer += step, i++) {
      image.data[rImagePointer] = (tensor.data[rTensorPointer++] - normBias[0]) * normMean[0];
      image.data[gImagePointer] = (tensor.data[gTensorPointer++] - normBias[1]) * normMean[1];
      image.data[bImagePointer] = (tensor.data[bTensorPointer++] - normBias[2]) * normMean[2];
      image.data[aImagePointer] = aTensorPointer === -1 ? 255 : (tensor.data[aTensorPointer++] - normBias[3]) * normMean[3];
    }
  } else {
    throw new Error("Can not access image data");
  }
  return image;
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor-factory-impl.js
var bufferToTensor = (buffer, options) => {
  if (buffer === void 0) {
    throw new Error("Image buffer must be defined");
  }
  if (options.height === void 0 || options.width === void 0) {
    throw new Error("Image height and width must be defined");
  }
  if (options.tensorLayout === "NHWC") {
    throw new Error("NHWC Tensor layout is not supported yet");
  }
  const { height, width } = options;
  const norm = options.norm ?? { mean: 255, bias: 0 };
  let normMean;
  let normBias;
  if (typeof norm.mean === "number") {
    normMean = [norm.mean, norm.mean, norm.mean, norm.mean];
  } else {
    normMean = [norm.mean[0], norm.mean[1], norm.mean[2], norm.mean[3] ?? 255];
  }
  if (typeof norm.bias === "number") {
    normBias = [norm.bias, norm.bias, norm.bias, norm.bias];
  } else {
    normBias = [norm.bias[0], norm.bias[1], norm.bias[2], norm.bias[3] ?? 0];
  }
  const inputformat = options.format !== void 0 ? options.format : "RGBA";
  const outputformat = options.tensorFormat !== void 0 ? options.tensorFormat !== void 0 ? options.tensorFormat : "RGB" : "RGB";
  const stride = height * width;
  const float32Data = outputformat === "RGBA" ? new Float32Array(stride * 4) : new Float32Array(stride * 3);
  let step = 4, rImagePointer = 0, gImagePointer = 1, bImagePointer = 2, aImagePointer = 3;
  let rTensorPointer = 0, gTensorPointer = stride, bTensorPointer = stride * 2, aTensorPointer = -1;
  if (inputformat === "RGB") {
    step = 3;
    rImagePointer = 0;
    gImagePointer = 1;
    bImagePointer = 2;
    aImagePointer = -1;
  }
  if (outputformat === "RGBA") {
    aTensorPointer = stride * 3;
  } else if (outputformat === "RBG") {
    rTensorPointer = 0;
    bTensorPointer = stride;
    gTensorPointer = stride * 2;
  } else if (outputformat === "BGR") {
    bTensorPointer = 0;
    gTensorPointer = stride;
    rTensorPointer = stride * 2;
  }
  for (let i = 0; i < stride; i++, rImagePointer += step, bImagePointer += step, gImagePointer += step, aImagePointer += step) {
    float32Data[rTensorPointer++] = (buffer[rImagePointer] + normBias[0]) / normMean[0];
    float32Data[gTensorPointer++] = (buffer[gImagePointer] + normBias[1]) / normMean[1];
    float32Data[bTensorPointer++] = (buffer[bImagePointer] + normBias[2]) / normMean[2];
    if (aTensorPointer !== -1 && aImagePointer !== -1) {
      float32Data[aTensorPointer++] = (buffer[aImagePointer] + normBias[3]) / normMean[3];
    }
  }
  const outputTensor = outputformat === "RGBA" ? new Tensor("float32", float32Data, [1, 4, height, width]) : new Tensor("float32", float32Data, [1, 3, height, width]);
  return outputTensor;
};
var tensorFromImage = async (image, options) => {
  const isHTMLImageEle = typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement;
  const isImageDataEle = typeof ImageData !== "undefined" && image instanceof ImageData;
  const isImageBitmap = typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
  const isString = typeof image === "string";
  let data;
  let bufferToTensorOptions = options ?? {};
  const createCanvas = () => {
    if (typeof document !== "undefined") {
      return document.createElement("canvas");
    } else if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(1, 1);
    } else {
      throw new Error("Canvas is not supported");
    }
  };
  const createCanvasContext = (canvas) => {
    if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
      return canvas.getContext("2d");
    } else if (canvas instanceof OffscreenCanvas) {
      return canvas.getContext("2d");
    } else {
      return null;
    }
  };
  if (isHTMLImageEle) {
    const canvas = createCanvas();
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels2DContext = createCanvasContext(canvas);
    if (pixels2DContext != null) {
      let height = image.height;
      let width = image.width;
      if (options !== void 0 && options.resizedHeight !== void 0 && options.resizedWidth !== void 0) {
        height = options.resizedHeight;
        width = options.resizedWidth;
      }
      if (options !== void 0) {
        bufferToTensorOptions = options;
        if (options.tensorFormat !== void 0) {
          throw new Error("Image input config format must be RGBA for HTMLImageElement");
        } else {
          bufferToTensorOptions.tensorFormat = "RGBA";
        }
        bufferToTensorOptions.height = height;
        bufferToTensorOptions.width = width;
      } else {
        bufferToTensorOptions.tensorFormat = "RGBA";
        bufferToTensorOptions.height = height;
        bufferToTensorOptions.width = width;
      }
      pixels2DContext.drawImage(image, 0, 0);
      data = pixels2DContext.getImageData(0, 0, width, height).data;
    } else {
      throw new Error("Can not access image data");
    }
  } else if (isImageDataEle) {
    let height;
    let width;
    if (options !== void 0 && options.resizedWidth !== void 0 && options.resizedHeight !== void 0) {
      height = options.resizedHeight;
      width = options.resizedWidth;
    } else {
      height = image.height;
      width = image.width;
    }
    if (options !== void 0) {
      bufferToTensorOptions = options;
    }
    bufferToTensorOptions.format = "RGBA";
    bufferToTensorOptions.height = height;
    bufferToTensorOptions.width = width;
    if (options !== void 0) {
      const tempCanvas = createCanvas();
      tempCanvas.width = width;
      tempCanvas.height = height;
      const pixels2DContext = createCanvasContext(tempCanvas);
      if (pixels2DContext != null) {
        pixels2DContext.putImageData(image, 0, 0);
        data = pixels2DContext.getImageData(0, 0, width, height).data;
      } else {
        throw new Error("Can not access image data");
      }
    } else {
      data = image.data;
    }
  } else if (isImageBitmap) {
    if (options === void 0) {
      throw new Error("Please provide image config with format for Imagebitmap");
    }
    const canvas = createCanvas();
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels2DContext = createCanvasContext(canvas);
    if (pixels2DContext != null) {
      const height = image.height;
      const width = image.width;
      pixels2DContext.drawImage(image, 0, 0, width, height);
      data = pixels2DContext.getImageData(0, 0, width, height).data;
      bufferToTensorOptions.height = height;
      bufferToTensorOptions.width = width;
      return bufferToTensor(data, bufferToTensorOptions);
    } else {
      throw new Error("Can not access image data");
    }
  } else if (isString) {
    return new Promise((resolve, reject) => {
      const canvas = createCanvas();
      const context = createCanvasContext(canvas);
      if (!image || !context) {
        return reject();
      }
      const newImage = new Image();
      newImage.crossOrigin = "Anonymous";
      newImage.src = image;
      newImage.onload = () => {
        canvas.width = newImage.width;
        canvas.height = newImage.height;
        context.drawImage(newImage, 0, 0, canvas.width, canvas.height);
        const img = context.getImageData(0, 0, canvas.width, canvas.height);
        bufferToTensorOptions.height = canvas.height;
        bufferToTensorOptions.width = canvas.width;
        resolve(bufferToTensor(img.data, bufferToTensorOptions));
      };
    });
  } else {
    throw new Error("Input data provided is not supported - aborted tensor creation");
  }
  if (data !== void 0) {
    return bufferToTensor(data, bufferToTensorOptions);
  } else {
    throw new Error("Input data provided is not supported - aborted tensor creation");
  }
};
var tensorFromTexture = (texture, options) => {
  const { width, height, download, dispose } = options;
  const dims = [1, height, width, 4];
  return new Tensor({ location: "texture", type: "float32", texture, dims, download, dispose });
};
var tensorFromGpuBuffer = (gpuBuffer, options) => {
  const { dataType, dims, download, dispose } = options;
  return new Tensor({ location: "gpu-buffer", type: dataType ?? "float32", gpuBuffer, dims, download, dispose });
};
var tensorFromMLTensor = (mlTensor, options) => {
  const { dataType, dims, download, dispose } = options;
  return new Tensor({ location: "ml-tensor", type: dataType ?? "float32", mlTensor, dims, download, dispose });
};
var tensorFromPinnedBuffer = (type, buffer, dims) => new Tensor({ location: "cpu-pinned", type, data: buffer, dims: dims ?? [buffer.length] });

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor-impl-type-mapping.js
var NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP = /* @__PURE__ */ new Map([
  ["float32", Float32Array],
  ["uint8", Uint8Array],
  ["int8", Int8Array],
  ["uint16", Uint16Array],
  ["int16", Int16Array],
  ["int32", Int32Array],
  ["bool", Uint8Array],
  ["float64", Float64Array],
  ["uint32", Uint32Array],
  ["int4", Uint8Array],
  ["uint4", Uint8Array]
]);
var NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP = /* @__PURE__ */ new Map([
  [Float32Array, "float32"],
  [Uint8Array, "uint8"],
  [Int8Array, "int8"],
  [Uint16Array, "uint16"],
  [Int16Array, "int16"],
  [Int32Array, "int32"],
  [Float64Array, "float64"],
  [Uint32Array, "uint32"]
]);
var isTypedArrayChecked = false;
var checkTypedArray = () => {
  if (!isTypedArrayChecked) {
    isTypedArrayChecked = true;
    const isBigInt64ArrayAvailable = typeof BigInt64Array !== "undefined" && BigInt64Array.from;
    const isBigUint64ArrayAvailable = typeof BigUint64Array !== "undefined" && BigUint64Array.from;
    const Float16Array2 = globalThis.Float16Array;
    const isFloat16ArrayAvailable = typeof Float16Array2 !== "undefined" && Float16Array2.from;
    if (isBigInt64ArrayAvailable) {
      NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("int64", BigInt64Array);
      NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(BigInt64Array, "int64");
    }
    if (isBigUint64ArrayAvailable) {
      NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("uint64", BigUint64Array);
      NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(BigUint64Array, "uint64");
    }
    if (isFloat16ArrayAvailable) {
      NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("float16", Float16Array2);
      NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(Float16Array2, "float16");
    } else {
      NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("float16", Uint16Array);
    }
  }
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor-utils-impl.js
var calculateSize = (dims) => {
  let size = 1;
  for (let i = 0; i < dims.length; i++) {
    const dim = dims[i];
    if (typeof dim !== "number" || !Number.isSafeInteger(dim)) {
      throw new TypeError(`dims[${i}] must be an integer, got: ${dim}`);
    }
    if (dim < 0) {
      throw new RangeError(`dims[${i}] must be a non-negative integer, got: ${dim}`);
    }
    size *= dim;
  }
  return size;
};
var tensorReshape = (tensor, dims) => {
  switch (tensor.location) {
    case "cpu":
      return new Tensor(tensor.type, tensor.data, dims);
    case "cpu-pinned":
      return new Tensor({
        location: "cpu-pinned",
        data: tensor.data,
        type: tensor.type,
        dims
      });
    case "texture":
      return new Tensor({
        location: "texture",
        texture: tensor.texture,
        type: tensor.type,
        dims
      });
    case "gpu-buffer":
      return new Tensor({
        location: "gpu-buffer",
        gpuBuffer: tensor.gpuBuffer,
        type: tensor.type,
        dims
      });
    case "ml-tensor":
      return new Tensor({
        location: "ml-tensor",
        mlTensor: tensor.mlTensor,
        type: tensor.type,
        dims
      });
    default:
      throw new Error(`tensorReshape: tensor location ${tensor.location} is not supported`);
  }
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor-impl.js
var Tensor = class {
  /**
   * implementation.
   */
  constructor(arg0, arg1, arg2) {
    checkTypedArray();
    let type;
    let dims;
    if (typeof arg0 === "object" && "location" in arg0) {
      this.dataLocation = arg0.location;
      type = arg0.type;
      dims = arg0.dims;
      switch (arg0.location) {
        case "cpu-pinned": {
          const expectedTypedArrayConstructor = NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.get(type);
          if (!expectedTypedArrayConstructor) {
            throw new TypeError(`unsupported type "${type}" to create tensor from pinned buffer`);
          }
          if (!(arg0.data instanceof expectedTypedArrayConstructor)) {
            throw new TypeError(`buffer should be of type ${expectedTypedArrayConstructor.name}`);
          }
          this.cpuData = arg0.data;
          break;
        }
        case "texture": {
          if (type !== "float32") {
            throw new TypeError(`unsupported type "${type}" to create tensor from texture`);
          }
          this.gpuTextureData = arg0.texture;
          this.downloader = arg0.download;
          this.disposer = arg0.dispose;
          break;
        }
        case "gpu-buffer": {
          if (type !== "float32" && type !== "float16" && type !== "int32" && type !== "int64" && type !== "uint32" && type !== "uint8" && type !== "bool" && type !== "uint4" && type !== "int4") {
            throw new TypeError(`unsupported type "${type}" to create tensor from gpu buffer`);
          }
          this.gpuBufferData = arg0.gpuBuffer;
          this.downloader = arg0.download;
          this.disposer = arg0.dispose;
          break;
        }
        case "ml-tensor": {
          if (type !== "float32" && type !== "float16" && type !== "int32" && type !== "int64" && type !== "uint32" && type !== "uint64" && type !== "int8" && type !== "uint8" && type !== "bool" && type !== "uint4" && type !== "int4") {
            throw new TypeError(`unsupported type "${type}" to create tensor from MLTensor`);
          }
          this.mlTensorData = arg0.mlTensor;
          this.downloader = arg0.download;
          this.disposer = arg0.dispose;
          break;
        }
        default:
          throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
      }
    } else {
      let data;
      let maybeDims;
      if (typeof arg0 === "string") {
        type = arg0;
        maybeDims = arg2;
        if (arg0 === "string") {
          if (!Array.isArray(arg1)) {
            throw new TypeError("A string tensor's data must be a string array.");
          }
          data = arg1;
        } else {
          const typedArrayConstructor = NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.get(arg0);
          if (typedArrayConstructor === void 0) {
            throw new TypeError(`Unsupported tensor type: ${arg0}.`);
          }
          if (Array.isArray(arg1)) {
            if (arg0 === "float16" && typedArrayConstructor === Uint16Array || arg0 === "uint4" || arg0 === "int4") {
              throw new TypeError(`Creating a ${arg0} tensor from number array is not supported. Please use ${typedArrayConstructor.name} as data.`);
            } else if (arg0 === "uint64" || arg0 === "int64") {
              data = typedArrayConstructor.from(arg1, BigInt);
            } else {
              data = typedArrayConstructor.from(arg1);
            }
          } else if (arg1 instanceof typedArrayConstructor) {
            data = arg1;
          } else if (arg1 instanceof Uint8ClampedArray) {
            if (arg0 === "uint8") {
              data = Uint8Array.from(arg1);
            } else {
              throw new TypeError(`A Uint8ClampedArray tensor's data must be type of uint8`);
            }
          } else if (arg0 === "float16" && arg1 instanceof Uint16Array && typedArrayConstructor !== Uint16Array) {
            data = new globalThis.Float16Array(arg1.buffer, arg1.byteOffset, arg1.length);
          } else {
            throw new TypeError(`A ${type} tensor's data must be type of ${typedArrayConstructor}`);
          }
        }
      } else {
        maybeDims = arg1;
        if (Array.isArray(arg0)) {
          if (arg0.length === 0) {
            throw new TypeError("Tensor type cannot be inferred from an empty array.");
          }
          const firstElementType = typeof arg0[0];
          if (firstElementType === "string") {
            type = "string";
            data = arg0;
          } else if (firstElementType === "boolean") {
            type = "bool";
            data = Uint8Array.from(arg0);
          } else {
            throw new TypeError(`Invalid element type of data array: ${firstElementType}.`);
          }
        } else if (arg0 instanceof Uint8ClampedArray) {
          type = "uint8";
          data = Uint8Array.from(arg0);
        } else {
          const mappedType = NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.get(arg0.constructor);
          if (mappedType === void 0) {
            throw new TypeError(`Unsupported type for tensor data: ${arg0.constructor}.`);
          }
          type = mappedType;
          data = arg0;
        }
      }
      if (maybeDims === void 0) {
        maybeDims = [data.length];
      } else if (!Array.isArray(maybeDims)) {
        throw new TypeError("A tensor's dims must be a number array");
      }
      dims = maybeDims;
      this.cpuData = data;
      this.dataLocation = "cpu";
    }
    const size = calculateSize(dims);
    if (this.cpuData && size !== this.cpuData.length) {
      if ((type === "uint4" || type === "int4") && Math.ceil(size / 2) === this.cpuData.length) {
      } else {
        throw new Error(`Tensor's size(${size}) does not match data length(${this.cpuData.length}).`);
      }
    }
    this.type = type;
    this.dims = dims;
    this.size = size;
  }
  // #endregion
  // #region factory
  static async fromImage(image, options) {
    return tensorFromImage(image, options);
  }
  static fromTexture(texture, options) {
    return tensorFromTexture(texture, options);
  }
  static fromGpuBuffer(gpuBuffer, options) {
    return tensorFromGpuBuffer(gpuBuffer, options);
  }
  static fromMLTensor(mlTensor, options) {
    return tensorFromMLTensor(mlTensor, options);
  }
  static fromPinnedBuffer(type, buffer, dims) {
    return tensorFromPinnedBuffer(type, buffer, dims);
  }
  // #endregion
  // #region conversions
  toDataURL(options) {
    return tensorToDataURL(this, options);
  }
  toImageData(options) {
    return tensorToImageData(this, options);
  }
  // #endregion
  // #region properties
  get data() {
    this.ensureValid();
    if (!this.cpuData) {
      throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
    }
    return this.cpuData;
  }
  get location() {
    return this.dataLocation;
  }
  get texture() {
    this.ensureValid();
    if (!this.gpuTextureData) {
      throw new Error("The data is not stored as a WebGL texture.");
    }
    return this.gpuTextureData;
  }
  get gpuBuffer() {
    this.ensureValid();
    if (!this.gpuBufferData) {
      throw new Error("The data is not stored as a WebGPU buffer.");
    }
    return this.gpuBufferData;
  }
  get mlTensor() {
    this.ensureValid();
    if (!this.mlTensorData) {
      throw new Error("The data is not stored as a WebNN MLTensor.");
    }
    return this.mlTensorData;
  }
  // #endregion
  // #region methods
  async getData(releaseData) {
    this.ensureValid();
    switch (this.dataLocation) {
      case "cpu":
      case "cpu-pinned":
        return this.data;
      case "texture":
      case "gpu-buffer":
      case "ml-tensor": {
        if (!this.downloader) {
          throw new Error("The current tensor is not created with a specified data downloader.");
        }
        if (this.isDownloading) {
          throw new Error("The current tensor is being downloaded.");
        }
        try {
          this.isDownloading = true;
          const data = await this.downloader();
          this.downloader = void 0;
          this.dataLocation = "cpu";
          this.cpuData = data;
          if (releaseData && this.disposer) {
            this.disposer();
            this.disposer = void 0;
          }
          return data;
        } finally {
          this.isDownloading = false;
        }
      }
      default:
        throw new Error(`cannot get data from location: ${this.dataLocation}`);
    }
  }
  dispose() {
    if (this.isDownloading) {
      throw new Error("The current tensor is being downloaded.");
    }
    if (this.disposer) {
      this.disposer();
      this.disposer = void 0;
    }
    this.cpuData = void 0;
    this.gpuTextureData = void 0;
    this.gpuBufferData = void 0;
    this.mlTensorData = void 0;
    this.downloader = void 0;
    this.isDownloading = void 0;
    this.dataLocation = "none";
  }
  // #endregion
  // #region tensor utilities
  ensureValid() {
    if (this.dataLocation === "none") {
      throw new Error("The tensor is disposed.");
    }
  }
  reshape(dims) {
    this.ensureValid();
    if (this.downloader || this.disposer) {
      throw new Error("Cannot reshape a tensor that owns GPU resource.");
    }
    return tensorReshape(this, dims);
  }
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/tensor.js
var Tensor2 = Tensor;

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/trace.js
var TRACE = (deviceType, label) => {
  if (typeof env.trace === "undefined" ? !env.wasm.trace : !env.trace) {
    return;
  }
  console.timeStamp(`${deviceType}::ORT::${label}`);
};
var TRACE_FUNC = (msg, extraMsg) => {
  const stack = new Error().stack?.split(/\r\n|\r|\n/g) || [];
  let hasTraceFunc = false;
  for (let i = 0; i < stack.length; i++) {
    if (hasTraceFunc && !stack[i].includes("TRACE_FUNC")) {
      let label = `FUNC_${msg}::${stack[i].trim().split(" ")[1]}`;
      if (extraMsg) {
        label += `::${extraMsg}`;
      }
      TRACE("CPU", label);
      return;
    }
    if (stack[i].includes("TRACE_FUNC")) {
      hasTraceFunc = true;
    }
  }
};
var TRACE_FUNC_BEGIN = (extraMsg) => {
  if (typeof env.trace === "undefined" ? !env.wasm.trace : !env.trace) {
    return;
  }
  TRACE_FUNC("BEGIN", extraMsg);
};
var TRACE_FUNC_END = (extraMsg) => {
  if (typeof env.trace === "undefined" ? !env.wasm.trace : !env.trace) {
    return;
  }
  TRACE_FUNC("END", extraMsg);
};
var TRACE_EVENT_BEGIN = (extraMsg) => {
  if (typeof env.trace === "undefined" ? !env.wasm.trace : !env.trace) {
    return;
  }
  console.time(`ORT::${extraMsg}`);
};
var TRACE_EVENT_END = (extraMsg) => {
  if (typeof env.trace === "undefined" ? !env.wasm.trace : !env.trace) {
    return;
  }
  console.timeEnd(`ORT::${extraMsg}`);
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/inference-session-impl.js
var InferenceSession = class _InferenceSession {
  constructor(handler) {
    this.handler = handler;
  }
  async run(feeds, arg1, arg2) {
    TRACE_FUNC_BEGIN();
    TRACE_EVENT_BEGIN("InferenceSession.run");
    const fetches = {};
    let options = {};
    if (typeof feeds !== "object" || feeds === null || feeds instanceof Tensor2 || Array.isArray(feeds)) {
      throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
    }
    let isFetchesEmpty = true;
    if (typeof arg1 === "object") {
      if (arg1 === null) {
        throw new TypeError("Unexpected argument[1]: cannot be null.");
      }
      if (arg1 instanceof Tensor2) {
        throw new TypeError("'fetches' cannot be a Tensor");
      }
      if (Array.isArray(arg1)) {
        if (arg1.length === 0) {
          throw new TypeError("'fetches' cannot be an empty array.");
        }
        isFetchesEmpty = false;
        for (const name of arg1) {
          if (typeof name !== "string") {
            throw new TypeError("'fetches' must be a string array or an object.");
          }
          if (this.outputNames.indexOf(name) === -1) {
            throw new RangeError(`'fetches' contains invalid output name: ${name}.`);
          }
          fetches[name] = null;
        }
        if (typeof arg2 === "object" && arg2 !== null) {
          options = arg2;
        } else if (typeof arg2 !== "undefined") {
          throw new TypeError("'options' must be an object.");
        }
      } else {
        let isFetches = false;
        const arg1Keys = Object.getOwnPropertyNames(arg1);
        for (const name of this.outputNames) {
          if (arg1Keys.indexOf(name) !== -1) {
            const v = arg1[name];
            if (v === null || v instanceof Tensor2) {
              isFetches = true;
              isFetchesEmpty = false;
              fetches[name] = v;
            }
          }
        }
        if (isFetches) {
          if (typeof arg2 === "object" && arg2 !== null) {
            options = arg2;
          } else if (typeof arg2 !== "undefined") {
            throw new TypeError("'options' must be an object.");
          }
        } else {
          options = arg1;
        }
      }
    } else if (typeof arg1 !== "undefined") {
      throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
    }
    for (const name of this.inputNames) {
      if (typeof feeds[name] === "undefined") {
        throw new Error(`input '${name}' is missing in 'feeds'.`);
      }
    }
    if (isFetchesEmpty) {
      for (const name of this.outputNames) {
        fetches[name] = null;
      }
    }
    const results = await this.handler.run(feeds, fetches, options);
    const returnValue = {};
    for (const key in results) {
      if (Object.hasOwnProperty.call(results, key)) {
        const result = results[key];
        if (result instanceof Tensor2) {
          returnValue[key] = result;
        } else {
          returnValue[key] = new Tensor2(result.type, result.data, result.dims);
        }
      }
    }
    TRACE_EVENT_END("InferenceSession.run");
    TRACE_FUNC_END();
    return returnValue;
  }
  async release() {
    return this.handler.dispose();
  }
  static async create(arg0, arg1, arg2, arg3) {
    TRACE_FUNC_BEGIN();
    TRACE_EVENT_BEGIN("InferenceSession.create");
    let filePathOrUint8Array;
    let options = {};
    if (typeof arg0 === "string") {
      filePathOrUint8Array = arg0;
      if (typeof arg1 === "object" && arg1 !== null) {
        options = arg1;
      } else if (typeof arg1 !== "undefined") {
        throw new TypeError("'options' must be an object.");
      }
    } else if (arg0 instanceof Uint8Array) {
      filePathOrUint8Array = arg0;
      if (typeof arg1 === "object" && arg1 !== null) {
        options = arg1;
      } else if (typeof arg1 !== "undefined") {
        throw new TypeError("'options' must be an object.");
      }
    } else if (arg0 instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && arg0 instanceof SharedArrayBuffer) {
      const buffer = arg0;
      let byteOffset = 0;
      let byteLength = arg0.byteLength;
      if (typeof arg1 === "object" && arg1 !== null) {
        options = arg1;
      } else if (typeof arg1 === "number") {
        byteOffset = arg1;
        if (!Number.isSafeInteger(byteOffset)) {
          throw new RangeError("'byteOffset' must be an integer.");
        }
        if (byteOffset < 0 || byteOffset >= buffer.byteLength) {
          throw new RangeError(`'byteOffset' is out of range [0, ${buffer.byteLength}).`);
        }
        byteLength = arg0.byteLength - byteOffset;
        if (typeof arg2 === "number") {
          byteLength = arg2;
          if (!Number.isSafeInteger(byteLength)) {
            throw new RangeError("'byteLength' must be an integer.");
          }
          if (byteLength <= 0 || byteOffset + byteLength > buffer.byteLength) {
            throw new RangeError(`'byteLength' is out of range (0, ${buffer.byteLength - byteOffset}].`);
          }
          if (typeof arg3 === "object" && arg3 !== null) {
            options = arg3;
          } else if (typeof arg3 !== "undefined") {
            throw new TypeError("'options' must be an object.");
          }
        } else if (typeof arg2 !== "undefined") {
          throw new TypeError("'byteLength' must be a number.");
        }
      } else if (typeof arg1 !== "undefined") {
        throw new TypeError("'options' must be an object.");
      }
      filePathOrUint8Array = new Uint8Array(buffer, byteOffset, byteLength);
    } else {
      throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
    }
    const [backend, optionsWithValidatedEPs] = await resolveBackendAndExecutionProviders(options);
    const handler = await backend.createInferenceSessionHandler(filePathOrUint8Array, optionsWithValidatedEPs);
    TRACE_EVENT_END("InferenceSession.create");
    TRACE_FUNC_END();
    return new _InferenceSession(handler);
  }
  startProfiling() {
    this.handler.startProfiling();
  }
  endProfiling() {
    this.handler.endProfiling();
  }
  get inputNames() {
    return this.handler.inputNames;
  }
  get outputNames() {
    return this.handler.outputNames;
  }
  get inputMetadata() {
    return this.handler.inputMetadata;
  }
  get outputMetadata() {
    return this.handler.outputMetadata;
  }
};

// node_modules/.pnpm/onnxruntime-common@1.23.0/node_modules/onnxruntime-common/dist/esm/inference-session.js
var InferenceSession2 = InferenceSession;

// node_modules/.pnpm/onnxruntime-web@1.23.0/node_modules/onnxruntime-web/dist/ort.node.min.mjs
var import_meta = {};
var require2 = (0, import_module.createRequire)(import_meta.url);
var pe = Object.defineProperty;
var yt = Object.getOwnPropertyDescriptor;
var Et = Object.getOwnPropertyNames;
var St = Object.prototype.hasOwnProperty;
var de = ((e) => typeof require2 < "u" ? require2 : typeof Proxy < "u" ? new Proxy(e, { get: (t, n) => (typeof require2 < "u" ? require2 : t)[n] }) : e)(function(e) {
  if (typeof require2 < "u") return require2.apply(this, arguments);
  throw Error('Dynamic require of "' + e + '" is not supported');
});
var M = (e, t) => () => (e && (t = e(e = 0)), t);
var ht = (e, t) => {
  for (var n in t) pe(e, n, { get: t[n], enumerable: true });
};
var It = (e, t, n, o) => {
  if (t && typeof t == "object" || typeof t == "function") for (let r of Et(t)) !St.call(e, r) && r !== n && pe(e, r, { get: () => t[r], enumerable: !(o = yt(t, r)) || o.enumerable });
  return e;
};
var Tt = (e) => It(pe({}, "__esModule", { value: true }), e);
var $;
var re = M(() => {
  "use strict";
  $ = !!(typeof process < "u" && process.versions && process.versions.node);
});
var De;
var Ot;
var Lt;
var j;
var Ae;
var ve;
var Bt;
var Pt;
var _t;
var vt;
var Ue;
var xe;
var me = M(() => {
  "use strict";
  re();
  De = $ || typeof location > "u" ? void 0 : location.origin, Ot = import_meta.url > "file:" && import_meta.url < "file;", Lt = () => {
    if (!$) {
      if (Ot) {
        let e = URL;
        return new URL(new e("ort.node.min.mjs", import_meta.url).href, De).href;
      }
      return import_meta.url;
    }
  }, j = Lt(), Ae = () => {
    if (j && !j.startsWith("blob:")) return j.substring(0, j.lastIndexOf("/") + 1);
  }, ve = (e, t) => {
    try {
      let n = t ?? j;
      return (n ? new URL(e, n) : new URL(e)).origin === De;
    } catch {
      return false;
    }
  }, Bt = (e, t) => {
    let n = t ?? j;
    try {
      return (n ? new URL(e, n) : new URL(e)).href;
    } catch {
      return;
    }
  }, Pt = (e, t) => `${t ?? "./"}${e}`, _t = async (e) => {
    let n = await (await fetch(e, { credentials: "same-origin" })).blob();
    return URL.createObjectURL(n);
  }, vt = async (e) => (await import(
    /*webpackIgnore:true*/
    e
  )).default, Ue = void 0, xe = async (e, t, n, o) => {
    let r = Ue && !(e || t);
    if (r) if (j) r = ve(j);
    else if (o && !n) r = true;
    else throw new Error("cannot determine the script source URL.");
    if (r) return [void 0, Ue];
    {
      let a = "ort-wasm-simd-threaded.mjs", s = e ?? Bt(a, t), i = !$ && n && s && !ve(s, t), u = i ? await _t(s) : s ?? Pt(a, t);
      return [i ? u : void 0, await vt(u)];
    }
  };
});
var be;
var we;
var ne;
var Me;
var Ut;
var Dt;
var At;
var Ce;
var y;
var V = M(() => {
  "use strict";
  me();
  we = false, ne = false, Me = false, Ut = () => {
    if (typeof SharedArrayBuffer > "u") return false;
    try {
      return typeof MessageChannel < "u" && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
    } catch {
      return false;
    }
  }, Dt = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
    } catch {
      return false;
    }
  }, At = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]));
    } catch {
      return false;
    }
  }, Ce = async (e) => {
    if (we) return Promise.resolve();
    if (ne) throw new Error("multiple calls to 'initializeWebAssembly()' detected.");
    if (Me) throw new Error("previous call to 'initializeWebAssembly()' failed.");
    ne = true;
    let t = e.initTimeout, n = e.numThreads;
    if (e.simd !== false) {
      if (e.simd === "relaxed") {
        if (!At()) throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.");
      } else if (!Dt()) throw new Error("WebAssembly SIMD is not supported in the current environment.");
    }
    let o = Ut();
    n > 1 && !o && (typeof self < "u" && !self.crossOriginIsolated && console.warn("env.wasm.numThreads is set to " + n + ", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."), console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."), e.numThreads = n = 1);
    let r = e.wasmPaths, a = typeof r == "string" ? r : void 0, s = r?.mjs, i = s?.href ?? s, u = r?.wasm, l = u?.href ?? u, f = e.wasmBinary, [d, c] = await xe(i, a, n > 1, !!f || !!l), p = false, S = [];
    if (t > 0 && S.push(new Promise((I) => {
      setTimeout(() => {
        p = true, I();
      }, t);
    })), S.push(new Promise((I, v) => {
      let b = { numThreads: n };
      if (f) b.wasmBinary = f;
      else if (l || a) b.locateFile = (w) => l ?? a + w;
      else if (i && i.indexOf("blob:") !== 0) b.locateFile = (w) => new URL(w, i).href;
      else if (d) {
        let w = Ae();
        w && (b.locateFile = (C) => w + C);
      }
      c(b).then((w) => {
        ne = false, we = true, be = w, I(), d && URL.revokeObjectURL(d);
      }, (w) => {
        ne = false, Me = true, v(w);
      });
    })), await Promise.race(S), p) throw new Error(`WebAssembly backend initializing failed due to timeout: ${t}ms`);
  }, y = () => {
    if (we && be) return be;
    throw new Error("WebAssembly is not initialized yet.");
  };
});
var A;
var K;
var g;
var oe = M(() => {
  "use strict";
  V();
  A = (e, t) => {
    let n = y(), o = n.lengthBytesUTF8(e) + 1, r = n._malloc(o);
    return n.stringToUTF8(e, r, o), t.push(r), r;
  }, K = (e, t, n, o) => {
    if (typeof e == "object" && e !== null) {
      if (n.has(e)) throw new Error("Circular reference in options");
      n.add(e);
    }
    Object.entries(e).forEach(([r, a]) => {
      let s = t ? t + r : r;
      if (typeof a == "object") K(a, s + ".", n, o);
      else if (typeof a == "string" || typeof a == "number") o(s, a.toString());
      else if (typeof a == "boolean") o(s, a ? "1" : "0");
      else throw new Error(`Can't handle extra config type: ${typeof a}`);
    });
  }, g = (e) => {
    let t = y(), n = t.stackSave();
    try {
      let o = t.PTR_SIZE, r = t.stackAlloc(2 * o);
      t._OrtGetLastError(r, r + o);
      let a = Number(t.getValue(r, o === 4 ? "i32" : "i64")), s = t.getValue(r + o, "*"), i = s ? t.UTF8ToString(s) : "";
      throw new Error(`${e} ERROR_CODE: ${a}, ERROR_MESSAGE: ${i}`);
    } finally {
      t.stackRestore(n);
    }
  };
});
var We;
var ke = M(() => {
  "use strict";
  V();
  oe();
  We = (e) => {
    let t = y(), n = 0, o = [], r = e || {};
    try {
      if (e?.logSeverityLevel === void 0) r.logSeverityLevel = 2;
      else if (typeof e.logSeverityLevel != "number" || !Number.isInteger(e.logSeverityLevel) || e.logSeverityLevel < 0 || e.logSeverityLevel > 4) throw new Error(`log severity level is not valid: ${e.logSeverityLevel}`);
      if (e?.logVerbosityLevel === void 0) r.logVerbosityLevel = 0;
      else if (typeof e.logVerbosityLevel != "number" || !Number.isInteger(e.logVerbosityLevel)) throw new Error(`log verbosity level is not valid: ${e.logVerbosityLevel}`);
      e?.terminate === void 0 && (r.terminate = false);
      let a = 0;
      return e?.tag !== void 0 && (a = A(e.tag, o)), n = t._OrtCreateRunOptions(r.logSeverityLevel, r.logVerbosityLevel, !!r.terminate, a), n === 0 && g("Can't create run options."), e?.extra !== void 0 && K(e.extra, "", /* @__PURE__ */ new WeakSet(), (s, i) => {
        let u = A(s, o), l = A(i, o);
        t._OrtAddRunConfigEntry(n, u, l) !== 0 && g(`Can't set a run config entry: ${s} - ${i}.`);
      }), [n, o];
    } catch (a) {
      throw n !== 0 && t._OrtReleaseRunOptions(n), o.forEach((s) => t._free(s)), a;
    }
  };
});
var xt;
var Mt;
var Ct;
var se;
var Wt;
var Fe;
var Re = M(() => {
  "use strict";
  V();
  oe();
  xt = (e) => {
    switch (e) {
      case "disabled":
        return 0;
      case "basic":
        return 1;
      case "extended":
        return 2;
      case "layout":
        return 3;
      case "all":
        return 99;
      default:
        throw new Error(`unsupported graph optimization level: ${e}`);
    }
  }, Mt = (e) => {
    switch (e) {
      case "sequential":
        return 0;
      case "parallel":
        return 1;
      default:
        throw new Error(`unsupported execution mode: ${e}`);
    }
  }, Ct = (e) => {
    e.extra || (e.extra = {}), e.extra.session || (e.extra.session = {});
    let t = e.extra.session;
    t.use_ort_model_bytes_directly || (t.use_ort_model_bytes_directly = "1"), e.executionProviders && e.executionProviders.some((n) => (typeof n == "string" ? n : n.name) === "webgpu") && (e.enableMemPattern = false);
  }, se = (e, t, n, o) => {
    let r = A(t, o), a = A(n, o);
    y()._OrtAddSessionConfigEntry(e, r, a) !== 0 && g(`Can't set a session config entry: ${t} - ${n}.`);
  }, Wt = async (e, t, n) => {
    for (let o of t) {
      let r = typeof o == "string" ? o : o.name, a = [];
      switch (r) {
        case "webnn":
          if (r = "WEBNN", typeof o != "string") {
            let d = o?.deviceType;
            d && se(e, "deviceType", d, n);
          }
          break;
        case "webgpu":
          if (r = "JS", typeof o != "string") {
            let f = o;
            if (f?.preferredLayout) {
              if (f.preferredLayout !== "NCHW" && f.preferredLayout !== "NHWC") throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${f.preferredLayout}`);
              se(e, "preferredLayout", f.preferredLayout, n);
            }
          }
          break;
        case "wasm":
        case "cpu":
          continue;
        default:
          throw new Error(`not supported execution provider: ${r}`);
      }
      let s = A(r, n), i = a.length, u = 0, l = 0;
      if (i > 0) {
        u = y()._malloc(i * y().PTR_SIZE), n.push(u), l = y()._malloc(i * y().PTR_SIZE), n.push(l);
        for (let f = 0; f < i; f++) y().setValue(u + f * y().PTR_SIZE, a[f][0], "*"), y().setValue(l + f * y().PTR_SIZE, a[f][1], "*");
      }
      await y()._OrtAppendExecutionProvider(e, s, u, l, i) !== 0 && g(`Can't append execution provider: ${r}.`);
    }
  }, Fe = async (e) => {
    let t = y(), n = 0, o = [], r = e || {};
    Ct(r);
    try {
      let a = xt(r.graphOptimizationLevel ?? "all"), s = Mt(r.executionMode ?? "sequential"), i = typeof r.logId == "string" ? A(r.logId, o) : 0, u = r.logSeverityLevel ?? 2;
      if (!Number.isInteger(u) || u < 0 || u > 4) throw new Error(`log severity level is not valid: ${u}`);
      let l = r.logVerbosityLevel ?? 0;
      if (!Number.isInteger(l) || l < 0 || l > 4) throw new Error(`log verbosity level is not valid: ${l}`);
      let f = typeof r.optimizedModelFilePath == "string" ? A(r.optimizedModelFilePath, o) : 0;
      if (n = t._OrtCreateSessionOptions(a, !!r.enableCpuMemArena, !!r.enableMemPattern, s, !!r.enableProfiling, 0, i, u, l, f), n === 0 && g("Can't create session options."), r.executionProviders && await Wt(n, r.executionProviders, o), r.enableGraphCapture !== void 0) {
        if (typeof r.enableGraphCapture != "boolean") throw new Error(`enableGraphCapture must be a boolean value: ${r.enableGraphCapture}`);
        se(n, "enableGraphCapture", r.enableGraphCapture.toString(), o);
      }
      if (r.freeDimensionOverrides) for (let [d, c] of Object.entries(r.freeDimensionOverrides)) {
        if (typeof d != "string") throw new Error(`free dimension override name must be a string: ${d}`);
        if (typeof c != "number" || !Number.isInteger(c) || c < 0) throw new Error(`free dimension override value must be a non-negative integer: ${c}`);
        let p = A(d, o);
        t._OrtAddFreeDimensionOverride(n, p, c) !== 0 && g(`Can't set a free dimension override: ${d} - ${c}.`);
      }
      return r.extra !== void 0 && K(r.extra, "", /* @__PURE__ */ new WeakSet(), (d, c) => {
        se(n, d, c, o);
      }), [n, o];
    } catch (a) {
      throw n !== 0 && t._OrtReleaseSessionOptions(n) !== 0 && g("Can't release session options."), o.forEach((s) => t._free(s)), a;
    }
  };
});
var q;
var ae;
var J;
var Ne;
var Ge;
var ie;
var ue;
var $e;
var ge = M(() => {
  "use strict";
  q = (e) => {
    switch (e) {
      case "int8":
        return 3;
      case "uint8":
        return 2;
      case "bool":
        return 9;
      case "int16":
        return 5;
      case "uint16":
        return 4;
      case "int32":
        return 6;
      case "uint32":
        return 12;
      case "float16":
        return 10;
      case "float32":
        return 1;
      case "float64":
        return 11;
      case "string":
        return 8;
      case "int64":
        return 7;
      case "uint64":
        return 13;
      case "int4":
        return 22;
      case "uint4":
        return 21;
      default:
        throw new Error(`unsupported data type: ${e}`);
    }
  }, ae = (e) => {
    switch (e) {
      case 3:
        return "int8";
      case 2:
        return "uint8";
      case 9:
        return "bool";
      case 5:
        return "int16";
      case 4:
        return "uint16";
      case 6:
        return "int32";
      case 12:
        return "uint32";
      case 10:
        return "float16";
      case 1:
        return "float32";
      case 11:
        return "float64";
      case 8:
        return "string";
      case 7:
        return "int64";
      case 13:
        return "uint64";
      case 22:
        return "int4";
      case 21:
        return "uint4";
      default:
        throw new Error(`unsupported data type: ${e}`);
    }
  }, J = (e, t) => {
    let n = [-1, 4, 1, 1, 2, 2, 4, 8, -1, 1, 2, 8, 4, 8, -1, -1, -1, -1, -1, -1, -1, 0.5, 0.5][e], o = typeof t == "number" ? t : t.reduce((r, a) => r * a, 1);
    return n > 0 ? Math.ceil(o * n) : void 0;
  }, Ne = (e) => {
    switch (e) {
      case "float16":
        return typeof Float16Array < "u" && Float16Array.from ? Float16Array : Uint16Array;
      case "float32":
        return Float32Array;
      case "uint8":
        return Uint8Array;
      case "int8":
        return Int8Array;
      case "uint16":
        return Uint16Array;
      case "int16":
        return Int16Array;
      case "int32":
        return Int32Array;
      case "bool":
        return Uint8Array;
      case "float64":
        return Float64Array;
      case "uint32":
        return Uint32Array;
      case "int64":
        return BigInt64Array;
      case "uint64":
        return BigUint64Array;
      default:
        throw new Error(`unsupported type: ${e}`);
    }
  }, Ge = (e) => {
    switch (e) {
      case "verbose":
        return 0;
      case "info":
        return 1;
      case "warning":
        return 2;
      case "error":
        return 3;
      case "fatal":
        return 4;
      default:
        throw new Error(`unsupported logging level: ${e}`);
    }
  }, ie = (e) => e === "float32" || e === "float16" || e === "int32" || e === "int64" || e === "uint32" || e === "uint8" || e === "bool" || e === "uint4" || e === "int4", ue = (e) => e === "float32" || e === "float16" || e === "int32" || e === "int64" || e === "uint32" || e === "uint64" || e === "int8" || e === "uint8" || e === "bool" || e === "uint4" || e === "int4", $e = (e) => {
    switch (e) {
      case "none":
        return 0;
      case "cpu":
        return 1;
      case "cpu-pinned":
        return 2;
      case "texture":
        return 3;
      case "gpu-buffer":
        return 4;
      case "ml-tensor":
        return 5;
      default:
        throw new Error(`unsupported data location: ${e}`);
    }
  };
});
var Q;
var ye = M(() => {
  "use strict";
  re();
  Q = async (e) => {
    if (typeof e == "string") if ($) try {
      let { readFile: t } = de("node:fs/promises");
      return new Uint8Array(await t(e));
    } catch (t) {
      if (t.code === "ERR_FS_FILE_TOO_LARGE") {
        let { createReadStream: n } = de("node:fs"), o = n(e), r = [];
        for await (let a of o) r.push(a);
        return new Uint8Array(Buffer.concat(r));
      }
      throw t;
    }
    else {
      let t = await fetch(e);
      if (!t.ok) throw new Error(`failed to load external data file: ${e}`);
      let n = t.headers.get("Content-Length"), o = n ? parseInt(n, 10) : 0;
      if (o < 1073741824) return new Uint8Array(await t.arrayBuffer());
      {
        if (!t.body) throw new Error(`failed to load external data file: ${e}, no response body.`);
        let r = t.body.getReader(), a;
        try {
          a = new ArrayBuffer(o);
        } catch (i) {
          if (i instanceof RangeError) {
            let u = Math.ceil(o / 65536);
            a = new WebAssembly.Memory({ initial: u, maximum: u }).buffer;
          } else throw i;
        }
        let s = 0;
        for (; ; ) {
          let { done: i, value: u } = await r.read();
          if (i) break;
          let l = u.byteLength;
          new Uint8Array(a, s, l).set(u), s += l;
        }
        return new Uint8Array(a, 0, o);
      }
    }
    else return e instanceof Blob ? new Uint8Array(await e.arrayBuffer()) : e instanceof Uint8Array ? e : new Uint8Array(e);
  };
});
var kt;
var qe;
var Je;
var Y;
var Ft;
var He;
var Ee;
var Ye;
var Ze;
var Ve;
var Xe;
var Ke;
var Qe = M(() => {
  "use strict";
  ke();
  Re();
  ge();
  V();
  oe();
  ye();
  kt = (e, t) => {
    y()._OrtInit(e, t) !== 0 && g("Can't initialize onnxruntime.");
  }, qe = async (e) => {
    kt(e.wasm.numThreads, Ge(e.logLevel));
  }, Je = async (e, t) => {
    y().asyncInit?.();
    let n = e.webgpu.adapter;
    if (t === "webgpu") {
      if (typeof navigator > "u" || !navigator.gpu) throw new Error("WebGPU is not supported in current environment");
      if (n) {
        if (typeof n.limits != "object" || typeof n.features != "object" || typeof n.requestDevice != "function") throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.");
      } else {
        let o = e.webgpu.powerPreference;
        if (o !== void 0 && o !== "low-power" && o !== "high-performance") throw new Error(`Invalid powerPreference setting: "${o}"`);
        let r = e.webgpu.forceFallbackAdapter;
        if (r !== void 0 && typeof r != "boolean") throw new Error(`Invalid forceFallbackAdapter setting: "${r}"`);
        if (n = await navigator.gpu.requestAdapter({ powerPreference: o, forceFallbackAdapter: r }), !n) throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.');
      }
    }
    if (t === "webnn" && (typeof navigator > "u" || !navigator.ml)) throw new Error("WebNN is not supported in current environment");
  }, Y = /* @__PURE__ */ new Map(), Ft = (e) => {
    let t = y(), n = t.stackSave();
    try {
      let o = t.PTR_SIZE, r = t.stackAlloc(2 * o);
      t._OrtGetInputOutputCount(e, r, r + o) !== 0 && g("Can't get session input/output count.");
      let s = o === 4 ? "i32" : "i64";
      return [Number(t.getValue(r, s)), Number(t.getValue(r + o, s))];
    } finally {
      t.stackRestore(n);
    }
  }, He = (e, t) => {
    let n = y(), o = n.stackSave(), r = 0;
    try {
      let a = n.PTR_SIZE, s = n.stackAlloc(2 * a);
      n._OrtGetInputOutputMetadata(e, t, s, s + a) !== 0 && g("Can't get session input/output metadata.");
      let u = Number(n.getValue(s, "*"));
      r = Number(n.getValue(s + a, "*"));
      let l = n.HEAP32[r / 4];
      if (l === 0) return [u, 0];
      let f = n.HEAPU32[r / 4 + 1], d = [];
      for (let c = 0; c < f; c++) {
        let p = Number(n.getValue(r + 8 + c * a, "*"));
        d.push(p !== 0 ? n.UTF8ToString(p) : Number(n.getValue(r + 8 + (c + f) * a, "*")));
      }
      return [u, l, d];
    } finally {
      n.stackRestore(o), r !== 0 && n._OrtFree(r);
    }
  }, Ee = (e) => {
    let t = y(), n = t._malloc(e.byteLength);
    if (n === 0) throw new Error(`Can't create a session. failed to allocate a buffer of size ${e.byteLength}.`);
    return t.HEAPU8.set(e, n), [n, e.byteLength];
  }, Ye = async (e, t) => {
    let n, o, r = y();
    Array.isArray(e) ? [n, o] = e : e.buffer === r.HEAPU8.buffer ? [n, o] = [e.byteOffset, e.byteLength] : [n, o] = Ee(e);
    let a = 0, s = 0, i = 0, u = [], l = [], f = [];
    try {
      if ([s, u] = await Fe(t), t?.externalData && r.mountExternalData) {
        let E = [];
        for (let h of t.externalData) {
          let B = typeof h == "string" ? h : h.path;
          E.push(Q(typeof h == "string" ? h : h.data).then((U) => {
            r.mountExternalData(B, U);
          }));
        }
        await Promise.all(E);
      }
      for (let E of t?.executionProviders ?? []) if ((typeof E == "string" ? E : E.name) === "webnn") {
        if (r.shouldTransferToMLTensor = false, typeof E != "string") {
          let B = E, U = B?.context, P = B?.gpuDevice, z = B?.deviceType, Z = B?.powerPreference;
          U ? r.currentContext = U : P ? r.currentContext = await r.webnnCreateMLContext(P) : r.currentContext = await r.webnnCreateMLContext({ deviceType: z, powerPreference: Z });
        } else r.currentContext = await r.webnnCreateMLContext();
        break;
      }
      a = await r._OrtCreateSession(n, o, s), r.webgpuOnCreateSession?.(a), a === 0 && g("Can't create a session."), r.jsepOnCreateSession?.(), r.currentContext && (r.webnnRegisterMLContext(a, r.currentContext), r.currentContext = void 0, r.shouldTransferToMLTensor = true);
      let [d, c] = Ft(a), p = !!t?.enableGraphCapture, S = [], I = [], v = [], b = [], w = [];
      for (let E = 0; E < d; E++) {
        let [h, B, U] = He(a, E);
        h === 0 && g("Can't get an input name."), l.push(h);
        let P = r.UTF8ToString(h);
        S.push(P), v.push(B === 0 ? { name: P, isTensor: false } : { name: P, isTensor: true, type: ae(B), shape: U });
      }
      for (let E = 0; E < c; E++) {
        let [h, B, U] = He(a, E + d);
        h === 0 && g("Can't get an output name."), f.push(h);
        let P = r.UTF8ToString(h);
        I.push(P), b.push(B === 0 ? { name: P, isTensor: false } : { name: P, isTensor: true, type: ae(B), shape: U });
      }
      return Y.set(a, [a, l, f, null, p, false]), [a, S, I, v, b];
    } catch (d) {
      throw l.forEach((c) => r._OrtFree(c)), f.forEach((c) => r._OrtFree(c)), i !== 0 && r._OrtReleaseBinding(i) !== 0 && g("Can't release IO binding."), a !== 0 && r._OrtReleaseSession(a) !== 0 && g("Can't release session."), d;
    } finally {
      r._free(n), s !== 0 && r._OrtReleaseSessionOptions(s) !== 0 && g("Can't release session options."), u.forEach((d) => r._free(d)), r.unmountExternalData?.();
    }
  }, Ze = (e) => {
    let t = y(), n = Y.get(e);
    if (!n) throw new Error(`cannot release session. invalid session id: ${e}`);
    let [o, r, a, s, i] = n;
    s && (i && t._OrtClearBoundOutputs(s.handle) !== 0 && g("Can't clear bound outputs."), t._OrtReleaseBinding(s.handle) !== 0 && g("Can't release IO binding.")), t.jsepOnReleaseSession?.(e), t.webnnOnReleaseSession?.(e), t.webgpuOnReleaseSession?.(e), r.forEach((u) => t._OrtFree(u)), a.forEach((u) => t._OrtFree(u)), t._OrtReleaseSession(o) !== 0 && g("Can't release session."), Y.delete(e);
  }, Ve = async (e, t, n, o, r, a, s = false) => {
    if (!e) {
      t.push(0);
      return;
    }
    let i = y(), u = i.PTR_SIZE, l = e[0], f = e[1], d = e[3], c = d, p, S;
    if (l === "string" && (d === "gpu-buffer" || d === "ml-tensor")) throw new Error("String tensor is not supported on GPU.");
    if (s && d !== "gpu-buffer") throw new Error(`External buffer must be provided for input/output index ${a} when enableGraphCapture is true.`);
    if (d === "gpu-buffer") {
      let b = e[2].gpuBuffer;
      S = J(q(l), f);
      {
        let w = i.jsepRegisterBuffer;
        if (!w) throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');
        p = w(o, a, b, S);
      }
    } else if (d === "ml-tensor") {
      let b = e[2].mlTensor;
      S = J(q(l), f);
      let w = i.webnnRegisterMLTensor;
      if (!w) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
      p = w(o, b, q(l), f);
    } else {
      let b = e[2];
      if (Array.isArray(b)) {
        S = u * b.length, p = i._malloc(S), n.push(p);
        for (let w = 0; w < b.length; w++) {
          if (typeof b[w] != "string") throw new TypeError(`tensor data at index ${w} is not a string`);
          i.setValue(p + w * u, A(b[w], n), "*");
        }
      } else {
        let w = i.webnnIsGraphInput, C = i.webnnIsGraphOutput;
        if (l !== "string" && w && C) {
          let E = i.UTF8ToString(r);
          if (w(o, E) || C(o, E)) {
            let h = q(l);
            S = J(h, f), c = "ml-tensor";
            let B = i.webnnCreateTemporaryTensor, U = i.webnnUploadTensor;
            if (!B || !U) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
            let P = await B(o, h, f);
            U(P, new Uint8Array(b.buffer, b.byteOffset, b.byteLength)), p = P;
          } else S = b.byteLength, p = i._malloc(S), n.push(p), i.HEAPU8.set(new Uint8Array(b.buffer, b.byteOffset, S), p);
        } else S = b.byteLength, p = i._malloc(S), n.push(p), i.HEAPU8.set(new Uint8Array(b.buffer, b.byteOffset, S), p);
      }
    }
    let I = i.stackSave(), v = i.stackAlloc(4 * f.length);
    try {
      f.forEach((w, C) => i.setValue(v + C * u, w, u === 4 ? "i32" : "i64"));
      let b = i._OrtCreateTensor(q(l), p, S, v, f.length, $e(c));
      b === 0 && g(`Can't create tensor for input/output. session=${o}, index=${a}.`), t.push(b);
    } finally {
      i.stackRestore(I);
    }
  }, Xe = async (e, t, n, o, r, a) => {
    let s = y(), i = s.PTR_SIZE, u = Y.get(e);
    if (!u) throw new Error(`cannot run inference. invalid session id: ${e}`);
    let l = u[0], f = u[1], d = u[2], c = u[3], p = u[4], S = u[5], I = t.length, v = o.length, b = 0, w = [], C = [], E = [], h = [], B = s.stackSave(), U = s.stackAlloc(I * i), P = s.stackAlloc(I * i), z = s.stackAlloc(v * i), Z = s.stackAlloc(v * i);
    try {
      [b, w] = We(a), TRACE_EVENT_BEGIN("wasm prepareInputOutputTensor");
      for (let m = 0; m < I; m++) await Ve(n[m], C, h, e, f[t[m]], t[m], p);
      for (let m = 0; m < v; m++) await Ve(r[m], E, h, e, d[o[m]], I + o[m], p);
      TRACE_EVENT_END("wasm prepareInputOutputTensor");
      for (let m = 0; m < I; m++) s.setValue(U + m * i, C[m], "*"), s.setValue(P + m * i, f[t[m]], "*");
      for (let m = 0; m < v; m++) s.setValue(z + m * i, E[m], "*"), s.setValue(Z + m * i, d[o[m]], "*");
      s.jsepOnRunStart?.(l), s.webnnOnRunStart?.(l);
      let x;
      x = await s._OrtRun(l, P, U, I, Z, v, z, b), x !== 0 && g("failed to call OrtRun().");
      let k = [], Oe = [];
      TRACE_EVENT_BEGIN("wasm ProcessOutputTensor");
      for (let m = 0; m < v; m++) {
        let F = Number(s.getValue(z + m * i, "*"));
        if (F === E[m]) {
          k.push(r[m]);
          continue;
        }
        let Le = s.stackSave(), W = s.stackAlloc(4 * i), H = false, O, _ = 0;
        try {
          s._OrtGetTensorData(F, W, W + i, W + 2 * i, W + 3 * i) !== 0 && g(`Can't access output tensor data on index ${m}.`);
          let le = i === 4 ? "i32" : "i64", ee = Number(s.getValue(W, le));
          _ = s.getValue(W + i, "*");
          let Be = s.getValue(W + i * 2, "*"), gt = Number(s.getValue(W + i * 3, le)), R = [];
          for (let L = 0; L < gt; L++) R.push(Number(s.getValue(Be + L * i, le)));
          s._OrtFree(Be) !== 0 && g("Can't free memory for tensor dims.");
          let N = R.reduce((L, T) => L * T, 1);
          O = ae(ee);
          let X = c?.outputPreferredLocations[o[m]];
          if (O === "string") {
            if (X === "gpu-buffer" || X === "ml-tensor") throw new Error("String tensor is not supported on GPU.");
            let L = [];
            for (let T = 0; T < N; T++) {
              let G = s.getValue(_ + T * i, "*"), te = s.getValue(_ + (T + 1) * i, "*"), Pe = T === N - 1 ? void 0 : te - G;
              L.push(s.UTF8ToString(G, Pe));
            }
            k.push([O, R, L, "cpu"]);
          } else if (X === "gpu-buffer" && N > 0) {
            let L = s.jsepGetBuffer;
            if (!L) throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');
            let T = L(_), G = J(ee, N);
            if (G === void 0 || !ie(O)) throw new Error(`Unsupported data type: ${O}`);
            H = true, k.push([O, R, { gpuBuffer: T, download: s.jsepCreateDownloader(T, G, O), dispose: () => {
              s._OrtReleaseTensor(F) !== 0 && g("Can't release tensor.");
            } }, "gpu-buffer"]);
          } else if (X === "ml-tensor" && N > 0) {
            let L = s.webnnEnsureTensor, T = s.webnnIsGraphInputOutputTypeSupported;
            if (!L || !T) throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');
            if (J(ee, N) === void 0 || !ue(O)) throw new Error(`Unsupported data type: ${O}`);
            if (!T(e, O, false)) throw new Error(`preferredLocation "ml-tensor" for ${O} output is not supported by current WebNN Context.`);
            let te = await L(e, _, ee, R, false);
            H = true, k.push([O, R, { mlTensor: te, download: s.webnnCreateMLTensorDownloader(_, O), dispose: () => {
              s.webnnReleaseTensorId(_), s._OrtReleaseTensor(F);
            } }, "ml-tensor"]);
          } else if (X === "ml-tensor-cpu-output" && N > 0) {
            let L = s.webnnCreateMLTensorDownloader(_, O)(), T = k.length;
            H = true, Oe.push((async () => {
              let G = [T, await L];
              return s.webnnReleaseTensorId(_), s._OrtReleaseTensor(F), G;
            })()), k.push([O, R, [], "cpu"]);
          } else {
            let L = Ne(O), T = new L(N);
            new Uint8Array(T.buffer, T.byteOffset, T.byteLength).set(s.HEAPU8.subarray(_, _ + T.byteLength)), k.push([O, R, T, "cpu"]);
          }
        } finally {
          s.stackRestore(Le), O === "string" && _ && s._free(_), H || s._OrtReleaseTensor(F);
        }
      }
      c && !p && (s._OrtClearBoundOutputs(c.handle) !== 0 && g("Can't clear bound outputs."), Y.set(e, [l, f, d, c, p, false]));
      for (let [m, F] of await Promise.all(Oe)) k[m][2] = F;
      return TRACE_EVENT_END("wasm ProcessOutputTensor"), k;
    } finally {
      s.webnnOnRunEnd?.(l), s.stackRestore(B), C.forEach((x) => s._OrtReleaseTensor(x)), E.forEach((x) => s._OrtReleaseTensor(x)), h.forEach((x) => s._free(x)), b !== 0 && s._OrtReleaseRunOptions(b), w.forEach((x) => s._free(x));
    }
  }, Ke = (e) => {
    let t = y(), n = Y.get(e);
    if (!n) throw new Error("invalid session id");
    let o = n[0], r = t._OrtEndProfiling(o);
    r === 0 && g("Can't get an profile file name."), t._OrtFree(r);
  };
});
var Se;
var et;
var tt;
var rt;
var nt;
var ot;
var st;
var at;
var it;
var ut;
var Ie = M(() => {
  "use strict";
  Qe();
  V();
  me();
  Se = false, et = false, tt = false, rt = async () => {
    if (!et) {
      if (Se) throw new Error("multiple calls to 'initWasm()' detected.");
      if (tt) throw new Error("previous call to 'initWasm()' failed.");
      Se = true;
      try {
        await Ce(env2.wasm), await qe(env2), et = true;
      } catch (e) {
        throw tt = true, e;
      } finally {
        Se = false;
      }
    }
  }, nt = async (e) => {
    await Je(env2, e);
  }, ot = async (e) => Ee(e), st = async (e, t) => Ye(e, t), at = async (e) => {
    Ze(e);
  }, it = async (e, t, n, o, r, a) => Xe(e, t, n, o, r, a), ut = async (e) => {
    Ke(e);
  };
});
var lt;
var Nt;
var ce;
var pt = M(() => {
  "use strict";
  Ie();
  ge();
  re();
  ye();
  lt = (e, t) => {
    switch (e.location) {
      case "cpu":
        return [e.type, e.dims, e.data, "cpu"];
      case "gpu-buffer":
        return [e.type, e.dims, { gpuBuffer: e.gpuBuffer }, "gpu-buffer"];
      case "ml-tensor":
        return [e.type, e.dims, { mlTensor: e.mlTensor }, "ml-tensor"];
      default:
        throw new Error(`invalid data location: ${e.location} for ${t()}`);
    }
  }, Nt = (e) => {
    switch (e[3]) {
      case "cpu":
        return new Tensor2(e[0], e[2], e[1]);
      case "gpu-buffer": {
        let t = e[0];
        if (!ie(t)) throw new Error(`not supported data type: ${t} for deserializing GPU tensor`);
        let { gpuBuffer: n, download: o, dispose: r } = e[2];
        return Tensor2.fromGpuBuffer(n, { dataType: t, dims: e[1], download: o, dispose: r });
      }
      case "ml-tensor": {
        let t = e[0];
        if (!ue(t)) throw new Error(`not supported data type: ${t} for deserializing MLTensor tensor`);
        let { mlTensor: n, download: o, dispose: r } = e[2];
        return Tensor2.fromMLTensor(n, { dataType: t, dims: e[1], download: o, dispose: r });
      }
      default:
        throw new Error(`invalid data location: ${e[3]}`);
    }
  }, ce = class {
    async fetchModelAndCopyToWasmMemory(t) {
      return ot(await Q(t));
    }
    async loadModel(t, n) {
      TRACE_FUNC_BEGIN();
      let o;
      typeof t == "string" ? $ ? o = await Q(t) : o = await this.fetchModelAndCopyToWasmMemory(t) : o = t, [this.sessionId, this.inputNames, this.outputNames, this.inputMetadata, this.outputMetadata] = await st(o, n), TRACE_FUNC_END();
    }
    async dispose() {
      return at(this.sessionId);
    }
    async run(t, n, o) {
      TRACE_FUNC_BEGIN();
      let r = [], a = [];
      Object.entries(t).forEach((c) => {
        let p = c[0], S = c[1], I = this.inputNames.indexOf(p);
        if (I === -1) throw new Error(`invalid input '${p}'`);
        r.push(S), a.push(I);
      });
      let s = [], i = [];
      Object.entries(n).forEach((c) => {
        let p = c[0], S = c[1], I = this.outputNames.indexOf(p);
        if (I === -1) throw new Error(`invalid output '${p}'`);
        s.push(S), i.push(I);
      });
      let u = r.map((c, p) => lt(c, () => `input "${this.inputNames[a[p]]}"`)), l = s.map((c, p) => c ? lt(c, () => `output "${this.outputNames[i[p]]}"`) : null), f = await it(this.sessionId, a, u, i, l, o), d = {};
      for (let c = 0; c < f.length; c++) d[this.outputNames[i[c]]] = s[c] ?? Nt(f[c]);
      return TRACE_FUNC_END(), d;
    }
    startProfiling() {
    }
    endProfiling() {
      ut(this.sessionId);
    }
  };
});
var mt = {};
ht(mt, { OnnxruntimeWebAssemblyBackend: () => fe, initializeFlags: () => dt, wasmBackend: () => Gt });
var dt;
var fe;
var Gt;
var bt = M(() => {
  "use strict";
  Ie();
  pt();
  dt = () => {
    (typeof env2.wasm.initTimeout != "number" || env2.wasm.initTimeout < 0) && (env2.wasm.initTimeout = 0);
    let e = env2.wasm.simd;
    if (typeof e != "boolean" && e !== void 0 && e !== "fixed" && e !== "relaxed" && (console.warn(`Property "env.wasm.simd" is set to unknown value "${e}". Reset it to \`false\` and ignore SIMD feature checking.`), env2.wasm.simd = false), typeof env2.wasm.proxy != "boolean" && (env2.wasm.proxy = false), typeof env2.wasm.trace != "boolean" && (env2.wasm.trace = false), typeof env2.wasm.numThreads != "number" || !Number.isInteger(env2.wasm.numThreads) || env2.wasm.numThreads <= 0) if (typeof self < "u" && !self.crossOriginIsolated) env2.wasm.numThreads = 1;
    else {
      let t = typeof navigator > "u" ? de("node:os").cpus().length : navigator.hardwareConcurrency;
      env2.wasm.numThreads = Math.min(4, Math.ceil((t || 1) / 2));
    }
  }, fe = class {
    async init(t) {
      dt(), await rt(), await nt(t);
    }
    async createInferenceSessionHandler(t, n) {
      let o = new ce();
      return await o.loadModel(t, n), o;
    }
  }, Gt = new fe();
});
var _e = "1.23.0";
var zr = esm_exports;
{
  let e = (bt(), Tt(mt)).wasmBackend;
  registerBackend("cpu", e, 10), registerBackend("wasm", e, 10);
}
Object.defineProperty(env2.versions, "web", { value: _e, enumerable: true });
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  InferenceSession,
  TRACE,
  TRACE_EVENT_BEGIN,
  TRACE_EVENT_END,
  TRACE_FUNC_BEGIN,
  TRACE_FUNC_END,
  Tensor,
  env,
  registerBackend
});
/*! Bundled license information:

onnxruntime-web/dist/ort.node.min.mjs:
  (*!
   * ONNX Runtime Web v1.23.0
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Licensed under the MIT License.
   *)
*/
