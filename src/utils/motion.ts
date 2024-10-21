import * as vscode from 'vscode';
import { Warning } from './errors';
import { toRegExp } from './utils';
import { debug } from '../state/state';

const bracketMap = {
	'(': ')',
	'[': ']',
	'{': '}',
	"'": "'",
	'"': '"',
	'`': '`',
	'<!--': '-->',
	'/*': '*/',
	'\n': '\n',
	'//': '\n',
	'#': '\n',
} as const;

const endToStart = {
	')': '(',
	']': '[',
	'}': '{',
	'-->': '<!--',
	'*/': '/*',
} as const;

const noNesting = ["'", '"', '`', '\n', '//', '#', '/*', '<!--'];

export function isElement(str: string) {
	return isStart(str) || isEnd(str);
}
function isStart(str: string): str is keyof typeof bracketMap {
	return str in bracketMap;
}

function isEnd(str: string): str is keyof typeof endToStart {
	return str in Object.keys(endToStart);
}

const getText = (editor: vscode.TextEditor, range: { start: string; end: string }) => {
	const text = editor.document.getText();
	const nonMatchingRanges = [...text.matchAll(/(['"`].*?['"`])|(\/\/.*\b)|(\/\*[\s\S]*\*\/)|(\/.*\/)/gm)].map((m) => ({
		range: [m.index, m.index + m[0].length - 1],
		innerRange: [m.index + 1, m.index + m[0].length - 2],
		value: m[0],
	}));
	const allStarts = [...text.matchAll(toRegExp(range.start, 'gm'))]
		.filter((m) => !nonMatchingRanges.find((r) => m.index! > r.range[0] && m.index! < r.range[1]))
		.map((m) => m.index!);

	function findNonMatching(i: number) {
		return nonMatchingRanges.find((r) => i > r.range[0] && i < r.range[1]);
	}
	const len = range.start.length > range.end.length ? range.start.length : range.end.length;
	const isSame = range.start === range.end;
	return {
		text,
		nonMatchingRanges,
		allStarts,
		isNonNesting: noNesting.includes(range.start),
		isSame,
		len,
		getCharAtI: (i: number) => {
			const slice = text.slice(i, i + len);

			if (slice.startsWith(range.start)) {
				const nonMatching = findNonMatching(i);
				if (!nonMatching) return { start: true, end: isSame };
				return { start: false, end: false, edges: nonMatching.innerRange };
			}

			if (slice.startsWith(range.end)) {
				const nonMatching = findNonMatching(i);
				if (!nonMatching) return { start: isSame, end: true };
				return { start: false, end: false, edges: nonMatching.innerRange };
			}

			return { start: false, end: false };
		},
		indexOf: (str: string, start: number) => {
			let index = -1;

			while (index === -1) {
				const r = text.indexOf(str, start);
				if (r === -1) break;
				const nonMatching = findNonMatching(r);
				if (nonMatching) start = nonMatching.innerRange[1];
				else index = r;
			}

			return index;
		},
		lastIndexOf: (str: string, start: number) => {
			let index = -1;

			while (index === -1) {
				const r = text.lastIndexOf(str, start);
				if (r === -1) break;

				const nonMatching = findNonMatching(r);
				if (nonMatching) start = nonMatching.innerRange[0];
				else index = r;
			}

			return index;
		},
	};
};

export function getRangeOf(
	el: string,
	args: { cursor: number; editor: vscode.TextEditor; isNext?: boolean; isPrev?: boolean }
) {
	let { cursor, editor, isNext, isPrev } = args;
	const start = isEnd(el) ? endToStart[el] : (el as keyof typeof bracketMap);
	if (!start) throw new Warning(`Not supported: ${el}`);
	const end = bracketMap[start];

	const { text, lastIndexOf, getCharAtI, indexOf, allStarts, isSame, len, isNonNesting } = getText(editor, {
		start,
		end,
	});

	let stack = 0;

	if (isSame || isNonNesting) {
		let startIdx = lastIndexOf(start, cursor);
		let endIndex = indexOf(end, cursor);
		if (start !== end) {
			if (isNext) {
				startIdx = indexOf(start, cursor + len);
				endIndex = indexOf(end, startIdx);
			} else if (isPrev) {
				startIdx = lastIndexOf(start, startIdx - len);
				endIndex = indexOf(end, startIdx);
			}
		} else if (isNext || isPrev) {
			const starts = allStarts.filter((_, idx) => idx % 2 === 0);
			const ends = allStarts.filter((_, idx) => idx % 2 !== 0);

			const item = isNext ? starts.filter((i) => i > cursor)?.[0] : ends.filter((i) => i < cursor).pop();
			if (!item) return;
			startIdx = isNext ? item : lastIndexOf(start, item - 1);
			endIndex = isNext ? indexOf(start, item + len) : item;
		}

		return toMatchingRange([startIdx, endIndex], editor, {
			include: false,
			len,
		});
	}
	if (isNext || isPrev) {
		if (isNext) {
			cursor = allStarts.filter((i) => i > cursor)?.[0] + 1;
		} else if (isPrev) {
			const startsBefore = allStarts.filter((i) => i < cursor - 1);
			const countBefore = startsBefore.length;
			if (countBefore === 1) {
				cursor = startsBefore[0] + 1;
			}
			if (countBefore > 1) {
				cursor = startsBefore.reverse().shift()! + 1;
			}
		}
	}

	for (let i = cursor - 1; i >= 0; i -= len) {
		const match = getCharAtI(i);
		if (match.edges?.length) {
			i = match.edges[0];
			continue;
		}

		if (match.start) {
			if (stack === 0)
				return toMatchingRange(findClosing(getCharAtI, text, i, start, end), editor, { include: false, len });
			stack--;
		} else if (match.end) stack++;
	}

	throw new Warning(`No pair for ${start}.`);
}

function findClosing(
	getCharAtI: ReturnType<typeof getText>['getCharAtI'],
	text: string,
	cursor: number,
	start: string,
	end: string
) {
	let stack = 1;
	const len = start.length > end.length ? start.length : end.length;
	for (let i = cursor + 1; i < text.length; i += len) {
		const match = getCharAtI(i);
		if (match.edges?.length) {
			i = match.edges[1];
			continue;
		}

		if (match.start) stack++;
		else if (match.end) {
			stack--;
			if (stack === 0) return [cursor, i] as [number, number];
		}
	}

	throw new Warning(`No pair for ${start}.`);
}

function toMatchingRange(
	offsets: [start: number, end: number],
	editor: vscode.TextEditor,
	output: { include: boolean; len: number }
) {
	const d = editor.document;
	const addStart = output.include ? 0 : output.len;
	const start = d.positionAt(offsets[0] + addStart);

	const addEnd = output.include ? output.len : 0;
	const end = d.positionAt(offsets[1] + addEnd);
	return new vscode.Range(start, end);
}

export function getWordsFrom(editor: vscode.TextEditor, cursor: vscode.Position) {
	const text = editor.document.getText();
	let currentWord = editor.document.getWordRangeAtPosition(cursor);
	const currentOffset = currentWord ? editor.document.offsetAt(currentWord.start) : 0;
	const words = [...text.matchAll(/\w+\b/g)];
	const currentWordText = editor.document.getText(currentWord);
	return {
		current: currentWord
			? {
					word: currentWordText,
					position: cursor,
					range: currentWord,
					offset: currentOffset,
					endOffset: currentOffset + currentWordText.length - 1,
			  }
			: null,
		next: (args: { count?: number; offset?: number }) =>
			getWord(
				editor,
				words.filter((w) => w.index > (args.offset ?? currentOffset)),
				args.count ?? 1
			),
		prev: (args: { count?: number; offset?: number }) =>
			getWord(
				editor,
				words.filter((w) => w.index < (args.offset ?? currentOffset)),
				args.count ?? -1
			),
		words,
	};
}

function getWord(editor: vscode.TextEditor, words: RegExpExecArray[], count: number) {
	let word = count < 0 ? words.at(count) : words.at(count - 1);
	if (typeof word?.index !== 'number' || word.index === -1) return null;

	const position = editor.document.positionAt(word.index + 1);
	const range = editor.document.getWordRangeAtPosition(position);
	return range
		? {
				word: word[0],
				position,
				offset: word.index,
				endOffset: word.index + word[0].length - 1,
				range,
		  }
		: null;
}
