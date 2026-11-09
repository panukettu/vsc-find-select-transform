import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type * as extension from '../../src/extension';

/**
 * One test per feature, against a real VS Code. Every test gets a fresh file, so
 * undo history and selections cannot leak between tests. In document strings `|`
 * marks the cursor. Tests asserting documented behaviour the code does not have
 * yet are `test.skip` with a `BUG:` comment.
 */

const EXTENSION_ID = '0xp.find-select-transform';
const PREFIX = 'find-select-transform';

suite('features', () => {
	let ext: extension.SelectTransform;
	let editor: vscode.TextEditor;
	let root: string;
	let docCount = 0;
	let srcCount = 0;
	let undoStubs: (() => void)[] = [];
	let changedSettings = new Set<string>();

	suiteSetup(async () => {
		root = vscode.workspace.workspaceFolders![0].uri.fsPath;
		const found = vscode.extensions.getExtension<extension.SelectTransform>(EXTENSION_ID);
		assert.ok(found, 'Extension not found');
		ext = await found.activate();
		await ext.transpile();
	});

	teardown(async () => {
		undoStubs.reverse().forEach((undo) => undo());
		undoStubs = [];

		const resetSrc = changedSettings.has('transform.src');
		for (const key of changedSettings) await setConfig(key, undefined);
		changedSettings = new Set();
		if (resetSrc) await ext.transpile();

		await vscode.workspace.saveAll(false);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	/* ------------------------------------------------------------------------ */
	/*                                  Helpers                                 */
	/* ------------------------------------------------------------------------ */

	/** Opens a new file with the given text; `|` marks the cursor. */
	async function open(marked: string, extName = 'ts') {
		const offset = marked.indexOf('|');
		const file = path.join(root, `doc-${++docCount}.${extName}`);
		fs.writeFileSync(file, marked.replace('|', ''));
		editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
		const position = editor.document.positionAt(Math.max(offset, 0));
		editor.selections = [new vscode.Selection(position, position)];
		return editor;
	}

	const run = (command: string, ...args: unknown[]) =>
		vscode.commands.executeCommand<any>(`${PREFIX}.${command}`, ...args);

	const text = () => editor.document.getText();
	const lineText = (line: number) => editor.document.lineAt(line).text;
	const selected = () => editor.selections.map((s) => editor.document.getText(s));
	const assertSelected = (...expected: string[]) => assert.deepStrictEqual(selected(), expected);
	const cursorAt = () => editor.document.offsetAt(editor.selection.active);

	function selectAll() {
		const end = editor.document.positionAt(text().length);
		editor.selections = [new vscode.Selection(new vscode.Position(0, 0), end)];
	}

	function selectText(...parts: string[]) {
		editor.selections = parts.map((part) => {
			const offset = text().indexOf(part);
			assert.ok(offset >= 0, `"${part}" not found`);
			return new vscode.Selection(editor.document.positionAt(offset), editor.document.positionAt(offset + part.length));
		});
	}

	function moveCursorTo(line: number, character = 0) {
		editor.selections = [new vscode.Selection(line, character, line, character)];
	}

	/** Updates a setting and waits until the extension has seen the change. */
	async function setConfig(key: string, value: unknown) {
		const config = vscode.workspace.getConfiguration(PREFIX);
		if (value !== undefined) changedSettings.add(key);
		if (JSON.stringify(config.inspect(key)?.workspaceValue) === JSON.stringify(value)) return;

		const seen = new Promise<void>((resolve) => {
			const listener = vscode.workspace.onDidChangeConfiguration((e) => {
				if (!e.affectsConfiguration(`${PREFIX}.${key}`)) return;
				listener.dispose();
				resolve();
			});
		});
		await config.update(key, value, vscode.ConfigurationTarget.Workspace);
		await seen;
	}

	/** Replaces a `vscode.window` function for the current test. */
	function stubWindow(name: string, replacement: unknown) {
		const target = vscode.window as any;
		const original = target[name];
		target[name] = replacement;
		undoStubs.push(() => (target[name] = original));
	}

	/** Answers the next "... With" quick pick with the given transform. */
	function pickTransform(label: string) {
		stubWindow('showQuickPick', async (items: { label: string }[]) => items.filter((item) => item.label === label));
	}

	/** A controllable input box: VS Code offers no way to type into a real one from a test. */
	function fakeInputBox() {
		const changed = new vscode.EventEmitter<string>();
		const hidden = new vscode.EventEmitter<void>();
		let onOpened: () => void;
		const opened = new Promise<void>((resolve) => (onOpened = resolve));
		const box = {
			value: '',
			title: '',
			ignoreFocusOut: false,
			disposed: false,
			show() {},
			hide: () => hidden.fire(),
			dispose() {
				box.disposed = true;
			},
			onDidHide: hidden.event,
			onDidChangeValue: (listener: (value: string) => unknown) => {
				const disposable = changed.event(listener);
				onOpened();
				return disposable;
			},
		};
		stubWindow('createInputBox', () => box);
		return {
			box,
			async type(value: string) {
				await opened;
				box.value = value;
				changed.fire(value);
				await new Promise((resolve) => setTimeout(resolve, 20));
			},
		};
	}

	/** Runs a command that opens the input box and types each value in turn. */
	async function runTyping(command: string, ...values: string[]) {
		const { type } = fakeInputBox();
		const result = run(command);
		for (const value of values) await type(value);
		return result;
	}

	/** Writes a transforms file (first entry is the entry point) and makes it the configured source. */
	async function useTransformsFile(files: Record<string, string>) {
		const dir = path.join(root, '.vscode', `src-${++srcCount}`);
		fs.mkdirSync(dir, { recursive: true });
		for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
		const entry = path.join(dir, Object.keys(files)[0]);
		await setConfig('transform.src', entry);
		return { entry, result: await ext.transpile() };
	}

	async function waitUntil(condition: () => boolean, message: string, timeoutMs = 20000) {
		const start = Date.now();
		while (!condition()) {
			assert.ok(Date.now() - start < timeoutMs, `Timed out waiting: ${message}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	/* ------------------------------------------------------------------------ */
	/*                                 Transforms                               */
	/* ------------------------------------------------------------------------ */

	suite('transform shapes', () => {
		test('custom separator splits on it instead of on lines', async () => {
			await open('a, b');
			selectAll();
			await ext.transform({ transforms: ['upperCaseCsv'] });
			assert.strictEqual(text(), 'A,B');
		});

		test('async functions are awaited', async () => {
			await open('b\na');
			selectAll();
			await ext.transform({ transforms: ['sortLines'] });
			assert.strictEqual(text(), 'a\nb');
		});

		test('line transforms receive ctx with their line index', async () => {
			await open('one\ntwo\nthree');
			selectText('one\ntwo');
			const seen: any[] = [];
			await ext.transform({
				transforms: [{ type: 'line', label: 'spy', functions: [(t: string, ctx: any) => (seen.push(ctx), t)] }],
			});

			assert.deepStrictEqual(seen.map((ctx) => ctx.line), [0, 1]);
			assert.strictEqual(seen[0].file, editor.document.fileName);
			assert.strictEqual(seen[0].ext, 'ts');
			assert.strictEqual(seen[0].rootPath, root);
			assert.strictEqual(seen[0].raw, 'one\ntwo');
			assert.deepStrictEqual(seen[0].lines, ['one', 'two']);
			assert.strictEqual(seen[0].documentText, 'one\ntwo\nthree');
		});

		test('raw transforms run once with line -1', async () => {
			await open('one\ntwo');
			selectAll();
			const seen: any[] = [];
			await ext.transform({
				transforms: [{ type: 'raw', label: 'spy', functions: [(t: string, ctx: any) => (seen.push([t, ctx.line]), t)] }],
			});
			assert.deepStrictEqual(seen, [['one\ntwo', -1]]);
		});

		test('a throwing transform reports its label and edits nothing', async () => {
			await open('keep');
			selectAll();
			const boom = () => {
				throw new Error('nope');
			};
			await assert.rejects(
				ext.transform({ transforms: [{ type: 'line', label: 'boom', functions: [boom] }] }),
				/Error in transform "boom": nope/
			);
			assert.strictEqual(text(), 'keep');
		});

		test('a transform returning a non-string is rejected', async () => {
			await open('keep');
			selectAll();
			await assert.rejects(
				ext.transform({ transforms: [{ type: 'line', label: 'bad', functions: [(() => 1) as any] }] }),
				/Transform "bad" returned number, expected a string/
			);
			assert.strictEqual(text(), 'keep');
		});
	});

	suite('transforms file', () => {
		test('relative imports are transpiled along with the file', async () => {
			await useTransformsFile({
				'main.ts': `import { shout } from './helper'; export default { transforms: { shout: (t) => shout(t) } };`,
				'helper.ts': `export const shout = (t: string) => t.toUpperCase();`,
			});
			await open('hi');
			selectAll();
			await ext.transform({ transforms: ['shout'] });
			assert.strictEqual(text(), 'HI');
		});

		test('a .js file works as the source', async () => {
			await useTransformsFile({ 'main.js': `module.exports = { transforms: { fromJs: (t) => t + '!' } };` });
			assert.deepStrictEqual(ext.getTransforms().all.map((t) => t.label), ['fromJs']);
		});

		test('src expands <root>, <home> and relative paths', async () => {
			await setConfig('transform.src', '<root>/a/x.ts');
			assert.strictEqual(ext.getConfig().transform.src, path.join(root, 'a', 'x.ts'));
			await setConfig('transform.src', '<home>/x.ts');
			assert.strictEqual(ext.getConfig().transform.src, path.join(os.homedir(), 'x.ts'));
			await setConfig('transform.src', 'b/x.ts');
			assert.strictEqual(ext.getConfig().transform.src, path.join(root, 'b', 'x.ts'));
		});

		test('type errors do not block transpilation', async () => {
			const { result } = await useTransformsFile({
				'main.ts': `const n: number = 'text'; export default { transforms: { typed: (t: string) => t + n } };`,
			});
			assert.deepStrictEqual(result?.diagnostics, []);
			assert.deepStrictEqual(ext.getTransforms().all.map((t) => t.label), ['typed']);
		});

		test('syntax errors are reported as diagnostics', async () => {
			stubWindow('showWarningMessage', async () => undefined);
			const { result } = await useTransformsFile({ 'main.ts': `export default { transforms: { bad: (t) => } };` });
			assert.ok(result?.diagnostics.length, 'expected diagnostics');
		});

		test('a file without a transforms export warns and loads nothing', async () => {
			const warnings: string[] = [];
			stubWindow('showWarningMessage', async (message: string) => void warnings.push(message));
			await useTransformsFile({ 'main.ts': `export default { nope: 1 };` });
			assert.ok(warnings.some((w) => w.includes('must `export default')), `warnings: ${warnings}`);
			assert.deepStrictEqual(ext.getTransforms().all, []);
		});

		test('unchanged files are served from the cache unless forced', async () => {
			await ext.transpile(true);
			assert.strictEqual((await ext.transpile(false))?.cached, true);
			assert.strictEqual((await ext.transpile(true))?.cached, false);
		});

		test('transform.watch re-transpiles when the file changes', async () => {
			const { entry } = await useTransformsFile({ 'main.ts': `export default { transforms: { before: (t) => t } };` });
			await setConfig('transform.watch', true);
			fs.writeFileSync(entry, `export default { transforms: { after: (t) => t } };`);
			await waitUntil(() => ext.getTransforms().all.some((t) => t.label === 'after'), 'watcher to reload the file');
		});

		test('createExampleTransforms creates and loads the example file', async () => {
			const src = path.join(root, '.vscode', `example-${++srcCount}`, 'transformer.ts');
			await setConfig('transform.src', src);
			await ext.createExampleTransforms();
			assert.ok(fs.existsSync(src), 'example file not created');
			assert.ok(ext.getTransforms().all.some((t) => t.label === 'helloWorldsToFoo'));
		});
	});

	suite('regexp transforms', () => {
		const useRegexp = (name: string, config: unknown) => setConfig('transform.regexp', { [name]: config });

		test('rewrite the range and are listed as transforms', async () => {
			await useRegexp('toDouble', { flags: 'g', transforms: [["'(.*?)'", '"$1"']] });
			await open(`a = 'x'; b = 'y';`);
			selectAll();
			await ext.transform({ transforms: ['toDouble'] });
			assert.strictEqual(text(), `a = "x"; b = "y";`);
		});

		test('pairs apply in order', async () => {
			await useRegexp('chain', { transforms: [['a', 'b'], ['b', 'c']] });
			await open('a');
			selectAll();
			await ext.transform({ transforms: ['chain'] });
			assert.strictEqual(text(), 'c');
		});

		test('a pair can set its own flags', async () => {
			await useRegexp('insensitive', { transforms: [['HELLO', 'bye', 'i']] });
			await open('hello');
			selectAll();
			await ext.transform({ transforms: ['insensitive'] });
			assert.strictEqual(text(), 'bye');
		});

		test('additionalValues add $id placeholders', async () => {
			await useRegexp('formatAssignment', {
				transforms: [['^(?<type>\\w+)\\s+(?<name>.*?)\\s*=\\s*(?<value>[^;/]*);?.*$', '$comment\nconst $<name> = $<value>;']],
				additionalValues: { comment: '(//.*)$' },
			});
			await open('int x = 1; // note');
			selectAll();
			await ext.transform({ transforms: ['formatAssignment'] });
			assert.strictEqual(text(), '// note\nconst x = 1;');
		});
	});

	suite('associations', () => {
		test('an extension entry wins over the * fallback', async () => {
			await setConfig('transform.associations', { '*': ['noop'], json: ['sortLines'] });
			assert.deepStrictEqual(ext.getTransforms('.json').filtered.map((t) => t.label), ['sortLines']);
			assert.deepStrictEqual(ext.getTransforms('.md').filtered.map((t) => t.label), ['noop']);
		});

		test('cursor and range entries drive their own commands', async () => {
			await setConfig('transform.associations', { ts: { cursor: ['helloWorldsToBar'], range: ['helloWorldsToFoo'] } });
			await open('|hello world\nhello world');
			await run('transform.cursorLine');
			assert.strictEqual(lineText(0), 'bar');

			selectText('hello world');
			await run('transform.selection');
			assert.strictEqual(lineText(1), 'foo');
		});

		// BUG: README says "Transforms run in the listed order", but getAvailableTransforms
		// filters the exported list, so they run in the order of the transforms file.
		test.skip('transforms run in the listed order', async () => {
			await setConfig('transform.associations', { ts: ['barsToHelloWorld', 'helloWorldsToBar'] });
			await open('|hello world');
			await run('transform.activeFile');
			assert.strictEqual(text(), 'bar');
		});

		test('on a selection, each transform receives the output of the previous one', async () => {
			await setConfig('transform.associations', { ts: ['helloWorldsToBar', 'barsToHelloWorld'] });
			await open('hello world');
			selectAll();
			await run('transform.selection');
			assert.strictEqual(text(), 'hello world');
		});
	});

	suite('chaining on a selection', () => {
		/** Runs `first` then a transform appending "2", returning what that second transform received. */
		async function chain(type: 'line' | 'raw', first: (t: string) => string) {
			const received: string[] = [];
			await ext.transform({
				transforms: [
					{ type, label: 'first', functions: [first] },
					{ type, label: 'second', functions: [(t: string) => (received.push(t), `${t}2`)] },
				],
			});
			return received;
		}

		test('part of a line', async () => {
			await open('xx abc yy');
			selectText('abc');
			assert.deepStrictEqual(await chain('line', () => 'ZZZ'), ['ZZZ']);
			assert.strictEqual(text(), 'xx ZZZ2 yy');
		});

		test('several lines', async () => {
			await open('abc\ndef');
			selectAll();
			assert.deepStrictEqual(await chain('line', () => 'ZZZ'), ['ZZZ', 'ZZZ']);
			assert.strictEqual(text(), 'ZZZ2\nZZZ2');
		});

		test('raw transforms', async () => {
			await open('abc\ndef');
			selectAll();
			assert.deepStrictEqual(await chain('raw', () => 'ZZZ'), ['ZZZ']);
			assert.strictEqual(text(), 'ZZZ2');
		});

		test('several selections on a line, where the first edit shifts the second selection', async () => {
			await open('abc def');
			selectText('abc', 'def');
			assert.deepStrictEqual(await chain('line', () => 'LONGER'), ['LONGER', 'LONGER']);
			assert.strictEqual(text(), 'LONGER2 LONGER2');
		});

		test('several selections in reverse document order', async () => {
			await open('abc def');
			selectText('def', 'abc');
			assert.deepStrictEqual(await chain('line', () => 'LONGER'), ['LONGER', 'LONGER']);
			assert.strictEqual(text(), 'LONGER2 LONGER2');
		});

		test('output with more lines than the input', async () => {
			await open('keep\nabc\nkeep');
			selectText('abc');
			assert.deepStrictEqual(await chain('raw', () => 'x\ny'), ['x\ny']);
			assert.strictEqual(text(), 'keep\nx\ny2\nkeep');
		});

		test('a CRLF document, where applying an edit converts its line endings', async () => {
			await open('keep\r\nabc\r\nkeep');
			selectText('abc');
			assert.deepStrictEqual(await chain('raw', () => 'x\ny'), ['x\r\ny']);
			assert.strictEqual(text(), 'keep\r\nx\r\ny2\r\nkeep');
		});

		test('an empty selection receives what was inserted at it', async () => {
			await open('a|b');
			assert.deepStrictEqual(await chain('raw', (t) => `${t}X`), ['X']);
			assert.strictEqual(text(), 'aX2b');
		});

		test('a first transform that changes nothing leaves the selection as it was', async () => {
			await open('xx abc yy');
			selectText('abc');
			assert.deepStrictEqual(await chain('line', (t) => t), ['abc']);
			assert.strictEqual(text(), 'xx abc2 yy');
		});
	});

	suite('chaining on activeFile and cursorLine', () => {
		/** Associates the transforms with .ts files, in the order they are exported here, and opens a document. */
		async function setUpChain(labels: string[], doc: string) {
			await useTransformsFile({
				'main.ts': `export default { transforms: {
					shorten: (t) => t.replace('hello world', 'hi'),
					upper: (t) => t.toUpperCase(),
					splitWords: { type: 'raw', run: (t) => t.replace(/ /g, '\\n') },
					sortLines: { type: 'raw', run: (t) => t.split('\\n').sort().join('\\n') },
					exclaim: (t) => t + '!',
				} };`,
			});
			await setConfig('transform.associations', { ts: labels });
			await open(doc);
		}

		test('activeFile: a replace feeds an append on every line', async () => {
			await setUpChain(['shorten', 'exclaim'], 'hello world\nhello world');
			await run('transform.activeFile');
			assert.strictEqual(text(), 'hi!\nhi!');
		});

		test('activeFile: a line transform feeds a raw transform', async () => {
			await setUpChain(['upper', 'sortLines'], 'b\na');
			await run('transform.activeFile');
			assert.strictEqual(text(), 'A\nB');
		});

		test('activeFile: new lines from the first transform reach the second', async () => {
			await setUpChain(['splitWords', 'exclaim'], 'a b\nc');
			await run('transform.activeFile');
			assert.strictEqual(text(), 'a!\nb!\nc!');
		});

		test('cursorLine: a replace feeds an append on the cursor line only', async () => {
			await setUpChain(['shorten', 'exclaim'], 'keep\n|hello world\nkeep');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'keep\nhi!\nkeep');
		});

		test('cursorLine: new lines from the first transform reach the second', async () => {
			await setUpChain(['splitWords', 'exclaim'], 'keep\n|a b\nkeep');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'keep\na!\nb!\nkeep');
		});

		test('cursorLine: running a chain again reverts it', async () => {
			await setUpChain(['shorten', 'exclaim'], '|hello world');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'hi!');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'hello world');
		});

		test('cursorLine: a chain that added lines reverts in one run', async () => {
			await setUpChain(['splitWords', 'exclaim'], 'keep\n|a b\nkeep');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'keep\na!\nb!\nkeep');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'keep\na b\nkeep');
		});

		test('undoAtCursor reverts a whole chain in one run', async () => {
			await setUpChain(['shorten', 'exclaim'], '|hello world');
			await run('transform.cursorLine');
			await run('transform.undoAtCursor');
			assert.strictEqual(text(), 'hello world');
		});

		test('a separator transform reverts every chunk in one run', async () => {
			await setConfig('transform.associations', { ts: ['upperCaseCsv'] });
			await open('|a,b');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'A,B');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'a,b');
		});

		test('undoAtCursor steps back through separate runs, newest first', async () => {
			await setUpChain(['exclaim'], '|x');
			await setConfig('transform.disableUndoToggle', true);
			await run('transform.cursorLine');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'x!!');
			await run('transform.undoAtCursor');
			assert.strictEqual(text(), 'x!');
			await run('transform.undoAtCursor');
			assert.strictEqual(text(), 'x');
		});
	});

	suite('transform commands', () => {
		test('transform.selection applies to every selection', async () => {
			await open('hello world\nkeep hello world\nhello world!');
			selectText('hello world\n', 'hello world!');
			await run('transform.selection');
			assert.strictEqual(text(), 'foo\nkeep hello world\nfoo!');
		});

		test('transform.selectionWith applies the picked transform', async () => {
			pickTransform('helloWorldsToBar');
			await open('hello world');
			selectAll();
			await run('transform.selectionWith');
			assert.strictEqual(text(), 'bar');
		});

		test('transform.cursorLine only touches the cursor line', async () => {
			await open('hello world\n|hello world');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'hello world\nfoo');
		});

		test('transform.cursorLine reverts when run again', async () => {
			await open('|hello world');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'foo');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'hello world');
		});

		test('transform.disableUndoToggle keeps the transform on the second run', async () => {
			await setConfig('transform.disableUndoToggle', true);
			await open('|hello world');
			await run('transform.cursorLine');
			await run('transform.cursorLine');
			assert.strictEqual(text(), 'foo');
		});

		test('transform.cursorLineWith applies the picked transform', async () => {
			pickTransform('helloWorldsToBar');
			await open('keep\n|hello world');
			await run('transform.cursorLineWith');
			assert.strictEqual(text(), 'keep\nbar');
		});

		test('transform.activeFile applies to the whole file', async () => {
			await open('|hello world\nhello world');
			await run('transform.activeFile');
			assert.strictEqual(text(), 'foo\nfoo');
		});

		test('transform.activeFileWith applies the picked transform to the whole file', async () => {
			pickTransform('helloWorldsToBar');
			await open('|hello world\nhello world');
			await run('transform.activeFileWith');
			assert.strictEqual(text(), 'bar\nbar');
		});

		test('transform.repeat re-runs the previous selection transform', async () => {
			pickTransform('helloWorldsToBar');
			await open('hello world\nhello world!');
			selectText('hello world\n');
			await run('transform.selectionWith');
			selectText('hello world!');
			await run('transform.repeat');
			assert.strictEqual(text(), 'bar\nbar!');
		});

		test('transform.repeat re-runs the previous cursor line transform', async () => {
			pickTransform('helloWorldsToBar');
			await open('|hello world\nhello world');
			await run('transform.cursorLineWith');
			moveCursorTo(1);
			await run('transform.repeat');
			assert.strictEqual(text(), 'bar\nbar');
		});

		test('transform.undoAtCursor reverts the transform on the cursor line', async () => {
			await open('|hello world');
			await run('transform.cursorLine');
			await run('transform.undoAtCursor');
			assert.strictEqual(text(), 'hello world');
		});

		test('transform.transpile recompiles an existing file', async () => {
			await ext.transpile(false);
			await run('transform.transpile');
			assert.strictEqual(ext.getStatus().prev.transpile?.cached, false);
		});

		test('transform.transpile offers to create a missing file', async () => {
			const src = path.join(root, '.vscode', `missing-${++srcCount}`, 'transformer.ts');
			await setConfig('transform.src', src);
			await ext.transpile();
			stubWindow('showInformationMessage', async () => 'Create example file');
			await run('transform.transpile');
			assert.ok(fs.existsSync(src), 'example file not created');
		});

		test('toggleKeybindings flips between disabled and enabled', async () => {
			const messages: string[] = [];
			stubWindow('setStatusBarMessage', (message: string) => {
				messages.push(message);
				return new vscode.Disposable(() => {});
			});
			await run('toggleKeybindings');
			await run('toggleKeybindings');
			assert.deepStrictEqual(messages, [
				'find-select-transform keybindings disabled',
				'find-select-transform keybindings enabled',
			]);
		});

		test('every contributed command and keybinding has a registered command', async () => {
			const { contributes } = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON;
			const registered = await ext.getCommands();
			const contributed: string[] = [...contributes.commands, ...contributes.keybindings].map((c) => c.command);
			const missing = contributed.filter((c) => c.startsWith(PREFIX) && !registered.includes(c));
			assert.deepStrictEqual(missing, []);
		});
	});

	/* ------------------------------------------------------------------------ */
	/*                                   Motions                                */
	/* ------------------------------------------------------------------------ */

	suite('motion targets', () => {
		const targets: [target: string, doc: string, expected: string][] = [
			['(', 'foo(|bar, baz)', 'bar, baz'],
			['[', 'x = [1, |2]', '1, 2'],
			['{', 'x = { |a: 1 }', ' a: 1 '],
			["'", "a = 'x |y'", 'x y'],
			['"', 'a = "x |y"', 'x y'],
			['`', 'a = `x |y`', 'x y'],
			['//', 'a = 1; // |note\nb', ' note'],
			['#', '# |note\nb', ' note'],
			['w', 'one tw|o three', 'two'],
			['l', 'one\n|two\nthree', 'two'],
			['F', 'one\n|two', 'one\ntwo'],
			['fn', 'function foo(a, b) { return |a; }', ' return a; '],
			['fa', 'function foo(a, b) { return |a; }', 'a, b'],
			['fi', 'function foo(a, b) { return |a; }', 'foo'],
		];

		for (const [target, doc, expected] of targets) {
			test(`${target} selects ${JSON.stringify(expected)}`, async () => {
				await open(doc);
				await ext.motion(target);
				assertSelected(expected);
			});
		}

		test('/* selects the block comment contents', async () => {
			await open('/* |note */');
			await ext.motion('/*');
			assertSelected(' note ');
		});

		test('/* keeps two block comments separate', async () => {
			await open('/* |a */ x /* b */');
			await ext.motion('/*');
			assertSelected(' a ');
		});

		test('/* outside a block comment leaves the cursor alone', async () => {
			await open('/* a */ |x');
			await ext.motion('/*');
			assertSelected('');
			assert.strictEqual(cursorAt(), 8);
		});

		test('<!-- selects the HTML comment contents', async () => {
			await open('<!-- |note -->');
			await ext.motion('<!--');
			assertSelected(' note ');
		});

		test('nested pairs resolve to the enclosing one', async () => {
			await open('{ a { |b } c }');
			await ext.motion('{');
			assertSelected(' b ');

			await open('{ a { b } |c }');
			await ext.motion('{');
			assertSelected(' a { b } c ');
		});

		test('fa with isNext targets the next function', async () => {
			await open('function one(|a) {}\nfunction two(b) {}');
			await ext.motion('fa', { isNext: true });
			assertSelected('b');
		});
	});

	suite('motion syntax', () => {
		test('"3l" selects that line', async () => {
			await open('|one\ntwo\nthree');
			await ext.motion('3l');
			assertSelected('three');
		});

		test('"3L" selects lines from the cursor', async () => {
			await open('|a\nb\nc\nd');
			await ext.motion('3L');
			assertSelected('a\nb\nc\n');
		});

		test('"line target" selects the element on that line', async () => {
			await open('|a { x }\nb { y }\nc { z }');
			await ext.motion('3 {');
			assertSelected(' z ');
		});

		test('"2 {" forward selects the 2nd pair ahead', async () => {
			await open('|a { x } { y } { z }');
			await ext.motion('2 {', { isNext: true });
			assertSelected(' y ');
		});

		test(`"-2'" selects the previous pairs`, async () => {
			await open(`'a' 'b' 'c' |`);
			await ext.motion(`-2'`);
			assert.deepStrictEqual(selected().sort(), ['b', 'c']);
		});

		test('"2 2w" backward selects 2 words from the 2nd word behind', async () => {
			await open('one two three four |five');
			await ext.motion('2 2w', { isPrev: true });
			assertSelected('two three');
		});

		test('"+" adds to the current selection', async () => {
			await open(`'a' 'b'`);
			selectText('a');
			await ext.motion(`+'`, { isNext: true });
			assertSelected('a', 'b');
		});

		// BUG: from an empty cursor, motion() sets `editor.selections = []`, which VS Code
		// replaces with a cursor at 0:0, so a stray cursor is left at the top of the file.
		test.skip('"+2fn" forward adds the next 2 function bodies', async () => {
			await open('function a() { |1 }\nfunction b() { 2 }\nfunction c() { 3 }');
			await ext.motion('+2fn', { isNext: true });
			assertSelected(' 2 ', ' 3 ');
		});
	});

	suite('motion commands', () => {
		test('motion.select selects from the typed input', async () => {
			await open(`'a|b'`);
			await runTyping('motion.select', `'`);
			assertSelected('ab');
		});

		test('the input box applies once valid and then closes', async () => {
			await open(`'a|b'`);
			const { box, type } = fakeInputBox();
			const result = run('motion.select');
			await type('nonsense');
			assert.strictEqual(box.disposed, false, 'invalid input should keep the box open');
			await type(`'`);
			await result;
			assert.strictEqual(box.disposed, true);
			assertSelected('ab');
		});

		test('motion.selectForward selects the next element', async () => {
			await open(`'a' '|b' 'c'`);
			await runTyping('motion.selectForward', `'`);
			assertSelected('c');
		});

		test('motion.selectBackward selects the previous element', async () => {
			await open(`'a' '|b' 'c'`);
			await runTyping('motion.selectBackward', `'`);
			assertSelected('a');
		});

		test('motion.change deletes the contents', async () => {
			await open('foo(|bar)');
			await runTyping('motion.change', '(');
			assert.strictEqual(text(), 'foo()');
		});

		test('motion.changeForward deletes the next element contents', async () => {
			await open(`'a' '|b' 'c'`);
			await runTyping('motion.changeForward', `'`);
			assert.strictEqual(text(), `'a' 'b' ''`);
		});

		test('motion.changeBackward deletes the previous element contents', async () => {
			await open(`'a' '|b' 'c'`);
			await runTyping('motion.changeBackward', `'`);
			assert.strictEqual(text(), `'' 'b' 'c'`);
		});

		test('motion.goto moves to the start of the target', async () => {
			await open('x { |a }');
			await runTyping('motion.goto', '{');
			assert.ok(editor.selection.isEmpty);
			assert.strictEqual(cursorAt(), 3);
		});

		test('motion.goto with select: end moves to the end of the target', async () => {
			await open('x { |a }');
			const { type } = fakeInputBox();
			const result = run('motion.goto', { select: 'end' });
			await type('{');
			await result;
			assert.ok(editor.selection.isEmpty);
			assert.strictEqual(cursorAt(), 6);
		});

		test('motion.goto with line and character jumps there', async () => {
			await open('|one\ntwo');
			await run('motion.goto', { line: 1, character: 2 });
			assert.deepStrictEqual([editor.selection.active.line, editor.selection.active.character], [1, 2]);
		});

		test('motion.repeat re-runs the motion at the cursor', async () => {
			await open(`'|a' 'b'`);
			await ext.motion(`'`);
			moveCursorTo(0, 5);
			await run('motion.repeat');
			assertSelected('b');
		});

		test('motion.repeatForward re-runs the motion forward', async () => {
			await open(`'a' '|b' 'c'`);
			await ext.motion(`'`);
			await run('motion.repeatForward');
			assertSelected('c');
		});

		test('motion.repeatBackward re-runs the motion backward', async () => {
			await open(`'a' '|b' 'c'`);
			await ext.motion(`'`);
			await run('motion.repeatBackward');
			assertSelected('a');
		});
	});

	suite('find', () => {
		test('words match partially and in order', async () => {
			await open('|const foo = 1;');
			await runTyping('motion.searchFromLine', 'con f');
			assertSelected('const f');
		});

		test('motion.searchForward jumps to the next match', async () => {
			await open('|foo a foo b');
			await runTyping('motion.searchForward', 'fo');
			assert.strictEqual(editor.selection.start.character, 6);
		});

		test('motion.searchBackward jumps to the previous match', async () => {
			await open('foo a foo b |foo c');
			await runTyping('motion.searchBackward', 'fo');
			assert.strictEqual(editor.selection.start.character, 6);
		});

		test('a leading line number searches from that line', async () => {
			await open('|x gg\ny\nz gg');
			await runTyping('motion.searchFromLine', '3 gg');
			assert.deepStrictEqual([editor.selection.start.line, editor.selection.start.character], [2, 2]);
		});

		test('search.jumpInputThreshold waits for that many characters', async () => {
			await setConfig('search.jumpInputThreshold', 3);
			await open('|const foo');
			const { type } = fakeInputBox();
			const result = run('motion.searchFromLine');
			await type('co');
			assert.ok(editor.selection.isEmpty, 'should not jump yet');
			await type('con');
			await result;
			assertSelected('con');
		});

		test('search.jumpResultThreshold waits until few enough results remain', async () => {
			await setConfig('search.jumpResultThreshold', 1);
			await open('|foo fob');
			const { type } = fakeInputBox();
			const result = run('motion.searchFromLine');
			await type('fo');
			assert.ok(editor.selection.isEmpty, 'two results should not jump');
			await type('foo');
			await result;
			assertSelected('foo');
		});

		const jumpSelections: [setting: string, expected: string, cursor: number][] = [
			['input', 'const foo', 9],
			['first-input', 'con', 3],
			['first-word', 'const', 5],
			['words', 'const foobar', 12],
			['start', '', 0],
			['end', '', 9],
		];

		for (const [setting, expected, cursor] of jumpSelections) {
			test(`search.jumpSelection "${setting}"`, async () => {
				await setConfig('search.jumpSelection', setting);
				await open('|const foobar = 1;');
				await runTyping('motion.searchFromLine', 'con foo');
				assertSelected(expected);
				assert.strictEqual(cursorAt(), cursor);
			});
		}

		test('motion.repeatForward repeats the search', async () => {
			await open('|foo a foo b foo c');
			await runTyping('motion.searchForward', 'fo');
			assert.strictEqual(editor.selection.start.character, 6);
			await run('motion.repeatForward');
			assert.strictEqual(editor.selection.start.character, 12);
		});
	});

	/* ------------------------------------------------------------------------ */
	/*                               Extension API                              */
	/* ------------------------------------------------------------------------ */

	suite('extension API', () => {
		test('transform with a Range location selects and transforms it', async () => {
			await open('|hello world\nhello world');
			await ext.transform({ transforms: ['helloWorldsToFoo'], location: new vscode.Range(1, 0, 1, 11) });
			assert.strictEqual(text(), 'hello world\nfoo');
		});

		test('transform with a Uri location transforms the whole file', async () => {
			await open('|hello world\nhello world');
			await ext.transform({ transforms: ['helloWorldsToFoo'], location: editor.document.uri });
			assert.strictEqual(text(), 'foo\nfoo');
		});

		test('transform with a Location opens it and transforms the range', async () => {
			await open('hello world\nhello world');
			const target = new vscode.Location(editor.document.uri, new vscode.Range(0, 0, 0, 11));
			await ext.transform({ transforms: ['helloWorldsToFoo'], location: target });
			assert.strictEqual(text(), 'foo\nhello world');
		});

		test('transform with type "lines" expands to the whole line', async () => {
			await open('hello world\nkeep');
			selectText('world');
			await ext.transform({ transforms: ['helloWorldsToFoo'], type: 'lines' });
			assert.strictEqual(text(), 'foo\nkeep');
		});

		test('transform with applyEdits false returns the edit without applying it', async () => {
			await open('hello world');
			selectAll();
			const result = await ext.transform({ transforms: ['helloWorldsToFoo'], applyEdits: false });
			assert.strictEqual(result.editCount, 1);
			assert.strictEqual(result.edit.get(editor.document.uri)[0].newText, 'foo');
			assert.strictEqual(text(), 'hello world');
		});

		test('transform with an unknown name rejects', async () => {
			await open('keep');
			await assert.rejects(ext.transform({ transforms: ['doesNotExist'] }), /No transforms found/);
		});

		test('motion with onMotion actions selects and deletes', async () => {
			await open('foo(|bar)');
			await ext.motion('(', { onMotion: ['select', 'delete'] });
			assert.strictEqual(text(), 'foo()');
		});

		test('motion with an onMotion callback can replace the ranges', async () => {
			await open('foo(|bar)');
			await ext.motion('(', { onMotion: ({ replace }) => replace(undefined, ['baz']) });
			assert.strictEqual(text(), 'foo(baz)');
		});

		test('motion with a Location runs there', async () => {
			await open(`'one'\n'two'`);
			const target = new vscode.Location(editor.document.uri, new vscode.Range(1, 2, 1, 2));
			await ext.motion(`'`, { location: target });
			assertSelected('two');
		});

		test('getStatus reports readiness and transforms', async () => {
			const status = ext.getStatus();
			assert.strictEqual(status.isReady, true);
			assert.strictEqual(status.isTranspiling, false);
			assert.ok(status.transforms.includes('helloWorldsToFoo'));
		});
	});
});
