import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import type { ExportedTransforms, Transform } from "../transformer";
import type { ParsedTransform, Transpilation } from "../types";
import { settings } from "./config.common";

export const DEFAULT_SOURCE = "<root>/.vscode/transformer.ts";

const nodeRequire = createRequire(__filename);

export type LoadedTransforms = { transforms: ParsedTransform[]; errors: string[] };

/**
 * Loads the transpiled transforms module and validates its default export.
 * Never throws: problems are returned as human readable `errors`.
 */
export function loadTransforms(transpiled: Pick<Transpilation, "js" | "files">): LoadedTransforms {
  for (const file of new Set([transpiled.js, ...transpiled.files])) {
    try {
      delete nodeRequire.cache[nodeRequire.resolve(file)];
    } catch {
      // Not loaded before, nothing to evict.
    }
  }

  let mod: unknown;
  try {
    mod = nodeRequire(transpiled.js);
  } catch (e) {
    return {
      transforms: [],
      errors: [`Failed to load ${transpiled.js}: ${e instanceof Error ? e.message : e}`],
    };
  }

  const exported = (mod as { default?: unknown })?.default ?? mod;
  if (!isExportedTransforms(exported)) {
    return {
      transforms: [],
      errors: [
        "The transforms file must `export default { transforms: { name: transform, ... } }`.",
      ],
    };
  }

  const result: LoadedTransforms = { transforms: [], errors: [] };
  for (const [label, item] of Object.entries(exported.transforms)) {
    const parsed = parseTransform(label, item);
    if (typeof parsed === "string") result.errors.push(parsed);
    else result.transforms.push(parsed);
  }
  if (!result.transforms.length && !result.errors.length)
    result.errors.push("The transforms file exports no transforms.");
  return result;
}

function parseTransform(label: string, item: Transform): ParsedTransform | string {
  const functions = typeof item === "object" && item !== null && "run" in item ? item.run : item;
  const type = typeof item === "object" && item !== null && "type" in item ? item.type : "line";
  const separator =
    typeof item === "object" && item !== null && "separator" in item ? item.separator : undefined;

  if (type !== "line" && type !== "raw")
    return `Transform "${label}": type must be "line" or "raw".`;
  if (separator != null && typeof separator !== "string")
    return `Transform "${label}": separator must be a string.`;

  const list = Array.isArray(functions) ? functions : [functions];
  if (!list.length || !list.every((fn) => typeof fn === "function")) {
    return `Transform "${label}": expected a function, an array of functions, or { type, run }.`;
  }
  return { label, functions: list, type, separator: separator || undefined };
}

function isExportedTransforms(exports: unknown): exports is ExportedTransforms {
  if (typeof exports !== "object" || exports === null) return false;
  if (!("transforms" in exports)) return false;
  const transforms = (exports as { transforms: unknown }).transforms;
  return typeof transforms === "object" && transforms !== null && !Array.isArray(transforms);
}

/**
 * Resolves the configured transforms file path. `<root>` and `<home>` are
 * expanded; relative paths are resolved against the workspace root. Returns an
 * empty string when the path cannot be resolved (e.g. `<root>` without a folder).
 */
export function getSourcePath(rootPath: string) {
  let source = settings<string>("transform.src", DEFAULT_SOURCE) || DEFAULT_SOURCE;

  if (source.includes("<home>")) source = source.replace("<home>", os.homedir());
  if (source.includes("<root>")) {
    if (!rootPath) return "";
    source = source.replace("<root>", rootPath);
  }
  if (!path.isAbsolute(source)) {
    if (!rootPath) return "";
    source = path.join(rootPath, source);
  }

  return path.normalize(source);
}
