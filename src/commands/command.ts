import * as vscode from 'vscode';
import type { CommandHandler, Fn } from '../types';

export class Command<
	Args extends object = any,
	Name extends string = string,
	Handler extends CommandHandler<Args> = CommandHandler<Args>,
	Result extends ReturnType<Handler> = ReturnType<Handler>
> {
	name: Name;
	id: `find-select-transform.${Name}`;
	disposable?: vscode.Disposable;
	handler: Handler;

	static create<N extends string, H extends CommandHandler<any>>(name: N, handler: H) {
		return new Command(name, handler);
	}
	execute(...args: any[]) {
		return vscode.commands.executeCommand<Result>(this.id, ...args);
	}

	constructor(name: Name, handler: Handler) {
		this.handler = handler;
		this.name = name;
		this.id = `find-select-transform.${this.name}` as const;
	}
}
