// Stand-in hub for the deterministic e2e run (Playwright webServer): every request gets a
// hub-shaped JSON 404, so proxy routing can be asserted without huggingface.co.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4174);

createServer((req, res) => {
	const body = JSON.stringify({ error: `Fixture upstream: ${req.method} ${req.url} not found` });
	res.writeHead(404, {
		'content-type': 'application/json; charset=utf-8',
		'x-error-code': 'RepoNotFound',
		'x-fixture-upstream': '1'
	});
	res.end(body);
}).listen(port, '127.0.0.1', () => {
	console.log(`fixture upstream listening on http://127.0.0.1:${port}`);
});
