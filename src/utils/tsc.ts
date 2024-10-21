import { exec } from 'child_process';
import type { TState } from '../state/state';
import { Transpilation } from '../types';
import { Critical } from './errors';

export async function tsc(source: string, outDir: string, state: TState) {
	state.strace('[TSC] Transpiling..', source, 'to ->', outDir);
	const prefix = 'TSFILE: ';

	return new Promise<Transpilation>((resolve, reject) => {
		exec(
			`npx tsc "${source}" --outDir "${outDir}" -m commonjs -t es6 --lib dom,es6,esnext --listEmittedFiles --skipLibCheck --noCheck --allowJs`,
			{
				cwd: state.extensionPath,
			},
			(err, stdout, stderr) => {
				const idx = stdout.indexOf(prefix);
				const idxErr = stderr.indexOf(prefix);

				if (idx === -1 && idxErr === -1) reject(stderr.length ? stderr : err);

				const result = idx !== -1 ? stdout : stderr;
				const files = result
					?.split('\n')
					.filter((l) => l.startsWith(prefix) && l.endsWith('.js'))
					.map((l) => l.replace(prefix, '').trim());

				if (!files?.length) reject(new Critical(`[TSC] -> Nothing transpiled from source: ${source}`));
				state.trace('[TSC] Output Files -> ', files);

				resolve({ files, source, outDir, js: files[0] });
			}
		);
	});
}
