import { describe, expect, test } from 'bun:test';
import { parseMotionInput } from '../../src/utils/input';

/** Regression coverage of the motion input grammar: `[+] [line ] [count] target`. */
describe('parseMotionInput', () => {
	test('bare element', () => {
		expect(parseMotionInput('{')).toMatchObject({ type: 'element', numbers: null, line: null, isLine: false });
	});

	test('"2 {" means: on line 2', () => {
		expect(parseMotionInput('2 {')).toMatchObject({ type: 'element', line: 1, isLine: true, isNext: true });
	});

	test('negative count goes backwards', () => {
		expect(parseMotionInput("-4'")).toMatchObject({ type: 'element', numbers: -4, motion: { value: "'" } });
	});

	test('dashes in a target are kept', () => {
		expect(parseMotionInput('<!--')).toMatchObject({ type: 'element', motion: { trimmedValue: '<!--' } });
		expect(parseMotionInput('+-2<!--')).toMatchObject({ type: 'element', expand: true, numbers: -2, motion: { trimmedValue: '<!--' } });
	});

	test('"+" expands the selection', () => {
		expect(parseMotionInput('+2fn', { isNext: true })).toMatchObject({ type: 'fn', expand: true, numbers: 2, isNext: true });
	});

	test('lines', () => {
		expect(parseMotionInput('5l')).toMatchObject({ type: 'line', numbers: 5, motion: { trimmedValue: 'l' } });
		expect(parseMotionInput('10L')).toMatchObject({ type: 'line', numbers: 10, motion: { trimmedValue: 'L' } });
	});

	test('repeat count with a direction', () => {
		expect(parseMotionInput('2 2w', { isPrev: true })).toMatchObject({ type: 'word', repeats: -1, repeatCount: 1, numbers: 2, isPrev: true });
	});

	test('search keeps the raw value and strips a leading line number', () => {
		expect(parseMotionInput('20 g', { isSearch: true })).toMatchObject({ type: 'search', line: 19, motion: { value: 'g' } });
		expect(parseMotionInput('const f', { isSearch: true })).toMatchObject({ type: 'search', motion: { value: 'const f' } });
	});

	test('incomplete or unknown input yields nothing', () => {
		expect(parseMotionInput('5')).toBeUndefined();
		expect(parseMotionInput('xyz')).toBeUndefined();
		expect(parseMotionInput('')).toBeUndefined();
	});
});
