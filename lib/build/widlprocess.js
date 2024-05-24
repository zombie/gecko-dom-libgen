import * as webidl2 from "webidl2";
import { getEmptyWebIDL } from "./helpers.js";
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function convert(text, commentMap) {
    const rootTypes = webidl2.parse(text);
    const partialInterfaces = [];
    const partialMixins = [];
    const partialDictionaries = [];
    const partialNamespaces = [];
    const includes = [];
    const namespaceNested = {};
    const browser = getEmptyWebIDL();
    for (const rootType of rootTypes) {
        if (rootType.type === "interface") {
            const converted = convertInterface(rootType, commentMap);
            if (rootType.partial) {
                partialInterfaces.push(converted);
            }
            else {
                browser.interfaces.interface[rootType.name] = converted;
            }
        }
        else if (rootType.type === "interface mixin") {
            const converted = convertInterfaceMixin(rootType, commentMap);
            if (rootType.partial) {
                partialMixins.push(converted);
            }
            else {
                browser.mixins.mixin[rootType.name] = converted;
            }
        }
        else if (rootType.type === "namespace") {
            const converted = convertNamespace(rootType, commentMap);
            if (rootType.partial) {
                partialNamespaces.push(converted);
            }
            else {
                browser.namespaces.push(converted);
            }
        }
        else if (rootType.type === "callback interface") {
            browser.callbackInterfaces.interface[rootType.name] =
                convertInterfaceCommon(rootType, commentMap);
        }
        else if (rootType.type === "callback") {
            browser.callbackFunctions.callbackFunction[rootType.name] =
                convertCallbackFunctions(rootType);
            addComments(browser.callbackFunctions.callbackFunction[rootType.name], commentMap, rootType.name);
        }
        else if (rootType.type === "dictionary") {
            const converted = convertDictionary(rootType, commentMap);
            if (rootType.partial) {
                partialDictionaries.push(converted);
            }
            else {
                browser.dictionaries.dictionary[rootType.name] = converted;
            }
        }
        else if (rootType.type === "enum") {
            browser.enums.enum[rootType.name] = convertEnum(rootType);
        }
        else if (rootType.type === "typedef") {
            browser.typedefs.typedef.push(convertTypedef(rootType));
        }
        else if (rootType.type === "includes") {
            includes.push(rootType);
        }
    }
    return {
        browser,
        partialInterfaces,
        partialMixins,
        partialDictionaries,
        partialNamespaces,
        includes,
        namespaceNested,
    };
}
function hasExtAttr(extAttrs, name) {
    return extAttrs.some((extAttr) => extAttr.name === name);
}
function getExtAttr(extAttrs, name) {
    const attr = extAttrs.find((extAttr) => extAttr.name === name);
    if (!attr || !attr.rhs) {
        return [];
    }
    if (attr.rhs.type === "*") {
        return ["*"];
    }
    return attr.rhs.type === "identifier-list" ||
        attr.rhs.type === "string-list" ||
        attr.rhs.type === "decimal-list" ||
        attr.rhs.type === "integer-list"
        ? attr.rhs.value.map((item) => item.value)
        : [attr.rhs.value];
}
function getExtAttrConcatenated(extAttrs, name) {
    const extAttr = getExtAttr(extAttrs, name);
    if (extAttr.length) {
        return extAttr.join(" ");
    }
}
function convertInterface(i, commentMap) {
    const result = convertInterfaceCommon(i, commentMap);
    if (i.inheritance) {
        result.extends = i.inheritance;
    }
    return result;
}
function convertInterfaceMixin(i, commentMap) {
    const result = convertInterfaceCommon(i, commentMap);
    result.mixin = true;
    result.noInterfaceObject = true;
    return result;
}
function addComments(obj, commentMap, container, member) {
    const key = container.toLowerCase() + (member ? "-" + member.toLowerCase() : "");
    if (commentMap[key]) {
        obj.comment = commentMap[key];
    }
}
function convertInterfaceCommon(i, commentMap) {
    const result = {
        name: i.name,
        constants: { constant: {} },
        methods: { method: {} },
        anonymousMethods: { method: [] },
        properties: { property: {}, namesakes: {} },
        constructor: getConstructor(i.members, i.name) ||
            getOldStyleConstructor(i.extAttrs, i.name),
        namedConstructor: getLegacyFactoryFunction(i.extAttrs, i.name),
        exposed: getExtAttrConcatenated(i.extAttrs, "Exposed"),
        global: getExtAttrConcatenated(i.extAttrs, "Global"),
        noInterfaceObject: hasExtAttr(i.extAttrs, "LegacyNoInterfaceObject") ||
            hasExtAttr(i.extAttrs, "NoInterfaceObject"),
        legacyWindowAlias: getExtAttr(i.extAttrs, "LegacyWindowAlias"),
        legacyNamespace: getExtAttr(i.extAttrs, "LegacyNamespace")[0],
        secureContext: hasExtAttr(i.extAttrs, "SecureContext"),
        transferable: hasExtAttr(i.extAttrs, "Transferable"),
    };
    if (!result.exposed && i.type === "interface" && !i.partial) {
        result.exposed = "Window";
    }
    for (const member of i.members) {
        if (member.type === "const") {
            result.constants.constant[member.name] = convertConstantMember(member);
            addComments(result.constants.constant[member.name], commentMap, i.name, member.name);
        }
        else if (member.type === "attribute") {
            const { properties } = result;
            const prop = convertAttribute(member, result.exposed);
            addComments(prop, commentMap, i.name, member.name);
            if (member.name in properties.namesakes) {
                properties.namesakes[member.name].push(prop);
            }
            else if (member.name in properties.property) {
                const existing = properties.property[member.name];
                delete properties.property[member.name];
                properties.namesakes[member.name] = [existing, prop];
            }
            else {
                properties.property[member.name] = prop;
            }
        }
        else if (member.type === "operation") {
            const operation = convertOperation(member, result.exposed);
            const { method } = result.methods;
            if (!member.name) {
                result.anonymousMethods.method.push(operation);
            }
            else if (method.hasOwnProperty(member.name)) {
                method[member.name].signature.push(...operation.signature);
            }
            else {
                method[member.name] = operation;
            }
            if (member.name) {
                addComments(method[member.name], commentMap, i.name, member.name);
            }
        }
        else if (member.type === "iterable" ||
            member.type === "maplike" ||
            member.type === "setlike") {
            result.iterator = {
                kind: member.type,
                readonly: member.readonly,
                async: member.async,
                param: member.arguments.map(convertArgument),
                type: member.idlType.map(convertIdlType),
            };
        }
    }
    return result;
}
function getConstructor(members, parent) {
    const constructor = {
        signature: [],
    };
    for (const member of members) {
        if (member.type === "constructor") {
            constructor.signature.push({
                type: parent,
                param: member.arguments.map(convertArgument),
            });
        }
    }
    if (constructor.signature.length) {
        return constructor;
    }
}
function getOldStyleConstructor(extAttrs, parent) {
    const constructor = {
        signature: [],
    };
    for (const extAttr of extAttrs) {
        if (extAttr.name === "Constructor") {
            constructor.signature.push({
                type: parent,
                param: extAttr.arguments.map(convertArgument),
            });
        }
    }
    if (constructor.signature.length) {
        return constructor;
    }
}
function getLegacyFactoryFunction(extAttrs, parent) {
    for (const extAttr of extAttrs) {
        if (extAttr.name === "LegacyFactoryFunction" &&
            extAttr.rhs &&
            typeof extAttr.rhs.value === "string") {
            return {
                name: extAttr.rhs.value,
                signature: [
                    {
                        type: parent,
                        param: extAttr.arguments
                            ? extAttr.arguments.map(convertArgument)
                            : [],
                    },
                ],
            };
        }
    }
}
function convertOperation(operation, inheritedExposure) {
    const isStringifier = operation.special === "stringifier";
    const type = operation.idlType
        ? convertIdlType(operation.idlType)
        : isStringifier
            ? { type: "DOMString" }
            : undefined;
    if (!type) {
        throw new Error("Unexpected anonymous operation");
    }
    return {
        name: operation.name || undefined,
        signature: [
            {
                ...type,
                param: operation.arguments.map(convertArgument),
            },
        ],
        getter: operation.special === "getter",
        static: operation.special === "static",
        stringifier: isStringifier,
        exposed: getExtAttrConcatenated(operation.extAttrs, "Exposed") ||
            inheritedExposure,
        secureContext: hasExtAttr(operation.extAttrs, "SecureContext"),
    };
}
function convertCallbackFunctions(c) {
    return {
        name: c.name,
        signature: [
            {
                ...convertIdlType(c.idlType),
                param: c.arguments.map(convertArgument),
            },
        ],
    };
}
function convertArgument(arg) {
    const idlType = convertIdlType(arg.idlType);
    if (hasExtAttr(arg.extAttrs, "LegacyNullToEmptyString")) {
        idlType.nullable = true;
    }
    return {
        name: arg.name,
        ...idlType,
        optional: arg.optional,
        variadic: arg.variadic,
    };
}
function convertAttribute(attribute, inheritedExposure) {
    const isEventHandler = typeof attribute.idlType.idlType === "string" &&
        attribute.idlType.idlType.endsWith("EventHandler"); // includes OnErrorEventHandler
    return {
        name: attribute.name,
        ...convertIdlType(attribute.idlType),
        static: attribute.special === "static",
        stringifier: attribute.special === "stringifier",
        readonly: attribute.readonly,
        eventHandler: isEventHandler ? attribute.name.slice(2) : undefined,
        exposed: getExtAttrConcatenated(attribute.extAttrs, "Exposed") ||
            inheritedExposure,
        putForwards: getExtAttr(attribute.extAttrs, "PutForwards")[0],
        secureContext: hasExtAttr(attribute.extAttrs, "SecureContext"),
    };
}
function convertConstantMember(constant) {
    return {
        name: constant.name,
        type: constant.idlType.idlType,
        value: convertConstantValue(constant.value),
    };
}
function convertConstantValue(value) {
    switch (value.type) {
        case "string":
            return `"${value.value}"`;
        case "boolean":
        case "number":
        case "sequence":
            return `${value.value}`;
        case "null":
        case "NaN":
            return value.type;
        case "Infinity":
            return (value.negative ? "-" : "") + value.type;
        case "dictionary":
            return "{}";
        default:
            throw new Error(`Not implemented: ${value.type}`);
    }
}
function convertNamespace(namespace, commentMap) {
    const result = {
        name: namespace.name,
        namespace: true,
        constructor: { signature: [] },
        methods: { method: {} },
        properties: { property: {} },
        exposed: getExtAttrConcatenated(namespace.extAttrs, "Exposed"),
    };
    for (const member of namespace.members) {
        if (member.type === "attribute") {
            result.properties.property[member.name] = convertAttribute(member, result.exposed);
            addComments(result.properties.property[member.name], commentMap, namespace.name, member.name);
        }
        else if (member.type === "operation" && member.idlType) {
            const operation = convertOperation(member, result.exposed);
            const { method } = result.methods;
            if (method[member.name]) {
                method[member.name].signature.push(...operation.signature);
            }
            else {
                method[member.name] = operation;
            }
            if (member.name) {
                addComments(method[member.name], commentMap, namespace.name, member.name);
            }
        }
    }
    return result;
}
function convertDictionary(dictionary, commentsMap) {
    const result = {
        name: dictionary.name,
        members: { member: {} },
    };
    if (dictionary.inheritance) {
        result.extends = dictionary.inheritance;
    }
    for (const member of dictionary.members) {
        result.members.member[member.name] = convertDictionaryMember(member);
        addComments(result.members.member[member.name], commentsMap, dictionary.name, member.name);
    }
    addComments(result, commentsMap, dictionary.name);
    return result;
}
function convertDictionaryMember(member) {
    return {
        name: member.name,
        default: member.default ? convertConstantValue(member.default) : undefined,
        required: member.required,
        ...convertIdlType(member.idlType),
    };
}
function convertEnum(en) {
    return {
        name: en.name,
        value: en.values.map((value) => value.value),
    };
}
function convertTypedef(typedef) {
    return {
        name: typedef.name,
        ...convertIdlType(typedef.idlType),
    };
}
function convertIdlType(i) {
    if (typeof i.idlType === "string") {
        return {
            type: i.idlType,
            nullable: i.nullable,
        };
    }
    if (i.generic) {
        return {
            type: i.generic,
            subtype: !Array.isArray(i.idlType)
                ? convertIdlType(i.idlType)
                : i.idlType.length === 1
                    ? convertIdlType(i.idlType[0])
                    : i.idlType.map(convertIdlType),
            nullable: i.nullable,
        };
    }
    if (i.union) {
        return {
            type: i.idlType.map(convertIdlType),
            nullable: i.nullable,
        };
    }
    throw new Error("Unsupported IDL type structure");
}
//# sourceMappingURL=widlprocess.js.map