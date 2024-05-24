// Extended types used but not defined in the spec
export const bufferSourceTypes = new Set([
    "ArrayBuffer",
    "SharedArrayBuffer",
    "ArrayBufferView",
    "DataView",
    "Int8Array",
    "Uint8Array",
    "Int16Array",
    "Uint16Array",
    "Uint8ClampedArray",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
]);
export const integerTypes = new Set([
    "byte",
    "octet",
    "short",
    "unsigned short",
    "long",
    "unsigned long",
    "long long",
    "unsigned long long",
]);
export const stringTypes = new Set([
    "ByteString",
    "DOMString",
    "USVString",
    "CSSOMString",
]);
// Trusted Types https://w3c.github.io/trusted-types/dist/spec/
export const trustedStringTypes = new Set([
    "HTMLString",
    "ScriptString",
    "ScriptURLString",
]);
const floatTypes = new Set([
    "float",
    "unrestricted float",
    "double",
    "unrestricted double",
]);
const sameTypes = new Set([
    "any",
    "boolean",
    "Date",
    "Function",
    "Promise",
    "PromiseLike",
    "undefined",
    "void",
]);
export const baseTypeConversionMap = new Map([
    ...[...bufferSourceTypes].map((type) => [type, type]),
    ...[...integerTypes, ...floatTypes].map((type) => [type, "number"]),
    ...[...stringTypes, ...trustedStringTypes].map((type) => [type, "string"]),
    ...[...sameTypes].map((type) => [type, type]),
    ["object", "any"],
    ["sequence", "Array"],
    ["ObservableArray", "Array"],
    ["record", "Record"],
    ["FrozenArray", "ReadonlyArray"],
    ["EventHandler", "EventHandler"],
]);
export function deepFilter(obj, fn) {
    if (typeof obj === "object") {
        if (Array.isArray(obj)) {
            return mapDefined(obj, (e) => fn(e, undefined) ? deepFilter(e, fn) : undefined);
        }
        else {
            const result = {};
            for (const e in obj) {
                if (fn(obj[e], e)) {
                    result[e] = deepFilter(obj[e], fn);
                }
            }
            return result;
        }
    }
    return obj;
}
export function filterProperties(obj, fn) {
    const result = {};
    for (const e in obj) {
        if (fn(obj[e])) {
            result[e] = obj[e];
        }
    }
    return result;
}
export function exposesTo(o, target) {
    if (!o || typeof o.exposed !== "string") {
        return true;
    }
    if (o.exposed === "*") {
        return true;
    }
    return o.exposed.split(" ").some((e) => target.includes(e));
}
export function merge(target, src, shallow) {
    if (typeof target !== "object" || typeof src !== "object") {
        return src;
    }
    if (!target || !src) {
        throw new Error("Either `target` or `src` is null");
    }
    for (const k in src) {
        if (Object.getOwnPropertyDescriptor(src, k)) {
            if (Object.getOwnPropertyDescriptor(target, k)) {
                const targetProp = target[k];
                const srcProp = src[k];
                if (Array.isArray(targetProp) && Array.isArray(srcProp)) {
                    mergeNamedArrays(targetProp, srcProp);
                }
                else {
                    if (shallow &&
                        typeof targetProp.name === "string" &&
                        typeof srcProp.name === "string") {
                        target[k] = srcProp;
                    }
                    else {
                        if (targetProp === srcProp && k !== "name") {
                            console.warn(`Redundant merge value ${targetProp} in ${JSON.stringify(src)}`);
                        }
                        target[k] = merge(targetProp, srcProp, shallow);
                    }
                }
            }
            else {
                target[k] = src[k];
            }
        }
    }
    return target;
}
function mergeNamedArrays(srcProp, targetProp) {
    const map = {};
    for (const e1 of srcProp) {
        const { name } = e1;
        if (name) {
            map[name] = e1;
        }
    }
    for (const e2 of targetProp) {
        const { name } = e2;
        if (name && map[name]) {
            merge(map[name], e2);
        }
        else {
            srcProp.push(e2);
        }
    }
}
export function distinct(a) {
    return Array.from(new Set(a).values());
}
export function mapToArray(m) {
    return Object.keys(m || {}).map((k) => m[k]);
}
export function arrayToMap(array, makeKey, makeValue) {
    const result = {};
    for (const value of array) {
        result[makeKey(value)] = makeValue(value);
    }
    return result;
}
export function mapValues(obj, fn) {
    return Object.keys(obj || {}).map((k) => fn(obj[k]));
}
export function mapDefined(array, mapFn) {
    const result = [];
    if (array) {
        for (let i = 0; i < array.length; i++) {
            const mapped = mapFn(array[i], i);
            if (mapped !== undefined) {
                result.push(mapped);
            }
        }
    }
    return result;
}
export function toNameMap(array) {
    const result = {};
    for (const value of array) {
        result[value.name] = value;
    }
    return result;
}
export function concat(a, b) {
    return !a ? b || [] : a.concat(b || []);
}
export function getEmptyWebIDL() {
    return {
        callbackFunctions: {
            callbackFunction: {},
        },
        callbackInterfaces: {
            interface: {},
        },
        dictionaries: {
            dictionary: {},
        },
        enums: {
            enum: {},
        },
        interfaces: {
            interface: {},
        },
        mixins: {
            mixin: {},
        },
        typedefs: {
            typedef: [],
        },
        namespaces: [],
    };
}
export function resolveExposure(obj, exposure, override) {
    if (!exposure) {
        throw new Error("No exposure set");
    }
    if ("exposed" in obj && (override || obj.exposed === undefined)) {
        obj.exposed = exposure;
    }
    for (const key in obj) {
        if (typeof obj[key] === "object" && obj[key]) {
            resolveExposure(obj[key], exposure, override);
        }
    }
}
function collectTypeReferences(obj) {
    const collection = [];
    if (typeof obj !== "object") {
        return collection;
    }
    if (Array.isArray(obj)) {
        return collection.concat(...obj.map(collectTypeReferences));
    }
    if (typeof obj.type === "string") {
        collection.push(obj.type);
    }
    if (Array.isArray(obj.implements)) {
        collection.push(...obj.implements);
    }
    if (typeof obj.extends === "string") {
        collection.push(obj.extends);
    }
    for (const e in obj) {
        collection.push(...collectTypeReferences(obj[e]));
    }
    return collection;
}
function getNonValueTypeMap(webidl) {
    const namedTypes = [
        ...mapToArray(webidl.callbackFunctions.callbackFunction),
        ...mapToArray(webidl.callbackInterfaces.interface),
        ...mapToArray(webidl.dictionaries.dictionary),
        ...mapToArray(webidl.enums.enum),
        ...mapToArray(webidl.mixins.mixin),
        ...webidl.typedefs.typedef,
    ];
    return new Map(namedTypes.map((t) => [t.name, t]));
}
export function followTypeReferences(webidl, filteredInterfaces) {
    const set = new Set();
    const map = getNonValueTypeMap(webidl);
    new Set(collectTypeReferences(filteredInterfaces)).forEach(follow);
    return set;
    function follow(reference) {
        if (baseTypeConversionMap.has(reference) ||
            reference in filteredInterfaces) {
            return;
        }
        const type = map.get(reference);
        if (!type) {
            return;
        }
        if (!set.has(type.name)) {
            set.add(type.name);
            collectTypeReferences(type).forEach(follow);
        }
    }
}
export function assertUnique(list) {
    if (new Set(list).size < list.length) {
        throw new Error(`Duplicate items found in the list: ${list}`);
    }
    return list;
}
//# sourceMappingURL=helpers.js.map