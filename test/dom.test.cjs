/* eslint-env node, jest */
"use strict";

const fs = require("fs");
const { generate } = require("../index.cjs");

const FILES = [
  "test_builtin.webidl",
  "TestFunctions.webidl",
  "TestInterfaceJSDictionaries.webidl",
  "TestInterfaceObservableArray.webidl",
  "TestInterfaceJS.webidl",
  "TestInterfaceJSMaplikeSetlikeIterable.webidl",
  "TestUtils.webidl",
];

function read(path) {
  return fs.readFileSync(require.resolve(path), "utf8");
}

test("Test*.webidl produces baseline dom.generated.d.ts", async () => {
  let dts = await generate(FILES.map((fn) => read(`./fixtures/${fn}`)));
  expect(dts).toEqual(read("./baselines/dom.generated.d.ts"));
});

test("Test*.webidl produces expected input files", async () => {
  let added = JSON.parse(read(`../inputfiles/addedTypes.jsonc`));
  expect(added).toEqual(JSON.parse(read("./baselines/addedTypes.jsonc")));

  let bcd = JSON.parse(read("@mdn/browser-compat-data"));
  expect(bcd).toEqual(JSON.parse(read("./baselines/bcd.data.json")));
});
