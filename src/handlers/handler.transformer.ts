import * as vscode from 'vscode';
import type { ParsedTransform, TInput, TInputs, Transform, TransformContext } from '../types';
import { Warning } from '../utils/errors';
import { parseRanges } from '../utils/utils';
import { regexpTransform } from './handler.regexp';

export type CtxBase = Omit<TransformContext, 'lines'>;

/** Runs the functions of a transform in order; each receives the previous output. */
export async function runTransformer(transformer: ParsedTransform, text: string, ctx: TransformContext) {
	let result = text;
	for (const fn of transformer.functions) {
		try {
			result = await fn(result, ctx);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw new Warning(`Error in transform "${transformer.label}": ${message}`);
		}
		if (typeof result !== 'string') {
			throw new Warning(`Transform "${transformer.label}" returned ${typeof result}, expected a string.`);
		}
	}
	return result;
}

const toEdit = (range: vscode.Range, before: string, after: string) =>
	before === after ? [] : [vscode.TextEdit.replace(range, after)];

async function transformRange(
	transformer: Transform,
	editor: vscode.TextEditor,
	range: TInput,
	context: CtxBase
): Promise<vscode.TextEdit[]> {
	const separator = transformer.type === 'line' ? transformer.separator : undefined;
	const { lines, textLines, text } = parseRanges(editor, [range], separator)[0];
	const ctx: TransformContext = { ...context, lines: textLines, raw: text };

	if (transformer.type === 'regexp') return toEdit(range, text, regexpTransform(transformer, text));

	if (transformer.type === 'line') {
		const edits: vscode.TextEdit[] = [];
		for (const [i, line] of lines.entries()) {
			edits.push(...toEdit(line.range, line.text, await runTransformer(transformer, line.text, { ...ctx, line: i })));
		}
		return edits;
	}

	return toEdit(range, text, await runTransformer(transformer, text, ctx));
}

/** Applies one transform to each range, returning the edits per range. */
export async function transformRanges(
	transform: Transform,
	ranges: TInputs,
	editor: vscode.TextEditor,
	ctx: CtxBase
): Promise<vscode.TextEdit[][]> {
	const list = ranges instanceof Array ? ranges : [ranges];
	const result: vscode.TextEdit[][] = [];
	for (const range of list) result.push(await transformRange(transform, editor, range, ctx));
	return result;
}
