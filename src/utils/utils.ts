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

export function getLines(text: string, lt = '\n'): string[] {
	return text.split(new RegExp(`(?<=${lt})`, 'g'));
}

export function parseRanges(editor: vscode.TextEditor, ranges: readonly (vscode.Range | vscode.Selection)[]) {
	const d = editor.document;
	return ranges.map((range) => {
		let start = d.offsetAt(range.start);
		const text = d.getText(range);
		const lines = getLines(text);
		return {
			range,
			text,
			textLines: lines,
			lines: lines.map((l, i) => ({
				idx: i,
				range: new vscode.Range(d.positionAt(start), d.positionAt((start += l.length))),
				text: l,
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

export function ensureFile(filepath: string, defaultFile: string) {
	const dir = path.dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (!existsSync(filepath)) {
		copyFileSync(defaultFile, filepath);
		vscode.workspace.openTextDocument(filepath).then(vscode.window.showTextDocument);
	}

	return { dir, filepath };
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
	_queue?: {
		uri: vscode.Uri;
		items: { prev: string; newText: string; lines: [number, number] }[];
	};
	queue(edit: vscode.WorkspaceEdit) {
		for (const [uri, edits] of edit.entries()) {
			const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
			if (!editor) continue;
			this._queue = {
				uri,
				items: edits.map((e) => ({
					newText: e.newText,
					prev: editor.document.getText(e.range),
					lines: [e.range.start.line, e.range.end.line],
				})),
			};
		}
	}
	append(success: boolean) {
		if (!success) delete this._queue;
		if (!this._queue) return;
		const key = this._queue.uri.toString();
		const items = this.prev.get(key);
		this.prev.set(key, {
			items: items ? [...items.items, ...this._queue.items] : this._queue.items,
		});
	}

	getPrevItem(editor = vscode.window.activeTextEditor) {
		if (!editor) return;
		const prev = this.prev.get(editor.document.uri.toString());
		if (!prev) return;

		const cursor = editor.selection.active;
		const line = editor.document.lineAt(cursor.line);
		const text = editor.document.getText(line.rangeIncludingLineBreak);

		const prevItem = prev.items.find(
			(t) => (t.lines[0] === cursor.line || t.lines[1] === cursor.line) && text?.includes(t.newText)
		);
		if (!prevItem) return;

		return { all: prev, prevItem, line };
	}

	async undoAtCursor(editor = vscode.window.activeTextEditor) {
		if (!editor) return;
		const item = this.getPrevItem(editor);
		if (!item) return;

		const { prevItem, all, line } = item;

		const fullText = editor.document.getText();
		const ntIndex = fullText.indexOf(prevItem.newText, editor.document.offsetAt(line.rangeIncludingLineBreak.start));
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
