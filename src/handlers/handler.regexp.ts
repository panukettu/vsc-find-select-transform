import type { RegExpTransform } from "../types";
import { escape } from "../utils/utils";

/**
 * Applies the matcher/replacer pairs in order. Afterwards every `$id` placeholder
 * named in `additionalValues` is replaced with the text its pattern matched in
 * the original input (or removed when nothing matched).
 */
export function regexpTransform(config: RegExpTransform, input: string) {
  let text = input;
  for (const transform of config.transforms) {
    text = text.replace(transform.matcher, transform.replacer);
  }

  const additional = config.additionalValues;
  if (!additional || !Object.keys(additional).length) return text;

  const values = populateAdditionalValues(config.flags, additional, input);
  for (const [id, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\$${escape(id)}(?![\\w$])`, "g"), () => value);
  }
  return text;
}

function populateAdditionalValues(flags: string, config: Record<string, string>, text: string) {
  const result: Record<string, string> = {};
  const globalFlags = flags.includes("g") ? flags : `${flags}g`;

  for (const [id, pattern] of Object.entries(config)) {
    const matches = [...text.matchAll(new RegExp(pattern, globalFlags))];
    const match = matches.find((m) => m.groups?.[id]) ?? matches[0];
    result[id] = match?.groups?.[id] ?? match?.[0] ?? "";
  }
  return result;
}
