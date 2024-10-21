// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DisableKeyBindings } from './commands/commands.general';
import * as Motions from './commands/commands.motions';
import * as Transforms from './commands/commands.transform';
import { EXTENSION_ID } from './config/config.common';
import { transform } from './handlers/handler.ext';
import { createState } from './state/state';
import type { ExtMotionArgs, ExtTransformArgs, MotionCallback, TFilter, Transform } from './types';
import { isStringArray, openLocation } from './utils/utils';
import { motion } from './handlers/handler.motions';

export function activate(ctx: vscode.ExtensionContext) {
	try {
		const channel = vscode.window.createOutputChannel(EXTENSION_ID, { log: true });
		const state = createState({ ctx, channel });
		state.registerCommands(...Object.values(Transforms), ...Object.values(Motions), DisableKeyBindings);
		return {
			isReady: () => !!state.prev.transpile?.js,
			getTransforms: (filter?: TFilter) => state.getAvailableTransforms({ filter }),
			transpile: () => state.transpile(),
			transform: <T extends Transform[] | TFilter>(args: ExtTransformArgs<T>) => transform<T>(state, args),
			motion: async <T = Record<'select' | 'delete', vscode.Selection[]>>(value: string, args?: ExtMotionArgs<T>) => {
				const editor = args?.location
					? 'range' in args.location
						? await openLocation(args.location)
						: args?.location
					: undefined;
				return motion<T>({
					args: {
						inputOverride: value,
						...args,
						state,
						editor,
					},
					onMotion: args?.onMotion ?? ['select'],
				});
			},
			getStatus: () => ({
				isReady: !!state.prev.transpile?.js,
				transforms: state.transforms.labels,
				isTranspiling: !!state.pendingTranspile,
				prev: state.prev,
				config: state.config,
			}),
			getCommands: async () => (await vscode.commands.getCommands(true)).filter((c) => c.startsWith('find-select')),
			getConfig: () => state.config,
		};
	} catch (e) {
		console.error('Failed to activate extension:', e);
		throw e;
	}
}

export function deactivate() {}

export type SelectTransform = ReturnType<typeof activate>;
