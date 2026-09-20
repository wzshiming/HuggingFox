// Playwright webServer for the selfhosted project: builds the web UI and the huggingfox binary
// into a throwaway directory, serves the embedded UI from empty data on SELFHOSTED_PORT with
// SELFHOSTED_TOKEN as the only credential, and removes everything when it is stopped.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.env.SELFHOSTED_PORT ?? '4175';
const token = process.env.SELFHOSTED_TOKEN;
if (!token) throw new Error('SELFHOSTED_TOKEN must be set (pnpm test:selfhosted does this)');

const dir = mkdtempSync(join(tmpdir(), 'hfx-selfhosted-'));
const cleanup = () => rmSync(dir, { recursive: true, force: true });

function run(command: string, args: string[]) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.status !== 0) {
		cleanup();
		throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`);
	}
}

run('pnpm', ['build']);
run('go', ['build', '-o', join(dir, 'huggingfox'), './cmd/huggingfox']);

const server = spawn(
	join(dir, 'huggingfox'),
	[
		'-addr',
		`127.0.0.1:${port}`,
		'-host-url',
		`http://127.0.0.1:${port}`,
		'-data',
		join(dir, 'data'),
		'-ssh-addr',
		'',
		'-token',
		token
	],
	{ stdio: 'inherit' }
);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
	process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => {
	cleanup();
	process.exit(code ?? (signal ? 0 : 1));
});
