// Export all internal methods used for gecko's version of build.js.

export { merge } from "./lib/build/helpers.js";
export { emitWebIdl } from "./lib/build/emitter.js";
export { convert } from "./lib/build/widlprocess.js";
export { getExposedTypes } from "./lib/build/expose.js";
export { getInterfaceElementMergeData } from "./lib/build/webref/elements.js";
