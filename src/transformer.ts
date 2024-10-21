/* -------------------------------------------------------------------------- */
/*                                   Example                                  */
/* -------------------------------------------------------------------------- */

function replace(a: string, b?: string): Transformer {
	return (text, _ctx) => {
		const result = text.replace(a, b ?? '');
		// console.log({ a, b, text, _ctx });
		// console.log(`"${text}" -> "${result}"`);
		return result;
	};
}

/**
 * You can configure the export object in many ways.
 */
const transforms = {
	helloWorldsToFoo: replace('hello world', 'foo'),
	firstHelloWorldToBar: { type: 'raw', run: replace('hello world', 'bar') },
	helloWorldsToBar: { type: 'line', separator: 'world', run: replace('hello world', 'bar') },
	barsToHelloWorld: replace('bar', 'hello world'),
	removeHelloWorlds: replace('hello world'),
	noop: [replace('hello world', 'foo'), replace('foo', 'bar'), replace('bar', 'hello world')],
} satisfies Record<string, Transform>;

export default {
	transforms,
} satisfies ExportedTransforms;

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type Ctx = {
	file: string;
	ext: string;
	rootPath: string;
	raw?: string;
	lines: string[];
	line: number;
	documentText?: string;
};

export type Transformer = (text: string, ctx: Ctx) => string | Promise<string>;
type OneOrMore = Transformer | readonly Transformer[] | Transformer[];
export type Transform =
	| OneOrMore
	| { type: 'raw'; run: OneOrMore }
	| { type: 'line'; separator: string; run: OneOrMore };

export type ExportedTransforms = {
	transforms: Record<string, Transform>;
};

/**
 * You may want to test it by running this file directly with -t.
 */
if (process.argv.includes('-t')) {
	const text =
		'Every programming language starts with a "hello world"\n  They say hello world is the first program you write.\n\texactly or foobar hello world!        \n';
	const lines = text.split('\n');

	const ctx = { lines, file: 'foo', ext: 'ts', rootPath: 'baz', raw: text, documentText: text, line: -1 };
	console.log(transforms.firstHelloWorldToBar.run(text, ctx)); // "raw" example
	lines.forEach((line, i) => console.log(transforms.helloWorldsToFoo(line, { ...ctx, line: i }))); // "line" example
}
