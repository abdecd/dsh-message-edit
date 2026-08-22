window.__ModuleLoader__.load({
	id: "dsh-message-edit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared.ts
		/** Same-origin endpoint owned by the Message Edit host plugin. */
		const MESSAGE_EDIT_PATH = "/message-edit";
		//#endregion
		//#region src/client/controller.ts
		/** Merge a burst of turn completions into one refresh. */
		const REFRESH_DELAY_MS = 300;
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function objectValue(value, label) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} 不是对象`);
			return value;
		}
		function stringValue(value, label) {
			if (typeof value !== "string") throw new TypeError(`${label} 不是字符串`);
			return value;
		}
		function numberValue(value, label) {
			if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} 不是数字`);
			return value;
		}
		function booleanValue(value, label) {
			if (typeof value !== "boolean") throw new TypeError(`${label} 不是布尔值`);
			return value;
		}
		function blockKind(value) {
			if (value !== "user" && value !== "assistant.reasoning" && value !== "assistant.response") throw new TypeError("消息块类型无效");
			return value;
		}
		function decodeMessage(value, index) {
			const row = objectValue(value, `messages[${String(index)}]`);
			return {
				key: stringValue(row["key"], "消息 key"),
				turn: numberValue(row["turn"], "消息 turn"),
				eventSeq: numberValue(row["eventSeq"], "消息 eventSeq"),
				blockIndex: numberValue(row["blockIndex"], "消息 blockIndex"),
				kind: blockKind(row["kind"]),
				text: stringValue(row["text"], "消息 text"),
				time: numberValue(row["time"], "消息 time")
			};
		}
		function decodeRetryable(value, index) {
			const row = objectValue(value, `retryableTurns[${String(index)}]`);
			return {
				turn: numberValue(row["turn"], "回合 turn"),
				userEventSeq: numberValue(row["userEventSeq"], "回合 userEventSeq"),
				preview: stringValue(row["preview"], "回合 preview"),
				time: numberValue(row["time"], "回合 time")
			};
		}
		function optionalOperation(value) {
			if (value === void 0) return void 0;
			if (value === "edit" || value === "reroll" || value === "retry" || value === "fork") return value;
			throw new TypeError("版本 operation 无效");
		}
		function decodeVersion(value, index) {
			const row = objectValue(value, `versions[${String(index)}]`);
			const operation = optionalOperation(row["operation"]);
			const cascade = row["cascade"];
			if (cascade !== void 0 && cascade !== "truncate" && cascade !== "preserve") throw new TypeError("版本 cascade 无效");
			const kind = row["blockKind"] === void 0 ? void 0 : blockKind(row["blockKind"]);
			return {
				sessionId: stringValue(row["sessionId"], "版本 sessionId"),
				...row["parentSessionId"] === void 0 ? {} : { parentSessionId: stringValue(row["parentSessionId"], "版本 parentSessionId") },
				...row["effectId"] === void 0 ? {} : { effectId: stringValue(row["effectId"], "版本 effectId") },
				...row["inverseSessionId"] === void 0 ? {} : { inverseSessionId: stringValue(row["inverseSessionId"], "版本 inverseSessionId") },
				createdAt: numberValue(row["createdAt"], "版本 createdAt"),
				depth: numberValue(row["depth"], "版本 depth"),
				current: booleanValue(row["current"], "版本 current"),
				onCurrentEffectPath: booleanValue(row["onCurrentEffectPath"], "版本 onCurrentEffectPath"),
				...operation === void 0 ? {} : { operation },
				...cascade === void 0 ? {} : { cascade },
				...row["targetTurn"] === void 0 ? {} : { targetTurn: numberValue(row["targetTurn"], "版本 targetTurn") },
				...kind === void 0 ? {} : { blockKind: kind },
				...row["before"] === void 0 ? {} : { before: stringValue(row["before"], "版本 before") },
				...row["after"] === void 0 ? {} : { after: stringValue(row["after"], "版本 after") },
				...row["rowCount"] === void 0 ? {} : { rowCount: numberValue(row["rowCount"], "版本 rowCount") }
			};
		}
		function arrayValue(value, label) {
			if (!Array.isArray(value)) throw new TypeError(`${label} 不是数组`);
			return value;
		}
		function stringArray(value, label) {
			return arrayValue(value, label).map((item, index) => stringValue(item, `${label}[${String(index)}]`));
		}
		function decodeTimeline(value) {
			const data = objectValue(value, "Timeline 响应");
			return {
				sessionId: stringValue(data["sessionId"], "Timeline sessionId"),
				messages: arrayValue(data["messages"], "Timeline messages").map(decodeMessage),
				retryableTurns: arrayValue(data["retryableTurns"], "Timeline retryableTurns").map(decodeRetryable),
				versions: arrayValue(data["versions"], "Timeline versions").map(decodeVersion),
				undoStack: stringArray(data["undoStack"], "Timeline undoStack"),
				redoSessionIds: stringArray(data["redoSessionIds"], "Timeline redoSessionIds")
			};
		}
		function decodeOperationResult(value) {
			const data = objectValue(value, "操作响应");
			return {
				sessionId: stringValue(data["sessionId"], "操作 sessionId"),
				queuedTurns: numberValue(data["queuedTurns"], "操作 queuedTurns")
			};
		}
		async function responseValue(response) {
			const value = await response.json();
			if (response.ok) return value;
			const error = objectValue(value, "错误响应")["error"];
			throw new Error(typeof error === "string" ? error : `请求失败：HTTP ${String(response.status)}`);
		}
		function conversationRevision(snapshot) {
			const turnEnds = [...snapshot.turnEnds.entries()].map(([turn, seq]) => `${String(turn)}:${String(seq)}`).join(",");
			return [
				snapshot.openState,
				snapshot.removed,
				snapshot.hasMore,
				turnEnds
			].join("|");
		}
		function lineageRevision(snapshot, sessionId) {
			let root = sessionId;
			const ancestorIds = /* @__PURE__ */ new Set();
			while (!ancestorIds.has(root)) {
				ancestorIds.add(root);
				const parent = snapshot.byId[root]?.parentId;
				if (parent === void 0 || snapshot.byId[parent] === void 0) break;
				root = parent;
			}
			const connected = [];
			for (const rawId of Object.keys(snapshot.byId).sort()) {
				const id = rawId;
				const seen = /* @__PURE__ */ new Set();
				let cursor = id;
				while (cursor !== void 0 && !seen.has(cursor)) {
					if (cursor === root) {
						connected.push(`${id}>${snapshot.byId[id]?.parentId ?? ""}`);
						break;
					}
					seen.add(cursor);
					cursor = snapshot.byId[cursor]?.parentId;
				}
			}
			return connected.join("|");
		}
		/** One stable controller is shared by all entries mounted for the same session. */
		var MessageEditController = class {
			sessionId;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				status: "idle",
				error: null,
				pending: null,
				timeline: null
			});
			face;
			generation = 0;
			ctx;
			sessions;
			sessionSource;
			sessionSourceDispose;
			sessionRevision;
			listRevision = "";
			refreshScheduled = false;
			refreshTimer;
			observing = false;
			navigationWaits = /* @__PURE__ */ new Set();
			disposeObservation = void 0;
			inflight = null;
			rerunAfter = false;
			abort = null;
			disposed = false;
			users = 0;
			constructor(ctx, sessionId) {
				this.sessionId = sessionId;
				this.ctx = ctx;
				this.sessions = ctx.get("sessions");
				this.face = {
					hooks: { messageEdit: this.store },
					acquire: () => {
						this.users += 1;
						if (this.users === 1 && this.disposed) this.revive();
						return () => this.release();
					},
					load: () => {
						this.load();
					},
					edit: (message, text, cascade) => this.mutate({
						action: "edit",
						sessionId: this.sessionId,
						eventSeq: message.eventSeq,
						blockIndex: message.blockIndex,
						text,
						cascade
					}),
					retry: (turn, cascade) => this.mutate({
						action: "retry",
						sessionId: this.sessionId,
						turn,
						cascade
					}),
					reroll: () => this.mutate({
						action: "reroll",
						sessionId: this.sessionId
					}),
					fork: (rows) => this.mutate({
						action: "fork",
						sessionId: this.sessionId,
						rows: rows.map((row) => ({
							kind: row.kind,
							text: row.text
						}))
					}),
					openVersion: (sessionId) => this.openWhenListed(sessionId)
				};
				this.observe();
			}
			observe() {
				this.disposeObservation = this.ctx.effect(() => this.observeDependencies(), `message-edit: observe ${this.sessionId}`);
			}
			release() {
				this.users -= 1;
				if (this.users <= 0) this.dispose();
			}
			/** Tear subscriptions down once no mounted entry uses this controller. */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.generation += 1;
				if (this.refreshTimer !== void 0) {
					clearTimeout(this.refreshTimer);
					this.refreshTimer = void 0;
					this.refreshScheduled = false;
				}
				this.abort?.abort();
				this.abort = null;
				this.disposeObservation?.();
				this.disposeObservation = void 0;
			}
			/** Re-observe after a transient zero; the retained store keeps old data
			* until the immediate refetch below commits. */
			revive() {
				this.disposed = false;
				this.observe();
				this.refresh();
			}
			/** Bind to replaceable value sources instead of retaining a Session object. */
			observeDependencies() {
				this.observing = true;
				this.listRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId);
				this.bindSessionSource();
				const disposeList = this.sessions.list.subscribe(() => {
					const rebound = this.bindSessionSource();
					const nextRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId);
					if (nextRevision === this.listRevision && !rebound) return;
					this.listRevision = nextRevision;
					this.invalidate();
				});
				return () => {
					this.observing = false;
					this.generation += 1;
					disposeList();
					this.sessionSourceDispose?.();
					this.sessionSourceDispose = void 0;
					this.sessionSource = void 0;
					this.sessionRevision = void 0;
					for (const cancel of [...this.navigationWaits]) cancel();
				};
			}
			bindSessionSource() {
				const source = this.sessions.binding(this.sessionId)?.session;
				if (source === this.sessionSource) return false;
				this.sessionSourceDispose?.();
				this.sessionSource = source;
				this.sessionRevision = source === void 0 ? void 0 : conversationRevision(source.getSnapshot());
				this.sessionSourceDispose = source?.subscribe(() => {
					if (this.sessionSource !== source) return;
					const revision = conversationRevision(source.getSnapshot());
					if (revision === this.sessionRevision) return;
					this.sessionRevision = revision;
					this.invalidate();
				});
				return true;
			}
			invalidate() {
				if (!this.observing || this.store.getSnapshot().status === "idle" || this.refreshScheduled) return;
				this.refreshScheduled = true;
				this.refreshTimer = setTimeout(() => {
					this.refreshTimer = void 0;
					this.refreshScheduled = false;
					if (this.observing && this.store.getSnapshot().status !== "idle") this.refresh();
				}, REFRESH_DELAY_MS);
			}
			/** Invalidation-driven refetch: one in-flight request absorbs the demand
			* and commits a single rerun once it settles. */
			refresh() {
				if (this.disposed) return;
				if (this.inflight !== null) {
					this.rerunAfter = true;
					return;
				}
				this.load();
			}
			/** Refetch the full value-level projection; concurrent callers share one
			* request, and an invalidation during flight schedules exactly one rerun. */
			async load() {
				if (this.disposed) return;
				if (this.inflight !== null) return this.inflight;
				const generation = ++this.generation;
				this.abort?.abort();
				const abort = new AbortController();
				this.abort = abort;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				const run = this.performLoad(generation, abort);
				this.inflight = run;
				try {
					await run;
				} finally {
					if (this.inflight === run) this.inflight = null;
					if (this.rerunAfter && !this.disposed) {
						this.rerunAfter = false;
						this.load();
					}
				}
			}
			async performLoad(generation, abort) {
				try {
					const timeline = decodeTimeline(await responseValue(await fetch(`${MESSAGE_EDIT_PATH}?sessionId=${encodeURIComponent(this.sessionId)}`, {
						method: "GET",
						headers: { accept: "application/json" },
						cache: "no-store",
						signal: abort.signal
					})));
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "ready";
						state.error = null;
						state.timeline = timeline;
					});
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "error";
						state.error = messageOf(error);
					});
				}
			}
			/** Refresh only controllers whose projection has already been requested. */
			refreshIfLoaded() {
				if (this.disposed || this.store.getSnapshot().status === "idle") return;
				this.refresh();
			}
			/** Read the model the chat input currently targets for this session — the
			* same value the composer's model dropdown renders and the next ordinary
			* prompt would use — so a re-execution follows it instead of the last model
			* recorded in the source history. Best effort: when the selection cannot be
			* resolved (subagent session, absent connection, RPC failure) the host falls
			* back to the history-derived route. */
			async composerRoute() {
				const connection = this.ctx.get("connection");
				if (connection === void 0 || connection.api === void 0) return void 0;
				try {
					const result = (await connection.api.sessions.models({ sessionId: this.sessionId })).result;
					if (result.ok !== true) return void 0;
					const current = result.value.current;
					if (current === void 0) return void 0;
					if (typeof current.provider !== "string" || current.provider.length === 0) return void 0;
					if (typeof current.model !== "string" || current.model.length === 0) return void 0;
					return {
						provider: current.provider,
						model: current.model
					};
				} catch {
					return;
				}
			}
			async mutate(operation) {
				const current = this.store.getSnapshot();
				if (current.pending !== null || current.status !== "ready") return false;
				this.store.update((state) => {
					state.pending = operation.action;
					state.error = null;
				});
				try {
					const route = await this.composerRoute();
					const payload = route === void 0 ? operation : {
						...operation,
						route
					};
					const result = decodeOperationResult(await responseValue(await fetch(MESSAGE_EDIT_PATH, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						body: JSON.stringify(payload)
					})));
					if (this.disposed) return true;
					this.store.update((state) => {
						state.pending = null;
					});
					await this.openWhenListed(result.sessionId);
					return true;
				} catch (error) {
					if (this.disposed) return false;
					this.store.update((state) => {
						state.pending = null;
						state.error = messageOf(error);
					});
					return false;
				}
			}
			/** Session-list publication is the reactive dependency for navigation. */
			openWhenListed(sessionId) {
				if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) {
					this.sessions.open(sessionId);
					return Promise.resolve();
				}
				return new Promise((resolve) => {
					let settled = false;
					let dispose = () => {};
					const finish = (open) => {
						if (settled) return;
						settled = true;
						dispose();
						this.navigationWaits.delete(cancel);
						if (open) this.sessions.open(sessionId);
						resolve();
					};
					const cancel = () => {
						finish(false);
					};
					this.navigationWaits.add(cancel);
					dispose = this.sessions.list.subscribe(() => {
						if (this.sessions.list.getSnapshot().byId[sessionId] === void 0) return;
						finish(true);
					});
					if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) finish(true);
				});
			}
		};
		//#endregion
		//#region \0dsh-css:/run/media/user1/78E6859DE6855BEE/code/js/dsh-message-edit/src/client/InlineMessageEdit.module.css.mjs
		const css$2 = ".Ps3QDa_overlay{z-index:1000;background:var(--dsw-alias-bg-mask,#00000073);justify-content:center;align-items:center;display:flex;position:fixed;inset:0}.Ps3QDa_panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;width:560px;padding:14px 16px}.Ps3QDa_title{color:var(--dsw-alias-label-primary);padding:4px 0 10px;font-size:13px}.Ps3QDa_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);width:100%;min-height:160px;color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;border-radius:8px;padding:10px}.Ps3QDa_footer{justify-content:flex-end;gap:8px;padding:10px 0 0;display:flex}.Ps3QDa_footer button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;padding:6px 14px}.Ps3QDa_iconButton{width:20px;height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:4px;justify-content:center;align-items:center;padding:2px;display:inline-flex}.Ps3QDa_iconButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-hover)}.Ps3QDa_picker{flex-direction:column;gap:6px;padding:4px 0 12px;display:flex}.Ps3QDa_pickerItem{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;border-radius:6px;padding:8px 10px;font-size:12px}.Ps3QDa_pickerItem:hover{background:var(--dsw-alias-bg-module-platform)}.Ps3QDa_pickerItemActive{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;align-self:flex-end;padding:6px 14px}";
		const tagId$2 = "dsh-message-edit/InlineMessageEdit.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var InlineMessageEdit_module_css_default = {
			"overlay": "Ps3QDa_overlay",
			"title": "Ps3QDa_title",
			"pickerItemActive": "Ps3QDa_pickerItemActive",
			"iconButton": "Ps3QDa_iconButton",
			"panel": "Ps3QDa_panel",
			"pickerItem": "Ps3QDa_pickerItem",
			"picker": "Ps3QDa_picker",
			"footer": "Ps3QDa_footer",
			"input": "Ps3QDa_input"
		};
		//#endregion
		//#region src/client/InlineMessageEdit.tsx
		/**
		* Message-row edit affordance: injects retry + edit icon buttons into each
		* settled message's icon-actions row (the official MessageIconActions has no
		* plugin slot, so injection rides a MutationObserver over action rows).
		* Icons are the official outline-16 SVGs inlined to avoid bundling the
		* primitives package.
		*/
		const BLOCK_TITLE = {
			user: "编辑用户消息",
			"assistant.reasoning": "编辑助手思考",
			"assistant.response": "编辑助手回复"
		};
		const STYLE = {
			overlay: InlineMessageEdit_module_css_default["overlay"] ?? "",
			panel: InlineMessageEdit_module_css_default["panel"] ?? "",
			title: InlineMessageEdit_module_css_default["title"] ?? "",
			input: InlineMessageEdit_module_css_default["input"] ?? "",
			footer: InlineMessageEdit_module_css_default["footer"] ?? "",
			iconButton: InlineMessageEdit_module_css_default["iconButton"] ?? "",
			picker: InlineMessageEdit_module_css_default["picker"] ?? "",
			pickerItem: InlineMessageEdit_module_css_default["pickerItem"] ?? "",
			pickerItemActive: InlineMessageEdit_module_css_default["pickerItemActive"] ?? ""
		};
		/** Official ic_ds_refresh_outline_16 path (dsh-client-ui-primitives). */
		const REFRESH_PATH = "M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z";
		/** Official ic_ds_edit_outline_16 path (dsh-client-ui-primitives). */
		const EDIT_PATH = "M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z";
		function svgIcon(path) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("fill", "none");
			const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p.setAttribute("d", path);
			p.setAttribute("fill", "currentColor");
			svg.appendChild(p);
			return svg;
		}
		function blockTitle(kind) {
			return BLOCK_TITLE[kind] ?? "编辑消息";
		}
		/** Mount one editor DOM effect and return its exact inverse. */
		function mountEditor(block, edit, close) {
			const overlay = document.createElement("div");
			overlay.className = STYLE.overlay;
			const panel = document.createElement("div");
			panel.className = STYLE.panel;
			const title = document.createElement("div");
			title.className = STYLE.title;
			title.textContent = blockTitle(block.kind);
			const input = document.createElement("textarea");
			input.className = STYLE.input;
			input.value = block.text;
			const footer = document.createElement("div");
			footer.className = STYLE.footer;
			const save = document.createElement("button");
			save.textContent = "保存";
			const cancel = document.createElement("button");
			cancel.textContent = "取消";
			footer.append(save, cancel);
			panel.append(title, input, footer);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			let mounted = true;
			let saving = false;
			const saveEdit = () => {
				if (saving) return;
				saving = true;
				save.disabled = true;
				edit(block, input.value, "truncate").then((applied) => {
					if (!mounted) return;
					if (applied) {
						close();
						return;
					}
					saving = false;
					save.disabled = false;
				});
			};
			const cancelEdit = () => {
				close();
			};
			const dismiss = (event) => {
				if (event.target === overlay) close();
			};
			save.addEventListener("click", saveEdit);
			cancel.addEventListener("click", cancelEdit);
			overlay.addEventListener("click", dismiss);
			return () => {
				mounted = false;
				save.removeEventListener("click", saveEdit);
				cancel.removeEventListener("click", cancelEdit);
				overlay.removeEventListener("click", dismiss);
				overlay.remove();
			};
		}
		/** Mount one block-picker DOM effect and return its exact inverse. */
		function mountPicker(blocks, select, close) {
			const overlay = document.createElement("div");
			overlay.className = STYLE.overlay;
			const panel = document.createElement("div");
			panel.className = STYLE.panel;
			const title = document.createElement("div");
			title.className = STYLE.title;
			title.textContent = blocks.some((block) => block.kind === "user") ? "编辑消息" : "编辑助手消息";
			const picker = document.createElement("div");
			picker.className = STYLE.picker;
			const itemListeners = [];
			for (const block of blocks) {
				const item = document.createElement("button");
				item.className = STYLE.pickerItem;
				item.textContent = `${blockTitle(block.kind)}：${block.text.slice(0, 24)}${block.text.length > 24 ? "…" : ""}`;
				const listener = () => {
					select(block);
				};
				item.addEventListener("click", listener);
				itemListeners.push({
					item,
					listener
				});
				picker.appendChild(item);
			}
			const cancel = document.createElement("button");
			cancel.textContent = "取消";
			cancel.className = STYLE.pickerItemActive;
			const cancelPicker = () => {
				close();
			};
			cancel.addEventListener("click", cancelPicker);
			panel.append(title, picker, cancel);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			return () => {
				for (const { item, listener } of itemListeners) item.removeEventListener("click", listener);
				cancel.removeEventListener("click", cancelPicker);
				overlay.remove();
			};
		}
		/** Compose every overlay with a single idempotent active inverse. */
		function createOverlayHost(edit) {
			let active;
			const mount = (effect) => {
				active?.();
				let cleanup = () => {};
				let mounted = true;
				const close = () => {
					if (!mounted) return;
					mounted = false;
					cleanup();
					if (active === close) active = void 0;
				};
				active = close;
				try {
					cleanup = effect(close);
				} catch (error) {
					active = void 0;
					mounted = false;
					throw error;
				}
			};
			const editBlock = (block) => {
				mount((close) => mountEditor(block, edit, close));
			};
			const chooseBlock = (blocks) => {
				mount((close) => mountPicker(blocks, (block) => {
					close();
					editBlock(block);
				}, close));
			};
			return {
				editBlock,
				chooseBlock,
				dispose: () => {
					active?.();
				}
			};
		}
		/** Inject retry + edit icon buttons into each message action row. */
		function InlineMessageEdit({ messages, edit, retry }) {
			(0, react.useEffect)(() => {
				const cleanups = [];
				const overlays = createOverlayHost(edit);
				let observer;
				let alive = true;
				let frame;
				let scheduled = false;
				const sync = () => {
					const actionRows = Array.from(document.querySelectorAll("[class*=\"actions\"]"));
					const claimedEvents = /* @__PURE__ */ new Set();
					for (const row of actionRows) {
						const marker = row;
						if (marker.__messageEditInjected === true) {
							if (marker.__messageEditEventSeq !== void 0) claimedEvents.add(marker.__messageEditEventSeq);
							continue;
						}
						const text = (row.parentElement?.parentElement?.textContent ?? "").trim();
						if (text.length === 0) continue;
						const eventSeq = [...new Set(messages.filter((message) => message.text.length > 0 && text.includes(message.text.slice(0, 24))).map((message) => message.eventSeq))].find((candidate) => !claimedEvents.has(candidate));
						if (eventSeq === void 0) continue;
						const blocks = messages.filter((message) => message.eventSeq === eventSeq);
						if (blocks.length === 0) continue;
						const previousMarker = marker.__messageEditInjected;
						const previousEventSeq = marker.__messageEditEventSeq;
						marker.__messageEditInjected = true;
						marker.__messageEditEventSeq = eventSeq;
						claimedEvents.add(eventSeq);
						const editButton = document.createElement("button");
						editButton.className = STYLE.iconButton;
						editButton.setAttribute("aria-label", "编辑消息");
						editButton.title = "编辑消息";
						editButton.appendChild(svgIcon(EDIT_PATH));
						const editMessage = () => {
							if (blocks.length === 1 && blocks[0] !== void 0) overlays.editBlock(blocks[0]);
							else overlays.chooseBlock(blocks);
						};
						editButton.addEventListener("click", editMessage);
						const retryButton = document.createElement("button");
						retryButton.className = STYLE.iconButton;
						retryButton.setAttribute("aria-label", "重试此回合");
						retryButton.title = "重试此回合";
						retryButton.appendChild(svgIcon(REFRESH_PATH));
						const turn = blocks[0]?.turn;
						const retryTurn = () => {
							if (turn !== void 0) retry(turn, "truncate");
						};
						retryButton.addEventListener("click", retryTurn);
						const lastOfficial = Array.from(row.querySelectorAll("button")).filter((button) => button !== editButton && button !== retryButton).at(-1);
						if (lastOfficial !== void 0) {
							lastOfficial.insertAdjacentElement("afterend", retryButton);
							lastOfficial.insertAdjacentElement("afterend", editButton);
						} else {
							row.appendChild(editButton);
							row.appendChild(retryButton);
						}
						cleanups.push(() => {
							editButton.removeEventListener("click", editMessage);
							retryButton.removeEventListener("click", retryTurn);
							editButton.remove();
							retryButton.remove();
							if (previousMarker === void 0) delete marker.__messageEditInjected;
							else marker.__messageEditInjected = previousMarker;
							if (previousEventSeq === void 0) delete marker.__messageEditEventSeq;
							else marker.__messageEditEventSeq = previousEventSeq;
						});
					}
				};
				sync();
				observer = new MutationObserver(() => {
					if (!alive || scheduled) return;
					scheduled = true;
					frame = requestAnimationFrame(() => {
						frame = void 0;
						scheduled = false;
						if (alive) sync();
					});
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					alive = false;
					if (frame !== void 0) cancelAnimationFrame(frame);
					observer?.disconnect();
					overlays.dispose();
					for (const cleanup of cleanups.reverse()) cleanup();
				};
			}, [
				messages,
				edit,
				retry
			]);
			return null;
		}
		//#endregion
		//#region \0dsh-css:/run/media/user1/78E6859DE6855BEE/code/js/dsh-message-edit/src/client/MessageEditHeader.module.css.mjs
		const css$1 = ".ovpcJa_root{align-items:center;gap:4px;display:inline-flex}.ovpcJa_iconButton,.ovpcJa_rerollButton{box-sizing:border-box;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0}.ovpcJa_iconButton{border-radius:50%;justify-content:center;align-items:center;width:28px;height:28px;font-size:16px;line-height:20px;display:inline-flex}.ovpcJa_rerollButton{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:18px}.ovpcJa_iconButton:hover:not(:disabled),.ovpcJa_rerollButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.ovpcJa_iconButton:focus-visible,.ovpcJa_rerollButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.ovpcJa_iconButton:disabled,.ovpcJa_rerollButton:disabled{cursor:default;opacity:.4}.ovpcJa_counter{min-width:108px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:11px;line-height:18px}@media (width<=760px){.ovpcJa_counter{display:none}}";
		const tagId$1 = "dsh-message-edit/MessageEditHeader.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var MessageEditHeader_module_css_default = {
			"root": "ovpcJa_root",
			"rerollButton": "ovpcJa_rerollButton",
			"counter": "ovpcJa_counter",
			"iconButton": "ovpcJa_iconButton"
		};
		//#endregion
		//#region src/client/MessageEditHeader.tsx
		/** Header contribution shared with the Timeline controller. */
		function MessageEditHeader({ useMessageEdit, acquire, load, openVersion, reroll, edit, retry }) {
			const state = useMessageEdit((value) => value);
			(0, react.useEffect)(() => {
				const release = acquire();
				load();
				return release;
			}, [acquire, load]);
			const timeline = state.timeline;
			const versions = state.timeline?.versions ?? [];
			const undoSessionId = timeline?.undoStack[0];
			const redoSessionId = timeline?.redoSessionIds.at(-1);
			const effectDepth = timeline?.undoStack.length ?? 0;
			const busy = state.pending !== null || state.status !== "ready";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InlineMessageEdit, {
				messages: state.status === "ready" && state.pending === null ? timeline?.messages ?? [] : [],
				edit,
				retry
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MessageEditHeader_module_css_default["root"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["iconButton"],
						"aria-label": "撤销当前版本效果",
						title: "撤销当前效果，保留更早效果",
						disabled: undoSessionId === void 0 || busy,
						onClick: () => {
							if (undoSessionId !== void 0) openVersion(undoSessionId);
						},
						children: "←"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MessageEditHeader_module_css_default["counter"],
						children: versions.length === 0 ? "效果 —" : `效果 ${String(effectDepth)} 层 · ${String(versions.length)} 版`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["iconButton"],
						"aria-label": "重施加下一版本效果",
						title: timeline !== null && timeline.redoSessionIds.length > 1 ? `重施加最新效果（另有 ${String(timeline.redoSessionIds.length - 1)} 个分支）` : "重施加下一效果",
						disabled: redoSessionId === void 0 || busy,
						onClick: () => {
							if (redoSessionId !== void 0) openVersion(redoSessionId);
						},
						children: "→"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditHeader_module_css_default["rerollButton"],
						disabled: busy || state.timeline === null,
						onClick: () => {
							reroll();
						},
						children: state.pending === "reroll" ? "正在重生成…" : "重生成"
					})
				]
			})] });
		}
		//#endregion
		//#region \0dsh-css:/run/media/user1/78E6859DE6855BEE/code/js/dsh-message-edit/src/client/MessageEditTimelineView.module.css.mjs
		const css = ".hbVeaa_root{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:24px;overflow:auto}.hbVeaa_pageHeader{justify-content:space-between;align-items:flex-start;gap:20px;max-width:1480px;margin:0 auto 16px;display:flex}.hbVeaa_title,.hbVeaa_intro,.hbVeaa_subtitle,.hbVeaa_notice,.hbVeaa_error,.hbVeaa_empty,.hbVeaa_turnTitle,.hbVeaa_turnPreview,.hbVeaa_messageText{margin:0}.hbVeaa_title{font-size:22px;font-weight:600;line-height:30px}.hbVeaa_intro{max-width:700px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}.hbVeaa_headerActions{flex:none;align-items:flex-end;gap:8px;display:flex}.hbVeaa_cascadeField{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:11px;line-height:16px;display:flex}.hbVeaa_select,.hbVeaa_textarea,.hbVeaa_primaryButton,.hbVeaa_secondaryButton,.hbVeaa_textButton,.hbVeaa_versionButton{box-sizing:border-box;font:inherit}.hbVeaa_select,.hbVeaa_textarea{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:8px}.hbVeaa_select{height:34px;padding:0 30px 0 9px;font-size:12px}.hbVeaa_primaryButton,.hbVeaa_secondaryButton,.hbVeaa_textButton,.hbVeaa_versionButton{cursor:pointer;border:0}.hbVeaa_primaryButton,.hbVeaa_secondaryButton{border-radius:17px;justify-content:center;align-items:center;min-height:34px;padding:0 13px;font-size:12px;line-height:18px;display:inline-flex}.hbVeaa_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}.hbVeaa_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.hbVeaa_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.hbVeaa_secondaryButton:hover:not(:disabled),.hbVeaa_textButton:hover:not(:disabled),.hbVeaa_versionButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hbVeaa_primaryButton:disabled,.hbVeaa_secondaryButton:disabled,.hbVeaa_textButton:disabled,.hbVeaa_versionButton:disabled,.hbVeaa_select:disabled{cursor:default;opacity:.45}.hbVeaa_primaryButton:focus-visible,.hbVeaa_secondaryButton:focus-visible,.hbVeaa_textButton:focus-visible,.hbVeaa_versionButton:focus-visible,.hbVeaa_select:focus-visible,.hbVeaa_textarea:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.hbVeaa_notice,.hbVeaa_error{max-width:1480px;margin:0 auto 10px;font-size:12px;line-height:18px}.hbVeaa_notice{color:var(--dsw-alias-state-warn-label)}.hbVeaa_error{color:var(--dsw-alias-state-error-primary)}.hbVeaa_status{box-sizing:border-box;width:100%;height:100%;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;align-items:flex-start;gap:12px;padding:24px;display:flex}.hbVeaa_status .hbVeaa_error{margin:0}.hbVeaa_columns{grid-template-columns:minmax(280px,.72fr) minmax(520px,1.75fr);align-items:start;gap:18px;max-width:1480px;margin:0 auto;display:grid}.hbVeaa_versionsPanel,.hbVeaa_turnsPanel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0;padding:16px}.hbVeaa_versionsPanel{position:sticky;top:0}.hbVeaa_sectionHeading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;display:flex}.hbVeaa_effectControls{background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:8px;margin-bottom:12px;padding:10px;display:flex}.hbVeaa_effectDepth{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}.hbVeaa_effectButtons{flex-wrap:wrap;gap:6px;display:flex}.hbVeaa_effectButtons .hbVeaa_secondaryButton{min-height:28px;padding:0 10px;font-size:11px}.hbVeaa_subtitle{font-size:16px;font-weight:500;line-height:24px}.hbVeaa_count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hbVeaa_versionList,.hbVeaa_turnList{margin:0;padding:0;list-style:none}.hbVeaa_versionList{flex-direction:column;gap:4px;display:flex}.hbVeaa_versionItem{--message-edit-depth:0;padding-left:calc(var(--message-edit-depth) * 14px);position:relative}.hbVeaa_versionButton{width:100%;min-width:0;color:var(--dsw-alias-label-secondary);text-align:left;background:0 0;border-radius:9px;align-items:flex-start;gap:9px;padding:9px;display:flex;position:relative}.hbVeaa_versionButton[data-current]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);opacity:1}.hbVeaa_versionButton:not([data-current]) .hbVeaa_pathBadge{opacity:.8}.hbVeaa_versionLine{background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:0;bottom:0;left:14px}.hbVeaa_versionDot{z-index:1;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:7px;height:7px;margin-top:6px}.hbVeaa_versionButton[data-current] .hbVeaa_versionDot{border-color:var(--dsw-alias-bg-module-platform);background:var(--dsw-alias-brand-primary)}.hbVeaa_versionMain{flex-direction:column;flex:1;min-width:0;display:flex}.hbVeaa_versionTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.hbVeaa_versionMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;overflow:hidden}.hbVeaa_versionDiff{color:var(--dsw-alias-label-tertiary);flex-direction:column;gap:2px;margin-top:5px;font-size:10px;line-height:15px;display:flex}.hbVeaa_versionDiff span{-webkit-line-clamp:2;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.hbVeaa_currentBadge,.hbVeaa_pathBadge,.hbVeaa_kindBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}.hbVeaa_currentBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_pathBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_turnList{flex-direction:column;gap:14px;display:flex}.hbVeaa_turnSection{border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:13px}.hbVeaa_turnHeader,.hbVeaa_messageHeader,.hbVeaa_editorActions{justify-content:space-between;align-items:center;gap:10px;display:flex}.hbVeaa_turnHeader{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start;padding-bottom:11px}.hbVeaa_turnTitle{font-size:14px;font-weight:500;line-height:22px}.hbVeaa_turnPreview{max-width:700px;color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:2;white-space:pre-wrap;-webkit-box-orient:vertical;font-size:11px;line-height:17px;display:-webkit-box;overflow:hidden}.hbVeaa_messageList{flex-direction:column;gap:8px;margin-top:10px;display:flex}.hbVeaa_messageCard{background:var(--dsw-alias-bg-module-platform);border-radius:9px;padding:10px}.hbVeaa_messageHeader{justify-content:flex-start}.hbVeaa_kindBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_kindBadge[data-kind=assistant\\.reasoning]{color:var(--dsw-alias-label-tertiary)}.hbVeaa_messageTime{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:17px}.hbVeaa_textButton{color:var(--dsw-alias-label-secondary);background:0 0;border-radius:12px;margin-left:auto;padding:3px 8px;font-size:11px;line-height:17px}.hbVeaa_messageText{max-height:220px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;font-family:inherit;font-size:12px;line-height:19px;overflow:auto}.hbVeaa_editor{margin-top:8px}.hbVeaa_textarea{resize:vertical;width:100%;min-height:120px;padding:9px;font-size:12px;line-height:19px}.hbVeaa_editorActions{margin-top:8px}.hbVeaa_editorHint{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.hbVeaa_empty{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:18px;font-size:13px;line-height:20px}@media (width<=1000px){.hbVeaa_columns{grid-template-columns:1fr}.hbVeaa_versionsPanel{position:static}}@media (width<=680px){.hbVeaa_root{padding:16px}.hbVeaa_pageHeader,.hbVeaa_headerActions,.hbVeaa_turnHeader,.hbVeaa_editorActions{flex-direction:column;align-items:stretch}.hbVeaa_headerActions,.hbVeaa_primaryButton,.hbVeaa_secondaryButton{width:100%}}.hbVeaa_changeSummary{align-items:center;gap:8px;display:flex}.hbVeaa_changeChip{color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:17px}.hbVeaa_newBadge,.hbVeaa_editedBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}.hbVeaa_newBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_editedBadge{color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_messageSpacer{flex:1}.hbVeaa_textButton[data-danger]{color:var(--dsw-alias-state-error-primary)}.hbVeaa_turnActions{flex-wrap:wrap;flex:none;justify-content:flex-end;gap:6px;display:flex}.hbVeaa_turnActions .hbVeaa_secondaryButton{min-height:28px;padding:0 10px;font-size:11px}.hbVeaa_composerFooter{border-top:1px dashed var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}.hbVeaa_emptyState{flex-direction:column;align-items:flex-start;gap:10px;display:flex}.hbVeaa_messageCard[data-added]{border:1px dashed var(--dsw-alias-brand-primary)}";
		const tagId = "dsh-message-edit/MessageEditTimelineView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MessageEditTimelineView_module_css_default = {
			"status": "hbVeaa_status",
			"editorActions": "hbVeaa_editorActions",
			"emptyState": "hbVeaa_emptyState",
			"turnPreview": "hbVeaa_turnPreview",
			"select": "hbVeaa_select",
			"versionsPanel": "hbVeaa_versionsPanel",
			"kindBadge": "hbVeaa_kindBadge",
			"newBadge": "hbVeaa_newBadge",
			"notice": "hbVeaa_notice",
			"cascadeField": "hbVeaa_cascadeField",
			"headerActions": "hbVeaa_headerActions",
			"composerFooter": "hbVeaa_composerFooter",
			"currentBadge": "hbVeaa_currentBadge",
			"versionButton": "hbVeaa_versionButton",
			"changeChip": "hbVeaa_changeChip",
			"secondaryButton": "hbVeaa_secondaryButton",
			"title": "hbVeaa_title",
			"error": "hbVeaa_error",
			"empty": "hbVeaa_empty",
			"turnSection": "hbVeaa_turnSection",
			"root": "hbVeaa_root",
			"editedBadge": "hbVeaa_editedBadge",
			"textarea": "hbVeaa_textarea",
			"intro": "hbVeaa_intro",
			"editorHint": "hbVeaa_editorHint",
			"effectButtons": "hbVeaa_effectButtons",
			"sectionHeading": "hbVeaa_sectionHeading",
			"columns": "hbVeaa_columns",
			"turnList": "hbVeaa_turnList",
			"messageList": "hbVeaa_messageList",
			"messageCard": "hbVeaa_messageCard",
			"versionDiff": "hbVeaa_versionDiff",
			"messageTime": "hbVeaa_messageTime",
			"primaryButton": "hbVeaa_primaryButton",
			"turnHeader": "hbVeaa_turnHeader",
			"changeSummary": "hbVeaa_changeSummary",
			"count": "hbVeaa_count",
			"messageText": "hbVeaa_messageText",
			"pageHeader": "hbVeaa_pageHeader",
			"effectDepth": "hbVeaa_effectDepth",
			"pathBadge": "hbVeaa_pathBadge",
			"turnTitle": "hbVeaa_turnTitle",
			"versionDot": "hbVeaa_versionDot",
			"subtitle": "hbVeaa_subtitle",
			"versionTitle": "hbVeaa_versionTitle",
			"effectControls": "hbVeaa_effectControls",
			"turnsPanel": "hbVeaa_turnsPanel",
			"editor": "hbVeaa_editor",
			"turnActions": "hbVeaa_turnActions",
			"versionMain": "hbVeaa_versionMain",
			"messageSpacer": "hbVeaa_messageSpacer",
			"versionMeta": "hbVeaa_versionMeta",
			"versionItem": "hbVeaa_versionItem",
			"versionList": "hbVeaa_versionList",
			"textButton": "hbVeaa_textButton",
			"versionLine": "hbVeaa_versionLine",
			"messageHeader": "hbVeaa_messageHeader"
		};
		//#endregion
		//#region src/client/MessageEditTimelineView.tsx
		/** Timeline tab: durable version tree plus free CRUD over finalized messages,
		* committed as a forked version that regenerates replies. */
		const BLOCK_LABEL = {
			user: "用户消息",
			"assistant.reasoning": "助手思考",
			"assistant.response": "助手回复"
		};
		const OPERATION_LABEL = {
			edit: "编辑",
			reroll: "重生成",
			retry: "重试",
			fork: "Fork"
		};
		function timeLabel(value) {
			return new Date(value).toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
		}
		function addedRow(kind) {
			return {
				key: `new-${crypto.randomUUID()}`,
				kind,
				text: "",
				added: true
			};
		}
		function changeSummaryText(changes) {
			const parts = [];
			if (changes.added > 0) parts.push(`新增 ${String(changes.added)}`);
			if (changes.edited > 0) parts.push(`编辑 ${String(changes.edited)}`);
			if (changes.deleted > 0) parts.push(`删除 ${String(changes.deleted)}`);
			return parts.join(" · ");
		}
		/** Group draft rows into sections: a user row starts a section and assistant
		* rows attach to the section started by the nearest previous user row. */
		function buildSections(rows, baseline, retryableTurns) {
			const retryable = new Map(retryableTurns.map((turn) => [turn.turn, turn]));
			const sections = [];
			let addedCount = 0;
			for (const row of rows) {
				if (row.kind !== "user" && sections.length > 0) {
					const last = sections[sections.length - 1];
					if (last !== void 0) last.rows.push(row);
					continue;
				}
				const section = {
					id: row.kind === "user" && row.added ? `added-${String(addedCount += 1)}` : row.turn === void 0 ? `row-${row.key}` : `turn-${String(row.turn)}`,
					turnLabel: row.kind === "user" ? row.added ? "新增回合" : `回合 ${String(row.turn ?? "?")}` : row.turn === void 0 ? "无用户回合" : `回合 ${String(row.turn)}`,
					preview: row.text,
					rows: [row]
				};
				sections.push(section);
			}
			for (const section of sections) {
				const head = section.rows[0];
				if (head === void 0) continue;
				section.preview = (section.rows.find((row) => row.kind === "user") ?? head).text;
				const unchanged = section.rows.every((row) => !row.added && baseline.get(row.key)?.text === row.text);
				if (head.kind === "user" && !head.added && head.turn !== void 0 && unchanged) {
					const retry = retryable.get(head.turn);
					if (retry !== void 0) section.retry = retry;
				}
			}
			return sections;
		}
		function VersionRow({ version, disabled, onOpen }) {
			const depthStyle = { "--message-edit-depth": String(version.depth) };
			const operation = version.operation === void 0 ? version.parentSessionId === void 0 ? "原始版本" : "外部分支" : OPERATION_LABEL[version.operation];
			const target = version.operation === "fork" ? version.rowCount === void 0 ? null : ` · ${String(version.rowCount)} 条消息` : version.targetTurn === void 0 ? null : ` · 回合 ${String(version.targetTurn)}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: MessageEditTimelineView_module_css_default["versionItem"],
				style: depthStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: MessageEditTimelineView_module_css_default["versionButton"],
					"data-current": version.current || void 0,
					disabled: version.current || disabled,
					onClick: () => {
						onOpen(version.sessionId);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["versionLine"],
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["versionDot"],
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: MessageEditTimelineView_module_css_default["versionMain"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionTitle"],
									children: [operation, target]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionMeta"],
									children: [
										timeLabel(version.createdAt),
										" · ",
										version.sessionId.slice(0, 12)
									]
								}),
								version.before === void 0 && version.after === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["versionDiff"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["原：", version.before || "（空）"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["新：", version.after || "（空）"] })]
								})
							]
						}),
						version.current ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["currentBadge"],
							children: "当前"
						}) : version.onCurrentEffectPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["pathBadge"],
							children: "效果链"
						}) : null
					]
				})
			});
		}
		function MessageCard({ row, baseline, editing, disabled, onBeginEdit, onCancelEdit, onTextChange, onApplyEdit, onDelete }) {
			const active = editing?.key === row.key;
			const edited = !row.added && baseline !== void 0 && baseline.text !== row.text;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: MessageEditTimelineView_module_css_default["messageCard"],
				"data-added": row.added || void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["messageHeader"],
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["kindBadge"],
							"data-kind": row.kind,
							children: BLOCK_LABEL[row.kind]
						}),
						row.added ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["newBadge"],
							children: "新增"
						}) : edited ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["editedBadge"],
							children: "已修改"
						}) : null,
						row.added || baseline === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["messageTime"],
							children: timeLabel(baseline.time)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["messageSpacer"],
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["textButton"],
							disabled,
							onClick: () => {
								active ? onCancelEdit() : onBeginEdit(row);
							},
							children: active ? "取消" : "编辑"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["textButton"],
							"data-danger": true,
							disabled,
							title: row.kind === "user" ? "删除该回合及其全部消息" : "删除这条消息",
							onClick: () => {
								onDelete(row);
							},
							children: "删除"
						})
					]
				}), active && editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["editor"],
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: MessageEditTimelineView_module_css_default["textarea"],
						value: editing.text,
						rows: 6,
						autoFocus: true,
						onChange: (event) => {
							onTextChange(event.currentTarget.value);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MessageEditTimelineView_module_css_default["editorActions"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["editorHint"],
							children: row.added ? "新消息只存在于草稿，点击 Fork 后进入新版本历史。" : "修改只保存在草稿，点击 Fork 后生成新版本；原版本保持不变。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageEditTimelineView_module_css_default["primaryButton"],
							disabled: disabled || editing.text.length === 0,
							onClick: () => {
								onApplyEdit(row, editing.text);
							},
							children: row.added ? "添加" : "完成编辑"
						})]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: MessageEditTimelineView_module_css_default["messageText"],
					children: row.text || "（空内容）"
				})]
			});
		}
		/** Conversation view entry: the durable version timeline plus the message composer. */
		function MessageEditTimelineView({ useMessageEdit, acquire, load, retry, reroll, fork, openVersion }) {
			const state = useMessageEdit((value) => value);
			const [cascade, setCascade] = (0, react.useState)("truncate");
			const [editing, setEditing] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const release = acquire();
				load();
				return release;
			}, [acquire, load]);
			const timeline = state.timeline;
			const baseline = (0, react.useMemo)(() => new Map((timeline?.messages ?? []).map((message) => [message.key, message])), [timeline]);
			const baselineRows = (0, react.useMemo)(() => (timeline?.messages ?? []).map((message) => ({
				key: message.key,
				kind: message.kind,
				text: message.text,
				turn: message.turn,
				added: false
			})), [timeline]);
			/** Identity of the loaded history; a change means the user switched versions
			* or new turns finalized, so the local draft re-syncs from the baseline. */
			const signature = (0, react.useMemo)(() => timeline === null ? "" : `${timeline.sessionId}|${timeline.messages.map((message) => message.key).join(",")}`, [timeline]);
			(0, react.useEffect)(() => {
				setDraft((current) => current?.signature === signature ? current : {
					signature,
					rows: baselineRows
				});
			}, [signature, baselineRows]);
			const rows = draft?.rows ?? baselineRows;
			const sections = (0, react.useMemo)(() => buildSections(rows, baseline, timeline?.retryableTurns ?? []), [
				rows,
				baseline,
				timeline
			]);
			const changes = (0, react.useMemo)(() => {
				let added = 0;
				let edited = 0;
				let deleted = 0;
				const present = /* @__PURE__ */ new Set();
				for (const row of rows) {
					if (row.added) {
						added += 1;
						continue;
					}
					present.add(row.key);
					const original = baseline.get(row.key);
					if (original === void 0 || original.text !== row.text) edited += 1;
				}
				for (const key of baseline.keys()) if (!present.has(key)) deleted += 1;
				return {
					added,
					edited,
					deleted,
					hasChanges: added + edited + deleted > 0
				};
			}, [rows, baseline]);
			const busy = state.pending !== null || state.status !== "ready";
			/** Settle an added row left behind when the editor moves away: an empty
			* buffer discards the row, a filled buffer keeps it in the draft. */
			const settleAddedRow = (current, leaving) => {
				if (leaving === void 0 || !leaving.added) return;
				setDraft({
					signature,
					rows: current.text.length === 0 ? rows.filter((candidate) => candidate.key !== current.key) : rows.map((candidate) => candidate.key === current.key ? {
						...candidate,
						text: current.text
					} : candidate)
				});
			};
			const beginEdit = (row) => {
				const current = editing;
				setEditing({
					key: row.key,
					text: row.text
				});
				if (current === null) return;
				settleAddedRow(current, rows.find((candidate) => candidate.key === current.key));
			};
			const cancelEdit = () => {
				const current = editing;
				setEditing(null);
				if (current === null) return;
				if (rows.find((candidate) => candidate.key === current.key)?.added === true) setDraft({
					signature,
					rows: rows.filter((candidate) => candidate.key !== current.key)
				});
			};
			const applyEdit = (row, text) => {
				setEditing(null);
				setDraft({
					signature,
					rows: rows.map((candidate) => candidate.key === row.key ? {
						...candidate,
						text
					} : candidate)
				});
			};
			const deleteRow = (row) => {
				if (editing?.key === row.key) setEditing(null);
				if (row.kind !== "user") {
					setDraft({
						signature,
						rows: rows.filter((candidate) => candidate.key !== row.key)
					});
					return;
				}
				const section = sections.find((candidate) => candidate.rows.some((candidateRow) => candidateRow.key === row.key));
				const doomed = new Set(section?.rows.map((candidateRow) => candidateRow.key) ?? [row.key]);
				setDraft({
					signature,
					rows: rows.filter((candidate) => !doomed.has(candidate.key))
				});
			};
			const addRow = (kind, afterKey) => {
				const row = addedRow(kind);
				const next = [...rows];
				if (afterKey === null) next.push(row);
				else {
					const index = next.findIndex((candidate) => candidate.key === afterKey);
					next.splice(index === -1 ? next.length : index + 1, 0, row);
				}
				setDraft({
					signature,
					rows: next
				});
				setEditing({
					key: row.key,
					text: ""
				});
			};
			const resetDraft = () => {
				setEditing(null);
				setDraft({
					signature,
					rows: baselineRows
				});
			};
			const forkRows = () => rows.map((row) => ({
				kind: row.kind,
				text: row.text
			}));
			const lastRow = rows[rows.length - 1];
			const forkLabel = state.pending === "fork" ? "正在 Fork…" : lastRow === void 0 ? "Fork 空白历史" : lastRow.kind === "user" ? "Fork 生成回复" : "Fork（不生成回复）";
			if (timeline === null || state.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MessageEditTimelineView_module_css_default["status"],
				children: [
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "正在加载会话时间线…" }) : null,
					state.status === "error" && state.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MessageEditTimelineView_module_css_default["error"],
						children: state.error
					}) : null,
					state.status === "idle" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "正在等待会话时间线…" }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditTimelineView_module_css_default["secondaryButton"],
						disabled: state.status === "loading",
						onClick: () => {
							load();
						},
						children: "重新加载"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MessageEditTimelineView_module_css_default["root"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: MessageEditTimelineView_module_css_default["pageHeader"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: MessageEditTimelineView_module_css_default["title"],
							children: "消息编辑与重生成"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: MessageEditTimelineView_module_css_default["intro"],
							children: "在右列自由增删改已落定消息，Fork 按当前内容重建消息历史并生成新版本；以用户消息结尾时， 新版本会生成新的助手回复。每次修改与其恢复版本成对记录，原版本保持不变。"
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MessageEditTimelineView_module_css_default["headerActions"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: MessageEditTimelineView_module_css_default["cascadeField"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "重试后续策略" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: MessageEditTimelineView_module_css_default["select"],
										value: cascade,
										onChange: (event) => {
											setCascade(event.currentTarget.value);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "truncate",
											children: "截断后续回合"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "preserve",
											children: "保留后续用户输入"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["primaryButton"],
									disabled: busy || editing !== null || !changes.hasChanges,
									title: "按右列当前内容重建消息历史并生成新版本；结尾的用户消息会触发新的助手回复",
									onClick: () => {
										fork(forkRows());
									},
									children: forkLabel
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["secondaryButton"],
									disabled: busy,
									onClick: () => {
										reroll();
									},
									children: state.pending === "reroll" ? "正在重生成…" : "重生成最后回复"
								})
							]
						})]
					}),
					state.error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MessageEditTimelineView_module_css_default["error"],
						children: state.error
					}),
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MessageEditTimelineView_module_css_default["notice"],
						children: "正在刷新时间线…"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MessageEditTimelineView_module_css_default["columns"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: MessageEditTimelineView_module_css_default["versionsPanel"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MessageEditTimelineView_module_css_default["sectionHeading"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: MessageEditTimelineView_module_css_default["subtitle"],
									children: "版本时间线"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MessageEditTimelineView_module_css_default["count"],
									children: String(timeline.versions.length)
								})]
							}), timeline.versions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MessageEditTimelineView_module_css_default["empty"],
								children: "当前会话还没有可记录的版本。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
								className: MessageEditTimelineView_module_css_default["versionList"],
								children: timeline.versions.map((version) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionRow, {
									version,
									disabled: busy,
									onOpen: (sessionId) => {
										openVersion(sessionId);
									}
								}, version.sessionId))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
							className: MessageEditTimelineView_module_css_default["turnsPanel"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MessageEditTimelineView_module_css_default["sectionHeading"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: MessageEditTimelineView_module_css_default["subtitle"],
									children: "已落定消息"
								}), changes.hasChanges ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MessageEditTimelineView_module_css_default["changeSummary"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MessageEditTimelineView_module_css_default["changeChip"],
										children: changeSummaryText(changes)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: MessageEditTimelineView_module_css_default["textButton"],
										disabled: busy,
										onClick: resetDraft,
										children: "重置"
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MessageEditTimelineView_module_css_default["count"],
									children: String(timeline.messages.length)
								})]
							}), sections.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MessageEditTimelineView_module_css_default["emptyState"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: MessageEditTimelineView_module_css_default["empty"],
									children: baseline.size === 0 ? "当前会话还没有已落定消息。" : "所有消息都已删除；Fork 将创建一个空白历史分支。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["secondaryButton"],
									disabled: busy,
									onClick: () => {
										addRow("user", null);
									},
									children: "＋ 添加用户消息"
								})]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
								className: MessageEditTimelineView_module_css_default["turnList"],
								children: sections.map((section) => {
									const retryTurn = section.retry;
									const tailKey = section.rows[section.rows.length - 1]?.key;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: MessageEditTimelineView_module_css_default["turnSection"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: MessageEditTimelineView_module_css_default["turnHeader"],
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												className: MessageEditTimelineView_module_css_default["turnTitle"],
												children: section.turnLabel
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: MessageEditTimelineView_module_css_default["turnPreview"],
												children: section.preview || "（空内容）"
											})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: MessageEditTimelineView_module_css_default["turnActions"],
												children: [
													retryTurn === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: MessageEditTimelineView_module_css_default["secondaryButton"],
														disabled: busy,
														onClick: () => {
															retry(retryTurn.turn, cascade);
														},
														children: state.pending === "retry" ? "正在重试…" : "重试此回合"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: MessageEditTimelineView_module_css_default["secondaryButton"],
														disabled: busy,
														title: "在此回合之后插入一条新的用户消息",
														onClick: () => {
															if (tailKey !== void 0) addRow("user", tailKey);
														},
														children: "＋ 用户消息"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: MessageEditTimelineView_module_css_default["secondaryButton"],
														disabled: busy,
														title: "为此回合追加一条助手回复",
														onClick: () => {
															if (tailKey !== void 0) addRow("assistant.response", tailKey);
														},
														children: "＋ 助手回复"
													})
												]
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: MessageEditTimelineView_module_css_default["messageList"],
											children: section.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageCard, {
												row,
												baseline: baseline.get(row.key),
												editing,
												disabled: busy,
												onBeginEdit: beginEdit,
												onCancelEdit: cancelEdit,
												onTextChange: (text) => {
													setEditing((current) => current === null ? null : {
														...current,
														text
													});
												},
												onApplyEdit: applyEdit,
												onDelete: deleteRow
											}, row.key))
										})]
									}, section.id);
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MessageEditTimelineView_module_css_default["composerFooter"],
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MessageEditTimelineView_module_css_default["secondaryButton"],
									disabled: busy,
									onClick: () => {
										addRow("user", null);
									},
									children: "＋ 在末尾添加用户消息"
								})
							})] })]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Explicit value sources and slot declaration-order edges. */
		const inject = [
			"slots",
			"conversation",
			"connection",
			"sessions"
		];
		/** Register both UI contributions over one per-session controller identity. */
		function apply(ctx) {
			const controllers = /* @__PURE__ */ new Map();
			const controllerFor = (sessionId) => {
				let controller = controllers.get(sessionId);
				if (controller === void 0) {
					controller = new MessageEditController(ctx, sessionId);
					controllers.set(sessionId, controller);
				}
				return controller;
			};
			ctx.on("connection/reset", () => {
				for (const controller of controllers.values()) controller.refreshIfLoaded();
			});
			ctx.slots.register({
				name: "conversation.view",
				id: "message-edit-timeline",
				order: 15,
				label: "Timeline",
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditTimelineView);
			ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "message-edit-controls",
				order: 15,
				inject: (sessionId) => controllerFor(sessionId).face
			}, MessageEditHeader);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map