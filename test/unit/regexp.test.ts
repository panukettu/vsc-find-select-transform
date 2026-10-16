import { describe, expect, test } from 'bun:test';
import { regexpTransform } from '../../src/handlers/handler.regexp';
import type { RegExpTransform } from '../../src/types';

const make = (overrides: Partial<RegExpTransform>): RegExpTransform => ({
	type: 'regexp',
	label: 'test',
	flags: 'gm',
	transforms: [],
	...overrides,
});

describe('regexpTransform', () => {
	test('applies matchers in order, output of one feeding the next', () => {
		const t = make({
			transforms: [
				{ matcher: /'(.*?)'/g, replacer: '"$1"', flags: 'g' },
				{ matcher: /"foo"/g, replacer: '"bar"', flags: 'g' },
			],
		});
		expect(regexpTransform(t, "const a = 'foo';")).toBe('const a = "bar";');
	});

	test('substitutes $id placeholders from additionalValues matched against the input', () => {
		const t = make({
			transforms: [{ matcher: /^(?<name>\w+)\s*=\s*(?<value>[^;]+);.*$/gm, replacer: '$comment\nconst $<name> = $<value>;', flags: 'gm' }],
			additionalValues: { comment: '(//.*)$' },
		});
		expect(regexpTransform(t, 'a = 1; // one')).toBe('// one\nconst a = 1;');
	});

	test('prefers a named group matching the id when present', () => {
		const t = make({
			transforms: [{ matcher: /x/g, replacer: '$who', flags: 'g' }],
			additionalValues: { who: 'name:(?<who>\\w+)' },
		});
		expect(regexpTransform(t, 'x name:panu')).toBe('panu name:panu');
	});

	test('removes unresolved placeholders instead of crashing when nothing matches', () => {
		const t = make({
			transforms: [{ matcher: /x/g, replacer: '[$comment]', flags: 'g' }],
			additionalValues: { comment: '(//.*)$' },
		});
		expect(regexpTransform(t, 'x')).toBe('[]');
	});

	test('leaves unrelated $identifiers in the text alone', () => {
		const t = make({
			transforms: [{ matcher: /foo/g, replacer: 'bar', flags: 'g' }],
			additionalValues: { comment: '(//.*)$' },
		});
		expect(regexpTransform(t, '$scope.foo = $$; ${x}')).toBe('$scope.bar = $$; ${x}');
	});
});
