import { debug } from '../state/state';
import type { RegExpTransform } from '../types';
import { Warning } from '../utils/errors';
import { settings } from './config.common';

export type RegExpConfig = {
	[key: string]: {
		transforms: RegExpTransformConfig[];
		additionalValues?: Record<string, string>;
		flags?: string;
	};
};
type RegExpTransformConfig = [matcher: string, replacer: string, flags?: string];

export function getRegexpTransforms() {
	const config = settings<unknown>('transform.regexp');

	if (!config || Object.keys(config).length === 0) return [];

	if (!isValidRegExpConfig(config)) {
		debug('[transform.regexp] Invalid: ', config);
		throw new Warning(
			'[transform.regexp] must be a key-value object with type: { transforms: [matcher: string, replacer: string, flags?: string][], additionalValues?: Record<string, string>, flags?: string }'
		);
	}

	return Object.entries(config).map(([id, item]) => {
		const rootFlags = getRegexpFlags(item);
		return {
			label: id,
			type: 'regexp',
			flags: rootFlags,
			transforms: item.transforms.map((t) => {
				const [matcher, replacer, flags] = t;
				const transformFlags = getRegexpFlags(flags, rootFlags);
				return {
					matcher: new RegExp(matcher, transformFlags),
					replacer,
					flags: transformFlags,
				};
			}),
			additionalValues: item.additionalValues,
		} satisfies RegExpTransform;
	});
}

export function getRegexpFlags(item?: unknown, fallback = 'gm') {
	if (!item) return fallback;
	if (typeof item === 'object') {
		if (!('flags' in item)) return fallback;
		item = item.flags;
	}

	if (typeof item !== 'string') return fallback;

	if (/^[gimsuy]*$/.test(item)) return item;

	throw new Warning(`[transform.regexp] Invalid flags: ${item} - must be one or more of 'gimsuy'`);
}

export function isValidRegExpConfig(config: unknown): config is RegExpConfig {
	if (!config || typeof config !== 'object' || Object.keys(config).length === 0) return false;

	if ('flags' in config && !isValidFlags(config.flags)) return false;
	if ('additionalValues' in config && !isValidAdditionalValuesJSON(config.additionalValues)) return false;

	return Object.values(config).every(
		(item) => 'transforms' in item && item.transforms.every((pair: unknown) => isValidTransformJSON(pair))
	);
}

function isValidFlags(flags: unknown) {
	return typeof flags === 'string' && /^[gimsuy]*$/.test(flags);
}

function isValidTransformJSON(pair: unknown): pair is RegExpTransformConfig {
	if (!Array.isArray(pair)) return false;
	if (pair.length !== 2 && pair.length !== 3) return false;
	if (pair.length === 3 && !isValidFlags(pair[2])) return false;

	return pair.every((item) => typeof item === 'string');
}

function isValidAdditionalValuesJSON(item: unknown): item is Record<string, string> {
	if (!item || typeof item !== 'object') return false;
	return Object.values(item).every((value) => typeof value === 'string');
}
