export const forceKeepAlive = {
    // Things that are incorrectly reported as unsupported.
    // These should be filed to https://github.com/mdn/browser-compat-data/issues
    CSSStyleDeclaration: [
        // https://github.com/mdn/browser-compat-data/commit/ebabd27460a306d6de80107b7e3c62be99ecd13c#r135144607
        "webkitMaskComposite",
    ],
    GlobalEventHandlers: [
        "onwebkitanimationend",
        "onwebkitanimationiteration",
        "onwebkitanimationstart",
    ],
    IDBDatabase: [
        // BCD unexpectedly is removing valid event data
        // https://github.com/mdn/browser-compat-data/issues/15345
        "onabort",
        "onerror",
    ],
    ShadowRoot: [
        // BCD unexpectedly is removing valid event data
        // https://github.com/mdn/browser-compat-data/issues/15345
        "onslotchange",
    ],
    WorkerGlobalScope: ["onrejectionhandled", "onunhandledrejection"],
    XMLHttpRequestEventTarget: [
        // BCD unexpectedly is removing valid event data
        // https://github.com/mdn/browser-compat-data/issues/15345
        "onabort",
        "onerror",
        "onload",
        "onloadend",
        "onloadstart",
        "onprogress",
        "ontimeout",
    ],
};
//# sourceMappingURL=keep-alive.js.map