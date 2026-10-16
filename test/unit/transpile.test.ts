import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTransforms } from '../../src/config/config.transformer';
import { loadTypeScript, transpile, typescriptCandidates } from '../../src/utils/transpile';

let dir: string;
let source: string;
let outDir: string;

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'fst-transpile-'));
	mkdirSync(path.join(dir, '.vscode'));
	source = path.join(dir, '.vscode', 'transformer.ts');
	outDir = path.join(dir, 'out');
	writeFileSync(
		path.join(dir, '.vscode', 'helper.ts'),
		`export const shout = (t: string): string => t.toUpperCase() satisfies string;`
	);
	writeFileSync(
		source,
		`import { shout } from './helper';
type Transformer = (text: string) => string;
const transforms = { shout, twice: [shout, (t: string) => t + t] } satisfies Record<string, Transformer | Transformer[]>;
export default { transforms };`
	);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('typescriptCandidates', () => {
	test('prefers the compiler shipped with VS Code, then the workspace, then our own', () => {
		const list = typescriptCandidates({ appRoot: '/app', rootPath: '/ws' });
		expect(list[0]).toBe(path.join('/app', 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'));
		expect(list[1]).toBe(path.join('/ws', 'node_modules', 'typescript', 'lib', 'typescript.js'));
		expect(list.at(-1)).toBe('typescript');
	});
});

describe('transpile', () => {
	test('emits the entry and its relative imports and reports the entry js', async () => {
		const result = await transpile({ source, outDir, typescript: loadTypeScript(['typescript']) });
		expect(result.cached).toBe(false);
		expect(result.js).toBe(path.join(outDir, 'transformer.js'));
		expect(result.files.map((f) => path.basename(f)).sort()).toEqual(['helper.js', 'transformer.js']);
		expect(result.diagnostics).toEqual([]);

		const loaded = loadTransforms(result);
		expect(loaded.errors).toEqual([]);
		expect(loaded.transforms.map((t) => t.label).sort()).toEqual(['shout', 'twice']);
		expect(loaded.transforms.find((t) => t.label === 'twice')?.functions).toHaveLength(2);
	});

	test('reuses the previous output while inputs are unchanged', async () => {
		const result = await transpile({ source, outDir, typescript: loadTypeScript(['typescript']) });
		expect(result.cached).toBe(true);
		expect(result.js).toBe(path.join(outDir, 'transformer.js'));
	});

	test('re-emits when an imported file changes, and when forced', async () => {
		const future = new Date(Date.now() + 5000);
		utimesSync(path.join(dir, '.vscode', 'helper.ts'), future, future);
		expect((await transpile({ source, outDir, typescript: loadTypeScript(['typescript']) })).cached).toBe(false);
		expect((await transpile({ source, outDir, typescript: loadTypeScript(['typescript']) })).cached).toBe(true);
		expect((await transpile({ source, outDir, force: true, typescript: loadTypeScript(['typescript']) })).cached).toBe(
			false
		);
	});

	test('reports syntax errors but still emits', async () => {
		const broken = path.join(dir, '.vscode', 'broken.ts');
		writeFileSync(broken, `export default { transforms: { a: (t: string) => t. } };`);
		const result = await transpile({ source: broken, outDir, typescript: loadTypeScript(['typescript']) });
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0]).toContain('broken.ts');
	});

	test('rejects with a readable error when the source is missing', async () => {
		const p = transpile({ source: path.join(dir, 'nope.ts'), outDir, typescript: loadTypeScript(['typescript']) });
		await expect(p).rejects.toThrow(/not found/i);
	});
});

describe('loadTypeScript', () => {
	test('skips missing candidates and throws a helpful error when none load', () => {
		expect(loadTypeScript(['/definitely/not/here.js', 'typescript']).version).toBeString();
		expect(() => loadTypeScript(['/definitely/not/here.js'])).toThrow(/TypeScript/);
	});
});
