import * as vscode from 'vscode';

type TError = 'error' | 'warning' | 'info' | 'internal';

/**
 * Errors that double as user notifications: constructing one shows the message,
 * so a thrown instance never needs to be reported again by the catcher.
 */
export abstract class Throwable<T extends TError = TError> extends Error {
	kind: T;
	protected constructor(message: string, kind: T) {
		super(message);
		this.kind = kind;
		this.onCreate();
	}

	protected abstract onCreate(): void;
}

/** Something the user can fix. Shown as a warning. */
export class Warning extends Throwable<'warning'> {
	constructor(message: string) {
		super(message, 'warning');
	}
	onCreate() {
		vscode.window.showWarningMessage(this.message);
	}
}

export class Internal extends Throwable<'internal'> {
	constructor(message: string) {
		super(message, 'internal');
	}
	onCreate() {
		vscode.window.showErrorMessage(`An internal error occurred: ${this.message}`);
	}
}

export class Critical extends Throwable<'error'> {
	constructor(message: string) {
		super(message, 'error');
	}
	onCreate() {
		vscode.window.showErrorMessage(`An internal error occurred: ${this.message}`);
	}
}

export class Info extends Throwable<'info'> {
	constructor(message: string) {
		super(message, 'info');
	}
	onCreate() {
		vscode.window.showInformationMessage(this.message);
	}
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
