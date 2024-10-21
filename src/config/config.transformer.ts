import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { Critical } from '../utils/errors';
import type { ExportedTransforms, Transform } from '../transformer';
import type { ParsedTransform } from '../types';
import { settings } from './config.common';

const defaultSource = '<root>/.vscode/transformer.ts';

export function getExportedTransforms(js: string, labels?: string[]) {
	const result = Object.entries(getExports(js).transforms)
		.map(parseTransforms)
		.filter((f) => !!f);

	if (!result.length) throw new Critical(`invalid-transformer -> ${js}`);

	if (!labels?.length) return result;

	return result.filter((obj) => obj && labels.includes(obj.label));
}

function getExports(js: string) {
	delete require.cache[require.resolve(js)];
	const exported = require(js).default;
	if (validateExports(exported)) return exported;
	return invalidTransformer();
}

function parseTransforms<T extends Transform>([label, item]: [label: string, item: T]): ParsedTransform | null {
	const functions = 'run' in item ? item.run : item;
	const type = 'type' in item ? item.type : 'line';
	const separator = 'separator' in item ? item.separator || '\n' : '\n';

	if (Array.isArray(functions)) {
		if (typeof functions[0] !== 'function') return invalidTransformer(label);
		return { label, functions, type, separator };
	}

	if (typeof functions !== 'function') return invalidTransformer(label);
	return { label, functions: [functions], type, separator };
}

function invalidTransformer<T extends string | undefined, R = undefined extends T ? never : null>(name?: T): R {
	if (!!name) {
		vscode.window.showErrorMessage(
			`Invalid transformer: ${name}. Value of .transforms must satisfy ExportedTransformer.`
		);
		return null as R;
	}

	throw new Critical(`Exported transformer does not satisfy the ExportedTransformer type.`);
}

function validateExports(exports: unknown): exports is ExportedTransforms {
	if (typeof exports !== 'object' || exports === null) return false;
	if (!('transforms' in exports) || typeof exports.transforms !== 'object') return false;
	return true;
}

export function getSourcePath(rootPath: string) {
	let source = settings('transform.src', defaultSource) as string;

	if (source.includes('<root>')) source = source.replace('<root>', rootPath);
	if (source.includes('<home>')) source = source.replace('<home>', os.homedir());
	if (!source.startsWith('/')) source = path.join(rootPath, source);

	return source;
}
