import * as vscode from 'vscode';

import { motion } from '../handlers/handler.motions';
import { getState } from '../state/state';
import { Command } from './command';

export type MotionBase<T = {}> = { isNext?: boolean; isPrev?: boolean; isLine?: boolean } & T;

export const Goto = async (
	args: MotionBase & { editor: vscode.TextEditor; line?: number; character?: number; select?: 'end' | 'start' }
) => {
	if (args.line != null) {
		const pos = args.editor.selection.start.with({ line: args.line });
		args.editor.selections = [new vscode.Selection(pos, pos)];
	} else {
		await motion({
			args: { ...args, state: getState(), editor: args.editor },
			onMotion: ({ select, motion: { ranges } }) =>
				select(ranges.map((r) => (args?.select === 'end' ? r.end : r.start))),
		});
	}
};

export const DisableKeyBindings = new Command('toggleKeybindings', async ({ state }) => {
	await state.setContext('keysDisabled', !state.getContext('keysDisabled'));
});
