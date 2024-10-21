import * as vscode from 'vscode';

type TError = 'error' | 'warning' | 'info' | 'internal';

abstract class Throwable<T extends TError> extends Error {
	kind: T;
	protected constructor(message: string, kind: T) {
		super(message);
		this.kind = kind;
		this.onCreate();
	}

	protected abstract onCreate(): any;
	abstract onCatch(): void | never;
}

export class Warning extends Throwable<'warning'> {
	constructor(message: string) {
		super(message, 'warning');
	}

	onCatch() {}
	onCreate() {
		vscode.window.showWarningMessage(this.message);
	}
}

export class Internal extends Throwable<'internal'> {
	constructor(message: string) {
		super(message, 'internal');
	}
	onCatch(): never {
		throw this;
	}
	onCreate() {
		vscode.window.showErrorMessage('An internal error occurred. See output for more information.');
	}
}

export class Critical extends Throwable<'error'> {
	constructor(message: string) {
		super(message, 'error');
	}

	onCatch(): never {
		throw this;
	}

	onCreate() {
		vscode.window.showErrorMessage('An internal error occurred. See output for more information.');
	}
}

export class Info extends Throwable<'info'> {
	constructor(message: string) {
		super(message, 'info');
	}

	onCatch() {}

	onCreate() {
		vscode.window.showInformationMessage(this.message);
	}
}

export function rootError<T = unknown>(e: T) {
	if (e instanceof Throwable) {
		e.onCatch();
	} else {
		if (e instanceof Error) {
			throw new Internal(e.message);
		} else {
			console.error(e);
			throw new Internal('An internal error occurred.');
		}
	}
}
