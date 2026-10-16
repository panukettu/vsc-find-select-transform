/**
 * find-select-transform: transforms file.
 *
 * `export default { transforms }` where every entry of `transforms` is one of
 *
 *   fn                                    line transform, `fn(line, ctx)` runs for each line
 *   [fn1, fn2]                            chained: fn2 receives fn1's output
 *   { type: 'raw', run: fn | fn[] }       runs once with the whole selection/line/file
 *   { type: 'line', separator, run }      splits on `separator` (default "\n") instead of lines
 *
 * The transform names are used in `find-select-transform.transform.associations`
 * and in the "... With" quick picks. Relative imports (`./helpers`) are
 * transpiled along with this file; packages resolve from the workspace's
 * node_modules. Type errors are ignored, only syntax has to be valid.
 */

/* -------------------------------------------------------------------------- */
/*                                   Example                                  */
/* -------------------------------------------------------------------------- */

function replace(search: string, replacement = ''): Transformer {
	return (text) => text.replace(search, replacement);
}

const transforms = {
	// Per line (default): `text` is a single line without its line break.
	helloWorldsToFoo: replace('hello world', 'foo'),
	helloWorldsToBar: { type: 'line', run: replace('hello world', 'bar') },
	barsToHelloWorld: replace('bar', 'hello world'),
	removeHelloWorlds: replace('hello world'),

	// Raw: `text` is the whole selection (or line/file), so only the first occurrence changes here.
	firstHelloWorldToBar: { type: 'raw', run: replace('hello world', 'bar') },

	// Chained: each function receives the previous result.
	noop: [replace('hello world', 'foo'), replace('foo', 'bar'), replace('bar', 'hello world')],

	// Custom separator: upper-cases each comma separated value of the selection.
	upperCaseCsv: { type: 'line', separator: ',', run: (text) => text.trim().toUpperCase() },

	// `ctx` tells you where you are. Here: prefix each line with its number within the selection.
	numberLines: (text, ctx) => `${String(ctx.line + 1).padStart(String(ctx.lines.length).length)}  ${text}`,

	// Async functions are fine.
	sortLines: { type: 'raw', run: async (text) => text.split('\n').sort().join('\n') },
} satisfies Record<string, Transform>;

export default {
	transforms,
} satisfies ExportedTransforms;

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type Ctx = {
	/** Absolute path of the document being transformed. */
	file: string;
	/** File extension without the dot, e.g. "ts". */
	ext: string;
	/** Workspace folder of the document. */
	rootPath: string;
	/** Full text of the selection/line/file being transformed. */
	raw?: string;
	/** All chunks (lines by default) of the selection. */
	lines: string[];
	/** Index of the current chunk in `lines`; -1 for raw transforms. */
	line: number;
	/** Full text of the document. */
	documentText?: string;
};

export type Transformer = (text: string, ctx: Ctx) => string | Promise<string>;
type OneOrMore = Transformer | readonly Transformer[] | Transformer[];
export type Transform =
	| OneOrMore
	| { type: 'raw'; run: OneOrMore }
	| { type: 'line'; separator?: string; run: OneOrMore };

export type ExportedTransforms = {
	transforms: Record<string, Transform>;
};

/* -------------------------------------------------------------------------- */
/*                 Try it: `bun run transformer.ts -t` or `tsx transformer.ts -t`                */
/* -------------------------------------------------------------------------- */

if (typeof process !== 'undefined' && process.argv.includes('-t')) {
	const text = 'Every language starts with a "hello world"\nThey say hello world is the first program.\nfoobar hello world!';
	const lines = text.split('\n');
	const ctx: Ctx = { lines, file: 'example.ts', ext: 'ts', rootPath: '.', raw: text, documentText: text, line: -1 };

	console.log(transforms.firstHelloWorldToBar.run(text, ctx)); // raw
	lines.forEach((line, i) => console.log(transforms.helloWorldsToFoo(line, { ...ctx, line: i }))); // per line
	lines.forEach((line, i) => console.log(transforms.numberLines(line, { ...ctx, line: i })));
}
