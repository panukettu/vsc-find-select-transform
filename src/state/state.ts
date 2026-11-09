import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Command } from '../commands/command';
import { TranspileSource } from '../commands/commands.transform';
import { type Config, EXTENSION_ID, getAssociations, getConfig } from '../config/config.common';
import { getRegexpTransforms } from '../config/config.regexp';
import { loadTransforms } from '../config/config.transformer';
import { transformRanges } from '../handlers/handler.transformer';
import type {
	CtxBase,
	ExecTransformsArgs,
	ExecTransformsResult,
	ParsedTransform,
	PreviousActions,
	RegExpTransform,
	TFilter,
	TInputs,
	Transform,
	TransformKind,
	Transpilation,
} from '../types';
import { Critical, errorMessage, Info, Warning } from '../utils/errors';
import type { MotionInput } from '../utils/input';
import { loadTypeScript, transpile, typescriptCandidates } from '../utils/transpile';
import { ensureFile, getActiveEditor, offsetsAfterEdits, quickPickTransforms } from '../utils/utils';
import { ExtensionStateBase } from './base';

export type TState = InstanceType<typeof State>;

const shared = {
	current: undefined as State | undefined,
	pendingTranspile: null as Promise<Transpilation | undefined> | null,
	channel: null as vscode.LogOutputChannel | null,
};

export function createState(args: { ctx: vscode.ExtensionContext; channel: vscode.LogOutputChannel }) {
	if (shared.current) return shared.current;
	shared.channel = args.channel;
	args.channel.clear();
	args.channel.trace('*** Initializing state..');
	shared.current = new State(args.ctx, args.channel);
	if (args.ctx.extensionMode !== vscode.ExtensionMode.Production) args.channel.show(true);
	return shared.current;
}

class State extends ExtensionStateBase<typeof EXTENSION_ID, Config> {
	protected exportedTransforms: ParsedTransform[] = [];
	protected regexpTransforms: RegExpTransform[] = [];

	prev: PreviousActions = {};

	constructor(ctx: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		super(EXTENSION_ID, getConfig(), ctx, outputChannel);

		this.loadRegexpTransforms();

		this.watch('onDidChangeActiveTextEditor', (editor) => {
			this.updateConfig({ document: editor?.document });
		});

		this.watch('onDidChangeConfiguration', (e) => {
			const prev = this.config;
			const next = this.updateConfig({ regexp: true });
			const srcChanged = prev.transform.src !== next.transform.src;
			if (srcChanged || e.affectsConfiguration(`${EXTENSION_ID}.transform.watch`)) this.syncWatcher();
			if (srcChanged) void this.transpile();
		});

		void this.transpile().then(() => this.syncWatcher());
	}

	/** Wraps a command handler: injects state + active editor, merges object args, reports errors once. */
	protected override commandBase(cmd: Command) {
		return async (...args: unknown[]) => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor && cmd.options.editor) return;
			this.strace('-> Executing command:', cmd.id);

			const extra = args.reduce<Record<string, unknown>>(
				(acc, arg) => (arg && typeof arg === 'object' && !Array.isArray(arg) ? { ...acc, ...arg } : acc),
				{}
			);
			try {
				return await cmd.handler({ state: this, activeEditor: activeEditor as vscode.TextEditor, ...extra });
			} catch (e) {
				return this.onCommandError(cmd, e);
			}
		};
	}

	private onCommandError(cmd: Command, e: unknown) {
		// Warnings and infos already notified the user when they were created.
		if (e instanceof Warning || e instanceof Info) return this.trace(`[${cmd.id}]`, e.message);
		this.channel.error(`[${cmd.id}]`, e instanceof Error ? e.stack ?? e.message : String(e));
		if (!(e instanceof Critical)) vscode.window.showErrorMessage(`${cmd.name}: ${errorMessage(e)}`);
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

	/** Re-reads settings for the given (or active) document. */
	updateConfig(update?: ConfigUpdate) {
		const next = getConfig(update?.document ?? vscode.window.activeTextEditor?.document);
		super.setConfig(next);
		if (update?.regexp) this.loadRegexpTransforms();
		void this.updateContext();
		return next;
	}

	private loadRegexpTransforms() {
		try {
			this.regexpTransforms = getRegexpTransforms();
		} catch (e) {
			this.regexpTransforms = [];
			this.channel.error('[transform.regexp]', errorMessage(e));
		}
	}

	private syncWatcher() {
		this.dispose('fs:');
		if (this.config.transform.watch) this.watchFile(this.config.transform.src, () => void this.transpile());
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
		const all = this.transforms.all;

		const filter = !opts?.filter || opts?.pick ? 'all' : opts.filter;
		if (filter === 'all') return { all, filtered: all };
		if (Array.isArray(filter)) return { all, filtered: all.filter((t) => filter.includes(t.label)) };

		const current = this.config.transform.associations;
		let associations: string[];
		if (filter === 'cursor') associations = current.cursor;
		else if (filter === 'range') associations = current.range;
		else if (filter.startsWith('.')) {
			const forExt = getAssociations(filter);
			associations = [...forExt.cursor, ...forExt.range];
		} else associations = [...current.cursor, ...current.range];

		const filtered = all.filter((t) => associations.includes(t.label));
		this.trace('[getTransforms]', filtered.length, 'of', all.length, 'transforms for filter', filter);
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

		result.editCount = await this.runTransforms(
			result.transforms,
			typeof inputs === 'function' ? inputs(editor) : [inputs.range],
			editor,
			this.getTransformCtx(editor),
			config
		);

		return this.onTransformsFinished(result);
	}

	private async getActiveTransforms({ pick, type, override }: ExecTransformsArgs) {
		if (override?.length) return override;

		if (this.pendingTranspile) await this.pendingTranspile;

		const transforms = this.getAvailableTransforms({ filter: pick ? 'all' : type });
		if (pick) transforms.filtered = await quickPickTransforms(transforms.filtered);

		if (!transforms.filtered.length) {
			const ext = this.config.transform.associations.ext;
			throw new Warning(
				transforms.all.length
					? `No transforms associated with ${ext ? `.${ext}` : 'this'} files for ${type} commands. Configure "${EXTENSION_ID}.transform.associations" or use a "... With" command.`
					: `No transforms available. Check the ${EXTENSION_ID} output for transpile errors.`
			);
		}
		return transforms.filtered;
	}

	private onTransformsFinished(result: ExecTransformsResult) {
		if (!result.editCount) {
			this.setStatus({ text: 'nothing to transform' });
			setTimeout(() => this.refreshStatus(), 2000);
			return result;
		}

		this.setStatus({ text: `applied ${result.editCount} edit${result.editCount === 1 ? '' : 's'}` });
		setTimeout(() => this.refreshStatus(), 2000);
		this.setPreviousTransforms(result);
		return result;
	}

	private setPreviousTransforms({ transforms, type }: { transforms: Transform[]; type: TransformKind }) {
		this.prev.transforms = {
			cursor: type === 'cursor' ? transforms : this.prev.transforms?.cursor,
			range: type === 'range' ? transforms : this.prev.transforms?.range,
		};
		void this.updateContext();
	}

	/**
	 * Runs transforms in order, each on the output of the previous one. The ranges are tracked
	 * through the edits: re-reading editor.selections would not work, as an edit moves or collapses them.
	 * Returns the number of text edits.
	 */
	async runTransforms(
		transforms: Transform[],
		inputs: TInputs,
		editor: vscode.TextEditor,
		ctx: CtxBase,
		config: { applyEdits?: boolean; edit?: vscode.WorkspaceEdit; saveUndo?: boolean }
	) {
		const { document } = editor;
		let ranges = (inputs instanceof Array ? inputs : [inputs]) as readonly vscode.Range[];
		const textBefore = ranges.map((range) => document.getText(range));
		let editCount = 0;

		for (const [i, transform] of transforms.entries()) {
			const edits = await transformRanges(transform, ranges, editor, ctx);
			const offsets = offsetsAfterEdits(document, ranges, edits);
			// WorkspaceEdit.set appends, so reusing an edit that was applied would apply it again.
			const edit = config.applyEdits && i > 0 ? new vscode.WorkspaceEdit() : config.edit;
			const applied = await this.setEdits([{ document, items: edits }], { ...config, edit });
			editCount += applied;
			if (applied && config.applyEdits) {
				ranges = offsets.map(({ start, end }) => new vscode.Range(document.positionAt(start), document.positionAt(end)));
			}
		}

		// However many transforms ran, one run is one undo step per range.
		if (config.saveUndo && config.applyEdits) {
			const items = ranges.map((range, i) => ({
				prev: textBefore[i],
				newText: document.getText(range),
				lines: [range.start.line, range.end.line] as [number, number],
			}));
			this.undos.record(document.uri, items.filter((item) => item.prev !== item.newText));
		}

		return editCount;
	}

	/** Collects edits into a WorkspaceEdit and optionally applies it. Returns the number of text edits. */
	async setEdits(
		edits: {
			document: vscode.TextDocument;
			items: vscode.TextEdit[] | vscode.TextEdit[][] | Promise<vscode.TextEdit[] | vscode.TextEdit[][]>;
		}[],
		config?: { applyEdits?: boolean; edit?: vscode.WorkspaceEdit }
	): Promise<number> {
		const edit = config?.edit ?? new vscode.WorkspaceEdit();
		let count = 0;

		for (const { document, items } of edits) {
			const flat = (await items).flat() as vscode.TextEdit[];
			if (!flat.length) continue;
			count += flat.length;
			edit.set(document.uri, flat);
		}

		if (!count) return 0;
		return config?.applyEdits ? this.applyEdits(edit) : count;
	}

	async applyEdits(edit: vscode.WorkspaceEdit) {
		const total = edit.entries().reduce((n, [, edits]) => n + edits.length, 0);
		this.trace(`[applyEdits] ${total} edits across ${edit.size} documents`);

		const success = await vscode.workspace.applyEdit(edit);

		return success ? total : 0;
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
		return shared.pendingTranspile;
	}

	get hasTransformsFile() {
		const src = this.config.transform.src;
		return !!src && existsSync(src);
	}

	/**
	 * Transpiles the configured transforms file and loads its exports. Resolves to
	 * `undefined` (after reporting) when the file is missing or fails to compile.
	 * Concurrent calls share the in-flight transpilation.
	 */
	transpile(opts?: { force?: boolean }): Promise<Transpilation | undefined> {
		if (shared.pendingTranspile) return shared.pendingTranspile;

		const source = this.config.transform.src;
		if (!this.hasTransformsFile) {
			this.trace('[transpile] No transforms file at', source || '(unresolved path)');
			this.prev.transpile = undefined;
			this.exportedTransforms = [];
			return this.updateContext().then(() => undefined);
		}

		this.setStatus({ text: '$(sync~spin) transpiling', tooltip: source });
		const run = async () => {
			try {
				const ts = loadTypeScript(typescriptCandidates({ appRoot: vscode.env.appRoot, rootPath: this.config.rootPath }));
				const result = await transpile({
					source,
					outDir: this.outDir.fsPath,
					force: opts?.force,
					typescript: ts,
					nodeModules: this.config.rootPath ? path.join(this.config.rootPath, 'node_modules') : undefined,
				});
				this.trace(`[transpile] ${result.cached ? 'Up to date' : 'Emitted'} ->`, result.js, `(TypeScript ${ts.version})`);
				for (const diagnostic of result.diagnostics) this.channel.warn('[transpile]', diagnostic);

				const loaded = loadTransforms(result);
				for (const error of loaded.errors) this.channel.error('[transforms]', error);
				if (loaded.errors.length) {
					const more = loaded.errors.length > 1 ? ` (+${loaded.errors.length - 1} more, see output)` : '';
					vscode.window.showWarningMessage(`${path.basename(source)}: ${loaded.errors[0]}${more}`);
				}

				this.prev.transpile = result;
				this.exportedTransforms = loaded.transforms;
				return result;
			} catch (e) {
				const message = errorMessage(e);
				this.channel.error('[transpile]', message);
				this.prev.transpile = undefined;
				this.exportedTransforms = [];
				void vscode.window
					.showErrorMessage(`Transpiling ${path.basename(source)} failed: ${message.split('\n')[0]}`, 'Show output')
					.then((choice) => choice && this.channel.show());
				return undefined;
			} finally {
				shared.pendingTranspile = null;
				await this.updateContext();
			}
		};

		return (shared.pendingTranspile = run());
	}

	/** Creates the example transforms file at the configured path and transpiles it. */
	async createExampleTransforms() {
		const src = this.config.transform.src;
		if (!src) {
			throw new Warning(
				`Cannot resolve "${EXTENSION_ID}.transform.src" without an open folder. Open a folder or use an absolute path (e.g. "<home>/.config/transformer.ts").`
			);
		}
		const template = this.ctx.asAbsolutePath(path.join('out', 'transformer.ts'));
		const { created } = ensureFile(src, template);
		this.log(created ? '[transforms] Created example file' : '[transforms] File already exists', src);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(src), { preview: false });
		await this.transpile({ force: true });
		return src;
	}

	async updateContext() {
		const transforms = this.transforms;
		const prevTransforms = [...(this.prev.transforms?.cursor ?? []), ...(this.prev.transforms?.range ?? [])];

		await this.setContext('ctx', {
			hasPreviousMotion: !!this.prev.motion?.input.motion.value,
			hasPreviousSearch: !!this.prev.motion?.onSearch,
			hasTransformFile: this.hasTransformsFile,
			hasTransforms: transforms.exists,
			hasPreviousTransform: prevTransforms.length > 0 && prevTransforms.every((t) => transforms.labels.includes(t.label)),
		});

		this.refreshStatus();
	}

	private refreshStatus() {
		if (shared.pendingTranspile) return;
		const src = this.config.transform.src;
		const transforms = this.transforms;

		if (!this.hasTransformsFile) {
			return this.setStatus({
				reset: true,
				command: TranspileSource.id,
				text: '$(warning) no transforms file',
				tooltip: `${src || `${EXTENSION_ID}.transform.src cannot be resolved without an open folder.`}\n\nClick to create an example transforms file.`,
			});
		}

		const { cursor, range, ext } = this.config.transform.associations;
		const associated = new Set([...cursor, ...range].filter((label) => transforms.labels.includes(label)));
		this.setStatus({
			reset: true,
			command: TranspileSource.id,
			text: transforms.exists ? `${associated.size}/${transforms.all.length}` : '$(warning) no transforms',
			tooltip: [
				`${path.basename(src)}: ${transforms.all.length} transforms`,
				`${associated.size} associated with ${ext ? `.${ext}` : 'this'} files${associated.size ? `: ${[...associated].join(', ')}` : ''}`,
				'',
				'Click to transpile again.',
			].join('\n'),
		});
	}
}

export function debug(...args: [string, ...any[]]) {
	shared.channel?.debug(...args);
}

export function getState(args?: ConfigUpdate) {
	if (!(shared.current instanceof State)) throw new Critical('No initialized state.');
	if (args?.document) shared.current.updateConfig(args);

	return shared.current;
}

export type ConfigUpdate = {
	document?: vscode.TextDocument;
	/** Re-read `transform.regexp` as well. */
	regexp?: boolean;
};
