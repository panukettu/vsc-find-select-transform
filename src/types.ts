import type * as vscode from 'vscode';
import type { TState } from './state/state';
import type { Transformer } from './transformer';
import type { MotionInput } from './utils/input';
import type { Cursor, getCursor } from './utils/utils';
import type { SearchCallback } from './utils/search';

export type ExecTransformsArgs = {
	editor?: vscode.TextEditor;
	type: 'cursor' | 'range';
	pick?: boolean;
	applyEdits?: boolean;
	saveUndo?: boolean;
	override?: Transform[];
};
export type ExecTransformsResult = { editCount: number; transforms: Transform[]; type: 'cursor' | 'range' };
type WorkspaceEvents = Omit<
	Filter<typeof vscode.workspace, `on${string}`, vscode.Event<any>>,
	'onDidChangeActiveColorTheme'
>;

type WindowEvents = Filter<typeof vscode.window, `on${string}`, vscode.Event<any>>;

type FSEvents = Filter<vscode.FileSystemWatcher, `on${string}`, vscode.Event<any>>;

type GetEvent<T extends EventKey> = T extends keyof WorkspaceEvents
	? WorkspaceEvents[T]
	: T extends keyof WindowEvents
	? WindowEvents[T]
	: T extends keyof FSEvents
	? FSEvents[T]
	: never;

export type EventHandler<Key extends EventKey> = Parameters<Event<Key>>[0] extends (...args: infer Args) => any
	? (event: Args[0]) => any
	: never;
export type EventKey = keyof WorkspaceEvents | keyof WindowEvents | keyof FSEvents;

export type Event<T extends EventKey> = GetEvent<T>;

export type Filter<T extends {}, FKey = unknown, FValue = unknown> = {
	[K in keyof T as When<string, K, When<FKey, K> & When<FValue, T[K], K>>]: T[K];
};

export type Transform = ParsedTransform | RegExpTransform;

export type TFilter = `.${string}` | ('all' | 'cursor' | 'range') | undefined | string[];

export type TInput = vscode.Range | vscode.Selection;

export type TInputs = TInput[] | readonly TInput[] | TInput;

export type ParsedTransform = { label: string; functions: Transformer[]; type: 'line' | 'raw'; separator?: string };
export type RegExpTransform = {
	type: 'regexp';
	label: string;
	transforms: RegExpTransformPair[];
	additionalValues?: Record<string, string> | undefined;
	flags: string;
};

export type Fn<Args extends any[] = any[], R = any | Promise<any>> = (...args: Args) => R;

export type Transpilation = {
	source: string;
	js: string;
	outDir: string;
	files: string[];
};
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };
export type CommandGlobals<T extends Record<string, any>> = {
	state: TState;
	editor: vscode.TextEditor;
} & { [K in keyof T]: T[K] };
export type CommandHandler<Args extends { [key: string]: any }> = Fn<[CommandGlobals<Args>, ...any[]]>;
export type Undefined = null | undefined;
type Falsy = Undefined | false | '' | 0;
type Truthy = string | number | true | object | [];

export type If<T, Y, N = never> = [T] extends [Truthy] ? ([T] extends [Falsy] ? N : Y) : N;

export type When<T, T2, True = T2, False = never, Catch = never> = If<
	T,
	If<T2 extends T ? true : false, True, False>,
	Catch
>;

export type RegExpTransformPair = {
	matcher: RegExp;
	replacer: string;
	flags: string;
};

export type TransformContext = {
	file: string;
	ext: string;
	rootPath: string;
	raw?: string;
	lines: string[];
	line: number;
	documentText?: string;
};

export type CtxBase = Omit<TransformContext, 'lines'> & { line: -1 };

export type OneOrMore = Transformer | readonly Transformer[] | Transformer[];

export type MotionSelection =
	| vscode.Range
	| vscode.Selection
	| { start?: vscode.Position; end?: vscode.Position }
	| vscode.Position;

export type Overrides = {
	isNext?: boolean;
	isPrev?: boolean;
	isSearch?: boolean;
	isLine?: boolean;
	inputOverride?: MotionInput | string;
};
export type MotionCallback<T> =
	| ('select' | 'delete')[]
	| ((args: {
			motion: { input: MotionInput; ranges: vscode.Range[] };
			select: (args?: MotionSelection[], expand?: boolean) => vscode.Selection[];
			replace: (args?: MotionSelection[], inputs?: string[]) => Promise<vscode.Selection[] | false>;
			editor: vscode.TextEditor;
			edit: vscode.WorkspaceEdit;
	  }) => T);
export type MotionArgs<T> = {
	onSearch?: SearchCallback<T>;
	onMotion?: MotionCallback<T>;
	args: {
		state: TState;
		editor?: vscode.TextEditor;
		edit?: vscode.WorkspaceEdit;
	} & Overrides;
};
export type MotionRangeArgs = {
	editor?: vscode.TextEditor;
	state?: TState;
	cursor?: number;
} & Overrides;

export type PreviousActions = {
	transpile?: Transpilation;
	transforms?: {
		cursor: Transform[] | undefined;
		range: Transform[] | undefined;
	};
	motion?: { onMotion?: any; input: MotionInput; onSearch?: any; isNext?: boolean; isPrev?: boolean };
};
export type ExtMotionArgs<T> = {
	isNext?: boolean;
	isPrev?: boolean;
	isLine?: boolean;
	onMotion?: MotionCallback<T>;
	location?: vscode.Location | vscode.TextEditor;
};
export type ExtTransformArgs<T extends Transform[] | TFilter = TFilter | Transform[]> = {
	location?: vscode.Location | TInputs | vscode.Uri;
	transforms?: T;
	type?: 'range' | 'lines';
	edit?: vscode.WorkspaceEdit;
	applyEdits?: boolean;
};
