import * as vscode from 'vscode';

import { motion } from '../handlers/handler.motions';
import { getState } from '../state/state';
import { Command } from './command';

export type MotionBase<T = {}> = { isNext?: boolean; isPrev?: boolean; isLine?: boolean } & T;

export const Goto = async (
	args: MotionBase & { activeEditor: vscode.TextEditor; line?: number; character?: number; select?: 'end' | 'start' }
) => {
	const editor = args.activeEditor;
	if (args.line != null) {
		const pos = editor.selection.start.with({ line: args.line, character: args.character ?? 0 });
		editor.selections = [new vscode.Selection(pos, pos)];
		editor.revealRange(new vscode.Range(pos, pos));
	} else {
		await motion({
			args: { ...args, state: getState(), editor },
			onMotion: ({ select, motion: { ranges } }) =>
				select(ranges.map((r) => (args?.select === 'end' ? r.end : r.start))),
		});
	}
};

export const DisableKeyBindings = new Command(
	'toggleKeybindings',
	async ({ state }) => {
		const disabled = !state.getContext('keysDisabled');
		await state.setContext('keysDisabled', disabled);
		vscode.window.setStatusBarMessage(`find-select-transform keybindings ${disabled ? 'disabled' : 'enabled'}`, 3000);
	},
	{ editor: false }
);
