import { describe, expect, test } from 'bun:test';
import { getRangeOf } from '../../src/utils/motion';
import { FakeDocument, FakeEditor } from './vscode.mock';

/** Resolves an element in a document where `|` marks the cursor. Returns the selected text. */
function select(marked: string, element: string, args: { isNext?: boolean; isPrev?: boolean } = {}) {
	const document = new FakeDocument(marked.replace('|', ''));
	const editor = new FakeEditor(document) as any;
	const range = getRangeOf(element, { cursor: marked.indexOf('|'), editor, ...args });
	return range ? document.getText(range as any) : undefined;
}

describe('block comments', () => {
	test('inside a comment selects its contents', () => {
		expect(select('/* |note */', '/*')).toBe(' note ');
	});

	test('spans multiple lines', () => {
		expect(select('/*\n|note\n*/', '/*')).toBe('\nnote\n');
	});

	test('two comments stay separate', () => {
		expect(select('/* |a */ x /* b */', '/*')).toBe(' a ');
		expect(select('/* a */ x /* |b */', '/*')).toBe(' b ');
	});

	test('forward selects the next comment', () => {
		expect(select('/* |a */ x /* b */', '/*', { isNext: true })).toBe(' b ');
	});

	test('backward selects the previous comment', () => {
		expect(select('/* a */ x /* |b */', '/*', { isPrev: true })).toBe(' a ');
	});

	test('before a comment selects nothing', () => {
		expect(select('|x /* a */', '/*')).toBeUndefined();
	});

	test('after a comment selects nothing', () => {
		expect(select('/* a */ |x', '/*')).toBeUndefined();
	});

	test('between comments selects nothing', () => {
		expect(select('/* a */ |x /* b */', '/*')).toBeUndefined();
	});

	test('code between comments is not treated as a comment', () => {
		expect(select('/* { */ { |a } /* } */', '{')).toBe(' a ');
	});
});

describe('searching past skipped ranges always terminates', () => {
	test('forward: target on the last inner character of a skipped range', () => {
		expect(() => select(`|/x"/ "y"`, '"')).not.toThrow();
	});

	test('backward: target on the first inner character of a skipped range', () => {
		expect(() => select(`/"x/ |y "z"`, '"')).not.toThrow();
	});

	test('backward: target on the first inner character of a line comment', () => {
		expect(select('//* |x', '/*')).toBeUndefined();
	});
});

describe('html comments', () => {
	test('inside a comment selects its contents', () => {
		expect(select('<!-- |note -->', '<!--')).toBe(' note ');
	});
});
