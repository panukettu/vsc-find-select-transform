/**
 * In-process transpilation of the user's transforms file.
 *
 * Instead of shelling out to `npx tsc` (which requires a TypeScript install next
 * to the extension, something the packaged .vsix does not ship), we load the
 * TypeScript compiler API from one of a few well-known locations and run it in
 * the extension host. Emitted files are cached next to a small manifest so an
 * unchanged transforms file costs a handful of `stat` calls on startup.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TS from 'typescript';
import type { Transpilation } from '../types';

export type TypeScriptModule = typeof TS;

export type TranspileOptions = {
	/** Absolute path of the transforms source file (.ts or .js). */
	source: string;
	/** Directory to emit into. Created when missing. */
	outDir: string;
	/** Ignore the cache and always emit. */
	force?: boolean;
	/** Loaded TypeScript compiler. See `loadTypeScript`. */
	typescript: TypeScriptModule;
	/**
	 * A `node_modules` directory to link into `outDir` so transforms can
	 * `import` packages installed in the workspace.
	 */
	nodeModules?: string;
};

const MANIFEST_FILE = '.transpile-manifest.json';

type Manifest = {
	version: 1;
	tsVersion: string;
	source: string;
	js: string;
	files: string[];
	/** Every file that took part in the compilation and its mtime. */
	inputs: Record<string, number>;
};

const nodeRequire = createRequire(__filename);

/**
 * Locations to look for the TypeScript compiler, most preferred first:
 *  1. the compiler VS Code itself ships (always present in desktop VS Code),
 *  2. the workspace's own `node_modules/typescript`,
 *  3. a `typescript` package resolvable from the extension (development builds).
 */
export function typescriptCandidates(args: { appRoot?: string; rootPath?: string }) {
	const candidates: string[] = [];
	if (args.appRoot) {
		candidates.push(path.join(args.appRoot, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'));
	}
	if (args.rootPath) {
		candidates.push(path.join(args.rootPath, 'node_modules', 'typescript', 'lib', 'typescript.js'));
	}
	candidates.push('typescript');
	return candidates;
}

const loaded = new Map<string, TypeScriptModule>();

/** Loads the first candidate that resolves to a TypeScript compiler module. */
export function loadTypeScript(candidates: string[]): TypeScriptModule {
	const failures: string[] = [];
	for (const candidate of candidates) {
		const cached = loaded.get(candidate);
		if (cached) return cached;
		try {
			const mod = nodeRequire(candidate) as Partial<TypeScriptModule>;
			if (typeof mod?.createProgram !== 'function') {
				failures.push(`${candidate}: not a TypeScript compiler module`);
				continue;
			}
			loaded.set(candidate, mod as TypeScriptModule);
			return mod as TypeScriptModule;
		} catch (e) {
			failures.push(`${candidate}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
		}
	}
	throw new Error(
		`TypeScript compiler not found. Install it in your workspace (e.g. \`npm i -D typescript\`).\nTried:\n${failures
			.map((f) => `  - ${f}`)
			.join('\n')}`
	);
}

/**
 * Transpiles `source` (and any relative files it imports) into `outDir`.
 * Type errors are ignored; syntax errors are reported in `diagnostics` while the
 * file is still emitted on a best-effort basis.
 */
export async function transpile(opts: TranspileOptions): Promise<Transpilation> {
	const { typescript: ts, force } = opts;
	const source = path.resolve(opts.source);
	const outDir = path.resolve(opts.outDir);

	if (!existsSync(source)) throw new Error(`Transforms file not found: ${source}`);
	mkdirSync(outDir, { recursive: true });
	linkNodeModules(outDir, opts.nodeModules);

	const previous = readManifest(outDir);
	if (!force && previous && isFresh(previous, source, ts.version)) {
		return { source, js: previous.js, outDir, files: previous.files, cached: true, diagnostics: [] };
	}

	const options: TS.CompilerOptions = {
		outDir,
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2022,
		allowJs: true,
		esModuleInterop: true,
		skipLibCheck: true,
		// No type checking happens, so skip loading lib/@types entirely.
		noLib: true,
		types: [],
		sourceMap: false,
		declaration: false,
		noEmitOnError: false,
	};

	const program = ts.createProgram([source], options);
	const emitted: { file: string; sources: string[] }[] = [];
	const emitResult = program.emit(undefined, (fileName, text, _bom, _onError, sourceFiles) => {
		mkdirSync(path.dirname(fileName), { recursive: true });
		writeFileSync(fileName, text);
		emitted.push({ file: path.normalize(fileName), sources: (sourceFiles ?? []).map((f) => path.normalize(f.fileName)) });
	});

	const diagnostics = [
		...program.getOptionsDiagnostics(),
		...program.getSyntacticDiagnostics(),
		...emitResult.diagnostics,
	].map((d) => formatDiagnostic(ts, d));

	const entry = emitted.find((e) => e.sources.includes(source));
	if (!entry) {
		throw new Error(`Nothing was emitted for ${source}${diagnostics.length ? `:\n${diagnostics.join('\n')}` : ''}`);
	}

	const inputs: Record<string, number> = {};
	for (const file of program.getSourceFiles()) {
		const name = path.normalize(file.fileName);
		if (existsSync(name)) inputs[name] = statSync(name).mtimeMs;
	}

	const manifest: Manifest = {
		version: 1,
		tsVersion: ts.version,
		source,
		js: entry.file,
		files: emitted.map((e) => e.file),
		inputs,
	};
	writeFileSync(path.join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, '\t'));

	return { source, js: manifest.js, outDir, files: manifest.files, cached: false, diagnostics };
}

function readManifest(outDir: string): Manifest | undefined {
	const file = path.join(outDir, MANIFEST_FILE);
	if (!existsSync(file)) return;
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
		return parsed?.version === 1 ? parsed : undefined;
	} catch {
		return;
	}
}

function isFresh(manifest: Manifest, source: string, tsVersion: string) {
	if (manifest.source !== source || manifest.tsVersion !== tsVersion) return false;
	if (!existsSync(manifest.js)) return false;
	return Object.entries(manifest.inputs).every((entry) => {
		const [file, mtime] = entry;
		return existsSync(file) && statSync(file).mtimeMs === mtime;
	});
}

function formatDiagnostic(ts: TypeScriptModule, diagnostic: TS.Diagnostic) {
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
	if (!diagnostic.file || diagnostic.start == null) return message;
	const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
	return `${diagnostic.file.fileName}:${line + 1}:${character + 1}: ${message}`;
}

/** Points `<outDir>/node_modules` at the workspace's node_modules, if any. */
function linkNodeModules(outDir: string, nodeModules?: string) {
	if (!nodeModules || !existsSync(nodeModules)) return;
	const link = path.join(outDir, 'node_modules');
	try {
		if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
			if (!lstatSync(link).isSymbolicLink()) return;
			if (path.resolve(path.dirname(link), readlinkSync(link)) === path.resolve(nodeModules)) return;
			unlinkSync(link);
		}
		symlinkSync(nodeModules, link, 'junction');
	} catch {
		// Best effort only. Transforms that import packages will fail to load with a clear error.
	}
}
