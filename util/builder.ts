import * as fs from 'fs';
import { watch } from 'node:fs';
import path from 'node:path';

const isWatch = process.argv.includes('--watch');
const isPublish = process.argv.includes('--publish');
const isTest = process.argv.includes('--test');
const srcDir = path.join(process.cwd(), 'src');
const outDir = path.join(process.cwd(), 'out');

function watchMode() {
	const watcher = watch(srcDir, { recursive: true }, async (event, filename) => {
		console.log(`Detected ${event} in ${filename}`);
		await createBundle();
	});
	const watcherJson = watch(path.join(process.cwd(), 'package.json'), async (event, filename) => {
		console.log(`Detected ${event} in ${filename}`);
		await createBundle();
	});

	console.log('watching..');

	return process.on('SIGINT', () => {
		console.log('Closing watcher...');
		watcher.close();
		watcherJson.close();
		process.exit(0);
	});
}

async function createBundle() {
	!isPublish ? console.log('building..') : console.log('building for publish..');
	if (fs.existsSync(outDir)) {
		fs.rmdirSync(outDir, { recursive: true });
	}

	fs.mkdirSync(outDir, { recursive: true });
	fs.copyFileSync(path.join(srcDir, 'transformer.ts'), path.join(outDir, 'transformer.ts'));

	const testFiles = isTest ? Array.from(new Bun.Glob('./test/suite/**/*.ts').scanSync()) : [];
	const result = await Bun.build({
		entrypoints: ['./src/extension.ts', ...testFiles].filter(Boolean),
		external: ['vscode', 'vscode-test'],
		target: 'node',
		format: 'cjs',
		minify: isPublish,
		sourcemap: isPublish ? 'none' : 'linked',
		packages: 'bundle',
		splitting: false,
		outdir: 'out',
		root: '.',
	});

	console.log(result);

	console.log('built!\n');
}

createBundle();
if (isWatch) {
	watchMode();
}
