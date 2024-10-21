import * as vscode from 'vscode';
import type { TState } from '../state/state';
import type { MotionSelection, Overrides } from '../types';
import { type MotionInput, parseMotionInput } from './input';
import { getCursor, getInputBox, selectRanges } from './utils';
import { searchWords } from './words';

export const isSearch = (args: Overrides) =>
	!!args?.isSearch || (typeof args?.inputOverride === 'object' && args.inputOverride.type === 'search');

export function getSearchMotionInput<T>({
	args,
	state,
	handler,
}: {
	args?: Overrides;
	state: TState;
	handler: (input: MotionInput) => T;
}) {
	if (args?.inputOverride) {
		let value = typeof args.inputOverride === 'string' ? args.inputOverride : args.inputOverride.motion.value;
		const input = parseMotionInput(value, args);
		return input ? handler(input) : undefined;
	}

	let disposable: vscode.Disposable | undefined = undefined;
	return getInputBox({ title: 'Search for?' }).waitFor(({ value, inputBox }) => {
		if (!value) return;

		if (!disposable) {
			disposable = inputBox.onDidHide(() => {
				state.showDecorations();
				disposable?.dispose();
			});
		}
		const input = parseMotionInput(value, args);
		return input ? handler(input) : undefined;
	});
}

export type SearchCallback<T> = (args: {
	input: MotionInput;
	editor: vscode.TextEditor;
	matches: ReturnType<typeof searchWords>;
	edit: vscode.WorkspaceEdit;
	select: (args?: MotionSelection[], expand?: boolean) => vscode.Selection[];
}) => T | null;
export async function handleSearchMotion<T>({
	args,
	state,
	editor,
	onSearch,
}: {
	args?: Overrides;
	state: TState;
	editor: vscode.TextEditor;
	onSearch: SearchCallback<T>;
}) {
	const text = editor.document.getText();
	return getSearchMotionInput({
		args,
		state,
		handler: (input) => {
			const cursor = getCursor({
				editor,
				cursor: editor.selection.anchor,
				override: input.line != null && { line: input.line, character: 0 },
			});

			const searchResult = onSearch({
				input,
				matches: searchWords({
					state,
					input,
					editor,
					cursor,
					text,
					words: input.motion.value.split(' '),
				}),
				editor,
				edit: state.edit,
				select: (selected = [], expand) => selectRanges(editor, selected, expand ?? input.expand),
			});
			if (searchResult) {
				state.setPreviousMotion({ input, onSearch, isNext: input.isNext, isPrev: input.isPrev });
				return searchResult;
			}
		},
	});
}
