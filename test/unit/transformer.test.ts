import { describe, expect, test } from "bun:test";

import { runTransformer, transformRanges } from "../../src/handlers/handler.transformer";
import type { ParsedTransform, TransformContext } from "../../src/types";
import { FakeDocument, FakeEditor, Position, Range } from "./vscode.mock";

const ctx: TransformContext = { file: "f.ts", ext: "ts", rootPath: "/", lines: [], line: -1 };

describe("runTransformer", () => {
  test("chains functions so each receives the previous output", async () => {
    const fns = [
      (t: string) => t.replace("a", "b"),
      (t: string) => t.replace("b", "c"),
      async (t: string) => t + "!",
    ];
    expect(await runTransformer({ label: "chain", type: "raw", functions: fns }, "a", ctx)).toBe(
      "c!",
    );
  });

  test("wraps a throwing transformer in a Warning naming the transform", async () => {
    const boom = () => {
      throw new Error("kaboom");
    };
    const p = runTransformer({ label: "bad", type: "raw", functions: [boom] }, "a", ctx);
    await expect(p).rejects.toThrow(/bad[\s\S]*kaboom/);
  });
});

describe("transformRanges", () => {
  const lineTransform = (fn: (t: string) => string, separator?: string): ParsedTransform => ({
    label: "line",
    type: "line",
    separator,
    functions: [fn],
  });

  test("line transforms receive lines without their line break and edits exclude the break", async () => {
    const doc = new FakeDocument("  a  \n  b  \n");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(2, 0));
    const seen: string[] = [];
    const [edits] = await transformRanges(
      lineTransform((t) => {
        seen.push(t);
        return t.trim();
      }),
      full,
      editor,
      ctx,
    );
    expect(seen).toEqual(["  a  ", "  b  "]);
    expect(edits.map((e) => [e.range.start.line, e.range.end.line, e.newText])).toEqual([
      [0, 0, "a"],
      [1, 1, "b"],
    ]);
  });

  test("ctx.line is the index within the selection and ctx.lines holds all chunks", async () => {
    const doc = new FakeDocument("x\ny\nz");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(2, 1));
    const seen: [number, string[]][] = [];
    const [edits] = await transformRanges(
      {
        label: "ctx",
        type: "line",
        functions: [
          (t, c) => {
            seen.push([c.line, c.lines]);
            return t.toUpperCase();
          },
        ],
      },
      full,
      editor,
      ctx,
    );
    expect(seen).toEqual([
      [0, ["x", "y", "z"]],
      [1, ["x", "y", "z"]],
      [2, ["x", "y", "z"]],
    ]);
    expect(edits.map((e) => e.newText)).toEqual(["X", "Y", "Z"]);
  });

  test("a custom separator splits the selection into chunks", async () => {
    const doc = new FakeDocument("a, b, c");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(0, 7));
    const [edits] = await transformRanges(
      lineTransform((t) => t.toUpperCase(), ", "),
      full,
      editor,
      ctx,
    );
    expect(edits.map((e) => [doc.getText(e.range), e.newText])).toEqual([
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
    ]);
  });

  test("skips edits whose output equals the input", async () => {
    const doc = new FakeDocument("keep\nchange");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(1, 6));
    const [edits] = await transformRanges(
      lineTransform((t) => t.replace("change", "changed")),
      full,
      editor,
      ctx,
    );
    expect(edits.map((e) => e.newText)).toEqual(["changed"]);
  });

  test("raw transforms receive the whole selection once", async () => {
    const doc = new FakeDocument("a\nb");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(1, 1));
    const [edits] = await transformRanges(
      { label: "raw", type: "raw", functions: [(t) => t.split("\n").reverse().join("\n")] },
      full,
      editor,
      ctx,
    );
    expect(edits.map((e) => e.newText)).toEqual(["b\na"]);
  });

  test("regexp transforms apply to the whole selection", async () => {
    const doc = new FakeDocument("'a' 'b'");
    const editor = new FakeEditor(doc) as any;
    const full: any = new Range(new Position(0, 0), new Position(0, 7));
    const [edits] = await transformRanges(
      {
        type: "regexp",
        label: "q",
        flags: "g",
        transforms: [{ matcher: /'(.*?)'/g, replacer: '"$1"', flags: "g" }],
      },
      full,
      editor,
      ctx,
    );
    expect(edits.map((e) => e.newText)).toEqual(['"a" "b"']);
  });
});
