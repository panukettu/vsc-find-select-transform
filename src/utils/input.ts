import type { Mutable, Overrides } from '../types';
import { isElement } from './motion';

export type MotionInput = Mutable<NonNullable<Awaited<ReturnType<typeof parseMotionInput>>>>;

function getParts(value: string, args?: Overrides) {
	const match = /^(?<expand>\+\s*)?((?<lineOrRepeats>\d+)(?:\s+))?(?<numbers>-?\d+)?(?<value>.*?)$/.exec(value);
	if (!match) return;
	const trimmedValue = trimMotionInput(value);
	const type = getMotionType(trimmedValue, args);
	if (!type) return;
	const isLine =
		args?.isLine || (!args?.isNext && !args?.isPrev && (match.groups?.lineOrRepeats != null || /^\d+\s$/.test(value)));
	const lineOrRepeats = match?.groups?.lineOrRepeats ? parseInt(match.groups.lineOrRepeats) : null;
	const line = isLine && lineOrRepeats != null ? lineOrRepeats - 1 : null;
	const repeats = line == null && lineOrRepeats != null ? lineOrRepeats - 1 : null;
	let valueOut = match?.groups?.value ?? value;

	if (args?.isSearch) {
		valueOut = value;
		if (isLine) valueOut = value.replace(/^\d+\s*/, '');
	}

	return {
		expand: !!match?.groups?.expand,
		line,
		isLine,
		repeats: repeats && args?.isPrev ? -repeats : repeats,
		repeatCount: repeats ? Math.abs(repeats) : null,
		repeatIdx: 0,
		numbers: match?.groups?.numbers ? parseInt(match.groups.numbers) : null,
		valueOut,
		value,
		trimmedValue,
		type: type as MotionType,
	};
}

export function parseMotionInput(input: string, args?: Overrides) {
	if (!input) return;

	const parts = getParts(input, args);
	if (!parts?.type) return;
	const { valueOut, trimmedValue, value, isLine, ...rest } = parts;
	if (isLine && /^\d+\s*$/.test(input)) return;

	const result = {
		...rest,
		motion: {
			originalValue: value,
			trimmedValue,
			value: valueOut,
		},
		isSearch: !!args?.isSearch,
		isLine,
		isNext: !!args?.isNext || parts.line != null,
		isPrev: !!args?.isPrev && parts.line == null,
	} as const;
	return result;
}

export type MotionType = NonNullable<ReturnType<typeof getMotionType>>;
export function getMotionType(value: string, args?: Overrides) {
	if (args?.isSearch) return `search`;
	if (isElement(value)) return 'element';
	if (value === 'w') return 'word';
	if (value === 'F') return 'file';
	if (value.toLowerCase() === 'l') return 'line';
	if (value.length > 1) {
		if (value.startsWith('f')) return 'fn';
	}

	console.error('Invalid motion:', value);
}

export function trimMotionInput(value: string) {
	return value.replace(/(\s|\+|\-|\d)/g, '').trim();
}
