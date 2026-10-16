import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Command } from '../commands/command';
import type { Event, EventHandler, EventKey, Fn } from '../types';
import { Warning } from '../utils/errors';
import { getActiveEditor, UndoableWorkspaceEdit } from '../utils/utils';

export abstract class ExtensionStateBase<Id extends string, Config extends { rootPath: string }> {
	id: Id;
	config: Config;

	protected _listeners = new Map<string, vscode.Disposable>();
	protected ctx: vscode.ExtensionContext;
	statusBar: vscode.StatusBarItem;
	decorations = new Map<string, { type: vscode.TextEditorDecorationType; items: vscode.DecorationOptions[] }>();

	undos = new UndoableWorkspaceEdit();

	constructor(id: Id, config: Config, ctx: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		this.id = id;
		this.addListener('channel', outputChannel);
		this.config = config;
		this.ctx = ctx;
		this.statusBar = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, 0);
		this.statusBar.name = id;
		this.setStatus(`$(sync~spin) ${id}`);

		ctx.subscriptions.push(this.statusBar, { dispose: () => this.dispose() });

		void this.setContext('dev', ctx.extensionMode !== vscode.ExtensionMode.Production);
		this.createDecorationType('cursor');
	}

	setStatus(args: { text?: string; reset?: boolean; tooltip?: string; command?: any } | string) {
		let { reset, text, tooltip, command } = typeof args === 'string' ? { text: args } : args;
		if (!text && !tooltip && !command) {
			return this.statusBar.hide();
		}
		if (text) text = `fst: ${text}`;
		if (reset) {
			this.statusBar.hide();
			this.statusBar.command = command ?? undefined;
			this.statusBar.text = text ?? '';
			this.statusBar.tooltip = tooltip ?? undefined;
			return this.statusBar.show();
		}

		if (text) this.statusBar.text = text;
		if (tooltip) this.statusBar.tooltip = tooltip;
		if (command) this.statusBar.command = command;
		return this.statusBar.show();
	}

	addDecoration(args: { type: 'cursor'; range: vscode.Range; iconOrText?: string; right?: number }) {
		const { type, range, iconOrText, right = 5 } = args;
		const decoration = this.decorations.get(type);
		if (!decoration) return;
		decoration.items.push({
			range,
			renderOptions: {
				after: { contentText: iconOrText, textDecoration: `none; position: absolute; right: -${right}px;` },
			},
		});
		return decoration;
	}

	showDecorations(args?: { keep?: boolean; editor: vscode.TextEditor; type?: string }) {
		const { keep, editor = getActiveEditor(), type } = { ...args };
		if (!args?.keep) this.decorations.forEach((d) => editor.setDecorations(d.type, []));
		if (type) {
			const decoration = this.decorations.get(type);
			if (!decoration) return;
			editor.setDecorations(decoration.type, decoration.items);
			if (!keep) decoration.items = [];
		}

		if (!args?.keep) this.decorations.forEach((d) => (d.items = []));
	}

	createDecorationType(type: string, icon?: string) {
		this.decorations.get(type)?.type.dispose();
		this.decorations.set(type, {
			type: vscode.window.createTextEditorDecorationType({
				rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
				textDecoration: 'none; margin-left: 0; color: #fff;',
				backgroundColor: 'rgba(0, 0, 0, 0.3)',
				after: {
					margin: '0 0 0 0',
					contentIconPath: icon && this.ctx.asAbsolutePath(icon),
					width: '0px',
					height: '0px',
					textDecoration: 'none; margin-left: 0;',
				},
			}),
			items: [],
		});
	}

	/** Where transpiled transforms are emitted: workspace storage, or global storage without a workspace. */
	get outDir() {
		return vscode.Uri.joinPath(this.ctx.storageUri ?? this.ctx.globalStorageUri, 'transforms');
	}

	prevContext: Record<string, unknown> = {};

	/** Sets `when`-clause context keys, skipping values that did not change. */
	async setContext<T extends Record<string, number | string | boolean> | boolean | string | number>(
		key: string,
		value: T
	) {
		const entries: [string, unknown][] =
			typeof value === 'object'
				? Object.entries(value).map(([k, v]) => [`${this.id}.${key}.${k}`, v])
				: [[`${this.id}.${key}`, value]];

		for (const [ctxKey, v] of entries) {
			if (ctxKey in this.prevContext && this.prevContext[ctxKey] === v) continue;
			this.prevContext[ctxKey] = v;
			await vscode.commands.executeCommand('setContext', ctxKey, v);
		}
	}

	getContext<T>(key: string): T {
		return this.prevContext[`${this.id}.${key}`] as T;
	}

	registerCommands(...cmds: Command[]) {
		return cmds.map((cmd) => {
			const disposable = vscode.commands.registerCommand(cmd.id, this.commandBase(cmd));
			this.ctx.subscriptions.push(disposable);
			this.trace('-> Registered Command:', cmd.id);
			return disposable;
		});
	}

	protected abstract commandBase(cmd: Command): Fn;

	protected setConfig(newConfig: Config) {
		return (this.config = newConfig);
	}

	protected addListener<T extends vscode.Disposable>(key: string, listener: (() => T) | T, usePrevious = false) {
		const prev = this._listeners.get(key);
		if (usePrevious && prev) return prev as T;
		prev?.dispose();
		const newListener = typeof listener === 'function' ? listener() : listener;
		this._listeners.set(key, newListener);
		return newListener;
	}

	protected watch<T extends EventKey>(kind: T, listener: EventHandler<T>, id: string = kind) {
		const fn = (
			kind in vscode.workspace
				? vscode.workspace[kind as keyof typeof vscode.workspace]
				: vscode.window[kind as keyof typeof vscode.window]
		) as Event<T>;

		if (typeof fn !== 'function') throw new Warning(`Invalid kind: ${kind}`);

		if (kind === 'onDidChangeConfiguration') {
			return this.addListener(
				`watcher-config-${id}`,
				() =>
					fn((e) => {
						if (!e || ('affectsConfiguration' in e && !e.affectsConfiguration(this.id))) return;
						this.channel.debug('[LISTENER] Config Changed.');
						return listener(e as any);
					}),
				true
			);
		}

		return this.addListener(
			`watcher-${kind}-${id}`,
			() => {
				this.channel.debug(`[LISTENER] ${kind} - ${id}.`);
				return fn(listener);
			},
			true
		);
	}

	protected getListener<T extends vscode.Disposable = vscode.Disposable>(listener: string, init?: () => T): T {
		const result = this._listeners.get(listener);
		if (!result) {
			if (!init) throw new Warning(`Listener ${listener} not found`);
			return this.addListener(listener, init());
		}
		return result as T;
	}

	/** Disposes listeners by exact key or key prefix; everything when called without keys. */
	dispose(...keys: string[]) {
		if (!keys.length) {
			this._listeners.forEach((l) => l.dispose());
			this._listeners.clear();
			this.decorations.forEach((d) => d.type.dispose());
			this.decorations.clear();
			return;
		}
		for (const key of keys) {
			for (const [id, listener] of [...this._listeners]) {
				if (id === key || id.startsWith(key)) {
					listener.dispose();
					this._listeners.delete(id);
				}
			}
		}
	}

	/**
	 * Watches a single file for changes and creation. Works for files outside the
	 * workspace too (e.g. `<home>/...`), which a plain glob string would not.
	 */
	protected watchFile(location: string, listener: (uri: vscode.Uri) => unknown) {
		this.dispose('fs:');
		if (!location) return;
		const pattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(location)), path.basename(location));
		const watcher = this.addListener(`fs:${location}`, () => vscode.workspace.createFileSystemWatcher(pattern));
		this.addListener(`fs:${location}:change`, () => watcher.onDidChange(listener));
		this.addListener(`fs:${location}:create`, () => watcher.onDidCreate(listener));
		this.trace('[watchFile]', location, existsSync(location) ? '' : '(does not exist yet)');
	}

	get channel() {
		return this.getListener<vscode.LogOutputChannel>('channel');
	}

	get extensionPath() {
		return this.ctx.extensionPath;
	}

	debug(...args: any[]) {
		const title = typeof args[0] === 'string' ? args.shift() : 'Debug';
		return this.channel.debug(title, ...args);
	}

	strace(...args: any[]) {
		this.channel.trace('-'.repeat(50));
		this.trace(...args);
	}

	trace(...args: any[]) {
		const title = typeof args[0] === 'string' ? args.shift() : 'Debug';
		return this.channel.trace(title, ...args);
	}

	log(...args: any[]) {
		const title = typeof args[0] === 'string' ? args.shift() : 'Log';
		return this.channel.info(title, ...args);
	}
}
