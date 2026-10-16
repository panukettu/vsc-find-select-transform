import { describe, expect, test } from 'bun:test';
import { splitWithOffsets } from '../../src/utils/utils';

describe('splitWithOffsets', () => {
	test('splits on \\n, dropping breaks and a trailing empty chunk', () => {
		expect(splitWithOffsets('a\nbc\n', '\n')).toEqual([
			{ text: 'a', start: 0, end: 1 },
			{ text: 'bc', start: 2, end: 4 },
		]);
	});
	test('treats \\r\\n as a line break when splitting on \\n', () => {
		expect(splitWithOffsets('a\r\nb', '\n')).toEqual([
			{ text: 'a', start: 0, end: 1 },
			{ text: 'b', start: 3, end: 4 },
		]);
	});
	test('keeps empty chunks in the middle', () => {
		expect(splitWithOffsets('a\n\nb', '\n').map((c) => c.text)).toEqual(['a', '', 'b']);
	});
	test('supports multi-character separators', () => {
		expect(splitWithOffsets('a, b', ', ')).toEqual([
			{ text: 'a', start: 0, end: 1 },
			{ text: 'b', start: 3, end: 4 },
		]);
	});
	test('returns the whole text when the separator is absent', () => {
		expect(splitWithOffsets('abc', '\n')).toEqual([{ text: 'abc', start: 0, end: 3 }]);
	});
	test('an empty text yields no chunks', () => {
		expect(splitWithOffsets('', '\n')).toEqual([]);
	});
});
