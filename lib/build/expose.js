import { getEmptyWebIDL, deepFilter, exposesTo, followTypeReferences, filterProperties, mapToArray, arrayToMap, } from "./helpers.js";
import { isEmptyRecord } from "./utils/record.js";
class LoggedSet extends Set {
    constructor(set) {
        super(set);
        this.unvisited = new Set(set);
    }
    has(value) {
        this.unvisited.delete(value);
        return super.has(value);
    }
    unvisitedValues() {
        return this.unvisited.values();
    }
}
export function getExposedTypes(webidl, target, forceKnownTypes) {
    const forceKnownTypesLogged = new LoggedSet(forceKnownTypes);
    const unexposedTypes = new Set();
    const filtered = getEmptyWebIDL();
    if (webidl.interfaces) {
        filtered.interfaces.interface = deepFilter(webidl.interfaces.interface, (o) => exposesTo(o, target));
        const unexposedInterfaces = mapToArray(webidl.interfaces.interface).filter((i) => !exposesTo(i, target));
        for (const i of unexposedInterfaces) {
            unexposedTypes.add(i.name);
        }
    }
    if (webidl.namespaces) {
        filtered.namespaces = deepFilter(webidl.namespaces, (o) => exposesTo(o, target));
    }
    if (webidl.mixins) {
        const allIncludes = Object.values(filtered.interfaces?.interface || {})
            .map((i) => i.implements || [])
            .flat();
        const mixins = deepFilter(webidl.mixins.mixin, (o) => exposesTo(o, target));
        filtered.mixins.mixin = filterProperties(mixins, (m) => allIncludes.includes(m.name) && !isEmptyMixin(m));
        for (const value of Object.values(filtered.interfaces.interface || {})) {
            if (value.implements) {
                value.implements = value.implements.filter((i) => !!filtered.mixins.mixin[i]);
            }
        }
    }
    const knownIDLTypes = new Set([
        ...followTypeReferences(webidl, filtered.interfaces.interface),
        ...followTypeReferences(webidl, arrayToMap(filtered.namespaces, (i) => i.name, (i) => i)),
    ]);
    const isKnownName = (o) => knownIDLTypes.has(o.name) || forceKnownTypesLogged.has(o.name);
    if (webidl.typedefs) {
        const referenced = webidl.typedefs.typedef.filter((t) => knownIDLTypes.has(t.name) || forceKnownTypesLogged.has(t.name));
        const { exposed, removed } = filterTypedefs(referenced, unexposedTypes);
        removed.forEach((s) => unexposedTypes.add(s));
        filtered.typedefs.typedef = exposed;
    }
    if (webidl.callbackFunctions)
        filtered.callbackFunctions.callbackFunction = filterProperties(webidl.callbackFunctions.callbackFunction, isKnownName);
    if (webidl.callbackInterfaces)
        filtered.callbackInterfaces.interface = filterProperties(webidl.callbackInterfaces.interface, isKnownName);
    if (webidl.dictionaries)
        filtered.dictionaries.dictionary = filterProperties(webidl.dictionaries.dictionary, isKnownName);
    if (webidl.enums)
        filtered.enums.enum = filterProperties(webidl.enums.enum, isKnownName);
    for (const unvisited of forceKnownTypesLogged.unvisitedValues()) {
        console.warn(`${unvisited} is redundant in knownTypes.json (${target})`);
    }
    return deepFilterUnexposedTypes(filtered, unexposedTypes);
}
/**
 * Filters unexposed types out from typedefs and
 * removes typedefs that only contains unexposed type names
 * @param typedefs target typedef array
 * @param unexposedTypes type names to be filtered out
 */
function filterTypedefs(typedefs, unexposedTypes) {
    const exposed = [];
    const removed = new Set();
    typedefs.forEach(filterTypedef);
    if (removed.size) {
        const result = filterTypedefs(exposed, removed);
        result.removed.forEach((s) => removed.add(s));
        return { exposed: result.exposed, removed };
    }
    else {
        return { exposed, removed };
    }
    function filterTypedef(typedef) {
        if (typedef.overrideType) {
            exposed.push(typedef);
        }
        else if (Array.isArray(typedef.type)) {
            const filteredType = filterUnexposedTypeFromUnion(typedef.type, unexposedTypes);
            if (!filteredType.length) {
                removed.add(typedef.name);
            }
            else {
                exposed.push({ ...typedef, type: flattenType(filteredType) });
            }
        }
        else if (unexposedTypes.has(typedef.type)) {
            removed.add(typedef.name);
        }
        else {
            exposed.push(typedef);
        }
    }
}
/**
 * Filters out unexposed type names from union types and optional function arguments
 * @param webidl target types
 * @param unexposedTypes type names to be filtered out
 */
function deepFilterUnexposedTypes(webidl, unexposedTypes) {
    return deepClone(webidl, (o) => {
        if (Array.isArray(o.type)) {
            return {
                ...o,
                type: filterUnexposedTypeFromUnion(o.type, unexposedTypes),
            };
        }
        if (!o.overrideSignatures && Array.isArray(o.signature)) {
            return {
                ...o,
                signature: o.signature.map(filterUnknownTypeFromSignature),
            };
        }
        if (o.members) {
            return filterUnknownTypeFromDictionary(o);
        }
        // TODO: Support filtering dictionary members
    });
    function filterUnknownTypeFromSignature(signature) {
        if (!signature.param) {
            return signature;
        }
        const param = [];
        for (const p of signature.param) {
            const types = Array.isArray(p.type) ? p.type : [p];
            const filtered = filterUnexposedTypeFromUnion(types, unexposedTypes);
            if (filtered.length >= 1) {
                param.push({ ...p, type: flattenType(filtered) });
            }
            else if (!p.optional) {
                throw new Error(`A non-optional parameter has unknown type: ${p.type}`);
            }
            else {
                // safe to skip
                break;
            }
        }
        return { ...signature, param };
    }
    function filterUnknownTypeFromDictionary(dictionary) {
        const result = {};
        for (const member of Object.values(dictionary.members.member)) {
            const filtered = filterUnexposedType(member, unexposedTypes);
            if (filtered) {
                result[member.name] = filtered;
            }
        }
        return { ...dictionary, members: { member: result } };
    }
}
function filterUnexposedType(type, unexposedTypes) {
    if (Array.isArray(type.type)) {
        const filteredUnion = filterUnexposedTypeFromUnion(type.type, unexposedTypes);
        if (filteredUnion.length) {
            return { ...type, type: flattenType(filteredUnion) };
        }
    }
    else if (type.overrideType || !unexposedTypes.has(type.type)) {
        return type;
    }
}
function filterUnexposedTypeFromUnion(union, unexposedTypes) {
    const result = [];
    for (const type of union) {
        const filtered = filterUnexposedType(type, unexposedTypes);
        if (filtered) {
            result.push(filtered);
        }
    }
    return result;
}
function deepClone(o, custom) {
    if (!o || typeof o !== "object") {
        return o;
    }
    if (Array.isArray(o)) {
        return o.map((v) => deepClone(v, custom));
    }
    const mapped = custom(o);
    if (mapped !== undefined) {
        return mapped;
    }
    const clone = {};
    for (const key of Object.getOwnPropertyNames(o)) {
        clone[key] = deepClone(o[key], custom);
    }
    return clone;
}
function flattenType(type) {
    if (type.length > 1) {
        return type;
    }
    else if (type.length === 1) {
        return type[0].type;
    }
    throw new Error("Cannot process empty union type");
}
function isEmptyMixin(i) {
    return (!!i?.mixin &&
        isEmptyRecord(i.properties?.property) &&
        isEmptyRecord(i.methods?.method) &&
        isEmptyRecord(i.constants?.constant) &&
        !i.anonymousMethods?.method.length &&
        !i.events?.event.length);
}
//# sourceMappingURL=expose.js.map