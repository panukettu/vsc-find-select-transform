import { describe, expect, test } from "bun:test";

import { getRegexpFlags, isValidRegExpConfig } from "../../src/config/config.regexp";

describe("isValidRegExpConfig", () => {
  test("accepts the documented shape", () => {
    expect(
      isValidRegExpConfig({
        toDoubleQuotes: { flags: "g", transforms: [["'(.*?)'", '"$1"']] },
        withExtra: { transforms: [["a", "b", "gi"]], additionalValues: { comment: "(//.*)$" } },
      }),
    ).toBe(true);
  });
  test("rejects invalid per-item flags and additionalValues", () => {
    expect(isValidRegExpConfig({ x: { flags: "z", transforms: [["a", "b"]] } })).toBe(false);
    expect(
      isValidRegExpConfig({ x: { transforms: [["a", "b"]], additionalValues: { c: 1 } } }),
    ).toBe(false);
  });
  test("rejects non-object items and malformed pairs without throwing", () => {
    expect(isValidRegExpConfig({ x: null })).toBe(false);
    expect(isValidRegExpConfig({ x: { transforms: [["only-one"]] } })).toBe(false);
    expect(isValidRegExpConfig({ x: { transforms: "nope" } })).toBe(false);
    expect(isValidRegExpConfig({ x: { transforms: [["a", "b", "q"]] } })).toBe(false);
  });
});

describe("getRegexpFlags", () => {
  test("falls back and validates", () => {
    expect(getRegexpFlags(undefined)).toBe("gm");
    expect(getRegexpFlags({ flags: "gi" })).toBe("gi");
    expect(getRegexpFlags("s", "g")).toBe("s");
    expect(() => getRegexpFlags("x")).toThrow();
  });
});
