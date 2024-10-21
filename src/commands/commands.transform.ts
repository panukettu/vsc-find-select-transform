import { existsSync } from 'fs';
import type { Transform } from '../types';
import { getCursorLine, getFullRange } from '../utils/utils';
import { Command } from './command';
import * as vscode from 'vscode';
import path from 'path';

export const TranspileSource = new Command('transform.transpile', async ({ state }) => {
	const cfg = state.updateConfig({
		changes: (_, next) => {
			if (!existsSync(next.transform.src)) {
				return vscode.window.showErrorMessage(`Source file not found: ${next.transform.src}`);
			}
			return { transpile: true };
		},
	});
	vscode.window.showInformationMessage(`Transpiled source ${path.extname(cfg.transform.src)}`);
});

export const TransformSelection = new Command('transform.selection', ({ state }, override?: Transform[]) => {
	return state.execTransforms((editor) => editor.selections, { type: 'range', applyEdits: true, override });
});

export const TransformSelectionWith = new Command('transform.selectionWith', ({ state }) => {
	return state.execTransforms((editor) => editor.selections, { type: 'range', pick: true, applyEdits: true });
});

export const TransformCursorLine = new Command('transform.cursorLine', ({ state, activeEditor, ...args }) => {
	return (
		state.getUndo()?.() ??
		state.execTransforms((editor) => [getCursorLine(editor).range], {
			type: 'cursor',
			saveUndo: true,
			applyEdits: true,
			override: args.override,
		})
	);
});

export const TransformCursorLineWith = new Command('transform.cursorLineWith', ({ state }) => {
	return (
		state.getUndo()?.() ??
		state.execTransforms((editor) => [getCursorLine(editor).range], {
			type: 'cursor',
			pick: true,
			saveUndo: true,
			applyEdits: true,
		})
	);
});

export const TransformFile = new Command('transform.activeFile', ({ state }) => {
	return state.execTransforms(
		(editor) => {
			return [getFullRange(editor)];
		},
		{ type: 'range', applyEdits: true }
	);
});

export const TransformFileWith = new Command('transform.activeFileWith', ({ state }) => {
	return state.execTransforms(
		(editor) => {
			return [getFullRange(editor)];
		},
		{ type: 'range', pick: true, applyEdits: true }
	);
});

export const UndoAtCursor = new Command('transform.undoAtCursor', ({ state }) => {
	return state.undos.undoAtCursor();
});

export const TransformRepeat = new Command('transform.repeat', ({ state, activeEditor }) => {
	if (!state.prev.transforms) return;

	const { range, cursor } = state.prev.transforms;

	if (!activeEditor.selection.isEmpty && range?.length) {
		return TransformSelection.execute({ override: range });
	}

	if (cursor?.length) {
		state.trace('-> TransformRepeat.cursor', cursor.length);
		return TransformCursorLine.execute({ override: cursor });
	}
});
