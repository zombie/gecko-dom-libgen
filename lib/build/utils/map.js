export function addToArrayMap(map, name, value) {
    const array = map.get(name) || [];
    array.push(value);
    map.set(name, array);
}
export function addToStringMap(map, name, value) {
    const old = map.get(name) || "";
    map.set(name, `${old}\n${value}\n`);
}
//# sourceMappingURL=map.js.map