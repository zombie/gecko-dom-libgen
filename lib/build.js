import { promises as fs } from "fs";
import { merge, resolveExposure, arrayToMap } from "./build/helpers.js";
import { emitWebIdl } from "./build/emitter.js";
import { convert } from "./build/widlprocess.js";
import { getExposedTypes } from "./build/expose.js";
import { getDeprecationData, getDocsData, getRemovalData, } from "./build/bcd.js";
import { getInterfaceElementMergeData } from "./build/webref/elements.js";
import { getWebidls } from "./build/webref/idl.js";
import jsonc from "jsonc-parser";
function mergeNamesakes(filtered) {
    const targets = [
        ...Object.values(filtered.interfaces.interface),
        ...Object.values(filtered.mixins.mixin),
        ...filtered.namespaces,
    ];
    for (const i of targets) {
        if (!i.properties || !i.properties.namesakes) {
            continue;
        }
        const { property } = i.properties;
        for (const [prop] of Object.values(i.properties.namesakes)) {
            if (prop && !(prop.name in property)) {
                property[prop.name] = prop;
            }
        }
    }
}
async function emitFlavor(webidl, forceKnownTypes, options) {
    const exposed = getExposedTypes(webidl, options.global, forceKnownTypes);
    mergeNamesakes(exposed);
    const result = emitWebIdl(exposed, options.global[0], "");
    await fs.writeFile(new URL(`${options.name}.generated.d.ts`, options.outputFolder), result);
    const iterators = emitWebIdl(exposed, options.global[0], "sync");
    await fs.writeFile(new URL(`${options.name}.iterable.generated.d.ts`, options.outputFolder), iterators);
    const asyncIterators = emitWebIdl(exposed, options.global[0], "async");
    await fs.writeFile(new URL(`${options.name}.asynciterable.generated.d.ts`, options.outputFolder), asyncIterators);
}
async function emitDom() {
    const inputFolder = new URL("../inputfiles/", import.meta.url);
    const outputFolder = new URL("../generated/", import.meta.url);
    // ${name} will be substituted with the name of an interface
    const removeVerboseIntroductions = [
        [
            /^(The|A) ${name} interface of (the\s*)*((?:(?!API)[A-Za-z\d\s])+ API)/,
            "This $3 interface ",
        ],
        [
            /^(The|A) ${name} (interface|event|object) (is|represents|describes|defines)?/,
            "",
        ],
        [
            /^An object implementing the ${name} interface (is|represents|describes|defines)/,
            "",
        ],
        [/^The ${name} is an interface representing/, ""],
        [/^This type (is|represents|describes|defines)?/, ""],
        [
            /^The (((?:(?!API)[A-Za-z\s])+ API)) ${name} (represents|is|describes|defines)/,
            "The $1 ",
        ],
    ];
    // Create output folder
    await fs.mkdir(outputFolder, {
        // Doesn't need to be recursive, but this helpfully ignores EEXIST
        recursive: true,
    });
    const overriddenItems = await readInputJSON("overridingTypes.jsonc");
    const addedItems = await readInputJSON("addedTypes.jsonc");
    const comments = await readInputJSON("comments.json");
    const deprecatedInfo = await readInputJSON("deprecatedMessage.json");
    const documentationFromMDN = await readInputJSON("mdn/apiDescriptions.json");
    const removedItems = await readInputJSON("removedTypes.jsonc");
    async function readInputJSON(filename) {
        const content = await fs.readFile(new URL(filename, inputFolder), "utf8");
        return jsonc.parse(content);
    }
    const widlStandardTypes = (await Promise.all([...(await getWebidls()).entries()].map(convertWidl))).filter((i) => i);
    const transferables = widlStandardTypes.flatMap((st) => {
        return Object.values(st.browser.interfaces?.interface ?? {}).filter((i) => i.transferable);
    });
    addedItems.typedefs.typedef.push({
        name: "Transferable",
        type: [
            ...transferables.map((v) => ({ type: v.name })),
            { type: "ArrayBuffer" },
        ],
    });
    async function convertWidl([shortName, idl]) {
        let commentsMap;
        try {
            commentsMap = await readInputJSON(`idl/${shortName}.commentmap.json`);
        }
        catch {
            commentsMap = {};
        }
        commentCleanup(commentsMap);
        const result = convert(idl, commentsMap);
        return result;
    }
    function commentCleanup(commentsMap) {
        for (const key in commentsMap) {
            // Filters out phrases for nested comments as we retargets them:
            // "This operation receives a dictionary, which has these members:"
            commentsMap[key] = commentsMap[key].replace(/[,.][^,.]+:$/g, ".");
        }
    }
    function mergeApiDescriptions(idl, descriptions) {
        const namespaces = arrayToMap(idl.namespaces, (i) => i.name, (i) => i);
        for (const [key, value] of Object.entries(descriptions)) {
            const target = idl.interfaces.interface[key] || namespaces[key];
            if (target && !value.startsWith("REDIRECT")) {
                target.comment = transformVerbosity(key, value);
            }
        }
        return idl;
    }
    function mergeDeprecatedMessage(idl, descriptions) {
        const namespaces = arrayToMap(idl.namespaces, (i) => i.name, (i) => i);
        for (const [key, value] of Object.entries(descriptions)) {
            const target = idl.interfaces.interface[key] || namespaces[key];
            if (target) {
                target.deprecated = transformVerbosity(key, value);
            }
        }
        return idl;
    }
    function transformVerbosity(name, description) {
        for (const regTemplate of removeVerboseIntroductions) {
            const [{ source: template }, replace] = regTemplate;
            const reg = new RegExp(template.replace(/\$\{name\}/g, name) + "\\s*");
            const product = description.replace(reg, replace);
            if (product !== description) {
                return product.charAt(0).toUpperCase() + product.slice(1);
            }
        }
        return description;
    }
    /// Load the input file
    let webidl = {};
    for (const w of widlStandardTypes) {
        webidl = merge(webidl, w.browser, true);
    }
    for (const w of widlStandardTypes) {
        for (const partial of w.partialInterfaces) {
            // Fallback to mixins before every spec migrates to `partial interface mixin`.
            const base = webidl.interfaces.interface[partial.name] ||
                webidl.mixins.mixin[partial.name];
            if (base) {
                if (base.exposed)
                    resolveExposure(partial, base.exposed);
                merge(base.constants, partial.constants, true);
                merge(base.methods, partial.methods, true);
                merge(base.properties, partial.properties, true);
            }
        }
        for (const partial of w.partialMixins) {
            const base = webidl.mixins.mixin[partial.name];
            if (base) {
                if (base.exposed)
                    resolveExposure(partial, base.exposed);
                merge(base.constants, partial.constants, true);
                merge(base.methods, partial.methods, true);
                merge(base.properties, partial.properties, true);
            }
        }
        for (const partial of w.partialDictionaries) {
            const base = webidl.dictionaries.dictionary[partial.name];
            if (base) {
                merge(base.members, partial.members, true);
            }
        }
        for (const partial of w.partialNamespaces) {
            const base = webidl.namespaces?.find((n) => n.name === partial.name);
            if (base) {
                if (base.exposed)
                    resolveExposure(partial, base.exposed);
                merge(base.methods, partial.methods, true);
                merge(base.properties, partial.properties, true);
            }
        }
        for (const include of w.includes) {
            const target = webidl.interfaces.interface[include.target];
            if (target) {
                if (!target.implements) {
                    target.implements = [include.includes];
                }
                else {
                    target.implements.push(include.includes);
                }
            }
        }
    }
    webidl = merge(webidl, await getInterfaceElementMergeData());
    webidl = merge(webidl, getDeprecationData(webidl));
    webidl = merge(webidl, getRemovalData(webidl));
    webidl = merge(webidl, getDocsData(webidl));
    webidl = prune(webidl, removedItems);
    webidl = mergeApiDescriptions(webidl, documentationFromMDN);
    webidl = merge(webidl, addedItems);
    webidl = merge(webidl, overriddenItems);
    webidl = merge(webidl, comments);
    webidl = mergeDeprecatedMessage(webidl, deprecatedInfo);
    for (const name in webidl.interfaces.interface) {
        const i = webidl.interfaces.interface[name];
        if (i.overrideExposed) {
            resolveExposure(i, i.overrideExposed, true);
        }
    }
    const knownTypes = await readInputJSON("knownTypes.json");
    emitFlavor(webidl, new Set(knownTypes.Window), {
        name: "dom",
        global: ["Window"],
        outputFolder,
    });
    emitFlavor(webidl, new Set(knownTypes.Worker), {
        name: "webworker",
        global: ["Worker", "DedicatedWorker", "SharedWorker", "ServiceWorker"],
        outputFolder,
    });
    emitFlavor(webidl, new Set(knownTypes.Worker), {
        name: "sharedworker",
        global: ["SharedWorker", "Worker"],
        outputFolder,
    });
    emitFlavor(webidl, new Set(knownTypes.Worker), {
        name: "serviceworker",
        global: ["ServiceWorker", "Worker"],
        outputFolder,
    });
    emitFlavor(webidl, new Set(knownTypes.Worklet), {
        name: "audioworklet",
        global: ["AudioWorklet", "Worklet"],
        outputFolder,
    });
    function prune(obj, template) {
        return filterByNull(obj, template);
        function filterByNull(obj, template) {
            if (!template)
                return obj;
            const filtered = Array.isArray(obj) ? obj.slice(0) : { ...obj };
            for (const k in template) {
                if (!obj[k]) {
                    console.warn(`removedTypes.json has a redundant field ${k} in ${JSON.stringify(template).slice(0, 100)}`);
                }
                else if (Array.isArray(template[k])) {
                    if (!Array.isArray(obj[k])) {
                        throw new Error(`Removal template ${k} is an array but the original field is not`);
                    }
                    // template should include strings
                    filtered[k] = obj[k].filter((item) => {
                        const name = typeof item === "string" ? item : item.name;
                        return !template[k].includes(name);
                    });
                    if (filtered[k].length !== obj[k].length - template[k].length) {
                        const differences = template[k].filter((t) => !obj[k].includes(t));
                        console.warn(`removedTypes.json has redundant array items: ${differences}`);
                    }
                }
                else if (template[k] !== null) {
                    filtered[k] = filterByNull(obj[k], template[k]);
                }
                else {
                    if (obj[k].exposed === "") {
                        console.warn(`removedTypes.json removes ${k} that has already been disabled by BCD.`);
                    }
                    delete filtered[k];
                }
            }
            return filtered;
        }
    }
}
await emitDom();
//# sourceMappingURL=build.js.map