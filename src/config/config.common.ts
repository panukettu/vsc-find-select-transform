import * as path from 'path';
import * as vscode from 'vscode';
import { getSourcePath } from './config.transformer';

export const EXTENSION_ID = 'find-select-transform' as const;

export const settings = <T extends unknown = unknown>(key: string, defaultValue?: T) => {
	return vscode.workspace.getConfiguration(EXTENSION_ID).get(key, defaultValue as T);
};

type CommandAssociation = { cursor: string[]; range: string[] };
type AssociatedTransforms = string[] | CommandAssociation;

export function getAssociations(filepathOrExtension?: string | `.${string}`): CommandAssociation & { ext: string } {
	let ext = '';
	if (filepathOrExtension) {
		ext = filepathOrExtension.startsWith('.')
			? filepathOrExtension.slice(1)
			: path.extname(filepathOrExtension)?.slice(1);
	}
	const associations = settings<Record<string, AssociatedTransforms>>('transform.associations', {});

	if (!ext?.length || !associations) return { ...parseAssociations(associations?.['*'] ?? []), ext: '' };

	const parsed = parseAssociations((ext in associations ? associations?.[ext] : associations?.['*']) ?? []);

	if (!parsed.range.length && !parsed.cursor.length) {
		vscode.window.showErrorMessage(
			"No associations found. Define them in 'find-select-transform.transform.associations'"
		);
	}

	return { ...parsed, ext };
}

function parseAssociations(transforms: AssociatedTransforms) {
	if (Array.isArray(transforms)) return { cursor: transforms, range: transforms };
	if ('cursor' in transforms || 'range' in transforms) return transforms;
	vscode.window.showWarningMessage(
		'Invalid association format. Must be an array or object with cursor and range keys.'
	);
	return { cursor: [], range: [] };
}

export function getRootPath(document = vscode.window.activeTextEditor?.document) {
	if (!document?.uri.fsPath) vscode.window.visibleTextEditors.find((editor) => (document = editor.document));
	return (
		(document?.uri ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : vscode.workspace.rootPath) || ''
	);
}

export type Config = ReturnType<typeof getConfig>;

export function getConfig(document = vscode.window.activeTextEditor?.document) {
	const rootPath = getRootPath(document);
	return {
		rootPath,
		transform: {
			disableUndoToggle: settings('transform.disableUndoToggle', false),
			watch: settings('transform.watch', false),
			associations: document ? getAssociations(document.fileName) : { cursor: [], range: [], ext: '' },
			src: getSourcePath(rootPath),
		},
		motion: {
			search: settings<{
				jumpResultThreshold: number;
				jumpInputThreshold: number;
				jumpSelect: 'start' | 'end' | 'words' | 'input' | 'first-input' | 'first-word';
			}>('search', {
				jumpResultThreshold: 0,
				jumpInputThreshold: 2,
				jumpSelect: 'input',
			}),
		},
	};
}
