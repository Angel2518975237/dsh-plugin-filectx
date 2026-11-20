// dsh-plugin-filectx — Client half (web).
//
// Registers the right-click context menu for produced-file chips and inline
// file mentions: a shell.overlay entry renders the menu, and a capture-phase
// document contextmenu listener recognizes the two product surfaces by their
// stable DOM contract (title = full path). Actions call the package's own
// /filectx-api routes served by the host half.
window.__ModuleLoader__.load({
	id: "dsh-plugin-filectx",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const NS = "filectx";
		const CSS = [
			".fctx-menu{position:fixed;z-index:2000;box-sizing:border-box;min-width:230px;max-width:340px;padding:4px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);font-family:inherit}",
			".fctx-path{padding:6px 8px 4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}",
			".fctx-item{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:5px 10px;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left;font-family:inherit}",
			".fctx-item:hover,.fctx-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}",
			".fctx-arrow{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}",
			".fctx-sub{display:flex;flex-direction:column;padding:2px 0 2px 10px}",
			".fctx-sub .fctx-item{min-height:28px;font-size:12px}",
			".fctx-sep{height:1px;flex:none;margin:3px 6px;background:var(--dsw-alias-border-l2)}",
			".fctx-note{padding:6px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".fctx-error{margin-top:2px;padding:6px 8px;border-radius:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}",
			".fctx-default{margin-left:auto;flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}"
		].join("\n");

		const zh = {
			"menu.open": "打开",
			"menu.openBrowser": "在浏览器中打开",
			"menu.openWith": "用浏览器打开…",
			"menu.reveal.finder": "在访达中显示",
			"menu.reveal.files": "在文件管理器中显示",
			"menu.copyPath": "复制路径",
			"menu.detecting": "正在检测浏览器…",
			"menu.none": "未检测到浏览器",
			"menu.default": "默认"
		};
		const en = {
			"menu.open": "Open",
			"menu.openBrowser": "Open in Browser",
			"menu.openWith": "Open With Browser…",
			"menu.reveal.finder": "Reveal in Finder",
			"menu.reveal.files": "Reveal in File Manager",
			"menu.copyPath": "Copy Path",
			"menu.detecting": "Detecting browsers…",
			"menu.none": "No browsers detected",
			"menu.default": "Default"
		};

		async function apiGet(action) {
			const response = await fetch("/filectx-api/" + action, { method: "GET" });
			if (!response.ok) throw new Error("HTTP " + String(response.status));
			return response.json();
		}
		async function apiPost(action, payload) {
			const response = await fetch("/filectx-api/" + action, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (!response.ok) throw new Error("HTTP " + String(response.status));
			return response.json();
		}

		function apply(ctx) {
			const locale = ctx.get("locale");
			let t = (key) => (zh[key] !== undefined ? zh[key] : key);
			if (locale !== undefined) {
				ctx.effect(() => locale.register(NS, { zh: zh, en: en }), "filectx: dictionaries");
				t = locale.bind(NS);
			}

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-plugin-filectx";
				tag.dataset.pluginCss = "dsh-plugin-filectx/menu.css";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => { tag.remove(); };
			}, "filectx: menu styles");

			// ---- tiny menu store shared by the listener and the overlay entry ----
			let menuState = null;
			const menuListeners = new Set();
			function publishMenu(next) {
				menuState = next;
				for (const fn of Array.from(menuListeners)) fn(next);
			}
			function subscribeMenu(fn) {
				menuListeners.add(fn);
				return () => { menuListeners.delete(fn); };
			}

			// The two shipped file surfaces both carry the full path in `title`.
			function resolveFileTarget(node) {
				if (node === null || typeof node.closest !== "function") return null;
				const btn = node.closest("button[title]");
				if (btn === null) return null;
				const title = btn.getAttribute("title");
				if (typeof title !== "string" || title === "" || title.indexOf("\0") !== -1) return null;
				if (!/^([A-Za-z]:[\\/]|\/)/.test(title)) return null;
				if (btn.closest('[data-produced-files-row]') !== null) return title;
				const cls = btn.getAttribute("class");
				if (cls !== null && cls.indexOf("_fileMention") !== -1) return title;
				return null;
			}

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				const onContextMenu = (event) => {
					const path = resolveFileTarget(event.target);
					if (path === null) {
						if (menuState !== null) publishMenu(null);
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					publishMenu({ x: event.clientX, y: event.clientY, path: path });
				};
				document.addEventListener("contextmenu", onContextMenu, true);
				return () => document.removeEventListener("contextmenu", onContextMenu, true);
			}, "filectx: contextmenu capture");

			let envPromise = null;
			function loadEnv() {
				if (envPromise === null) {
					envPromise = apiGet("browsers").catch(() => ({ ok: false, platform: "unknown", browsers: [] }));
				}
				return envPromise;
			}

			function FileContextMenu() {
				const [menu, setMenu] = react.useState(menuState);
				react.useEffect(() => subscribeMenu(setMenu), []);
				const [env, setEnv] = react.useState(null);
				const [subOpen, setSubOpen] = react.useState(false);
				const [error, setError] = react.useState(null);

				react.useEffect(() => {
					setSubOpen(false);
					setError(null);
					if (menu !== null) loadEnv().then((value) => setEnv(value));
				}, [menu]);

				react.useEffect(() => {
					if (menu === null || typeof document === "undefined") return;
					const inside = (node) => node !== null && typeof node.closest === "function" && node.closest("[data-filectx-menu]") !== null;
					const onPointerDown = (event) => { if (!inside(event.target)) publishMenu(null); };
					const onKey = (event) => { if (event.key === "Escape") publishMenu(null); };
					const onScroll = (event) => { if (!inside(event.target)) publishMenu(null); };
					document.addEventListener("pointerdown", onPointerDown, true);
					document.addEventListener("keydown", onKey, true);
					document.addEventListener("scroll", onScroll, true);
					return () => {
						document.removeEventListener("pointerdown", onPointerDown, true);
						document.removeEventListener("keydown", onKey, true);
						document.removeEventListener("scroll", onScroll, true);
					};
				}, [menu]);

				react.useEffect(() => {
					if (menu === null || typeof document === "undefined") return;
					const node = document.querySelector("[data-filectx-menu]");
					if (node === null) return;
					const rect = node.getBoundingClientRect();
					const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
					const vh = typeof window === "undefined" ? 800 : window.innerHeight;
					let x = menu.x;
					let y = menu.y;
					if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
					if (y + rect.height > vh - 8) y = Math.max(8, vh - rect.height - 8);
					node.style.left = String(Math.round(x)) + "px";
					node.style.top = String(Math.round(y)) + "px";
				}, [menu, subOpen, env]);

				if (menu === null) return null;
				const plat = env !== null && typeof env.platform === "string" ? env.platform : "unknown";
				const browsers = env !== null && Array.isArray(env.browsers) ? env.browsers : null;
				const revealKey = plat === "darwin" ? "menu.reveal.finder" : "menu.reveal.files";
				const el = react.createElement;
				const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
				const run = async (action, payload) => {
					setError(null);
					try {
						const result = await apiPost(action, payload);
						if (result !== null && typeof result === "object" && result.ok === false) {
							setError(typeof result.error === "string" ? result.error : "operation failed");
							return;
						}
						publishMenu(null);
					} catch (e) {
						setError(e !== null && typeof e === "object" && typeof e.message === "string" ? e.message : String(e));
					}
				};
				const item = (label, onClick) => el("button", {
					type: "button",
					className: "fctx-item",
					role: "menuitem",
					onClick: (event) => { stop(event); onClick(); },
					onContextMenu: stop
				}, label);

				return el("div", {
					className: "fctx-menu",
					"data-filectx-menu": "true",
					role: "menu",
					style: { left: menu.x + "px", top: menu.y + "px" },
					onContextMenu: (event) => { stop(event); publishMenu(null); }
				},
					el("div", { className: "fctx-path", title: menu.path }, menu.path),
					item(t("menu.open"), () => run("open", { path: menu.path })),
					item(t("menu.openBrowser"), () => run("open-browser", { path: menu.path })),
					el("div", {
						className: "fctx-item",
						role: "menuitem",
						tabIndex: 0,
						onClick: (event) => { stop(event); setSubOpen((v) => !v); },
						onContextMenu: stop
					}, t("menu.openWith"), el("span", { className: "fctx-arrow" }, subOpen ? "▾" : "▸")),
					subOpen ? el("div", { className: "fctx-sub", role: "group" },
						browsers === null
							? el("span", { className: "fctx-note" }, t("menu.detecting"))
							: browsers.length === 0
								? el("span", { className: "fctx-note" }, t("menu.none"))
								: browsers.map((b) => el("button", {
									key: b.name,
									type: "button",
									className: "fctx-item",
									role: "menuitem",
									onClick: (event) => { stop(event); run("open-with", { path: menu.path, app: b.name }); },
									onContextMenu: stop
								}, b.name, b.isDefault === true ? el("span", { className: "fctx-default" }, t("menu.default")) : null))
					) : null,
					el("div", { className: "fctx-sep" }),
					item(t(revealKey), () => run("reveal", { path: menu.path })),
					item(t("menu.copyPath"), () => run("copy", { text: menu.path })),
					error !== null ? el("div", { className: "fctx-error", role: "alert" }, error) : null
				);
			}

			const slots = ctx.get("slots");
			if (slots !== undefined) {
				slots.inject("shell.overlay", () => slots.register(
					{ name: "shell.overlay", id: "filectx-menu", order: 90, label: "file context menu" },
					FileContextMenu
				));
			}
		}

		exports.apply = apply;
		return module.exports;
	}
});
