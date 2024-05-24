export function hasStableImplementation(browser, prefix) {
    if (!browser) {
        return false;
    }
    const latest = !Array.isArray(browser)
        ? browser
        : browser.find((i) => i.prefix === prefix); // first one if no prefix
    if (!latest) {
        return false;
    }
    return (!!latest.version_added &&
        // "preview" means BCD has no idea about whether it will ride the train
        // https://github.com/mdn/browser-compat-data/issues/12344
        latest.version_added !== "preview" &&
        !latest.version_removed &&
        !latest.flags &&
        latest.prefix === prefix &&
        !latest.alternative_name);
}
//# sourceMappingURL=stable.js.map