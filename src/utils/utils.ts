import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { If, MotionSelection, Transform } from '../types';
import { Warning } from './errors';

export async function quickPickTransforms(
	list: Transform[],
	config = {
		editor: vscode.window.activeTextEditor,
		title: 'Select Transforms',
	}
) {
	if (!config.editor) throw new Warning('No active editor.');

	const selected = await vscode.window.showQuickPick(list, {
		canPickMany: true,
		title: config.title,
	});

	if (!selected?.length) {
		throw new Warning('No transforms selected.');
	}

	return selected;
}

export function getInputBox(config?: vscode.InputBoxOptions & { show?: boolean }) {
	const inputBox = vscode.window.createInputBox();
	const { title = 'Input', ignoreFocusOut = true, show = true } = { ...config };
	inputBox.ignoreFocusOut = ignoreFocusOut;
	inputBox.title = title;
	if (show) inputBox.show();
	return {
		...inputBox,
		async waitFor<T>(handler: (args: { value: string; inputBox: vscode.InputBox }) => T, dispose = true) {
			return new Promise<T>((res, reject) => {
				const disposable = inputBox.onDidChangeValue(async (value) => {
					try {
						const result = await handler({ value, inputBox });
						if (result) {
							if (dispose) this.remove([disposable]);
							return res(result);
						}
					} catch (e) {
						if (dispose) this.remove([disposable]);
						console.error(e);
						return reject(e);
					}
				});
			});
		},
		remove: (disposables?: vscode.Disposable[]) => {
			if (disposables) disposables.forEach((d) => d.dispose());
			inputBox.hide();
			inputBox.value = '';
			inputBox.dispose();
		},
	};
}

export function getActiveEditor<
	T extends boolean,
	Editor extends If<T, vscode.TextEditor | undefined, vscode.TextEditor>
>(optional?: T) {
	const editor = vscode.window.activeTextEditor as Editor;
	if (!editor && !optional) throw new Warning('No active editor found.');
	return editor;
}

export type Chunk = { text: string; start: number; end: number };

/**
 * Splits `text` on `separator`, returning each chunk with its offsets within
 * `text`. Separators are excluded from the chunks, `\r\n` counts as a line
 * break when splitting on `\n`, and a trailing separator does not produce an
 * empty final chunk.
 */
export function splitWithOffsets(text: string, separator = '\n'): Chunk[] {
	if (!text.length) return [];
	if (!separator) separator = '\n';

	const chunks: Chunk[] = [];
	let pos = 0;
	while (pos <= text.length) {
		const idx = text.indexOf(separator, pos);
		if (idx === -1) {
			chunks.push({ text: text.slice(pos), start: pos, end: text.length });
			break;
		}
		let end = idx;
		if (separator === '\n' && end > pos && text[end - 1] === '\r') end--;
		chunks.push({ text: text.slice(pos, end), start: pos, end });
		pos = idx + separator.length;
		if (pos === text.length) break;
	}
	return chunks;
}

/** Resolves each range to its text and the chunks (lines by default) within it. */
export function parseRanges(
	editor: vscode.TextEditor,
	ranges: readonly (vscode.Range | vscode.Selection)[],
	separator = '\n'
) {
	const d = editor.document;
	return ranges.map((range) => {
		const base = d.offsetAt(range.start);
		const text = d.getText(range);
		const chunks = splitWithOffsets(text, separator);
		return {
			range,
			text,
			textLines: chunks.map((c) => c.text),
			lines: chunks.map((c, i) => ({
				idx: i,
				range: new vscode.Range(d.positionAt(base + c.start), d.positionAt(base + c.end)),
				text: c.text,
			})),
		};
	});
}

export function getCursorLine(editor: vscode.TextEditor) {
	const c = editor.selection.active;
	const { range, text } = editor.document.lineAt(c.line);
	return {
		idx: c.line,
		range,
		text,
	};
}

export function getFullRange(editor: vscode.TextEditor) {
	const d = editor.document;
	return new vscode.Range(d.lineAt(0).range.start, d.lineAt(d.lineCount - 1).range.end);
}

/** Creates `filepath` from `template` unless it already exists. */
export function ensureFile(filepath: string, template: string) {
	const dir = path.dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const created = !existsSync(filepath);
	if (created) copyFileSync(template, filepath);
	return { dir, filepath, created };
}

export const fnRegexp = () =>
	new RegExp(
		/((function|fn|const|let|var)\s(?<name>\w+))?( = )?\(\(?(?<args>.*?)\).*?((?<bodyStart>[{|\(\]])|(?<bodyInline>\w+.+?\W+(?=\)|;])))/gm
	);

type FnGroup = { value: string; start: number; end: number };
type FnResult = {
	match: FnGroup;
	name?: FnGroup;
	args: FnGroup;
} & ({ bodyStart: FnGroup } | { bodyInline: FnGroup });

export const getFn = (args: { text: string; offset: number; isNext?: boolean; isPrev?: boolean }): FnResult | null => {
	const { text, offset, isNext, isPrev } = args;
	let matches = [...text.matchAll(fnRegexp())];
	if (!matches?.length || !matches?.[0]?.[0]) return null;
	let match: RegExpExecArray | undefined;

	if (isNext) {
		const found = matches.find((m) => m.index > offset);
		if (!found) return null;
		match = found;
	} else if (isPrev) {
		const earlier = matches.filter((m) => m.index < offset);
		const found = earlier?.length > 1 ? earlier.reverse().slice(1)[0] : earlier[0];
		if (!found) return null;
		match = found;
	} else {
		match = matches.findLast((m) => m.index < offset);
	}
	if (!match?.groups) return null;

	const result = {
		match: { value: match[0], start: match.index, end: match.index + match[0].length },
	} as FnResult;

	return Object.entries(match.groups).reduce((acc, [key, value], idx, self) => {
		if (typeof value === 'undefined') return acc;
		const groupName = key as keyof FnResult;
		const prevIndex = idx ? acc[self[idx - 1][0] as keyof FnResult]?.end ?? match.index : match.index;

		const isArgs = groupName === 'args';
		let start = text.indexOf(isArgs ? `(${value})` : value, prevIndex);
		if (isArgs) start++;
		acc[groupName] = { value, start, end: start + value.length };
		return acc;
	}, result);
};

export const toRegExp = (str: string, flags?: string) => {
	return new RegExp(escape(str), flags);
};
export const escape = (str: string) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
export type CursorKind = number | vscode.Position | vscode.Range | vscode.Selection;

export type Cursor = ReturnType<typeof getCursor>;
export function getCursor(args: {
	fallback?: vscode.Position;
	cursor?: CursorKind;
	override?: { line?: number | null; character?: number | null } | false | null;
	editor?: vscode.TextEditor;
}) {
	let { cursor, editor = getActiveEditor(), fallback = editor.selection.anchor } = args;
	let position =
		typeof cursor === 'object'
			? 'end' in cursor
				? cursor.start
				: cursor
			: typeof cursor === 'number'
			? editor.document.positionAt(cursor)
			: fallback;

	if (args.override) {
		position = position.with({
			line: args.override.line ?? position.line,
			character: args.override.character ?? position.character,
		});
	}
	cursor = editor.document.offsetAt(position);
	return {
		offset: cursor,
		position,
		range: typeof cursor === 'object' && 'start' in cursor ? cursor : new vscode.Selection(position, position),
		wordRange: editor.document.getWordRangeAtPosition(position),
	};
}

export function selectRanges(editor: vscode.TextEditor, ranges: MotionSelection[], expand = false) {
	const selections = toSelections(ranges);
	editor.revealRange(selections[selections.length - 1]);
	return (editor.selections = expand ? editor.selections.concat(selections) : selections);
}

export async function replaceRanges<T extends vscode.Range[]>(args: {
	editor: vscode.TextEditor;
	edit?: vscode.WorkspaceEdit;
	noApply?: boolean;
	ranges?: T;
	inputs?: string[];
}) {
	if (!args.ranges?.length) return false;
	const { editor, edit = new vscode.WorkspaceEdit(), ranges, inputs } = args;
	ranges.forEach((r, i) =>
		inputs?.length ? edit.replace(editor.document.uri, r, inputs?.[i] ?? '') : edit.delete(editor.document.uri, r)
	);

	if (args.noApply) return ranges;

	return (await vscode.workspace.applyEdit(edit)) ? ranges : false;
}
export function toSelections(selections: MotionSelection[], editor = getActiveEditor()) {
	return selections.map((range) => {
		const start = 'character' in range ? range : range.start ?? range.end ?? editor.selection.anchor;
		const end = 'character' in range ? range : range.end ?? range.start ?? editor.selection.active;
		return new vscode.Selection(start, end);
	});
}

/**
 * Where ranges end up, as offsets, once their edits are applied. `edits[i]` are the edits
 * inside `ranges[i]`. Call before applying them: the document must still be in its old state.
 */
export function offsetsAfterEdits(
	document: vscode.TextDocument,
	ranges: readonly vscode.Range[],
	edits: vscode.TextEdit[][]
) {
	const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
	const changes = edits.map((list) =>
		list.map(({ range, newText }) => ({
			end: document.offsetAt(range.end),
			// Applying an edit converts its line endings to the document's.
			delta: newText.replace(/\r\n|\r|\n/g, eol).length - document.getText(range).length,
		}))
	);
	const sum = (list: { delta: number }[]) => list.reduce((total, change) => total + change.delta, 0);

	return ranges.map((range, i) => {
		const start = document.offsetAt(range.start);
		const shift = sum(changes.filter((_, j) => j !== i).flat().filter((change) => change.end <= start));
		return { start: start + shift, end: document.offsetAt(range.end) + shift + sum(changes[i]) };
	});
}

export function hasRanges(ranges?: any[]): ranges is vscode.Range[] {
	return !!ranges?.length;
}

export class UndoableWorkspaceEdit {
	prev: Map<
		string,
		{
			items: { prev: string; newText: string; lines: [number, number] }[];
		}
	> = new Map();

	/** Saves one undo step per item. `lines` are where `newText` now is in the document. */
	record(uri: vscode.Uri, newItems: { prev: string; newText: string; lines: [number, number] }[]) {
		const key = uri.toString();
		this.prev.set(key, { items: [...(this.prev.get(key)?.items ?? []), ...newItems] });
	}

	getPrevItem(editor = vscode.window.activeTextEditor) {
		if (!editor) return;
		const prev = this.prev.get(editor.document.uri.toString());
		if (!prev) return;

		const cursor = editor.selection.active.line;
		const prevItem = prev.items.findLast(
			({ lines: [first, last], newText }) =>
				first <= cursor &&
				cursor <= last &&
				editor.document.getText(new vscode.Range(first, 0, last + 1, 0)).includes(newText)
		);
		if (!prevItem) return;

		return { all: prev, prevItem };
	}

	async undoAtCursor(editor = vscode.window.activeTextEditor) {
		if (!editor) return;
		const item = this.getPrevItem(editor);
		if (!item) return;

		const { prevItem, all } = item;

		const fullText = editor.document.getText();
		const ntIndex = fullText.indexOf(prevItem.newText, editor.document.offsetAt(new vscode.Position(prevItem.lines[0], 0)));
		const range = new vscode.Range(
			editor.document.positionAt(ntIndex),
			editor.document.positionAt(ntIndex + prevItem.newText.length)
		);
		const success = await editor.edit((edit) => edit.replace(range, prevItem.prev || ''));

		if (!success) throw new Warning('Failed to undo at cursor.');
		else this.prev.set(editor.document.uri.toString(), { ...all, items: all.items.filter((i) => i !== prevItem) });
	}
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function openLocation(location: vscode.Location) {
	return vscode.window.showTextDocument(location.uri, { selection: location.range });
}
