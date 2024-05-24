/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const fs = require("fs");
const WEBREF = require.resolve("@webref/idl").replace("index.js", "");

// Convert Mozilla-flavor webidl into idl parsable by @w3c/webidl2.js.
function preprocess(webidl) {
  return webidl
    .replaceAll(/^#.+/gm, "")
    .replaceAll(
      /interface (\w+);/gm,
      "[LegacyNoInterfaceObject,Exposed=*] interface $1 {};"
    )
    .replaceAll(/\bUTF8String\b/gm, "DOMString")
    .replaceAll(/^\s*legacycaller /gm, "getter ")
    .replaceAll(/^\s*legacycaller/gm, "any legacycaller")
    .replaceAll(/^callback constructor /gm, "callback ")
    .replaceAll(/(ElementCreationOptions) or (DOMString)/gm, "$2 or $1")
    .replaceAll(/Exposed=(Window|\([\w,\s]*Window[\w,\s]*\))/gm, "Exposed=*")
    .replaceAll(/(attribute boolean aecDebug;)/gm, "readonly $1");
}

// Replace existing idls inside @webref/idl with provided (processed) webidls.
function replaceIdls(webidls) {
  fs.readdirSync(WEBREF)
    .filter((fn) => fn.endsWith(".idl"))
    .forEach((fn) => {
      fs.rmSync(`${WEBREF}/${fn}`);
    });
  Object.entries(webidls).forEach(([fn, idl]) => {
    fs.writeFileSync(`${WEBREF}/${fn.replace("/", ".")}.idl`, preprocess(idl));
  });
}

// Populate fake compat data from an interface, make all members exposed.
function fakeCompatData(i, data) {
  let __compat = {
    support: {
      firefox: { version_added: 1 },
      safari: { version_added: 1 },
    },
  };
  let members = { ...i.properties?.property, ...i.methods?.method };
  for (let m of Object.values(members)) {
    data[m.name + (m.static || i.namespace ? "_static" : "")] = { __compat };
  }
  if (i.iterator && !i.iterator.async) {
    data.forEach = { __compat };
    data.values = { __compat };
  }
  data.__compat = { ...__compat };
}

// Add static isInstance methods for all interfaces with constructors.
function addIsInstance(i) {
  let isInstance = {
    name: "isInstance",
    type: "IsInstance",
    subtype: { type: i.name },
    static: true,
  };
  return { properties: { property: { isInstance } } };
}

// Gather all interface-like entities (mixins, namespaces, dicts) from idl.
async function interfaceLike() {
  const webref = require("@webref/idl");
  const wp = await import(`./lib/build/widlprocess.js`);

  let all = Object.values(await webref.listAll()).map(async (idl) => {
    let w = wp.convert(await idl.text(), {});
    return [
      Object.values(w.browser.dictionaries.dictionary),
      Object.values(w.browser.interfaces.interface),
      Object.values(w.browser.mixins.mixin),
      w.browser.namespaces,
      w.partialInterfaces,
      w.partialMixins,
      w.partialNamespaces,
    ];
  });
  return (await Promise.all(all)).flat(2);
}

// Prepare BCD and input files for TypeScript-DOM-lib-generator.
async function prepInputsFiles() {
  let bcd = { api: {}, css: { properties: {} }, webassembly: {} };
  let added = { interfaces: { interface: {} }, typedefs: { typedef: [] } };

  for (let i of await interfaceLike()) {
    fakeCompatData(i, (bcd.api[i.name] ??= {}));
    if (!i.mixin && !i.namespace && !i.noInterfaceObject && !i.members) {
      added.interfaces.interface[i.name] = addIsInstance(i);
    }
  }

  // Need an item with mdn_url and deprecated, or getDocsData voids everything.
  bcd.api.TestUtils.__compat.status = { deprecated: 1 };
  bcd.api.TestUtils.__compat.mdn_url = "data:,";

  writeJson("@mdn/browser-compat-data", bcd);
  writeJson("./inputfiles/addedTypes.jsonc", added);
}

function writeJson(p, data) {
  fs.writeFileSync(require.resolve(p), JSON.stringify(data, null, 2));
}

// TS lib generator doesn't await emitFlavor() calls, need to poll for changes.
async function awaitGenerated() {
  let path = `${__dirname}/generated/dom.generated.d.ts`;
  let time = Date.now();
  let stat;
  do {
    if (Date.now() > time + 15_000) {
      throw new Error("Timeout waiting for TypeScript-DOM-lib-generator");
    }
    stat = fs.statSync(path, { throwIfNoEntry: false });
    await new Promise((r) => setTimeout(r, 100));
  } while (!stat?.size);
  return fs.readFileSync(path, "utf-8");
}

// Wrap TypeScript-DOM-lib-generator: prepare inputs, run, await output.
async function generate(webidls) {
  replaceIdls(webidls);
  await prepInputsFiles();
  await import("./lib/build.js");
  return awaitGenerated();
}
exports.generate = generate;
