// dsh-plugin-filectx — Host half.
//
// Serves `/filectx-api` over the host webServer for the browser menu, and runs
// the native open / reveal / clipboard commands through the host `subprocess`
// service with literal argv arrays (never shell-interpreted). The route is
// refcounted so concurrent sessions on presets mounting this row share one
// registration, and the last unmount disposes it.
//
// Endpoints (JSON):
//   GET  /filectx-api/browsers        -> { ok, platform, browsers: [{name, isDefault}] }
//   POST /filectx-api/open            { path }
//   POST /filectx-api/open-browser    { path }
//   POST /filectx-api/open-with       { path, app }
//   POST /filectx-api/reveal          { path }
//   POST /filectx-api/copy            { text }

let routeDispose = null;
let refs = 0;

export function apply(ctx) {
	const subprocess = ctx.get('subprocess');
	const webServer = ctx.get('webServer');
	if (subprocess === undefined || webServer === undefined) {
		console.error('dsh-plugin-filectx: requires the host subprocess and webServer services');
		return;
	}
	const impl = createImpl(subprocess);
	refs += 1;
	if (routeDispose === null) {
		routeDispose = webServer.register({
			kind: 'prefix',
			path: '/filectx-api',
			handler: (req, res) => {
				handle(impl, req, res);
			}
		});
	}
	return () => {
		refs -= 1;
		if (refs <= 0 && routeDispose !== null) {
			const dispose = routeDispose;
			routeDispose = null;
			dispose();
		}
	};
}

function createImpl(subprocess) {
	const COLLECT = { maxBytes: 65536 };
	// pbcopy needs an UTF-8 LC_CTYPE: the scrubbed parent env carries no locale,
	// and under LC_CTYPE=C pbcopy silently fails on non-ASCII stdin (a Chinese
	// path copies as empty while pbcopy still exits 0).
	const UTF8_ENV = { LC_CTYPE: 'UTF-8' };
	function run(argv, input, env) {
		const handle = subprocess.spawn({
			argv: argv,
			cwd: '/',
			stdio: {
				stdin: input === undefined ? 'ignore' : { data: input },
				stdout: COLLECT,
				stderr: COLLECT
			},
			graceMs: 5000,
			env: env
		});
		return handle.done.then((outcome) => {
			const out = handle.collected.stdout !== undefined ? handle.collected.stdout.readFrom(0).text : '';
			const err = handle.collected.stderr !== undefined ? handle.collected.stderr.readFrom(0).text : '';
			if (outcome.exitCode !== 0) {
				const detail = (err !== '' ? err : out !== '' ? out : 'exit code ' + String(outcome.exitCode)).trim();
				throw new Error(detail);
			}
			return out;
		});
	}
	async function runFirst(candidates, args, input, env) {
		let last = null;
		for (const bin of candidates) {
			try {
				return await run([bin].concat(args), input, env);
			} catch (error) {
				last = error;
			}
		}
		throw last === null ? new Error('no runnable candidate command') : last;
	}
	function messageOf(error) {
		return error instanceof Error ? error.message : String(error);
	}

	let platformPromise;
	function platform() {
		if (platformPromise === undefined) {
			platformPromise = (async () => {
				for (const bin of ['/usr/bin/uname', '/bin/uname', 'uname']) {
					try {
						const out = await run([bin, '-s']);
						const s = out.trim();
						if (s === 'Darwin') return 'darwin';
						if (s === 'Linux') return 'linux';
						return s.toLowerCase();
					} catch (error) {}
				}
				return 'unknown';
			})();
		}
		return platformPromise;
	}

	function checkPath(value) {
		if (typeof value !== 'string' || value === '' || value.length > 4096 || value.includes('\0')) return false;
		return /^([A-Za-z]:[\\/]|\/)/.test(value);
	}
	function dirnameOf(path) {
		const at = path.lastIndexOf('/');
		if (at <= 0) return '/';
		return path.slice(0, at);
	}

	// The macOS bundle id registered for https is the default browser (the same
	// LaunchServices record the shipped native opener reads).
	function macBundleForHttps(plist) {
		const stripped = plist.replace(/LSHandlerPreferredVersions\s*=\s*\{[^}]*\};/g, '');
		const match = /\{[^{}]*LSHandlerURLScheme\s*=\s*"?https"?;[^{}]*\}/.exec(stripped);
		if (match === null) return null;
		const role = /LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?;/.exec(match[0]);
		return role === null ? null : role[1];
	}

	const KNOWN_BROWSERS = ['Tabbit', 'Safari', 'Google Chrome', 'Microsoft Edge', 'Firefox', 'Arc', 'Brave Browser', 'Chromium', 'Opera', 'Vivaldi', 'DuckDuckGo', 'Orion', 'Zen Browser', 'SigmaOS', '豆包浏览器'];
	const BUNDLE_NAMES = {
		'com.tabbit-ai.tabbit': 'Tabbit',
		'com.apple.safari': 'Safari',
		'com.google.chrome': 'Google Chrome',
		'com.microsoft.edgemac': 'Microsoft Edge',
		'org.mozilla.firefox': 'Firefox',
		'companybrowser.browser': 'Arc',
		'com.brave.browser': 'Brave Browser',
		'org.chromium.chromium': 'Chromium',
		'com.operasoftware.opera': 'Opera',
		'com.vivaldi.vivaldi': 'Vivaldi',
		'com.duckduckgo.macos.browser': 'DuckDuckGo',
		'com.kagi.kagimac': 'Orion',
		'app.zenbrowser.zen': 'Zen Browser'
	};
	function bundleToName(bundle) {
		if (typeof bundle !== 'string' || bundle === '') return null;
		const key = bundle.toLowerCase();
		if (BUNDLE_NAMES[key] !== undefined) return BUNDLE_NAMES[key];
		const flat = key.replace(/[^a-z]/g, '');
		for (const name of KNOWN_BROWSERS) {
			if (flat.includes(name.toLowerCase().replace(/[^a-z]/g, ''))) return name;
		}
		return null;
	}

	async function darwinDefaultBrowserBundle() {
		try {
			const plist = await run(['/usr/bin/defaults', 'read', 'com.apple.LaunchServices/com.apple.launchservices.secure']);
			return macBundleForHttps(plist);
		} catch (error) {
			return null;
		}
	}

	const OPEN = ['/usr/bin/open', 'open'];
	const XDG_OPEN = ['/usr/bin/xdg-open', 'xdg-open'];

	async function browsers() {
		const plat = await platform();
		if (plat !== 'darwin') {
			return { ok: true, platform: plat, browsers: [] };
		}
		let names = [];
		try {
			const out = await run(['/bin/ls', '/Applications']);
			names = out.split('\n').map((s) => s.trim()).filter((n) => n.endsWith('.app')).map((n) => n.slice(0, -4));
		} catch (error) {}
		let homeNames = [];
		try {
			const home = (await run(['/usr/bin/printenv', 'HOME'])).trim();
			if (home !== '') {
				const out = await run(['/bin/ls', home + '/Applications']);
				homeNames = out.split('\n').map((s) => s.trim()).filter((n) => n.endsWith('.app')).map((n) => n.slice(0, -4));
			}
		} catch (error) {}
		const present = [];
		for (const known of KNOWN_BROWSERS) {
			if (names.includes(known) || homeNames.includes(known)) present.push(known);
		}
		const bundle = await darwinDefaultBrowserBundle();
		const defaultName = bundleToName(bundle);
		return {
			ok: true,
			platform: 'darwin',
			browsers: present.map((name) => ({ name: name, isDefault: name === defaultName }))
		};
	}

	async function openPath(args) {
		const path = args !== null && typeof args === 'object' ? args.path : undefined;
		if (!checkPath(path)) return { ok: false, error: 'invalid path' };
		const plat = await platform();
		try {
			if (plat === 'darwin') await runFirst(OPEN, [path]);
			else if (plat === 'linux') await runFirst(XDG_OPEN, [path]);
			else return { ok: false, error: 'unsupported platform: ' + plat };
			return { ok: true };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	async function openBrowser(args) {
		const path = args !== null && typeof args === 'object' ? args.path : undefined;
		if (!checkPath(path)) return { ok: false, error: 'invalid path' };
		const plat = await platform();
		try {
			if (plat === 'darwin') {
				const bundle = await darwinDefaultBrowserBundle();
				if (bundle !== null) {
					try {
						await runFirst(OPEN, ['-b', bundle, path]);
						return { ok: true };
					} catch (error) {}
				}
				await runFirst(OPEN, [path]);
				return { ok: true };
			}
			if (plat === 'linux') {
				await runFirst(XDG_OPEN, [path]);
				return { ok: true };
			}
			return { ok: false, error: 'unsupported platform: ' + plat };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	async function openWith(args) {
		const path = args !== null && typeof args === 'object' ? args.path : undefined;
		const app = args !== null && typeof args === 'object' ? args.app : undefined;
		if (!checkPath(path)) return { ok: false, error: 'invalid path' };
		if (typeof app !== 'string' || app === '' || app.length > 256 || app.includes('\0') || app.includes('/')) {
			return { ok: false, error: 'invalid application name' };
		}
		const plat = await platform();
		if (plat !== 'darwin') return { ok: false, error: 'choosing an application is macOS-only' };
		try {
			await runFirst(OPEN, ['-a', app, path]);
			return { ok: true };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	async function reveal(args) {
		const path = args !== null && typeof args === 'object' ? args.path : undefined;
		if (!checkPath(path)) return { ok: false, error: 'invalid path' };
		const plat = await platform();
		try {
			if (plat === 'darwin') {
				await runFirst(OPEN, ['-R', path]);
				return { ok: true };
			}
			if (plat === 'linux') {
				await runFirst(XDG_OPEN, [dirnameOf(path)]);
				return { ok: true };
			}
			return { ok: false, error: 'unsupported platform: ' + plat };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	async function copy(args) {
		const text = args !== null && typeof args === 'object' ? args.text : undefined;
		if (typeof text !== 'string' || text === '' || text.length > 65536 || text.includes('\0')) {
			return { ok: false, error: 'invalid text' };
		}
		const plat = await platform();
		try {
			if (plat === 'darwin') {
				await runFirst(['/usr/bin/pbcopy', 'pbcopy'], [], text, UTF8_ENV);
				return { ok: true };
			}
			if (plat === 'linux') {
				try {
					await runFirst(['/usr/bin/xclip', 'xclip'], ['-selection', 'clipboard'], text, UTF8_ENV);
				} catch (error) {
					await runFirst(['/usr/bin/xsel', 'xsel'], ['--clipboard', '--input'], text, UTF8_ENV);
				}
				return { ok: true };
			}
			return { ok: false, error: 'unsupported platform: ' + plat };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	return { browsers: browsers, open: openPath, openBrowser: openBrowser, openWith: openWith, reveal: reveal, copy: copy };
}

function json(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
	res.end(body);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.setEncoding('utf8');
		req.on('data', (chunk) => {
			data += chunk;
			if (data.length > 65536) {
				reject(new Error('request body too large'));
				req.destroy();
			}
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

async function handle(impl, req, res) {
	const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
	const action = pathname.split('/').filter(Boolean)[1] ?? '';
	try {
		if (req.method === 'GET' && action === 'browsers') {
			json(res, 200, await impl.browsers());
			return;
		}
		if (req.method !== 'POST') {
			json(res, 405, { ok: false, error: 'method not allowed' });
			return;
		}
		const body = await readBody(req);
		let args = {};
		try {
			args = body === '' ? {} : JSON.parse(body);
		} catch (error) {
			json(res, 400, { ok: false, error: 'invalid JSON body' });
			return;
		}
		if (args === null || typeof args !== 'object') {
			json(res, 400, { ok: false, error: 'invalid JSON body' });
			return;
		}
		if (action === 'open') json(res, 200, await impl.open(args));
		else if (action === 'open-browser') json(res, 200, await impl.openBrowser(args));
		else if (action === 'open-with') json(res, 200, await impl.openWith(args));
		else if (action === 'reveal') json(res, 200, await impl.reveal(args));
		else if (action === 'copy') json(res, 200, await impl.copy(args));
		else json(res, 404, { ok: false, error: 'unknown action' });
	} catch (error) {
		json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
	}
}
