/**
 * Build script (run with Bun).
 *
 *   bun run util/builder.ts            build once
 *   bun run util/builder.ts --watch    rebuild on changes in src/ and package.json
 *   bun run util/builder.ts --test     also bundle test/suite and create the test fixture workspace
 *   bun run util/builder.ts --publish  minified build without sourcemaps
 */
import * as fs from 'node:fs';
import path from 'node:path';

const isWatch = process.argv.includes('--watch');
const isPublish = process.argv.includes('--publish');
const isTest = process.argv.includes('--test');
const root = process.cwd();
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'out');

function watchMode() {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const rebuild = (event: string, filename: string | null) => {
		console.log(`Detected ${event} in ${filename}`);
		clearTimeout(timer);
		timer = setTimeout(() => void createBundle(), 50);
	};
	const watcher = fs.watch(srcDir, { recursive: true }, rebuild);
	const watcherJson = fs.watch(path.join(root, 'package.json'), rebuild);

	console.log('watching..');

	process.on('SIGINT', () => {
		console.log('Closing watcher...');
		watcher.close();
		watcherJson.close();
		process.exit(0);
	});
}

/** A throwaway workspace for the integration tests, containing the example transforms file. */
function createTestFixture() {
	const workspace = path.join(outDir, 'test', 'fixtures', 'workspace');
	fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
	fs.copyFileSync(path.join(srcDir, 'transformer.ts'), path.join(workspace, '.vscode', 'transformer.ts'));
	fs.writeFileSync(
		path.join(workspace, 'index.ts'),
		["const a = 'hello world';", "const b = 'hello world';", "const c = 'foo';", ''].join('\n')
	);
	return workspace;
}

async function createBundle() {
	console.log(isPublish ? 'building for publish..' : 'building..');
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });
	// The example transforms file is shipped as-is so the extension can create it for the user.
	fs.copyFileSync(path.join(srcDir, 'transformer.ts'), path.join(outDir, 'transformer.ts'));

	const testFiles = isTest ? Array.from(new Bun.Glob('./test/suite/**/*.ts').scanSync()) : [];
	const result = await Bun.build({
		entrypoints: ['./src/extension.ts', ...testFiles],
		// `typescript` is resolved at runtime (VS Code's own copy, the workspace, or node_modules in dev).
		external: ['vscode', 'typescript'],
		target: 'node',
		format: 'cjs',
		minify: isPublish,
		sourcemap: isPublish ? 'none' : 'linked',
		packages: 'bundle',
		splitting: false,
		outdir: 'out',
		root: '.',
	});

	for (const log of result.logs) console.log(log);
	if (!result.success) {
		console.error('build failed');
		if (!isWatch) process.exit(1);
		return;
	}
	for (const output of result.outputs) {
		console.log(`  ${path.relative(root, output.path)} (${(output.size / 1024).toFixed(1)} kB)`);
	}
	if (isTest) console.log(`  fixture workspace: ${path.relative(root, createTestFixture())}`);

	console.log('built!\n');
}

void createBundle().then(() => {
	if (isWatch) watchMode();
});
