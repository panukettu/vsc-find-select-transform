import * as path from 'node:path';
import * as vscode from 'vscode';
import { Command } from '../commands/command';
import { type Config, getConfig, EXTENSION_ID, getAssociations } from '../config/config.common';
import { getRegexpTransforms } from '../config/config.regexp';
import { getExportedTransforms } from '../config/config.transformer';
import { Critical, Warning } from '../utils/errors';
import { transformRanges } from '../handlers/handler.transformer';
import { ExtensionStateBase } from './base';
import { tsc } from '../utils/tsc';
import type {
	CtxBase,
	ExecTransformsArgs,
	ExecTransformsResult,
	ExtTransformArgs,
	Fn,
	ParsedTransform,
	PreviousActions,
	RegExpTransform,
	TFilter,
	TInputs,
	Transform,
	Transpilation,
} from '../types';
import {
	getActiveEditor,
	getCursorLine,
	getFullRange,
	isStringArray,
	quickPickTransforms,
	toSelections,
} from '../utils/utils';
import type { MotionInput } from '../utils/input';
import { TranspileSource } from '../commands/commands.transform';

export type TState = InstanceType<typeof State>;

const state = {
	current: undefined as State | undefined,
	pendingTranspile: null as Promise<Transpilation> | null,
	channel: null as vscode.LogOutputChannel | null,
};

export function createState(args: { ctx: vscode.ExtensionContext; channel: vscode.LogOutputChannel }) {
	if (state.current?.prev.transpile?.js) return state.current;
	state.channel = args.channel;
	args.channel.clear();

	try {
		state.channel.trace('*** Initializing state..');
		state.current = new State(args.ctx, args.channel);
		state.current.channel.show(true);
	} catch (e) {
		state.channel.error('Failed to initialize state:', e);
		throw e;
	}

	return state.current;
}

class State extends ExtensionStateBase<typeof EXTENSION_ID, Config> {
	protected exportedTransforms: ParsedTransform[] = [];
	protected regexpTransforms: RegExpTransform[] = [];

	prev: PreviousActions = {};

	constructor(ctx: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		super(EXTENSION_ID, getConfig(), ctx, outputChannel);

		try {
			this.regexpTransforms = getRegexpTransforms();

			this.watch('onDidChangeActiveTextEditor', (e) => {
				this.setStatus(e ? path.extname(e?.document.fileName) : 'find-select-transform');
				this.updateConfig(e);
			});

			this.transpile().then(() => {
				this.channel.trace(
					`[State] Initial transpile complete. ${this.config.transform.watch ? 'Watching..' : 'Not watching.'}`
				);

				if (this.config.transform.watch)
					this.watchFile(this.config.transform.src, (e) => {
						return this.transpile(e.fsPath, this.outDir.fsPath);
					});

				this.watch('onDidChangeConfiguration', (e) => {
					this.updateConfig({
						changes: (prev, next) => {
							if (prev.transform.watch && !next.transform.watch) return this.dispose('fs');
							if (!prev.transform.watch && next.transform.watch) {
								this.watchFile(next.transform.src, (e) => this.transpile(e.fsPath, this.outDir.fsPath));
							}
						},
					});
				});
			});
		} catch (e) {
			console.log('Failed to initialize state:', e);
			this.channel.error('Failed to initialize state:', e);
			throw e;
		}
	}

	protected override commandBase<Args extends Parameters<T>, T extends Fn>(cmd: Command) {
		return (...args: Args) => {
			if (!vscode.window.activeTextEditor?.document) return;
			this.strace('-> Executing command:', cmd.id);
			try {
				return cmd.handler({
					state: this,
					activeEditor: vscode.window.activeTextEditor,
					...args.slice(1).reduce((a, b) => ({ ...a, ...b }), {}),
				});
			} catch (e) {
				if (e instanceof Error) throw e;
				return e;
			}
		};
	}

	async setPreviousMotion(args: {
		onMotion?: Function | string[];
		onSearch?: Function;
		input: MotionInput;
		isPrev?: boolean;
		isNext?: boolean;
	}) {
		this.prev.motion = args;
		await this.setContext('ctx', {
			hasPreviousMotion: !!args.input?.motion?.value,
			hasPreviousSearch: !!args.onSearch,
		});
	}

	updateConfig(update?: ConfigUpdate) {
		const oldConfig = this.config;
		const newConfig = getConfig(update?.document);
		this.regexpTransforms = getRegexpTransforms();
		super.setConfig(newConfig);
		const changes = update?.changes?.(oldConfig, newConfig);
		if (changes && typeof changes === 'object') {
			if ('transpile' in changes) this.transpile();
		}
		this.updateContext();
		return newConfig;
	}

	get transforms() {
		const allTransforms = [...this.exportedTransforms, ...this.regexpTransforms];
		return {
			all: allTransforms,
			exists: allTransforms.length > 0,
			labels: allTransforms.map((t) => t.label),
		};
	}

	getAvailableTransforms(opts?: { filter?: TFilter; pick?: boolean }) {
		const all = [...this.exportedTransforms, ...this.regexpTransforms];

		const filter = !opts?.filter || opts?.pick ? 'all' : opts.filter;
		if (filter === 'all') return { all, filtered: all };
		if (Array.isArray(filter)) return { all, filtered: all.filter((t) => filter.includes(t.label)) };

		let associations;
		if (filter === 'cursor') {
			associations = this.config.transform.associations?.cursor;
		} else if (filter === 'range') {
			associations = this.config.transform.associations?.range;
		} else if (filter.startsWith('.')) {
			const fileAssociations = getAssociations(filter);
			associations = [...fileAssociations.cursor, ...fileAssociations.range];
		} else {
			associations = [...this.config.transform.associations?.cursor, ...this.config.transform.associations?.range];
		}

		const filtered = all.filter((t) => associations.includes(t.label));

		this.trace('[getTransforms] Got ', filtered.length, 'transforms');
		this.strace(
			'[getTransforms] Associations:',
			'\n *  Cursor:',
			this.config.transform.associations.cursor,
			'\n *  Range:',
			this.config.transform.associations.range
		);
		return { all, filtered };
	}

	async execTransforms(inputs: ((editor: vscode.TextEditor) => TInputs) | vscode.Location, config: ExecTransformsArgs) {
		const editor =
			typeof inputs === 'function'
				? config.editor ?? getActiveEditor()
				: await vscode.window.showTextDocument(inputs.uri, { selection: inputs.range });

		const result: ExecTransformsResult = {
			editCount: 0,
			transforms: await this.getActiveTransforms(config),
			type: config.type,
		};

		const ctx = this.getTransformCtx(editor);
		for (const transform of result.transforms) {
			result.editCount += await this.setEdits(
				[
					{
						document: editor.document,
						items: transformRanges(
							transform,
							typeof inputs === 'function' ? inputs(editor) : [inputs.range],
							editor,
							ctx
						),
					},
				],
				config
			);
		}

		return this.onTransformsFinished(result);
	}

	private async getActiveTransforms({ pick, type, override }: ExecTransformsArgs) {
		if (override?.length) return override;

		const transforms = this.getAvailableTransforms({ filter: pick ? 'all' : type });
		if (pick) transforms.filtered = await quickPickTransforms(transforms.filtered);

		if (!transforms?.filtered?.length) {
			throw new Warning('No transforms found.');
		}
		return transforms.filtered;
	}

	private onTransformsFinished(result: ExecTransformsResult) {
		const { editCount, transforms, type } = result;
		if (!editCount) {
			vscode.window.showInformationMessage('No transforms applied.');
			return result;
		}

		vscode.window.showInformationMessage(`Transformed ${result.editCount} selections`);
		this.setPreviousTransforms({ transforms, type });
		return result;
	}

	private setPreviousTransforms(transforms: { transforms: Transform[]; type: 'cursor' | 'range' }) {
		this.prev.transforms = {
			cursor: transforms.type === 'cursor' ? transforms.transforms : this.prev.transforms?.cursor,
			range: transforms.type === 'range' ? transforms.transforms : this.prev.transforms?.range,
		};
		// this.setContext(
		// 	'ctx.hasPreviousTransform',
		// 	!!this.prev.transforms?.cursor?.length || !!this.prev.transforms?.range?.length
		// );
	}

	async setEdits<T extends boolean>(
		edits: {
			document: vscode.TextDocument;
			items: vscode.TextEdit[] | vscode.TextEdit[][] | Promise<vscode.TextEdit[] | vscode.TextEdit[][]>;
		}[],
		config?: { applyEdits?: T; edit?: vscode.WorkspaceEdit; saveUndo?: boolean }
	): Promise<number> {
		if (!edits) return 0;
		const edit = config?.edit ?? this.edit;

		for (let { document, items } of edits) {
			if (items instanceof Promise) items = await items;

			if (items instanceof Array && !(items[0] instanceof Array)) items = [items as vscode.TextEdit[]];
			edit.set(document.uri, items.flat());
		}

		return config?.applyEdits ? this.applyEdits(edit, config.saveUndo) : edit.size;
	}

	async applyEdits(edit = this.edit, saveEdits?: boolean) {
		this.trace(`\n\n[applyEdits] Applying to ${edit.size} documents..`);

		edit.entries().forEach(([uri, edits]) => {
			this.strace(`[applyEdits] ${edits.length} edits to ${uri.fsPath}`);
		});

		if (saveEdits) this.undos.queue(edit);
		const success = await vscode.workspace.applyEdit(edit);
		if (saveEdits) this.undos.append(success);

		const size = success ? edit.size : 0;
		this.trace(`[applyEdits] ${size} edits applied to ${size} documents.`);
		edit = new vscode.WorkspaceEdit();

		return size;
	}

	getUndo(editor = vscode.window.activeTextEditor) {
		if (this.config.transform.disableUndoToggle) return;
		const prev = this.undos.getPrevItem(editor);
		if (!prev) return;
		return () => this.undos.undoAtCursor(editor);
	}

	getTransformCtx(editor = vscode.window.activeTextEditor): CtxBase {
		if (!editor) throw new Warning('No active editor found.');
		return {
			file: editor.document.fileName,
			ext: this.config.transform.associations.ext,
			rootPath: this.config.rootPath,
			documentText: editor.document.getText(),
			line: -1,
		};
	}

	get pendingTranspile() {
		return state.pendingTranspile;
	}

	transpile(source = this.config.transform.src, outdir = this.outDir.fsPath) {
		if (state.pendingTranspile) return state.pendingTranspile;
		this.strace('[transpile] Transpiling..\n * Source:', source, '\n * To:', outdir);
		this.setStatus({ reset: true, tooltip: 'Transpiling..', text: 'Transpiling..' });

		if (!source?.length) {
			throw new Critical('[transpile] No source file provided for transpile.');
		}

		return (state.pendingTranspile = tsc(source, outdir, this)
			.then((transpiled) => {
				if (vscode.window.activeTextEditor) {
					this.setStatus(path.extname(vscode.window.activeTextEditor?.document.fileName));
				}
				this.trace('[transpile] output:', transpiled.js);

				this.prev.transpile = transpiled;
				this.exportedTransforms = getExportedTransforms(this.prev.transpile.js);

				return transpiled;
			})
			.catch((e) => {
				this.channel.error(e.message);
				throw e;
			})
			.finally(async () => {
				state.pendingTranspile = null;
				await this.updateContext();
			}));
	}
	async updateContext() {
		const hasFile = !!this.config.transform.src;
		const transforms = this.transforms;
		const prevTransforms = [...(this.prev.transforms?.cursor ?? []), ...(this.prev.transforms?.range ?? [])];

		await this.setContext('ctx', {
			hasPreviousMotion: !!this.prev.motion?.input.motion.value,
			hasPreviousSearch: !!this.prev.motion?.onSearch,
			hasTransformFile: hasFile,
			hasTransforms: transforms.exists,
			hasPreviousTransform: prevTransforms.every((t) => transforms.labels.includes(t.label)),
		});

		let statusText = 'Ready';
		if (!transforms.exists) statusText = 'No transforms';
		if (!hasFile) statusText = 'No transforms file';

		this.setStatus({
			command: TranspileSource.id,
			text: statusText,
			tooltip: `${path.basename(this.config.transform.src)}: ${
				transforms.all.length
			} transforms.\n\nClick to transpile.`,
		});
	}
}

type Update = { document: vscode.TextDocument };

export function debug(...args: [string, ...any[]]) {
	state.channel!.debug(...args);
}
export function getState(args?: Update) {
	if (!(state.current instanceof State)) throw new Critical('No initialized state.');
	if (args && 'document' in args) state.current.updateConfig(args);

	return state.current;
}

export type ConfigUpdate = {
	document?: vscode.TextDocument;
	changes?: (prev: Config, next: Config) => unknown;
};
