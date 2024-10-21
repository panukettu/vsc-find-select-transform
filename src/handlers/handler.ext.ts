import * as vscode from 'vscode';
import type { ExtTransformArgs, TFilter, Transform } from '../types';
import { transformRanges } from './handler.transformer';
import { getActiveEditor, getFullRange, isStringArray } from '../utils/utils';
import type { TState } from '../state/state';

export async function transform<T extends Transform[] | TFilter>(state: TState, args: ExtTransformArgs<T>) {
	let editor;
	let getRanges: (e: vscode.TextEditor) => readonly vscode.Selection[] | vscode.Range[];
	const { location, transforms = 'all', type = 'range', applyEdits = true, edit = new vscode.WorkspaceEdit() } = args;

	if (location) {
		if ('uri' in location) {
			editor = await vscode.window.showTextDocument(location.uri, { selection: location.range });
			getRanges = (e) => e.selections;
		} else if ('fsPath' in location) {
			editor = await vscode.window.showTextDocument(location);
			getRanges = (e) => [getFullRange(e)];
		} else {
			editor = getActiveEditor();
			editor.selections =
				location instanceof Array
					? location.map((l) => new vscode.Selection(l.start, l.end))
					: [new vscode.Selection(location.start, location.end)];
			getRanges = (e) => e.selections;
		}
	} else {
		editor = getActiveEditor();
		getRanges = (e) => e.selections;
	}

	if (state.pendingTranspile && (typeof args.transforms === 'string' || isStringArray(args.transforms))) {
		await state.pendingTranspile;
	}

	const ctx = state.getTransformCtx(editor);
	const fns =
		typeof transforms === 'string' || isStringArray(transforms)
			? state.getAvailableTransforms({ filter: transforms }).filtered
			: transforms;

	if (!fns.length) {
		throw new Error('No transforms found');
	}

	const result = {
		editCount: 0,
		edit,
		transforms: fns.map((t) => t.label),
		ranges: getRanges(editor),
		type,
	};

	for (const transform of fns) {
		const ranges = getRanges(editor);
		result.editCount += await state.setEdits(
			[
				{
					document: editor.document,
					items: transformRanges(
						transform,
						type === 'lines' ? ranges.map((r) => editor.document.lineAt(r.start.line).rangeIncludingLineBreak) : ranges,
						editor,
						ctx
					),
				},
			],
			{ applyEdits }
		);
	}

	return result;
}
