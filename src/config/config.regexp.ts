import type { RegExpTransform } from "../types";
import { Warning } from "../utils/errors";
import { settings } from "./config.common";

export type RegExpConfig = {
  [key: string]: {
    transforms: RegExpTransformConfig[];
    additionalValues?: Record<string, string>;
    flags?: string;
  };
};
type RegExpTransformConfig = [matcher: string, replacer: string, flags?: string];

const FLAGS = /^[dgimsuvy]*$/;

/** Reads and validates `transform.regexp`. Throws a `Warning` for an invalid config. */
export function getRegexpTransforms(): RegExpTransform[] {
  const config = settings<unknown>("transform.regexp");

  if (!config || typeof config !== "object" || Object.keys(config).length === 0) return [];

  if (!isValidRegExpConfig(config)) {
    throw new Warning(
      "[transform.regexp] must be an object of { transforms: [matcher, replacer, flags?][], additionalValues?: Record<string, string>, flags?: string } entries.",
    );
  }

  return Object.entries(config).map(([id, item]) => {
    const rootFlags = getRegexpFlags(item);
    return {
      label: id,
      type: "regexp",
      flags: rootFlags,
      transforms: item.transforms.map(([matcher, replacer, flags]) => {
        const transformFlags = getRegexpFlags(flags, rootFlags);
        return { matcher: new RegExp(matcher, transformFlags), replacer, flags: transformFlags };
      }),
      additionalValues: item.additionalValues,
    } satisfies RegExpTransform;
  });
}

export function getRegexpFlags(item?: unknown, fallback = "gm") {
  if (!item) return fallback;
  if (typeof item === "object") {
    if (!("flags" in item)) return fallback;
    item = item.flags;
  }

  if (typeof item !== "string") return fallback;
  if (FLAGS.test(item)) return item;

  throw new Warning(
    `[transform.regexp] Invalid flags: ${item} - must be one or more of 'dgimsuvy'`,
  );
}

export function isValidRegExpConfig(config: unknown): config is RegExpConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const items = Object.values(config);
  if (!items.length) return false;

  return items.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if ("flags" in item && !isValidFlags(item.flags)) return false;
    if ("additionalValues" in item && !isValidAdditionalValuesJSON(item.additionalValues))
      return false;
    if (!("transforms" in item) || !Array.isArray(item.transforms) || !item.transforms.length)
      return false;
    return item.transforms.every(isValidTransformJSON);
  });
}

function isValidFlags(flags: unknown) {
  return typeof flags === "string" && FLAGS.test(flags);
}

function isValidTransformJSON(pair: unknown): pair is RegExpTransformConfig {
  if (!Array.isArray(pair)) return false;
  if (pair.length !== 2 && pair.length !== 3) return false;
  if (pair.length === 3 && !isValidFlags(pair[2])) return false;
  return pair.every((item) => typeof item === "string");
}

function isValidAdditionalValuesJSON(item: unknown): item is Record<string, string> {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Object.values(item).every((value) => typeof value === "string");
}
