/**
 * Minimal in-memory stand-in for the `vscode` module so pure helpers can be
 * unit tested with `bun test` outside of an extension host.
 */
import { mock } from 'bun:test';

export class Position {
	constructor(public line: number, public character: number) {}
	with(change: { line?: number; character?: number }) {
		return new Position(change.line ?? this.line, change.character ?? this.character);
	}
	isAfter(other: Position) {
		return this.line > other.line || (this.line === other.line && this.character > other.character);
	}
	isBefore(other: Position) {
		return this.line < other.line || (this.line === other.line && this.character < other.character);
	}
	isEqual(other: Position) {
		return this.line === other.line && this.character === other.character;
	}
}

export class Range {
	start: Position;
	end: Position;
	constructor(start: Position, end: Position) {
		this.start = start;
		this.end = end;
	}
	get isEmpty() {
		return this.start.isEqual(this.end);
	}
	isEqual(other: Range) {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end);
	}
	union(other: Range) {
		const start = this.start.isBefore(other.start) ? this.start : other.start;
		const end = this.end.isAfter(other.end) ? this.end : other.end;
		return new Range(start, end);
	}
}

export class Selection extends Range {
	anchor: Position;
	active: Position;
	constructor(anchor: Position, active: Position) {
		super(anchor, active);
		this.anchor = anchor;
		this.active = active;
	}
}

export class TextEdit {
	constructor(public range: Range, public newText: string) {}
	static replace(range: Range, newText: string) {
		return new TextEdit(range, newText);
	}
}

export class Uri {
	constructor(public fsPath: string) {}
	static file(p: string) {
		return new Uri(p);
	}
	toString() {
		return `file://${this.fsPath}`;
	}
}

export class RelativePattern {
	constructor(public base: Uri, public pattern: string) {}
}

/** A tiny TextDocument implementation backed by a string. */
export class FakeDocument {
	constructor(public text: string, public fileName = '/workspace/file.ts') {}
	get uri() {
		return Uri.file(this.fileName);
	}
	private get lines() {
		return this.text.split('\n');
	}
	get lineCount() {
		return this.lines.length;
	}
	getText(range?: Range) {
		if (!range) return this.text;
		return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
	}
	offsetAt(pos: Position) {
		const lines = this.lines;
		let offset = 0;
		for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
		return offset + pos.character;
	}
	positionAt(offset: number) {
		const lines = this.lines;
		let remaining = offset;
		for (let i = 0; i < lines.length; i++) {
			if (remaining <= lines[i].length) return new Position(i, remaining);
			remaining -= lines[i].length + 1;
		}
		const last = lines.length - 1;
		return new Position(last, lines[last].length);
	}
	lineAt(line: number) {
		const text = this.lines[line];
		const range = new Range(new Position(line, 0), new Position(line, text.length));
		const hasBreak = line < this.lines.length - 1;
		return {
			text,
			range,
			lineNumber: line,
			rangeIncludingLineBreak: hasBreak ? new Range(range.start, new Position(line + 1, 0)) : range,
		};
	}
}

export class FakeEditor {
	selections: Selection[] = [];
	constructor(public document: FakeDocument) {}
	get selection() {
		return this.selections[0];
	}
}

export const messages: { kind: string; message: string }[] = [];
export const settings = new Map<string, unknown>();

const vscodeMock = {
	Position,
	Range,
	Selection,
	TextEdit,
	Uri,
	RelativePattern,
	StatusBarAlignment: { Left: 1, Right: 2 },
	ExtensionMode: { Production: 1, Development: 2, Test: 3 },
	DecorationRangeBehavior: { ClosedClosed: 1 },
	env: { appRoot: '' },
	window: {
		activeTextEditor: undefined,
		visibleTextEditors: [],
		showWarningMessage: (message: string) => void messages.push({ kind: 'warning', message }),
		showErrorMessage: (message: string) => void messages.push({ kind: 'error', message }),
		showInformationMessage: (message: string) => void messages.push({ kind: 'info', message }),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: () => ({
			get: <T>(key: string, defaultValue?: T) => (settings.has(key) ? (settings.get(key) as T) : defaultValue),
		}),
	},
	commands: {
		executeCommand: async () => undefined,
	},
};

mock.module('vscode', () => vscodeMock);
