import * as vscode from 'vscode';
import { Warning } from '../utils/errors';
import { getState } from '../state/state';
import type { ParsedTransform, TInput, TInputs, Transform, TransformContext } from '../types';
import { parseRanges } from '../utils/utils';
import { regexpTransform } from './handler.regexp';

export type CtxBase = Omit<TransformContext, 'lines'>;

async function transform(transformer: ParsedTransform, text: string, ctx: TransformContext) {
	let result = text;
	for (const fn of transformer.functions) {
		try {
			result = await fn(text, ctx);
		} catch (e: any) {
			throw new Warning(`Error in ${transformer.label}.\nError: ${'message' in e ? e.message : e}`);
		}
	}
	return result;
}

async function transformRange(transformer: Transform, editor: vscode.TextEditor, range: TInput, context: CtxBase) {
	const state = getState();
	state.debug('[transform] ', transformer.label);

	const { lines, textLines, text } = parseRanges(editor, [range])[0];
	const ctx = { ...context, lines: textLines, raw: text };

	if (transformer.type === 'regexp') return [vscode.TextEdit.replace(range, regexpTransform(transformer, text))];
	if (transformer.type === 'line') {
		state.debug('[transform] lines:', lines.length);
		return Promise.all(
			lines.map(async (l, i) => {
				return vscode.TextEdit.replace(l.range, await transform(transformer, l.text, { ...ctx, line: i }));
			})
		);
	}

	return [vscode.TextEdit.replace(range, await transform(transformer, text, ctx))];
}

export async function transformRanges(
	t: Transform,
	r: TInputs,
	e: vscode.TextEditor,
	ctx: CtxBase
): Promise<vscode.TextEdit[][]>;
export async function transformRanges(
	t: Transform,
	r: TInputs,
	e: vscode.TextEditor,
	ctx: CtxBase
): Promise<vscode.TextEdit[][]> {
	if (!(r instanceof Array)) r = [r];
	return await Promise.all(r.map((range) => transformRange(t, e, range, ctx)));
}
