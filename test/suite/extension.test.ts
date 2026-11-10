import * as assert from "assert";

import * as vscode from "vscode";

import type * as extension from "../../src/extension";

const EXTENSION_ID = "0xp.find-select-transform";

async function activateExtension(fileToOpen: vscode.Uri) {
  const ext = vscode.extensions.getExtension<extension.SelectTransform>(EXTENSION_ID);
  assert.ok(ext, "Extension not found");
  const editor = await vscode.window.showTextDocument(fileToOpen);
  const api = await ext.activate();
  await api.transpile();
  return { ext: api, editor };
}

suite("find-select-transform", () => {
  let ext: extension.SelectTransform;
  let editor: vscode.TextEditor;

  suiteSetup(async () => {
    const folder = vscode.workspace.workspaceFolders![0];
    ({ ext, editor } = await activateExtension(vscode.Uri.joinPath(folder.uri, "index.ts")));
  });

  test("activates and loads the example transforms", async () => {
    assert.ok(ext.isReady(), "transforms file not transpiled");
    const labels = ext.getTransforms().all.map((t) => t.label);
    assert.ok(labels.includes("helloWorldsToBar"), `missing transform in ${labels}`);
    assert.deepStrictEqual(
      ext.getTransforms(".ts").filtered.map((t) => t.label),
      ["helloWorldsToFoo"],
    );
  });

  test("registers its commands", async () => {
    const commands = await ext.getCommands();
    assert.ok(commands.includes("find-select-transform.transform.selection"));
    assert.ok(commands.includes("find-select-transform.motion.select"));
  });

  test("line transforms apply per line and raw transforms once per range", async () => {
    editor.selections = [new vscode.Selection(0, 0, 2, 0)];
    const result = await ext.transform({ transforms: ["helloWorldsToBar"] });
    assert.strictEqual(result.editCount, 2);
    assert.strictEqual(lineText(0), "const a = 'bar';");
    assert.strictEqual(lineText(1), "const b = 'bar';");

    editor.selections = [new vscode.Selection(0, 0, 2, 0)];
    await ext.transform({
      transforms: [
        {
          type: "raw",
          label: "inline",
          functions: [(text) => text.replaceAll("bar", "hello world")],
        },
      ],
    });
    assert.strictEqual(lineText(0), "const a = 'hello world';");
    assert.strictEqual(lineText(1), "const b = 'hello world';");
  });

  test("chained transforms feed each other", async () => {
    editor.selections = [new vscode.Selection(0, 0, 1, 0)];
    const result = await ext.transform({ transforms: ["noop"] });
    assert.strictEqual(result.editCount, 0, "noop chain should not produce edits");
    assert.strictEqual(lineText(0), "const a = 'hello world';");
  });

  test("motions select element contents", async () => {
    cursorAt("foo");
    await ext.motion("'");
    assert.strictEqual(editor.document.getText(editor.selection), "foo");

    cursorAt("const b");
    await ext.motion("'", { isNext: true });
    assert.strictEqual(editor.document.getText(editor.selection), "hello world");
  });

  function lineText(line: number) {
    return editor.document.lineAt(line).text;
  }

  function cursorAt(text: string) {
    const offset = editor.document.getText().indexOf(text);
    assert.ok(offset >= 0, `"${text}" not found in document`);
    const position = editor.document.positionAt(offset);
    editor.selections = [new vscode.Selection(position, position)];
  }
});
