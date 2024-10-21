import * as vscode from 'vscode';
import { type TState, debug } from '../state/state';
import type { MotionArgs, MotionRangeArgs, Mutable, Overrides } from '../types';
import { type MotionInput, parseMotionInput, trimMotionInput } from '../utils/input';
import { getRangeOf, getWordsFrom } from '../utils/motion';
import {
	type CursorKind,
	getActiveEditor,
	getCursor,
	getFn,
	getFullRange,
	getInputBox,
	hasRanges,
	replaceRanges,
	selectRanges,
	toSelections,
} from '../utils/utils';
import { handleSearchMotion } from '../utils/search';

export async function motion<T = Record<'select' | 'delete', vscode.Selection[]>>({
	args,
	onMotion,
	onSearch,
}: MotionArgs<T>) {
	const { editor = getActiveEditor(), state, edit = new vscode.WorkspaceEdit() } = args;
	if (onSearch) return handleSearchMotion({ args, state, editor, onSearch });

	const selection = editor.selection;
	const input = await getMotionInput(args);
	if (!input || !onMotion) return;

	let ranges = getRanges(input, args);
	if (!hasRanges(ranges)) return;

	state.setPreviousMotion({ onMotion, input, isNext: args.isNext, isPrev: args.isPrev });

	if (input.expand) {
		if (editor.selections.length === 1 && selection.isEmpty && !selection.isEqual(ranges[0])) {
			editor.selections = [];
		} else if (editor.selections.length > 1) {
			const rangeLen = ranges.length;
			if (args.isPrev) {
				const afterCursor = editor.selections.filter((r) => r.start.isAfter(editor.selection.active));
				if (afterCursor.length >= rangeLen) {
					editor.selections = editor.selections.slice(0, -rangeLen);
				}
			} else if (args.isNext) {
				const beforeCursor = editor.selections.filter((r) => r.end.isBefore(editor.selection.active));
				if (beforeCursor.length >= rangeLen) {
					editor.selections = editor.selections.slice(0, -rangeLen);
				}
			}
		}
	}

	if (onMotion instanceof Array) {
		let result = {} as Record<(typeof onMotion)[number], vscode.Selection[]>;

		for (const action of onMotion) {
			if (action === 'select') result = { ...result, select: selectRanges(editor, ranges, input.expand) };
			else if (action === 'delete') {
				result = { ...result, delete: (await replaceRanges({ ranges: result?.select, editor, edit })) || [] };
			}
		}
		return result;
	}

	return onMotion({
		motion: { input, ranges },
		select: (selected = ranges) => selectRanges(editor, selected, input.expand),
		replace: async (selected = ranges, inputs) => {
			const selections = toSelections(selected);
			return await replaceRanges({ ranges: selections, inputs, editor, edit });
		},
		editor,
		edit,
	});
}
function getMotionInput(args: Overrides) {
	if (args?.inputOverride) {
		if (typeof args.inputOverride === 'string') return parseMotionInput(args.inputOverride, args);
		if (args.inputOverride.line && (args.isNext || args.isPrev)) args.inputOverride.line = null;
		return args.inputOverride;
	}
	return getInputBox({ title: 'Motion' }).waitFor(({ value }) => {
		return parseMotionInput(value, args);
	});
}

function getHandlerArgs(input: Mutable<MotionInput>, args?: MotionRangeArgs) {
	let out = input;
	const editor = args?.editor ?? getActiveEditor();
	if (typeof args?.inputOverride === 'string') {
		out = {
			...out,
			motion: { ...out.motion, value: args.inputOverride, trimmedValue: trimMotionInput(args.inputOverride) },
		};
	} else if (args?.inputOverride) {
		out = { ...out, ...args.inputOverride };
	}

	return {
		...args,
		editor,
		isNext: out.line == null ? args?.isNext : out.isNext,
		isPrev: out.line == null ? args?.isPrev : out.isPrev,
		cursor: getCursor({
			cursor: args?.cursor,
			editor,
			override:
				out.line != null && (out.line > 0 ? { line: out.line - 1, character: 9999 } : { line: 0, character: 0 }),
			fallback: out.expand ? editor.selections.at(-1)?.anchor : editor.selection.anchor,
		}),
		document: editor.document,
		input: out,
	};
}

function getRanges(motion?: MotionInput, _args?: MotionRangeArgs) {
	if (!motion) return;
	const args = getHandlerArgs(motion, _args);

	let ranges: (vscode.Range | undefined)[] | undefined;
	let currentCursor = args.cursor;
	if (args.input.repeatCount) {
		let nextRange: vscode.Range | undefined;
		for (let i = 0; i < args.input.repeatCount; i++) {
			nextRange = getRange({
				...args,
				cursor: currentCursor,
			})?.[0];
			args.input.repeatIdx = i + 1;
			if (!nextRange) break;

			currentCursor = getCursor({ cursor: nextRange.start, editor: args.editor });
		}
		if (!nextRange) return;
	}

	ranges = getRange({
		...args,
		cursor: currentCursor,
	});

	if (hasRanges(ranges)) return ranges;
}

function getRange(args?: ReturnType<typeof getHandlerArgs>) {
	try {
		return args ? handlers[args.input.type](args) : [];
	} catch (error) {
		console.log(error);
	}
}

type HandleArgs = {
	input: MotionInput;
	state?: TState;
	editor: vscode.TextEditor;
	document: vscode.TextDocument;
	cursor: ReturnType<typeof getCursor>;
	isNext?: boolean;
	isPrev?: boolean;
};

const handlers: Record<MotionInput['type'], (args: HandleArgs) => (vscode.Range | undefined)[] | undefined> = {
	word: handleWord,
	element: handleElement,
	fn: handleFunction,
	line: handleLine,
	file: (args) => [getFullRange(args.editor)],
	search: () => undefined,
};

function handleWord(args: HandleArgs) {
	const { input, isNext, isPrev, editor, cursor } = args;
	let { current, next, prev } = getWordsFrom(editor, cursor.position);

	if (isNext) {
		current = next({ offset: current?.endOffset ?? cursor.offset });
	}
	if (isPrev) {
		current = prev({ offset: current?.offset ?? cursor.offset });
	}

	let range = current?.range;
	if (!range) return [];
	if (input.repeatIdx < (input.repeatCount ?? -1) || !input.numbers) return [range];
	if (!input.numbers) return [range];
	const ranges = handleNumbers(args, handleWord, true);
	const lastRange = ranges?.[ranges.length - 1];
	return lastRange ? [range.union(lastRange)] : [range];
}

function handleElement(args: HandleArgs) {
	const { cursor, input } = args;

	debug('handleElementss', input, 'cursor', cursor.position);
	if (!input.numbers) return [getRangeOf(input.motion.trimmedValue, { ...args, cursor: cursor.offset })];
	return handleNumbers(args, handleElement, true);
}

function handleFunction(args: HandleArgs) {
	const { editor, cursor, input, isNext, isPrev } = args;
	const document = editor.document;

	const fn = getFn({ text: document.getText(), offset: cursor.offset, isNext, isPrev });
	if (!fn) return [];
	let ranges: (vscode.Range | undefined)[] = [];

	if (input.motion.trimmedValue === 'fi') {
		if (!fn.name) {
			const pos = document.positionAt(fn.args.start > 0 ? fn.args.start - 1 : fn.args.start);
			ranges = [new vscode.Range(pos, pos)];
		} else {
			ranges = [new vscode.Range(document.positionAt(fn.name.start), document.positionAt(fn.name.end))];
		}
	}

	if (input.motion.trimmedValue === 'fn') {
		if ('bodyInline' in fn) {
			ranges = [new vscode.Range(document.positionAt(fn.bodyInline.start), document.positionAt(fn.bodyInline.end))];
		} else {
			ranges = [getRangeOf(fn.bodyStart.value, { cursor: fn.bodyStart.end, editor })];
		}
	}

	if (input.motion.trimmedValue === 'fa') {
		ranges = [new vscode.Range(document.positionAt(fn.args.start), document.positionAt(fn.args.end))];
	}

	if (!input.numbers) return ranges;
	return handleNumbers(args, handleFunction);
}

function handleLine(args: HandleArgs) {
	const { editor, cursor, input, isNext, isPrev } = args;
	const document = editor.document;
	const line = cursor.position.line;
	const value = input.motion.trimmedValue;
	const numbers = input.numbers;

	if (value === 'l') {
		if (isNext) return [document.lineAt(line + 1).range];
		else if (isPrev) return [document.lineAt(line - 1).range];
		if (numbers && numbers >= 1) return [document.lineAt(numbers - 1).range];
		return [document.lineAt(line).range];
	}

	if (value === 'L') {
		if (numbers) {
			const targetLine = numbers < 0 ? line - Math.abs(numbers) : line + Math.abs(numbers) - 1;
			return [
				document
					.lineAt(targetLine > line ? line : line - 1)
					.rangeIncludingLineBreak.union(document.lineAt(targetLine).rangeIncludingLineBreak),
			];
		}

		const start = document.lineAt(0).rangeIncludingLineBreak;

		return [start.union(document.lineAt(line - 1).rangeIncludingLineBreak)];
	}
}

function handleNumbers(
	args: HandleArgs,
	cb: (args: HandleArgs) => (vscode.Range | undefined)[] | undefined,
	setNextPrev = false
) {
	const { input, cursor } = args;
	if (!input.numbers) return;

	const ranges = [] as vscode.Range[];

	const direction =
		!args.isNext && (input.numbers < 0 || (input.repeats && input.repeats < 0) || args.isPrev) ? 'prev' : 'next';
	const nextPrev = setNextPrev ? { isNext: direction === 'next', isPrev: direction === 'prev' } : {};

	for (let i = 0; i < Math.abs(input.numbers); i++) {
		const nextCursor =
			i === 0 ? { cursor } : getNextCursor({ direction, from: ranges[i - 1], fallback: cursor.offset }, args);
		const nextRanges = cb({ ...args, ...nextCursor, input: { ...args.input, numbers: 0 }, ...nextPrev });
		if (hasRanges(nextRanges)) ranges.push(...nextRanges);
		else break;
	}

	return ranges.filter(Boolean);
}

function getNextCursor(
	args: { from?: CursorKind; direction: 'prev' | 'next'; fallback?: CursorKind },
	handlerArgs: HandleArgs
) {
	const { editor, cursor } = handlerArgs;
	const from =
		args.from || args.fallback
			? getCursor({ cursor: args.from ? args.from : args.fallback, editor }).range
			: cursor.range;

	const result = {
		cursor: cursor,
		isNext: args.direction === 'next',
		isPrev: args.direction === 'prev',
	};

	if (args.direction === 'prev') result.cursor = getCursor({ cursor: editor.document.offsetAt(from.start) });
	else result.cursor = getCursor({ cursor: editor.document.offsetAt(from.end) });
	return result;
}
