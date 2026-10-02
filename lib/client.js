// Browser half of dsh-web-search-crw (declared in package.json dsh.client,
// served through the host's /plugins combo route by @deepseek-ai/dsh-client-modules).
// Hand-written in the same lazy-CJS factory shape tsdown emits for the
// official companions, so no build step is needed.
//
// What it mounts: the `plugins.row.config` cell for this plugin's profile row
// (`<package name>#<row id>` = `dsh-web-search-crw#web-search-crw`), while the
// Host serves the `web-search-crw` settings namespace. The Host's
// @deepseek-ai/dsh-settings derives that namespace from the plugin's exported
// Config schema — volatile fields only — and the page rendered here is
// generated FROM that live schema: one control per declared field, string /
// number / boolean / string-array inputs chosen by schema type, `role: secret`
// fields as write-only inputs (the literal never crosses the wire), field
// descriptions as hints, and writes as revision-fenced mutate ops. Adding a
// volatile field to lib/index.js Config shows it here with no client change.
window.__ModuleLoader__.load({
	id: "dsh-web-search-crw",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region css
		const css = ".crw-config-fields{flex-direction:column;gap:14px;max-width:640px;display:flex}.crw-config-field{flex-direction:column;gap:3px;display:flex}.crw-config-labelRow{align-items:baseline;gap:8px;display:flex}.crw-config-label{font-size:13px;font-weight:600}.crw-config-overridden{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0 border;border:0;padding:0;font:inherit;font-size:11px;text-decoration:underline}.crw-config-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.crw-config-input,.crw-config-textarea{border:1px solid var(--dsw-alias-border-l2,var(--dsw-border-color,#ccc));border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:inherit;padding:6px 8px;font:inherit;font-size:13px;width:100%}.crw-config-textarea{min-height:64px;resize:vertical}.crw-config-checkRow{align-items:center;gap:8px;display:flex}.crw-config-state{color:var(--dsw-alias-label-tertiary);font-size:11px}.crw-config-actions{align-items:center;gap:10px;padding-top:4px;display:flex}.crw-config-save{cursor:pointer;background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-bg-base,#fff);border:0;border-radius:8px;padding:6px 16px;font:inherit;font-size:13px}.crw-config-save:disabled{cursor:default;opacity:.55}.crw-config-clear{cursor:pointer;color:inherit;background:0 0;border:0;padding:0;font:inherit;font-size:12px;text-decoration:underline}.crw-config-note{color:var(--dsw-alias-state-danger,var(--dsw-alias-label-tertiary));font-size:12px}";
		const styleTagId = "dsh-web-search-crw/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-search-crw";
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locales
		/** English copy for the form chrome; field names fall back to a humanized key. */
		const en = {
			title: "Web search (CRW)",
			summary: "CRW-compatible search server at {url}.",
			summaryUnset: "CRW-compatible search server (endpoint not set; defaults to http://localhost:3000).",
			loading: "Loading configuration…",
			readOnly: "This deployment stores settings read-only.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			overridden: "overridden",
			reset: "reset",
			invalidNumber: "Enter a number, or leave blank to use the default.",
			keyConfigured: "A key is configured.",
			keyUnset: "No key is configured.",
			keyPlaceholderSet: "keep current key",
			keyPlaceholderUnset: "no key",
			clearKey: "remove key",
			emptyMeansDefault: "empty = default"
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "网页搜索（CRW）",
			summary: "CRW 兼容搜索服务器：{url}。",
			summaryUnset: "CRW 兼容搜索服务器（未设置接口地址，默认 http://localhost:3000）。",
			loading: "正在加载配置…",
			readOnly: "本部署的设置为只读。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			overridden: "已覆盖",
			reset: "恢复默认",
			invalidNumber: "请填数字；留空表示使用默认值。",
			keyConfigured: "已配置密钥。",
			keyUnset: "未配置密钥。",
			keyPlaceholderSet: "保持当前密钥",
			keyPlaceholderUnset: "无密钥",
			clearKey: "清除密钥",
			emptyMeansDefault: "留空表示默认值"
		};
		//#endregion
		//#region fields
		/**
		* Human label for a schema key with no dictionary entry: `resolveTimeoutMs`
		* → `Resolve timeout ms`. Unknown keys still render — the form is generated
		* from the schema, not from a field list in here.
		* @param key - the config field name.
		* @returns the fallback label.
		*/
		function humanize(key) {
			return key.replace(/^([a-z])/, (m, c) => c.toUpperCase()).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([a-z])(ms)$/i, "$1 $2");
		}
		/**
		* Project one schema member into what the renderer needs.
		* @param key - the field name.
		* @param node - the plain schema node from the Host descriptor.
		* @returns a field descriptor, or undefined for shapes this form skips.
		*/
		function fieldOf(key, node) {
			if (node == null || typeof node !== "object") return void 0;
			const meta = node.meta ?? {};
			const secret = meta.role === "secret";
			if (node.type === "string") return {
				key,
				kind: secret ? "secret" : "text",
				description: typeof meta.description === "string" ? meta.description : void 0,
				hasDefault: meta.default !== void 0
			};
			if (node.type === "number") return {
				key,
				kind: "number",
				min: typeof meta.min === "number" ? meta.min : void 0,
				step: typeof meta.step === "number" ? meta.step : void 0,
				description: typeof meta.description === "string" ? meta.description : void 0,
				hasDefault: meta.default !== void 0
			};
			if (node.type === "boolean") return {
				key,
				kind: "boolean",
				description: typeof meta.description === "string" ? meta.description : void 0,
				hasDefault: meta.default !== void 0
			};
			if (node.type === "array" && node.inner != null && node.inner.type === "string") return {
				key,
				kind: "lines",
				description: typeof meta.description === "string" ? meta.description : void 0,
				hasDefault: meta.default !== void 0
			};
			return void 0;
		}
		/** Parse one staged input into the wire value; `null` marks an unusable input. */
		function parseInput(field, text) {
			switch (field.kind) {
				case "number": {
					if (text.trim().length === 0) return null;
					const value = Number(text);
					if (!Number.isFinite(value)) return null;
					return value;
				}
				case "boolean": return text === "true";
				case "lines": return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
				default: return text;
			}
		}
		/** The text one input shows for a current value (staged edits win upstream). */
		function inputText(field, value) {
			if (field.kind === "boolean") return "";
			if (field.kind === "lines") return Array.isArray(value) ? value.join("\n") : "";
			return value === void 0 || value === null ? "" : String(value);
		}
		//#endregion
		//#region card
		/**
		* The row's configuration entry: a one-liner on the cards, the generated
		* form once the row page opens it. Field list, order, types and hints all
		* come from the Host-served schema; the staged edits and the save are local.
		*/
		function CrwConfigCard(props) {
			const { t, row } = props;
			const form = props.form;
			const state = form?.state;
			const [staged, setStaged] = react.useState(() => ({}));
			const [note, setNote] = react.useState(() => (null));
			const [saving, setSaving] = react.useState(() => (false));
			if (props.view !== "page") return t(row?.value?.baseURL != null && row.value.baseURL.length > 0 ? "summary" : "summaryUnset", row?.value?.baseURL != null ? {
				url: row.value.baseURL
			} : {});
			if (row == null || state == null || state.status === "loading") return (0, react.createElement)("p", {
				className: "crw-config-note"
			}, t("loading"));
			const disabled = !state.writable;
			const fields = Object.entries(row.schema?.dict ?? {}).flatMap(([key, node]) => {
				const field = fieldOf(key, node);
				return field === void 0 ? [] : [field];
			});
			const secretOf = (key) => (row.secrets ?? []).find((candidate) => candidate.path.length === 1 && candidate.path[0] === key);
			const stage = (key, patch) => {
				setNote(null);
				setStaged((previous) => {
					const next = {
						...previous
					};
					if (patch === null) delete next[key];
					else next[key] = patch;
					return next;
				});
			};
			const pending = Object.entries(staged).filter(([key, edit]) => {
				if (edit.op === "unset") return true;
				if (edit.invalid === true) return true;
				return edit.value !== (state.value ?? {})[key];
			});
			const invalid = pending.some(([ , edit]) => edit.invalid === true);
			const save = async () => {
				if (pending.length === 0 || form == null) return;
				setSaving(true);
				setNote(null);
				const ops = pending.map(([key, edit]) => edit.op === "unset" ? {
					op: "unset",
					path: [key]
				} : {
					op: "set",
					path: [key],
					value: edit.value
				});
				const accepted = await form.mutate(ops, state.revision).catch(() => false);
				setSaving(false);
				if (accepted === true) {
					setStaged({});
					return;
				}
				setNote(t("saveFailed"));
			};
			const fieldRow = (field) => {
				const stagedEdit = staged[field.key];
				const current = (state.value ?? {})[field.key];
				const text = stagedEdit?.op === "set" ? stagedEdit.typed ?? inputText(field, stagedEdit.value) : stagedEdit?.op === "unset" ? "" : inputText(field, current);
				const label = () => {
				const text = t(`field.${field.key}`);
				return text === `field.${field.key}` ? humanize(field.key) : text;
			};
				const overridden = field.kind !== "secret" && JSON.stringify(current ?? null) !== JSON.stringify((state.base ?? {})[field.key] ?? null);
				const hint = field.description ?? (field.hasDefault ? t("emptyMeansDefault") : void 0);
				return (0, react.createElement)("div", {
					className: "crw-config-field",
					key: field.key
				}, (0, react.createElement)("div", {
					className: "crw-config-labelRow"
				}, (0, react.createElement)("span", {
					className: "crw-config-label",
					htmlFor: `crw-config-${field.key}`
				}, label()), overridden ? (0, react.createElement)("button", {
					type: "button",
					className: "crw-config-overridden",
					title: t("overridden"),
					disabled,
					onClick: () => {
						stage(field.key, {
							op: "unset"
						});
					}
				}, t("reset")) : null), field.kind === "boolean" ? (0, react.createElement)("label", {
					className: "crw-config-checkRow"
				}, (0, react.createElement)("input", {
					type: "checkbox",
					checked: stagedEdit?.op === "set" ? stagedEdit.value === true : current === true,
					disabled,
					onChange: (event) => {
						stage(field.key, {
							op: "set",
							value: event.target.checked
						});
					}
				}), (0, react.createElement)("span", {
					className: "crw-config-state"
				}, String(stagedEdit?.op === "set" ? stagedEdit.value === true : current === true))) : (0, react.createElement)("input", {
					id: `crw-config-${field.key}`,
					className: "crw-config-input",
					type: field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text",
					value: text,
					min: field.min,
					step: field.step,
					disabled,
					autoComplete: field.kind === "secret" ? "off" : void 0,
					placeholder: field.kind === "secret" ? t(secretOf(field.key)?.set === true ? "keyPlaceholderSet" : "keyPlaceholderUnset") : void 0,
					onChange: (event) => {
						if (field.kind === "secret" && event.target.value.length === 0) {
							stage(field.key, null);
							return;
						}
						const value = parseInput(field, event.target.value);
						stage(field.key, {
							op: "set",
							typed: event.target.value,
							value: value ?? event.target.value,
							invalid: value === null
						});
					}
				}), field.kind === "secret" && secretOf(field.key)?.set === true ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)("span", {
					className: "crw-config-state"
				}, t("keyConfigured")), stagedEdit === void 0 ? (0, react.createElement)("button", {
					type: "button",
					className: "crw-config-clear",
					disabled,
					onClick: () => {
						stage(field.key, {
							op: "unset"
						});
					}
				}, t("clearKey")) : null) : field.kind === "secret" ? (0, react.createElement)("span", {
					className: "crw-config-state"
				}, t("keyUnset")) : null, hint !== void 0 ? (0, react.createElement)("p", {
					className: "crw-config-hint"
				}, hint) : null, stagedEdit?.invalid === true ? (0, react.createElement)("span", {
					className: "crw-config-note"
				}, t("invalidNumber")) : null);
			};
			return (0, react.createElement)("div", {
				className: "crw-config-fields"
			}, disabled ? (0, react.createElement)("p", {
				className: "crw-config-note"
			}, t("readOnly")) : null, fields.map(fieldRow), (0, react.createElement)("div", {
				className: "crw-config-actions"
			}, (0, react.createElement)("button", {
				type: "button",
				className: "crw-config-save",
				disabled: disabled || saving || pending.length === 0 || invalid,
				onClick: () => {
					void save();
				}
			}, saving ? t("saving") : t("save")), note !== null ? (0, react.createElement)("span", {
				className: "crw-config-note"
			}, note) : null));
		}
		//#endregion
		//#region index
		/**
		* Browser plugin body: registers the row-configuration page while the Host
		* serves this plugin's namespace, so a deployment that never composed the
		* provider shows no trace of the page.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.webSearchCrw";
		/** Settings namespace the Host derives from the host-side Config schema. */
		const SETTINGS_NS = "web-search-crw";
		/** `plugins.row.config` cell: `<package name>#<profile row id>`. */
		const ROW_CONFIG_KEY = "dsh-web-search-crw#web-search-crw";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/**
		* Mount the CRW row-configuration page.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "web-search-crw: dictionaries");
			const mirror = ctx.configForms.describe();
			const currentRow = () => mirror.getSnapshot()?.view?.namespaces?.find((candidate) => candidate.ns === SETTINGS_NS);
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
				name: "plugins.row.config",
				key: ROW_CONFIG_KEY,
				label: () => t("title"),
				locale: NS,
				inject: () => ({ row: currentRow() })
			}, CrwConfigCard))), "web-search-crw: row configuration page");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
