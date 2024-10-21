import * as path from 'node:path';
import { defineConfig } from '@vscode/test-cli';
import { homedir } from 'node:os';

// async function main() {
// 	try {
// 		// The folder containing the Extension Manifest package.json
// 		// Passed to `--extensionDevelopmentPath`
// 		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

// 		// The path to test runner
// 		// Passed to --extensionTestsPath
// 		const extensionTestsPath = path.resolve(__dirname, './suite/index');

// 		// Download VS Code, unzip it and run the integration test
// 		await runTests({ extensionDevelopmentPath, extensionTestsPath });
// 	} catch (err) {
// 		console.error('Failed to run tests');
// 		process.exit(1);
// 	}
// }

// main();

/// <reference types="@types/test-cli" />
export default defineConfig({
	label: 'unitTests',
	files: '../out/test/**/*.test.js',
	extensionDevelopmentPath: process.cwd(),
	version: 'insiders',
	workspaceFolder: path.join(homedir(), 'projects', 'pk-vsc-test-project', 'project-nested'),
	mocha: {
		ui: 'tdd',
		timeout: 20000,
	},
});
