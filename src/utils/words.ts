import * as vscode from 'vscode';
import { type TState, debug } from '../state/state';
import type { MotionInput } from './input';
import { type Cursor, escape } from './utils';

export function searchWords(args: {
	state: TState;
	editor: vscode.TextEditor;
	cursor: Cursor;
	input: MotionInput;
	text: string;
	words: string[];
}) {
	const { state, editor, text, words, input } = args;
	const { isPrev, isNext } = input;

	const offset = isNext ? args.cursor.offset + 1 : args.cursor.offset;
	const config = state.config.motion.search;

	const regxp = new RegExp(words.map(escape).join('.*?\\W+?'), 'g');
	const textToSearch = isPrev ? text.slice(0, offset - 1) : text.slice(offset);
	const matches = [...textToSearch.matchAll(regxp)];

	const results = (isPrev ? matches.reverse() : matches).map((m, i) => {
		const idx = isPrev ? m.index : m.index + offset;
		return {
			i,
			value: m[0],
			offset: idx,
			process: (cfg = config) => {
				const { jumpSelect } = cfg;

				const word = words[0];
				const wordIndex = idx + m[0].indexOf(word);

				const start = editor.document.positionAt(wordIndex);

				const wordsOnly = jumpSelect === 'words' || jumpSelect === 'first-word';
				const wordRange = wordsOnly ? editor.document.getWordRangeAtPosition(start) : null;
				const onlyFirst = jumpSelect === 'first-word' || jumpSelect === 'first-input';

				let end = wordRange && onlyFirst && wordRange.end;
				if (!end && !onlyFirst) end = editor.document.positionAt(wordIndex + m[0].length);
				if (!end) end = editor.document.positionAt(wordIndex + word.length);
				if (!onlyFirst && wordsOnly) end = editor.document.getWordRangeAtPosition(end)?.end ?? end;

				return {
					range: new vscode.Range(start, end),
					line: editor.document.lineAt(start.line),
				};
			},
		};
	});

	const nextMatch = results[0];

	if (results.length > 0) {
		const slice = config.jumpResultThreshold || results.length;
		results.slice(0, slice).forEach((r, i) => {
			const hasMore = i === slice - 1 && results.length > config.jumpResultThreshold;
			state.addDecoration({
				range: r.process().range,
				type: 'cursor',
				iconOrText: hasMore ? '+' + (results.length - config.jumpResultThreshold) : '⇠',
				right: 5,
			});
		});
	}

	state.showDecorations({ type: 'cursor', editor, keep: false });
	return {
		results,
		nextMatch,
		next:
			(!!config.jumpInputThreshold &&
				!config.jumpResultThreshold &&
				results.length > 0 &&
				words.join('').length >= config.jumpInputThreshold &&
				results?.[0]) ||
			(matches.length > 0 && matches.length <= config.jumpResultThreshold)
				? results[0]
				: null,
	};
}
