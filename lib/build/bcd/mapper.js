import api from "bcd-idl-mapper";
import { filterMapRecord, isEmptyRecord } from "../utils/record.js";
import { mapDefined } from "../helpers.js";
import { hasStableImplementation } from "./stable.js";
function mergeCompatStatements(data) {
    if (!data) {
        return;
    }
    if (data?.__compat) {
        return data.__compat;
    }
    // Some items have no top level __compat and instead have contexts with compat data for each
    const statements = Object.values(data)
        .map((d) => d.__compat)
        .filter((n) => n);
    const base = Object.fromEntries(Object.keys(statements[0].support).map((key) => {
        return [key, []];
    }));
    for (const statement of statements) {
        for (const key of Object.keys(statement.support)) {
            const support = statement.support[key];
            if (support && hasStableImplementation(support)) {
                if (!base[key]) {
                    base[key] = []; // some support field is not everywhere e.g. deno
                }
                base[key].push(...(Array.isArray(support) ? support : [support]));
            }
        }
    }
    return { ...statements[0], support: base };
}
function mapInterfaceLike(name, i, mapper) {
    const data = i.mixin
        ? api.__mixins[name]
        : i.legacyNamespace
            ? api[i.legacyNamespace][name]
            : api[name];
    const intCompat = data?.__compat;
    const mapped = mapper({ key: name, compat: intCompat, mixin: !!i.mixin });
    if (!data) {
        if (mapped) {
            return { name: i.name, ...mapped };
        }
        return;
    }
    const result = { ...mapped };
    const recordMapper = (key) => {
        const compat = mergeCompatStatements(data[key]);
        return mapper({
            key,
            parentKey: name,
            compat,
            mixin: !!i.mixin,
        });
    };
    const methods = filterMapRecord(i.methods?.method, recordMapper, i.namespace);
    const properties = filterMapRecord(i.properties?.property, recordMapper, i.namespace);
    if (i.iterator) {
        const iteratorKey = i.iterator.async ? "@@asyncIterator" : "@@iterator";
        // BCD often doesn't have an @@iterator entry, but it does usually have an entry
        // for iterable methods such as values(). Use that as a fallback.
        // See also: https://github.com/mdn/browser-compat-data/issues/6367
        const iteratorCompat = mergeCompatStatements(data[iteratorKey] ?? data["values"]);
        const iteratorMapped = mapper({
            key: iteratorKey,
            parentKey: name,
            compat: iteratorCompat,
            mixin: !!i.mixin,
        });
        if (iteratorMapped !== undefined) {
            result.iterator = iteratorMapped;
        }
    }
    if (!isEmptyRecord(methods)) {
        result.methods = { method: methods };
    }
    if (!isEmptyRecord(properties)) {
        result.properties = { property: properties };
    }
    if (!isEmptyRecord(result)) {
        return { name: i.name, ...result };
    }
}
export function mapToBcdCompat(webidl, mapper) {
    const map = (name, i) => mapInterfaceLike(name, i, mapper);
    const interfaces = filterMapRecord(webidl.interfaces?.interface, map);
    const mixins = filterMapRecord(webidl.mixins?.mixin, map);
    const namespaces = mapDefined(webidl.namespaces, (n) => mapInterfaceLike(n.name, n, mapper));
    if (!isEmptyRecord(interfaces) ||
        !isEmptyRecord(mixins) ||
        !isEmptyRecord(namespaces)) {
        return {
            interfaces: interfaces && { interface: interfaces },
            mixins: mixins && { mixin: mixins },
            namespaces,
        };
    }
}
//# sourceMappingURL=mapper.js.map