import type { RegExpTransform } from '../types';

export function regexpTransform(config: RegExpTransform, text: string) {
	for (const transform of config.transforms) {
		text = text.replace(transform.matcher, transform.replacer);
	}

	if (typeof config.additionalValues === 'object' && Object.keys(config.additionalValues)?.length) {
		const additionalValues = populateAdditionalValues(config.flags, config.additionalValues, text);
		if (additionalValues && Object.keys(additionalValues).length) {
			for (const [id, value] of Object.entries(config.additionalValues)) {
				text = text.replaceAll(`\\$${id}`, value);
			}
		}
	}

	return text.replaceAll(/\\$\\w+/g, '');
}

function populateAdditionalValues(flags: string, config: Record<string, string>, text: string) {
	if (!Object.keys(config).length) return;

	const result: Record<string, string> = {};

	for (const [id, matcher] of Object.entries(config)) {
		const regexp = new RegExp(matcher, flags);
		const search = [...text.matchAll(regexp)];
		const match = search.find((root) => (root.groups && root.groups[id]) || root[0]) ?? search[0];
		result[id] = match.groups?.[id] ?? match?.[0] ?? '';
	}
	return result;
}
