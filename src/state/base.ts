import { existsSync } from 'fs';
import * as vscode from 'vscode';
import type { Command } from '../commands/command';
import type { Event, EventHandler, EventKey, Fn } from '../types';
import { rootError, Warning } from '../utils/errors';
import { getActiveEditor, UndoableWorkspaceEdit } from '../utils/utils';

export abstract class ExtensionStateBase<Id extends string, Config extends { rootPath: string }> {
	id: Id;
	config: Config;

	protected _listeners = new Map<string, vscode.Disposable>();
	protected filesWatched: Set<string> = new Set();
	protected ctx: vscode.ExtensionContext;
	statusBar: vscode.StatusBarItem;
	decorations = new Map<string, { type: vscode.TextEditorDecorationType; items: vscode.DecorationOptions[] }>();

	edit = new vscode.WorkspaceEdit();
	undos = new UndoableWorkspaceEdit();

	constructor(id: Id, config: Config, ctx: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		this.id = id;
		this.addListener('channel', outputChannel);
		this.config = config;
		this.ctx = ctx;
		this.statusBar = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, 0);
		this.statusBar.name = id;
		this.setStatus(`$(sync~spin) ${id}`);

		this.setContext('dev', ctx.extensionMode !== vscode.ExtensionMode.Production);
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

	get outDir() {
		return this.ctx.storageUri ?? this.ctx.extensionUri.with({ path: this.ctx.extensionUri.path + '/temp' });
	}

	prevContext: Record<string, any> = {};
	async setContext<T extends Record<string, number | string | boolean> | boolean | string | number>(
		key: string,
		value: T
	) {
		if (typeof value === 'object' && Object.keys(value).length) {
			for (const [k, v] of Object.entries(value)) {
				const ctxKey = `${this.id}.${key}.${k}`;
				this.prevContext[ctxKey] = v;
				await vscode.commands.executeCommand('setContext', ctxKey, v);
			}
		} else {
			this.prevContext[`${this.id}.${key}`] = value;
			return await vscode.commands.executeCommand('setContext', `${this.id}.${key}`, value);
		}
	}

	getContext<T>(key: string): T {
		if (!this.prevContext) return undefined as T;
		const ctxKey = `${this.id}.${key}`;
		return this.prevContext[ctxKey] as T;
	}

	registerCommands(...cmds: Command[]) {
		return cmds.map((cmd) => this._registerCommand(cmd.id, this.commandBase(cmd)));
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

	protected _registerCommand<CommandId extends string, T extends Fn, Args extends Parameters<T>>(
		cmdId: CommandId,
		handler: T
	) {
		const disposable = vscode.commands.registerCommand(cmdId, (...args: Args) => {
			if (!vscode.window.activeTextEditor?.document) return;
			try {
				return handler({ state: this, editor: vscode.window.activeTextEditor }, ...args);
			} catch (e) {
				return rootError(e);
			}
		});
		this.ctx.subscriptions.push(disposable);
		this.trace('-> Registered Command:', cmdId);
		return disposable;
	}

	protected getListener<T extends vscode.Disposable = vscode.Disposable>(listener: string, init?: () => T): T {
		const result = this._listeners.get(listener);
		if (!result) {
			if (!init) throw new Warning(`Listener ${listener} not found`);
			return this.addListener(listener, init());
		}
		return result as T;
	}

	dispose(...keys: string[]) {
		if (!keys?.length) {
			this._listeners.forEach((l) => l.dispose());
			this._listeners.clear();
		} else {
			keys.forEach((k) => {
				if (!this._listeners.has(k)) {
					const fuzz = [...this._listeners.keys()].filter((id) => id.includes(k));
					if (!fuzz.length) return;
					fuzz.forEach((f) => this._listeners.get(f)?.dispose());
				} else {
					this._listeners.get(k)?.dispose();
				}
			});
		}
	}

	protected watchFile(
		location: string,
		listener: EventHandler<'onDidChange'>,
		params = { allowEmpty: false, clear: true }
	) {
		if (!location?.length) return;
		if (!params.allowEmpty && !existsSync(location)) throw new Warning(`File not found: ${location}`);

		if (params.clear) this.dispose('fs');
		this.addListener(
			`fs-onChange-${location}`,
			() =>
				this.addListener(`fs-${location}`, () => vscode.workspace.createFileSystemWatcher(location), true).onDidChange(
					listener
				),
			true
		);

		this.filesWatched.add(location);
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
