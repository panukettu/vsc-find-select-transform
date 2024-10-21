import * as assert from 'assert';

import * as vscode from 'vscode';
import * as extension from '../../src/extension';
import exported from '../../src/transformer';

async function activateExtension(fileToOpen: vscode.Uri) {
	let ext = vscode.extensions.all.find((ext) => {
		return ext.id === '0xp.find-select-transform';
	});

	log1('ACTIVATING', ext?.id);

	const result: { ext: extension.SelectTransform; editor: vscode.TextEditor } = {} as any;
	if (!ext || !ext?.isActive) {
		const editor = await vscode.window.showTextDocument(fileToOpen);
		if (editor) {
			result.ext = await ext?.activate();
			await result.ext.transpile();
			result.editor = vscode.window.activeTextEditor ?? editor;
		} else {
			throw new Error(`Failed to open file: ${fileToOpen.toString()}`);
		}
	} else {
		const editor = await vscode.window.showTextDocument(fileToOpen);
		result.ext = ext.exports;
		result.editor = vscode.window.activeTextEditor ?? editor;
	}
	logd();
	log1('EXTENSION-STATUS', result?.ext.getStatus());
	log1('FILE', result.editor.document.uri.toString());
	logd();
	console.log('\n');
	return result;
}

suite('Extension Test Suite', () => {
	let ext: extension.SelectTransform;
	let editor: vscode.TextEditor;
	suiteSetup(async () => {
		console.log('Starting tests...');
		const folder = vscode.workspace.workspaceFolders![0];
		const result = await activateExtension(vscode.Uri.joinPath(folder.uri, 'index.ts'));
		ext = result.ext;
		editor = result.editor;
	});

	test('activates', async () => {
		assert.ok(ext, 'Extension not found');
		assert.ok(ext.isReady());
	});

	test('extension data', async () => {
		assert.ok(vscode.extensions.getExtension('0xp.find-select-transform')?.exports.isReady());
		assert.ok(!!ext.getTransforms().all.length, 'No transforms found');
	});

	test('api-motion-transform', async () => {
		const transforms = ext.getTransforms('.ts').filtered;
		assert.ok(transforms.length, 'No transforms found');

		console.log(
			'Transforms:',
			transforms.map((t) => t.label)
		);

		await cursorAt('hello world');
		await ext.motion('2L', { isNext: true });
		assert.ok(editor.selections.length === 2);

		assert.ok(textAt(editor, 0, true).includes('hello world'));
		assert.ok(textAt(editor, 1, true).includes('hello world'));

		await ext.transform({ transforms: ['helloWorldsToBar'] });

		assert.ok(textAt(editor, 0, true).includes('bar'));
		assert.ok(textAt(editor, 1, true).includes('bar'));
		console.log('Transformed:', textAt(editor, 0, true));
		console.log('Transformed:', textAt(editor, 1, true));

		await ext.motion("-2'");

		console.log('Select:', textAt(editor, 0, true));
		console.log('Select:', textAt(editor, 1, true));
		await ext.transform({
			transforms: [{ type: 'raw', functions: [exported.transforms.barsToHelloWorld], label: 'abc' }],
		});

		assert.ok(textAt(editor, 0, true).includes('hello world'));
		assert.ok(textAt(editor, 1, true).includes('hello world'));

		console.log('Transformed:', textAt(editor, 0, true));
		console.log('Transformed:', textAt(editor, 1, true));
	});
});

function log1(title: string, msg: any) {
	console.log(`[${title}] ->`, msg);
}

function logd() {
	console.log('*****************************************************');
}

const cursorAt = async (text: string, line = false) => {
	let editor = vscode.window.activeTextEditor;
	if (!editor) throw new Error('No active editor in test');

	const offset = editor.document.getText().indexOf(text);
	const position = editor.document.positionAt(offset);
	const range = !line ? new vscode.Range(position, position) : editor.document.lineAt(position.line).range;
	editor.selection = new vscode.Selection(range.start, range.end);
	return {
		range,
		text: editor.document.getText().slice(0, offset),
		wordRange: editor.document.getText(editor.document.getWordRangeAtPosition(range.start)),
	};
};

function textAt(editor: vscode.TextEditor, range?: vscode.Range | number, line = false) {
	range = typeof range === 'number' ? editor.selections[range] : range ?? editor.selection;
	if (line) return editor.document.lineAt(range.start.line).text;
	return editor.document.getText(range);
}
