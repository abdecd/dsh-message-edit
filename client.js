window.__ModuleLoader__.load({
	id: "dsh-message-edit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared.ts
		/** Same-origin endpoint owned by the Message Edit host plugin. */
		const MESSAGE_EDIT_PATH = "/message-edit";
		//#endregion
		//#region src/client/controller.ts
		/** Merge a burst of turn completions / node events into one refresh. */
		const REFRESH_DELAY_MS = 150;
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
			if (value !== "user" && value !== "assistant.reasoning" && value !== "assistant.response" && value !== "system" && value !== "tool.call" && value !== "tool.result" && value !== "context.inject") throw new TypeError("消息块类型无效");
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
				time: numberValue(row["time"], "消息 time"),
				...typeof row["toolName"] === "string" ? { toolName: row["toolName"] } : {},
				...typeof row["callId"] === "string" ? { callId: row["callId"] } : {}
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
		function decodePreset(value, index) {
			const row = objectValue(value, `presets[${String(index)}]`);
			return {
				id: stringValue(row["id"], "preset id"),
				isDefault: booleanValue(row["isDefault"], "preset isDefault"),
				...typeof row["name"] === "string" ? { name: row["name"] } : {},
				...typeof row["description"] === "string" ? { description: row["description"] } : {},
				...typeof row["broken"] === "string" ? { broken: row["broken"] } : {}
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
			const agentPreset = data["agentPreset"];
			if (agentPreset !== void 0 && agentPreset !== null && typeof agentPreset !== "string") throw new TypeError("Timeline agentPreset 不是字符串或 null");
			const presets = data["presets"] === void 0 ? [] : arrayValue(data["presets"], "Timeline presets").map(decodePreset);
			return {
				sessionId: stringValue(data["sessionId"], "Timeline sessionId"),
				messages: arrayValue(data["messages"], "Timeline messages").map(decodeMessage),
				retryableTurns: arrayValue(data["retryableTurns"], "Timeline retryableTurns").map(decodeRetryable),
				versions: arrayValue(data["versions"], "Timeline versions").map(decodeVersion),
				agentPreset: agentPreset ?? null,
				presets,
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
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
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
			sessionFace;
			sessionFaceDispose;
			sessionRevision;
			sessionRunning = false;
			pendingTurnRefresh = false;
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
				this.sessions = ctx.sessions;
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
					fork: (rows, workspaceId, agentPreset) => this.mutate({
						action: "fork",
						sessionId: this.sessionId,
						rows: rows.map((row) => ({
							kind: row.kind,
							text: row.text,
							...row.toolName === void 0 ? {} : { toolName: row.toolName },
							...row.callId === void 0 ? {} : { callId: row.callId },
							...row.sourceEventSeq === void 0 ? {} : { sourceEventSeq: row.sourceEventSeq },
							...row.sourceBlockIndex === void 0 ? {} : { sourceBlockIndex: row.sourceBlockIndex }
						})),
						...workspaceId === void 0 ? {} : { workspaceId },
						...agentPreset === void 0 ? {} : { agentPreset }
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
				this.sessionSourceDispose?.();
				this.sessionSourceDispose = void 0;
				this.sessionSource = void 0;
				this.sessionFaceDispose?.();
				this.sessionFaceDispose = void 0;
				this.sessionFace = void 0;
				this.sessionRevision = void 0;
				this.sessionRunning = false;
				this.pendingTurnRefresh = false;
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
				this.bindSessionFace();
				this.sessionRunning = this.isSessionRunning();
				const disposeList = this.sessions.list.subscribe(() => {
					const reboundSource = this.bindSessionSource();
					const reboundFace = this.bindSessionFace();
					const running = this.isSessionRunning();
					if (this.sessionRunning !== running) {
						this.sessionRunning = running;
						if (!running && this.pendingTurnRefresh) {
							this.pendingTurnRefresh = false;
							this.invalidate();
						}
					}
					const nextRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId);
					if (nextRevision === this.listRevision && !reboundSource && !reboundFace) return;
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
					this.sessionFaceDispose?.();
					this.sessionFaceDispose = void 0;
					this.sessionFace = void 0;
					this.sessionRevision = void 0;
					this.sessionRunning = false;
					this.pendingTurnRefresh = false;
					for (const cancel of [...this.navigationWaits]) cancel();
				};
			}
			isSessionRunning() {
				const binding = this.sessions.binding(this.sessionId);
				if (typeof binding?.session?.getSnapshot === "function") {
					const running = binding.session.getSnapshot()?.running;
					if (typeof running === "boolean") return running;
				}
				const fromList = this.sessions.list.getSnapshot().byId[this.sessionId]?.running;
				if (typeof fromList === "boolean") return fromList;
				return false;
			}
			bindSessionFace() {
				const session = this.sessions.binding(this.sessionId)?.session;
				if (session === this.sessionFace) return false;
				this.sessionFaceDispose?.();
				this.sessionFace = session;
				if (typeof session?.subscribe === "function" && typeof session?.getSnapshot === "function") {
					this.sessionRunning = Boolean(session.getSnapshot()?.running);
					this.sessionFaceDispose = session.subscribe(() => {
						if (this.sessionFace !== session) return;
						const running = Boolean(session.getSnapshot()?.running);
						if (this.sessionRunning !== running) {
							this.sessionRunning = running;
							if (!running && this.pendingTurnRefresh) {
								this.pendingTurnRefresh = false;
								this.invalidate();
							}
						}
					});
				} else this.sessionFaceDispose = void 0;
				return true;
			}
			bindSessionSource() {
				const source = this.sessions.binding(this.sessionId)?.eventSource;
				if (source === this.sessionSource) return false;
				this.sessionSourceDispose?.();
				this.sessionSource = source;
				this.sessionRevision = source === void 0 ? void 0 : source.getSnapshot().revision;
				this.sessionSourceDispose = source?.subscribe(() => {
					if (this.sessionSource !== source) return;
					const revision = source.getSnapshot().revision;
					if (revision === this.sessionRevision) return;
					this.sessionRevision = revision;
					if (this.isSessionRunning()) {
						this.pendingTurnRefresh = true;
						return;
					}
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
					if (state.status === "idle") state.status = "loading";
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
				const projection = this.sessions.binding(this.sessionId)?.session.projections.faceOf("modelSelection").getSnapshot();
				if (typeof projection !== "object" || projection === null || !("next" in projection)) return void 0;
				const current = projection.next;
				if (typeof current !== "object" || current === null) return void 0;
				if (!("provider" in current) || typeof current.provider !== "string" || !current.provider) return void 0;
				if (!("model" in current) || typeof current.model !== "string" || !current.model) return void 0;
				const reasoningEffort = "reasoningEffort" in current ? current.reasoningEffort : void 0;
				if (reasoningEffort !== void 0 && (typeof reasoningEffort !== "string" || !reasoningEffort)) return void 0;
				return {
					provider: current.provider,
					model: current.model,
					...reasoningEffort === void 0 ? {} : { reasoningEffort }
				};
			}
			async mutate(operation) {
				let current = this.store.getSnapshot();
				if (current.pending !== null) return false;
				if (current.status !== "ready") {
					try {
						await this.load();
					} catch {}
					current = this.store.getSnapshot();
				}
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
				this.sessions.refresh();
				return new Promise((resolve) => {
					let settled = false;
					let dispose = () => {};
					let timer;
					const finish = (open) => {
						if (settled) return;
						settled = true;
						if (timer !== void 0) clearTimeout(timer);
						dispose();
						this.navigationWaits.delete(cancel);
						if (open) try {
							this.sessions.open(sessionId);
						} catch {}
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
					if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) {
						finish(true);
						return;
					}
					timer = setTimeout(() => {
						if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) finish(true);
						else this.sessions.refresh().then(() => {
							finish(this.sessions.list.getSnapshot().byId[sessionId] !== void 0);
						}).catch(() => {
							finish(false);
						});
					}, 500);
				});
			}
		};
		//#endregion
		//#region \0dsh-css:/run/media/user1/78E6859DE6855BEE/code/js/dsh-message-edit/src/client/MessageEditHeader.module.css.mjs
		const css$1 = ".ovpcJa_root{flex-wrap:wrap;align-items:center;gap:4px;min-width:0;max-width:100%;display:inline-flex}.ovpcJa_iconButton,.ovpcJa_rerollButton{box-sizing:border-box;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;touch-action:manipulation;background:0 0;border:0}.ovpcJa_iconButton{border-radius:50%;justify-content:center;align-items:center;width:28px;height:28px;font-size:16px;line-height:20px;display:inline-flex}.ovpcJa_rerollButton{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:18px}.ovpcJa_iconButton:hover:not(:disabled),.ovpcJa_rerollButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.ovpcJa_iconButton:focus-visible,.ovpcJa_rerollButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.ovpcJa_iconButton:disabled,.ovpcJa_rerollButton:disabled{cursor:default;opacity:.4}.ovpcJa_counter{min-width:108px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:11px;line-height:18px}@media (width<=760px){.ovpcJa_counter{display:none}.ovpcJa_iconButton{width:36px;height:36px;font-size:18px}.ovpcJa_rerollButton{white-space:nowrap;border-radius:18px;height:36px;min-height:36px;padding:0 12px}}";
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
			"iconButton": "ovpcJa_iconButton",
			"rerollButton": "ovpcJa_rerollButton",
			"counter": "ovpcJa_counter"
		};
		//#endregion
		//#region src/client/MessageEditHeader.tsx
		/** Header contribution shared with the Timeline controller. */
		function MessageEditHeader({ useMessageEdit, acquire, load, openVersion, reroll }) {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
			});
		}
		//#endregion
		//#region \0dsh-css:/run/media/user1/78E6859DE6855BEE/code/js/dsh-message-edit/src/client/MessageEditTimelineView.module.css.mjs
		const css = ".hbVeaa_root{box-sizing:border-box;width:100%;min-width:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:24px}.hbVeaa_pageHeader{justify-content:space-between;align-items:flex-start;gap:20px;min-width:0;max-width:1480px;margin:0 auto 16px;display:flex}.hbVeaa_pageHeader>:first-child{min-width:0}.hbVeaa_title,.hbVeaa_intro,.hbVeaa_subtitle,.hbVeaa_notice,.hbVeaa_error,.hbVeaa_empty,.hbVeaa_turnTitle,.hbVeaa_turnPreview,.hbVeaa_messageText{margin:0}.hbVeaa_title{font-size:22px;font-weight:600;line-height:30px}.hbVeaa_intro{max-width:700px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin-top:4px;font-size:13px;line-height:20px}.hbVeaa_headerActions{flex-direction:column;flex:none;align-items:flex-end;gap:8px;min-width:0;display:flex}.hbVeaa_actionRow{flex-wrap:wrap;align-items:flex-end;gap:8px;min-width:0;display:flex}.hbVeaa_workspaceField{align-self:stretch;align-items:flex-start}.hbVeaa_cascadeField{min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:11px;line-height:16px;display:flex}.hbVeaa_select,.hbVeaa_textarea,.hbVeaa_primaryButton,.hbVeaa_secondaryButton,.hbVeaa_textButton,.hbVeaa_versionButton,.hbVeaa_checkbox{box-sizing:border-box;font:inherit}.hbVeaa_select,.hbVeaa_textarea{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:8px;max-width:100%}.hbVeaa_select{height:34px;padding:0 30px 0 9px;font-size:12px}.hbVeaa_workspaceSelect{max-width:280px}.hbVeaa_primaryButton,.hbVeaa_secondaryButton,.hbVeaa_textButton,.hbVeaa_versionButton,.hbVeaa_expandButton{cursor:pointer;border:0}.hbVeaa_primaryButton,.hbVeaa_secondaryButton{border-radius:17px;justify-content:center;align-items:center;min-height:34px;padding:0 13px;font-size:12px;line-height:18px;display:inline-flex}.hbVeaa_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}.hbVeaa_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.hbVeaa_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.hbVeaa_secondaryButton:hover:not(:disabled),.hbVeaa_textButton:hover:not(:disabled),.hbVeaa_versionButton:hover:not(:disabled),.hbVeaa_expandButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hbVeaa_primaryButton:disabled,.hbVeaa_secondaryButton:disabled,.hbVeaa_textButton:disabled,.hbVeaa_versionButton:disabled,.hbVeaa_select:disabled{cursor:default;opacity:.45}.hbVeaa_primaryButton:focus-visible,.hbVeaa_secondaryButton:focus-visible,.hbVeaa_textButton:focus-visible,.hbVeaa_versionButton:focus-visible,.hbVeaa_expandButton:focus-visible,.hbVeaa_select:focus-visible,.hbVeaa_textarea:focus-visible,.hbVeaa_checkbox:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.hbVeaa_notice,.hbVeaa_error{max-width:1480px;margin:0 auto 10px;font-size:12px;line-height:18px}.hbVeaa_notice{color:var(--dsw-alias-state-warn-label)}.hbVeaa_error{color:var(--dsw-alias-state-error-primary)}.hbVeaa_status{box-sizing:border-box;width:100%;height:100%;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;align-items:flex-start;gap:12px;padding:24px;display:flex}.hbVeaa_status .hbVeaa_error{margin:0}.hbVeaa_columns{grid-template-columns:minmax(280px,.72fr) minmax(520px,1.75fr);align-items:start;gap:18px;width:100%;min-width:0;max-width:1480px;margin:0 auto;display:grid}.hbVeaa_versionsPanel,.hbVeaa_turnsPanel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0;padding:16px}.hbVeaa_versionsPanel{position:-webkit-sticky;position:sticky;top:0}.hbVeaa_sectionHeading{justify-content:space-between;align-items:center;gap:12px;min-width:0;margin-bottom:14px;display:flex}.hbVeaa_turnsPanel .hbVeaa_sectionHeading{z-index:5;background:var(--dsw-alias-bg-layer-1);border-bottom:2px solid var(--dsw-alias-border-l2);border-top-left-radius:14px;border-top-right-radius:14px;margin:-16px -16px 14px;padding:14px 16px;position:-webkit-sticky;position:sticky;top:0;box-shadow:0 2px 6px #00000014}.hbVeaa_effectControls{background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:8px;margin-bottom:12px;padding:10px;display:flex}.hbVeaa_effectDepth{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}.hbVeaa_effectButtons{flex-wrap:wrap;gap:6px;display:flex}.hbVeaa_effectButtons .hbVeaa_secondaryButton{min-height:28px;padding:0 10px;font-size:11px}.hbVeaa_subtitle{font-size:16px;font-weight:500;line-height:24px}.hbVeaa_count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hbVeaa_versionList,.hbVeaa_turnList{margin:0;padding:0;list-style:none}.hbVeaa_versionList{flex-direction:column;gap:4px;display:flex}.hbVeaa_versionItem{--message-edit-depth:0;padding-left:calc(var(--message-edit-depth) * 14px);position:relative}.hbVeaa_versionButton{width:100%;min-width:0;color:var(--dsw-alias-label-secondary);text-align:left;overflow-wrap:anywhere;background:0 0;border-radius:9px;align-items:flex-start;gap:9px;padding:9px;display:flex;position:relative}.hbVeaa_versionButton[data-current]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);opacity:1}.hbVeaa_versionButton:not([data-current]) .hbVeaa_pathBadge{opacity:.8}.hbVeaa_versionLine{background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:0;bottom:0;left:14px}.hbVeaa_versionDot{z-index:1;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:7px;height:7px;margin-top:6px}.hbVeaa_versionButton[data-current] .hbVeaa_versionDot{border-color:var(--dsw-alias-bg-module-platform);background:var(--dsw-alias-brand-primary)}.hbVeaa_versionMain{flex-direction:column;flex:1;min-width:0;display:flex}.hbVeaa_versionTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.hbVeaa_versionMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;overflow:hidden}.hbVeaa_versionDiff{color:var(--dsw-alias-label-tertiary);flex-direction:column;gap:2px;margin-top:5px;font-size:10px;line-height:15px;display:flex}.hbVeaa_versionDiff span{-webkit-line-clamp:2;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.hbVeaa_currentBadge,.hbVeaa_pathBadge,.hbVeaa_kindBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}.hbVeaa_currentBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_pathBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_turnList{flex-direction:column;gap:8px;display:flex}.hbVeaa_turnSection{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;overflow:clip}.hbVeaa_turnHeader,.hbVeaa_messageHeader,.hbVeaa_editorActions{justify-content:space-between;align-items:center;gap:8px;display:flex}.hbVeaa_turnHeader{z-index:4;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);cursor:pointer;user-select:none;border-top-left-radius:8px;border-top-right-radius:8px;align-items:center;margin:-8px -10px 6px;padding:8px 10px;position:-webkit-sticky;position:sticky;top:54px;box-shadow:0 2px 4px #0000000d}.hbVeaa_turnHeaderLeft{cursor:pointer;user-select:none;flex:auto;align-items:center;gap:8px;min-width:0;display:flex}.hbVeaa_turnTitle{white-space:nowrap;flex:none;font-size:13px;font-weight:600;line-height:20px}.hbVeaa_turnPreview{min-width:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;max-width:450px;font-size:12px;line-height:18px;overflow:hidden}.hbVeaa_messageList{flex-direction:column;gap:5px;margin-top:6px;display:flex}.hbVeaa_messageCard{background:var(--dsw-alias-bg-module-platform);border-left:3px solid #0000;border-radius:6px;padding:6px 10px}.hbVeaa_messageCard[data-kind=user]{background:#3b82f60d;border-left-color:#3b82f6}.hbVeaa_messageCard[data-kind=assistant\\.response]{background:#10b9810d;border-left-color:#10b981}.hbVeaa_messageCard[data-kind=assistant\\.reasoning]{background:#8b5cf60d;border-left-color:#8b5cf6}.hbVeaa_messageCard[data-kind=tool-call]{background:#f59e0b0d;border-left-color:#f59e0b}.hbVeaa_messageCard[data-kind=tool-result]{background:#06b6d40d;border-left-color:#06b6d4}.hbVeaa_messageCard[data-kind=system]{background:#ec48990d;border-left-color:#ec4899}.hbVeaa_messageCard[data-kind=context-inject]{background:#6366f10d;border-left-color:#6366f1}.hbVeaa_messageHeader{flex-wrap:wrap;justify-content:flex-start;gap:6px}.hbVeaa_kindBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:1px 5px;font-size:11px;line-height:17px}.hbVeaa_kindBadge[data-kind=user]{color:#2563eb;background:#3b82f61f;font-weight:500}.hbVeaa_kindBadge[data-kind=assistant\\.response]{color:#059669;background:#10b9811f;font-weight:500}.hbVeaa_kindBadge[data-kind=assistant\\.reasoning]{color:#7c3aed;background:#8b5cf61f;font-weight:500}.hbVeaa_kindBadge[data-kind=tool-call]{color:#d97706;background:#f59e0b1f;font-weight:500}.hbVeaa_kindBadge[data-kind=tool-result]{color:#0891b2;background:#06b6d41f;font-weight:500}.hbVeaa_kindBadge[data-kind=system]{color:#db2777;background:#ec48991f;font-weight:500}.hbVeaa_kindBadge[data-kind=context-inject]{color:#4f46e5;background:#6366f11f;font-weight:500}.hbVeaa_messageTime{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:17px}.hbVeaa_textButton{min-height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border-radius:10px;margin-left:auto;padding:2px 7px;font-size:11px;line-height:16px}.hbVeaa_checkbox{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0 4px 0 0}.hbVeaa_checkbox:disabled{cursor:default;opacity:.45}.hbVeaa_batchActions{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;min-width:0;display:flex}.hbVeaa_batchActions .hbVeaa_textButton{margin-left:0}.hbVeaa_messageTextWrapper{flex-direction:column;gap:2px;min-width:0;display:flex}.hbVeaa_messageText{max-height:180px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px;font-family:inherit;font-size:12px;line-height:18px;overflow:auto}.hbVeaa_messageTextCollapsed{text-overflow:ellipsis;white-space:nowrap;max-height:none;overflow:hidden}.hbVeaa_expandButton{color:var(--dsw-alias-brand-primary);background:0 0;border-radius:3px;align-self:flex-start;margin-top:2px;padding:2px 6px;font-size:11px;line-height:15px}.hbVeaa_editor{margin-top:6px}.hbVeaa_textarea{resize:vertical;width:100%;min-height:100px;padding:7px 9px;font-size:12px;line-height:18px}.hbVeaa_editorActions{margin-top:6px}.hbVeaa_editorHint{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:11px;line-height:16px}.hbVeaa_empty{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:18px;font-size:13px;line-height:20px}@media (width<=1000px){.hbVeaa_columns{grid-template-columns:minmax(0,1fr)}.hbVeaa_versionsPanel{position:static}}@media (width<=680px){.hbVeaa_root{padding:12px}.hbVeaa_pageHeader,.hbVeaa_headerActions,.hbVeaa_actionRow,.hbVeaa_turnHeader,.hbVeaa_editorActions{flex-direction:column;align-items:stretch}.hbVeaa_pageHeader{gap:14px;margin-bottom:12px}.hbVeaa_title{font-size:20px;line-height:28px}.hbVeaa_intro{font-size:12px;line-height:18px}.hbVeaa_headerActions,.hbVeaa_actionRow,.hbVeaa_cascadeField{width:100%}.hbVeaa_actionRow{gap:8px}.hbVeaa_workspaceField{align-self:stretch;align-items:stretch}.hbVeaa_select,.hbVeaa_workspaceSelect{width:100%;max-width:none;height:44px;min-height:44px;font-size:16px}.hbVeaa_primaryButton,.hbVeaa_secondaryButton{width:100%;min-height:44px;font-size:14px}.hbVeaa_versionsPanel,.hbVeaa_turnsPanel{border-radius:10px;padding:12px}.hbVeaa_sectionHeading{flex-wrap:wrap;align-items:flex-start;gap:8px;margin-bottom:10px}.hbVeaa_turnsPanel .hbVeaa_sectionHeading{z-index:auto;box-shadow:none;border-radius:10px 10px 0 0;margin:-12px -12px 10px;padding:12px;position:static}.hbVeaa_batchActions{flex:100%;justify-content:flex-start;gap:4px;width:100%}.hbVeaa_batchActions .hbVeaa_textButton{min-height:36px;padding:6px 8px}.hbVeaa_changeSummary{flex-wrap:wrap;gap:4px 8px}.hbVeaa_versionItem{padding-left:min(calc(var(--message-edit-depth) * 10px), 28px)}.hbVeaa_versionButton{gap:7px;padding:9px 8px}.hbVeaa_versionTitle,.hbVeaa_versionMeta{white-space:normal;overflow-wrap:anywhere}.hbVeaa_versionDiff{font-size:11px;line-height:16px}.hbVeaa_turnSection{padding:8px}.hbVeaa_turnHeader{box-shadow:none;margin:-8px -8px 6px;padding:8px;position:static}.hbVeaa_turnHeaderLeft{gap:6px;width:100%}.hbVeaa_turnPreview{flex:auto;max-width:none}.hbVeaa_turnActions{justify-content:flex-start;gap:6px;width:100%}.hbVeaa_turnActions .hbVeaa_secondaryButton{flex:120px;width:auto;min-height:38px;padding:0 8px;font-size:12px}.hbVeaa_messageList{gap:6px}.hbVeaa_messageCard{padding:8px}.hbVeaa_messageHeader{align-items:center;gap:4px}.hbVeaa_messageSpacer{display:none}.hbVeaa_messageTime{margin-right:auto;font-size:10px}.hbVeaa_textButton{min-height:36px;margin-left:0;padding:6px 9px}.hbVeaa_checkbox{width:18px;height:18px;margin-right:3px}.hbVeaa_dragHandle{min-width:28px;min-height:32px;margin-right:0;padding:8px 4px}.hbVeaa_messageText{max-height:min(40vh,220px);font-size:13px;line-height:20px}.hbVeaa_textarea{min-height:140px;font-size:16px;line-height:22px}.hbVeaa_editorActions{gap:8px}.hbVeaa_editorHint{font-size:12px;line-height:18px}.hbVeaa_empty{padding:14px}}@media (width<=380px){.hbVeaa_root,.hbVeaa_versionsPanel,.hbVeaa_turnsPanel{padding:10px}.hbVeaa_turnsPanel .hbVeaa_sectionHeading{margin:-10px -10px 10px;padding:10px}.hbVeaa_turnSection{padding:6px}.hbVeaa_turnHeader{margin:-6px -6px 6px;padding:8px 6px}.hbVeaa_messageCard{padding:7px}}.hbVeaa_changeSummary{align-items:center;gap:8px;display:flex}.hbVeaa_changeChip{color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:17px}.hbVeaa_newBadge,.hbVeaa_editedBadge{border-radius:9px;flex:none;padding:1px 6px;font-size:10px;line-height:17px}.hbVeaa_newBadge{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_editedBadge{color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-bg-layer-1)}.hbVeaa_messageSpacer{flex:1}.hbVeaa_textButton[data-danger]{color:var(--dsw-alias-state-error-primary)}.hbVeaa_turnActions{flex-wrap:wrap;flex:none;justify-content:flex-end;gap:4px;min-width:0;display:flex}.hbVeaa_turnActions .hbVeaa_secondaryButton{border-radius:11px;min-height:22px;padding:0 7px;font-size:10px;line-height:14px}.hbVeaa_composerFooter{border-top:1px dashed var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}.hbVeaa_emptyState{flex-direction:column;align-items:flex-start;gap:10px;display:flex}.hbVeaa_messageCard[data-added]{border:1px dashed var(--dsw-alias-brand-primary)}.hbVeaa_dragHandle{color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none;border-radius:4px;justify-content:center;align-items:center;margin-right:2px;padding:2px 4px;font-size:14px;line-height:1;display:inline-flex}.hbVeaa_dragHandle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hbVeaa_dragHandle:active{cursor:grabbing}.hbVeaa_messageCard[data-dragging]{opacity:.4}.hbVeaa_messageCard[data-drag-over-top]{border-top:2px solid var(--dsw-alias-brand-primary)}.hbVeaa_messageCard[data-drag-over-bottom]{border-bottom:2px solid var(--dsw-alias-brand-primary)}.hbVeaa_collapseTurnButton{color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none;background:0 0;border:0;border-radius:4px;justify-content:center;align-items:center;padding:0 4px;font-size:11px;line-height:18px;display:inline-flex}.hbVeaa_collapseTurnButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hbVeaa_turnSection[data-collapsed]{padding-bottom:8px}.hbVeaa_turnSection[data-collapsed] .hbVeaa_turnHeader{box-shadow:none;border-bottom:0;margin-bottom:-8px}.hbVeaa_turnSection[data-dragging]{opacity:.4}.hbVeaa_turnSection[data-drag-over-top]{border-top:3px solid var(--dsw-alias-brand-primary)}.hbVeaa_turnSection[data-drag-over-bottom]{border-bottom:3px solid var(--dsw-alias-brand-primary)}@media (width<=680px){.hbVeaa_changeSummary{gap:4px 8px}.hbVeaa_turnActions{justify-content:flex-start;gap:6px;width:100%}.hbVeaa_turnActions .hbVeaa_secondaryButton{min-height:38px;padding:0 8px;font-size:12px}.hbVeaa_dragHandle{margin-right:0;padding:8px 4px}.hbVeaa_collapseTurnButton{min-width:32px;min-height:32px}}";
		const tagId = "dsh-message-edit/MessageEditTimelineView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-message-edit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MessageEditTimelineView_module_css_default = {
			"subtitle": "hbVeaa_subtitle",
			"notice": "hbVeaa_notice",
			"turnTitle": "hbVeaa_turnTitle",
			"root": "hbVeaa_root",
			"title": "hbVeaa_title",
			"currentBadge": "hbVeaa_currentBadge",
			"editorActions": "hbVeaa_editorActions",
			"batchActions": "hbVeaa_batchActions",
			"secondaryButton": "hbVeaa_secondaryButton",
			"kindBadge": "hbVeaa_kindBadge",
			"turnHeader": "hbVeaa_turnHeader",
			"workspaceSelect": "hbVeaa_workspaceSelect",
			"messageTime": "hbVeaa_messageTime",
			"pageHeader": "hbVeaa_pageHeader",
			"count": "hbVeaa_count",
			"editor": "hbVeaa_editor",
			"actionRow": "hbVeaa_actionRow",
			"error": "hbVeaa_error",
			"versionList": "hbVeaa_versionList",
			"columns": "hbVeaa_columns",
			"workspaceField": "hbVeaa_workspaceField",
			"versionLine": "hbVeaa_versionLine",
			"changeChip": "hbVeaa_changeChip",
			"editedBadge": "hbVeaa_editedBadge",
			"expandButton": "hbVeaa_expandButton",
			"emptyState": "hbVeaa_emptyState",
			"effectControls": "hbVeaa_effectControls",
			"versionTitle": "hbVeaa_versionTitle",
			"empty": "hbVeaa_empty",
			"versionButton": "hbVeaa_versionButton",
			"versionsPanel": "hbVeaa_versionsPanel",
			"turnActions": "hbVeaa_turnActions",
			"composerFooter": "hbVeaa_composerFooter",
			"effectButtons": "hbVeaa_effectButtons",
			"collapseTurnButton": "hbVeaa_collapseTurnButton",
			"textarea": "hbVeaa_textarea",
			"checkbox": "hbVeaa_checkbox",
			"messageList": "hbVeaa_messageList",
			"turnSection": "hbVeaa_turnSection",
			"status": "hbVeaa_status",
			"pathBadge": "hbVeaa_pathBadge",
			"turnsPanel": "hbVeaa_turnsPanel",
			"turnPreview": "hbVeaa_turnPreview",
			"effectDepth": "hbVeaa_effectDepth",
			"versionItem": "hbVeaa_versionItem",
			"versionDiff": "hbVeaa_versionDiff",
			"messageHeader": "hbVeaa_messageHeader",
			"turnHeaderLeft": "hbVeaa_turnHeaderLeft",
			"messageSpacer": "hbVeaa_messageSpacer",
			"headerActions": "hbVeaa_headerActions",
			"messageTextWrapper": "hbVeaa_messageTextWrapper",
			"turnList": "hbVeaa_turnList",
			"messageTextCollapsed": "hbVeaa_messageTextCollapsed",
			"cascadeField": "hbVeaa_cascadeField",
			"versionDot": "hbVeaa_versionDot",
			"select": "hbVeaa_select",
			"intro": "hbVeaa_intro",
			"versionMeta": "hbVeaa_versionMeta",
			"dragHandle": "hbVeaa_dragHandle",
			"messageText": "hbVeaa_messageText",
			"messageCard": "hbVeaa_messageCard",
			"versionMain": "hbVeaa_versionMain",
			"newBadge": "hbVeaa_newBadge",
			"textButton": "hbVeaa_textButton",
			"sectionHeading": "hbVeaa_sectionHeading",
			"editorHint": "hbVeaa_editorHint",
			"changeSummary": "hbVeaa_changeSummary",
			"primaryButton": "hbVeaa_primaryButton"
		};
		//#endregion
		//#region src/client/MessageEditTimelineView.tsx
		/** Timeline tab: durable version tree plus free CRUD over finalized messages,
		* committed as a forked version that regenerates replies. */
		const BLOCK_LABEL = {
			user: "用户消息",
			"assistant.reasoning": "助手思考",
			"assistant.response": "助手回复",
			system: "System Prompt",
			"tool.call": "工具调用",
			"tool.result": "工具返回",
			"context.inject": "上下文/Skill 注入"
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
		/** Group draft rows into sections: each turn in history is an atomic section. */
		function buildSections(rows, baseline, retryableTurns) {
			const retryable = new Map(retryableTurns.map((turn) => [turn.turn, turn]));
			const sections = [];
			const sectionMap = /* @__PURE__ */ new Map();
			for (const row of rows) {
				const turnKey = row.turn === void 0 ? `added-${row.key}` : `turn-${String(row.turn)}`;
				let section = sectionMap.get(turnKey);
				if (section === void 0) {
					section = {
						id: turnKey,
						turnLabel: row.turn === void 0 ? "新增回合" : `回合 ${String(row.turn)}`,
						preview: row.text,
						rows: []
					};
					sectionMap.set(turnKey, section);
					sections.push(section);
				}
				section.rows.push(row);
			}
			for (const section of sections) {
				const userRow = section.rows.find((row) => row.kind === "user");
				const head = section.rows[0];
				section.preview = (userRow ?? head)?.text || "（空内容）";
				if (userRow && !userRow.added && userRow.turn !== void 0) {
					if (section.rows.every((row) => !row.added && baseline.get(row.key)?.text === row.text)) {
						const retry = retryable.get(userRow.turn);
						if (retry !== void 0) section.retry = retry;
					}
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
		function MessageCard({ row, baseline, editing, selected, disabled, isDragging, dragOverPosition, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onSelectToggle, onBeginEdit, onCancelEdit, onTextChange, onApplyEdit, onDelete }) {
			const active = editing?.key === row.key;
			const edited = !row.added && baseline !== void 0 && baseline.text !== row.text;
			const badgeLabel = row.kind === "tool.call" && row.toolName ? `工具调用: ${row.toolName}` : BLOCK_LABEL[row.kind] || row.kind;
			const kindDataAttr = row.kind.replace(".", "-");
			const isMultiLine = row.text.includes("\n") || row.text.length > 70;
			const [expanded, setExpanded] = (0, react.useState)(!isMultiLine);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: MessageEditTimelineView_module_css_default["messageCard"],
				"data-kind": kindDataAttr,
				"data-added": row.added || void 0,
				"data-dragging": isDragging || void 0,
				"data-drag-over-top": dragOverPosition === "top" || void 0,
				"data-drag-over-bottom": dragOverPosition === "bottom" || void 0,
				onDragOver: (e) => {
					onDragOver?.(e, row);
				},
				onDragLeave,
				onDrop: (e) => {
					onDrop?.(e, row);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["messageHeader"],
					children: [
						!disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["dragHandle"],
							draggable: true,
							title: "按住拖拽排序",
							onDragStart: (e) => {
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData("text/plain", row.key);
								onDragStart?.(row);
							},
							onDragEnd: () => {
								onDragEnd?.();
							},
							children: "⋮⋮"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: MessageEditTimelineView_module_css_default["checkbox"],
							checked: selected,
							disabled,
							title: "选择此消息进行批量操作",
							onChange: () => {
								onSelectToggle(row);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessageEditTimelineView_module_css_default["kindBadge"],
							"data-kind": kindDataAttr,
							children: badgeLabel
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
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MessageEditTimelineView_module_css_default["messageTextWrapper"],
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: `${MessageEditTimelineView_module_css_default["messageText"]}${!expanded && isMultiLine ? ` ${MessageEditTimelineView_module_css_default["messageTextCollapsed"]}` : ""}`,
						children: row.text || "（空内容）"
					}), isMultiLine && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MessageEditTimelineView_module_css_default["expandButton"],
						onClick: () => {
							setExpanded(!expanded);
						},
						children: expanded ? "收起" : "展开全文"
					})]
				})]
			});
		}
		/** Conversation view entry: the durable version timeline plus the message composer. */
		function MessageEditTimelineView({ useMessageEdit, acquire, load, retry, reroll, fork, openVersion, sessionId, useWorkspaces }) {
			const state = useMessageEdit((value) => value);
			const workspaceItems = useWorkspaces((value) => value.items);
			const [cascade, setCascade] = (0, react.useState)("truncate");
			const [forkWorkspaceId, setForkWorkspaceId] = (0, react.useState)("");
			const [forkPresetId, setForkPresetId] = (0, react.useState)("");
			const [editing, setEditing] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [history, setHistory] = (0, react.useState)([]);
			const [selectedKeys, setSelectedKeys] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [draggingKey, setDraggingKey] = (0, react.useState)(null);
			const [draggingSectionId, setDraggingSectionId] = (0, react.useState)(null);
			const [dragOverTarget, setDragOverTarget] = (0, react.useState)(null);
			const [dragOverSection, setDragOverSection] = (0, react.useState)(null);
			const [collapsedSectionIds, setCollapsedSectionIds] = (0, react.useState)(/* @__PURE__ */ new Set());
			const currentWorkspace = (0, react.useMemo)(() => workspaceItems.find((workspace) => workspace.sessionIds.includes(sessionId)), [workspaceItems, sessionId]);
			const selectedForkWorkspaceId = forkWorkspaceId;
			(0, react.useEffect)(() => {
				const release = acquire();
				load();
				return release;
			}, [acquire, load]);
			const timeline = state.timeline;
			const presetItems = timeline?.presets ?? [];
			const sourcePreset = timeline?.agentPreset ?? null;
			const sourcePresetLabel = (sourcePreset === null ? void 0 : presetItems.find((preset) => preset.id === sourcePreset))?.name ?? sourcePreset ?? "未设置";
			const baseline = (0, react.useMemo)(() => new Map((timeline?.messages ?? []).map((message) => [message.key, message])), [timeline]);
			const baselineRows = (0, react.useMemo)(() => (timeline?.messages ?? []).map((message) => ({
				key: message.key,
				kind: message.kind,
				text: message.text,
				turn: message.turn,
				added: false,
				...message.toolName !== void 0 ? { toolName: message.toolName } : {},
				...message.callId !== void 0 ? { callId: message.callId } : {},
				sourceEventSeq: message.eventSeq,
				sourceBlockIndex: message.blockIndex
			})), [timeline]);
			/** Identity of the loaded history; a change means the user switched versions
			* or new turns finalized, so the local draft re-syncs from the baseline. */
			const signature = (0, react.useMemo)(() => timeline === null ? "" : `${timeline.sessionId}|${timeline.messages.map((message) => message.key).join(",")}`, [timeline]);
			const lastSessionIdRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setDraft((current) => current?.signature === signature ? current : {
					signature,
					rows: baselineRows
				});
				setHistory([]);
				const sessionChanged = lastSessionIdRef.current !== timeline?.sessionId;
				lastSessionIdRef.current = timeline?.sessionId ?? null;
				if (sessionChanged) {
					setForkWorkspaceId("");
					setForkPresetId("");
					setSelectedKeys(/* @__PURE__ */ new Set());
					setEditing(null);
					setCollapsedSectionIds(new Set(baselineRows.map((r) => r.turn !== void 0 ? `turn-${String(r.turn)}` : `added-${r.key}`)));
				}
			}, [
				signature,
				baselineRows,
				timeline?.sessionId
			]);
			const draftReady = draft?.signature === signature;
			const rows = draftReady ? draft?.rows ?? baselineRows : baselineRows;
			const updateDraftRows = (nextRows) => {
				setHistory((prev) => [...prev.slice(-30), rows]);
				setDraft({
					signature,
					rows: nextRows
				});
			};
			const undoDraft = () => {
				if (history.length === 0) return;
				const prevRows = history[history.length - 1];
				if (!prevRows) return;
				setHistory(history.slice(0, -1));
				setDraft({
					signature,
					rows: prevRows
				});
				setEditing(null);
			};
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
			const busy = state.pending !== null || state.status !== "ready" || !draftReady;
			/** Settle an added row left behind when the editor moves away: an empty
			* buffer discards the row, a filled buffer keeps it in the draft. */
			const settleAddedRow = (current, leaving) => {
				if (leaving === void 0 || !leaving.added) return;
				updateDraftRows(current.text.length === 0 ? rows.filter((candidate) => candidate.key !== current.key) : rows.map((candidate) => candidate.key === current.key ? {
					...candidate,
					text: current.text
				} : candidate));
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
			const toggleSelectRow = (row) => {
				setSelectedKeys((prev) => {
					const next = new Set(prev);
					if (next.has(row.key)) next.delete(row.key);
					else next.add(row.key);
					return next;
				});
			};
			const toggleSelectSection = (section) => {
				setSelectedKeys((prev) => {
					const next = new Set(prev);
					if (section.rows.every((r) => prev.has(r.key))) for (const r of section.rows) next.delete(r.key);
					else for (const r of section.rows) next.add(r.key);
					return next;
				});
			};
			const toggleSectionCollapse = (sectionId) => {
				setCollapsedSectionIds((prev) => {
					const next = new Set(prev);
					if (next.has(sectionId)) next.delete(sectionId);
					else next.add(sectionId);
					return next;
				});
			};
			const collapseAllSections = () => {
				setCollapsedSectionIds(new Set(sections.map((s) => s.id)));
			};
			const expandAllSections = () => {
				setCollapsedSectionIds(/* @__PURE__ */ new Set());
			};
			const selectAll = () => {
				setSelectedKeys(new Set(rows.map((row) => row.key)));
			};
			const invertSelection = () => {
				setSelectedKeys((prev) => {
					const next = /* @__PURE__ */ new Set();
					for (const row of rows) if (!prev.has(row.key)) next.add(row.key);
					return next;
				});
			};
			const clearSelection = () => {
				setSelectedKeys(/* @__PURE__ */ new Set());
			};
			const deleteSelected = () => {
				if (selectedKeys.size === 0) return;
				if (editing !== null && selectedKeys.has(editing.key)) setEditing(null);
				const doomed = new Set(selectedKeys);
				for (const section of sections) {
					const head = section.rows[0];
					if (head !== void 0 && head.kind === "user" && doomed.has(head.key)) for (const row of section.rows) doomed.add(row.key);
				}
				updateDraftRows(rows.filter((candidate) => !doomed.has(candidate.key)));
				setSelectedKeys(/* @__PURE__ */ new Set());
			};
			const cancelEdit = () => {
				const current = editing;
				setEditing(null);
				if (current === null) return;
				if (rows.find((candidate) => candidate.key === current.key)?.added === true) updateDraftRows(rows.filter((candidate) => candidate.key !== current.key));
			};
			const applyEdit = (row, text) => {
				setEditing(null);
				updateDraftRows(rows.map((candidate) => candidate.key === row.key ? {
					...candidate,
					text
				} : candidate));
			};
			const handleDragStart = (row) => {
				setDraggingKey(row.key);
				setDraggingSectionId(null);
			};
			const handleSectionDragStart = (section) => {
				setDraggingSectionId(section.id);
				setDraggingKey(null);
			};
			const handleDragEnd = () => {
				setDraggingKey(null);
				setDraggingSectionId(null);
				setDragOverTarget(null);
				setDragOverSection(null);
			};
			const autoScroll = (event) => {
				let scrollEl = event.currentTarget.parentElement;
				while (scrollEl && scrollEl !== document.body) {
					if (scrollEl.scrollHeight > scrollEl.clientHeight) {
						const overflow = getComputedStyle(scrollEl).overflowY;
						if (overflow === "auto" || overflow === "scroll") break;
					}
					scrollEl = scrollEl.parentElement;
				}
				if (!scrollEl) scrollEl = document.querySelector(".wSkVaW_scrollBody");
				if (!scrollEl) return;
				const rect = scrollEl.getBoundingClientRect();
				const composerSeat = document.querySelector(".wSkVaW_composerSeat");
				const effectiveBottom = composerSeat ? composerSeat.getBoundingClientRect().top : rect.bottom;
				const threshold = 120;
				const maxSpeed = 50;
				if (event.clientY < rect.top + threshold) {
					const ratio = Math.max(.2, (rect.top + threshold - event.clientY) / threshold);
					scrollEl.scrollTop -= Math.round(maxSpeed * ratio);
				} else if (event.clientY > effectiveBottom - threshold) {
					const ratio = Math.max(.2, (event.clientY - (effectiveBottom - threshold)) / threshold);
					scrollEl.scrollTop += Math.round(maxSpeed * ratio);
				}
			};
			const handleDragOver = (event, targetRow) => {
				if (draggingKey === null || draggingKey === targetRow.key) return;
				event.preventDefault();
				autoScroll(event);
				const rect = event.currentTarget.getBoundingClientRect();
				const position = event.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
				if (dragOverTarget?.key !== targetRow.key || dragOverTarget.position !== position) setDragOverTarget({
					key: targetRow.key,
					position
				});
			};
			const handleSectionDragOver = (event, targetSection) => {
				autoScroll(event);
				if (draggingSectionId !== null) {
					if (draggingSectionId === targetSection.id) return;
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					const position = event.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
					if (dragOverSection?.id !== targetSection.id || dragOverSection.position !== position) setDragOverSection({
						id: targetSection.id,
						position
					});
					return;
				}
				if (draggingKey !== null) event.preventDefault();
			};
			const handleDrop = (event, targetRow) => {
				event.preventDefault();
				event.stopPropagation();
				const sourceKey = draggingKey || event.dataTransfer.getData("text/plain");
				if (!sourceKey || sourceKey === targetRow.key) {
					handleDragEnd();
					return;
				}
				let position = dragOverTarget?.position;
				if (!position || dragOverTarget?.key !== targetRow.key) {
					const rect = event.currentTarget.getBoundingClientRect();
					position = event.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
				}
				const currentRows = [...rows];
				const sourceIndex = currentRows.findIndex((r) => r.key === sourceKey);
				const targetIndex = currentRows.findIndex((r) => r.key === targetRow.key);
				if (sourceIndex === -1 || targetIndex === -1) {
					handleDragEnd();
					return;
				}
				const [movedRow] = currentRows.splice(sourceIndex, 1);
				if (!movedRow) {
					handleDragEnd();
					return;
				}
				let insertIndex = currentRows.findIndex((r) => r.key === targetRow.key);
				if (position === "bottom") insertIndex += 1;
				currentRows.splice(insertIndex, 0, movedRow);
				updateDraftRows(currentRows);
				handleDragEnd();
			};
			const handleSectionDrop = (event, targetSection) => {
				event.preventDefault();
				event.stopPropagation();
				if (draggingSectionId !== null) {
					if (draggingSectionId === targetSection.id) {
						handleDragEnd();
						return;
					}
					const sourceSectionIndex = sections.findIndex((s) => s.id === draggingSectionId);
					const targetSectionIndex = sections.findIndex((s) => s.id === targetSection.id);
					if (sourceSectionIndex === -1 || targetSectionIndex === -1) {
						handleDragEnd();
						return;
					}
					let position = dragOverSection?.position;
					if (!position || dragOverSection?.id !== targetSection.id) {
						const rect = event.currentTarget.getBoundingClientRect();
						position = event.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
					}
					const newSections = [...sections];
					const [movedSection] = newSections.splice(sourceSectionIndex, 1);
					if (!movedSection) {
						handleDragEnd();
						return;
					}
					let insertIndex = newSections.findIndex((s) => s.id === targetSection.id);
					if (position === "bottom") insertIndex += 1;
					newSections.splice(insertIndex, 0, movedSection);
					const reorderedRows = newSections.flatMap((s) => s.rows);
					updateDraftRows(reorderedRows);
					handleDragEnd();
					return;
				}
				const sourceKey = draggingKey || event.dataTransfer.getData("text/plain");
				if (!sourceKey) {
					handleDragEnd();
					return;
				}
				const lastRow = targetSection.rows[targetSection.rows.length - 1];
				if (!lastRow || lastRow.key === sourceKey) {
					handleDragEnd();
					return;
				}
				const currentRows = [...rows];
				const sourceIndex = currentRows.findIndex((r) => r.key === sourceKey);
				if (sourceIndex === -1) {
					handleDragEnd();
					return;
				}
				const [movedRow] = currentRows.splice(sourceIndex, 1);
				if (!movedRow) {
					handleDragEnd();
					return;
				}
				const targetIndex = currentRows.findIndex((r) => r.key === lastRow.key);
				if (targetIndex === -1) currentRows.push(movedRow);
				else currentRows.splice(targetIndex + 1, 0, movedRow);
				updateDraftRows(currentRows);
				handleDragEnd();
			};
			const deleteRow = (row) => {
				if (editing?.key === row.key) setEditing(null);
				setSelectedKeys((prev) => {
					const next = new Set(prev);
					next.delete(row.key);
					return next;
				});
				if (row.kind !== "user") {
					updateDraftRows(rows.filter((candidate) => candidate.key !== row.key));
					return;
				}
				const section = sections.find((candidate) => candidate.rows.some((candidateRow) => candidateRow.key === row.key));
				const doomed = new Set(section?.rows.map((candidateRow) => candidateRow.key) ?? [row.key]);
				updateDraftRows(rows.filter((candidate) => !doomed.has(candidate.key)));
			};
			const addRow = (kind, afterKey) => {
				const row = addedRow(kind);
				const next = [...rows];
				if (afterKey === null) next.push(row);
				else {
					const index = next.findIndex((candidate) => candidate.key === afterKey);
					next.splice(index === -1 ? next.length : index + 1, 0, row);
				}
				updateDraftRows(next);
				setEditing({
					key: row.key,
					text: ""
				});
			};
			const resetDraft = () => {
				setEditing(null);
				setSelectedKeys(/* @__PURE__ */ new Set());
				setDraft({
					signature,
					rows: baselineRows
				});
			};
			const hasSelection = selectedKeys.size > 0;
			const activeRows = (0, react.useMemo)(() => {
				if (!hasSelection) return rows;
				return rows.filter((r) => selectedKeys.has(r.key));
			}, [
				rows,
				selectedKeys,
				hasSelection
			]);
			const forkRows = () => activeRows.map((row) => ({
				kind: row.kind,
				text: row.text,
				...row.toolName ? { toolName: row.toolName } : {},
				...row.callId ? { callId: row.callId } : {},
				...row.sourceEventSeq !== void 0 ? { sourceEventSeq: row.sourceEventSeq } : {},
				...row.sourceBlockIndex !== void 0 ? { sourceBlockIndex: row.sourceBlockIndex } : {}
			}));
			const lastActiveRow = activeRows[activeRows.length - 1];
			const forkLabel = state.pending === "fork" ? "正在 Fork…" : hasSelection ? lastActiveRow === void 0 ? "Fork 选中消息 (0)" : lastActiveRow.kind === "user" ? `Fork 选中项并回复 (${selectedKeys.size})` : `Fork 选中项 (${selectedKeys.size})` : lastActiveRow === void 0 ? "Fork 空白历史" : lastActiveRow.kind === "user" ? "Fork 生成回复" : "Fork（不生成回复）";
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
							children: "在右列自由增删改已落定消息，Fork 按当前内容重建消息历史并生成新版本；可在顶部选择目标工作区。 以用户消息结尾时，新版本会生成新的助手回复。每次修改与其恢复版本成对记录，原版本保持不变。"
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MessageEditTimelineView_module_css_default["headerActions"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MessageEditTimelineView_module_css_default["actionRow"],
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
											disabled: busy || editing !== null || !changes.hasChanges && !hasSelection && selectedForkWorkspaceId === "" && forkPresetId === "",
											title: hasSelection ? "基于当前选中的消息列表重建新版本历史" : selectedForkWorkspaceId !== "" ? "按当前历史 Fork 到目标工作区" : forkPresetId !== "" ? "按当前历史 Fork 并使用选定的 DSH preset" : "按右列当前内容重建消息历史并生成新版本；结尾的用户消息会触发新的助手回复",
											onClick: () => {
												fork(forkRows(), selectedForkWorkspaceId || void 0, forkPresetId || void 0);
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
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: `${MessageEditTimelineView_module_css_default["cascadeField"]} ${MessageEditTimelineView_module_css_default["workspaceField"]}`,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Fork 目标工作区" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: `${MessageEditTimelineView_module_css_default["select"]} ${MessageEditTimelineView_module_css_default["workspaceSelect"]}`,
										value: selectedForkWorkspaceId,
										disabled: busy,
										onChange: (event) => {
											setForkWorkspaceId(event.currentTarget.value);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: currentWorkspace === void 0 ? "沿用源会话工作目录" : `跟随当前工作区：${currentWorkspace.title}`
										}), workspaceItems.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: workspace.workspaceId,
											children: [
												workspace.title,
												" · ",
												workspace.path
											]
										}, workspace.workspaceId))]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: `${MessageEditTimelineView_module_css_default["cascadeField"]} ${MessageEditTimelineView_module_css_default["workspaceField"]}`,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Fork 使用 DSH preset" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: `${MessageEditTimelineView_module_css_default["select"]} ${MessageEditTimelineView_module_css_default["workspaceSelect"]}`,
										value: forkPresetId,
										disabled: busy,
										onChange: (event) => {
											setForkPresetId(event.currentTarget.value);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: "",
											children: ["沿用源会话：", sourcePresetLabel]
										}), presetItems.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: preset.id,
											disabled: preset.broken !== void 0,
											children: [
												preset.name ?? preset.id,
												preset.isDefault ? " · 默认" : "",
												preset.broken === void 0 ? "" : " · 不可用"
											]
										}, preset.id))]
									})]
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MessageEditTimelineView_module_css_default["batchActions"],
									children: [
										sections.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["textButton"],
											disabled: busy,
											title: "展开所有历史回合",
											onClick: expandAllSections,
											children: "展开全部"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["textButton"],
											disabled: busy,
											title: "收起所有历史回合",
											onClick: collapseAllSections,
											children: "收起全部"
										})] }),
										rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["textButton"],
												disabled: busy,
												title: "全选所有消息",
												onClick: selectAll,
												children: "全选"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["textButton"],
												disabled: busy,
												title: "反向选择消息",
												onClick: invertSelection,
												children: "反选"
											}),
											selectedKeys.size > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["textButton"],
												disabled: busy,
												title: "取消所有选择",
												onClick: clearSelection,
												children: "取消选择"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: MessageEditTimelineView_module_css_default["textButton"],
												"data-danger": true,
												disabled: busy,
												title: "批量删除选中的消息",
												onClick: deleteSelected,
												children: [
													"删除选中 (",
													selectedKeys.size,
													")"
												]
											})] })
										] }),
										changes.hasChanges ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: MessageEditTimelineView_module_css_default["changeSummary"],
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: MessageEditTimelineView_module_css_default["changeChip"],
													children: changeSummaryText(changes)
												}),
												history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: MessageEditTimelineView_module_css_default["textButton"],
													disabled: busy,
													title: "撤销最近一次草稿修改",
													onClick: undoDraft,
													children: "撤销修改"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: MessageEditTimelineView_module_css_default["textButton"],
													disabled: busy,
													title: "重置全部草稿回原始版本",
													onClick: resetDraft,
													children: "重置"
												})
											]
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MessageEditTimelineView_module_css_default["textButton"],
											disabled: busy,
											title: "撤销最近一次草稿修改",
											onClick: undoDraft,
											children: "撤销修改"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: MessageEditTimelineView_module_css_default["count"],
											children: String(timeline.messages.length)
										})] })
									]
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
									const isCollapsed = collapsedSectionIds.has(section.id);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: MessageEditTimelineView_module_css_default["turnSection"],
										"data-collapsed": isCollapsed || void 0,
										"data-dragging": draggingSectionId === section.id || void 0,
										"data-drag-over-top": dragOverSection?.id === section.id && dragOverSection.position === "top" || void 0,
										"data-drag-over-bottom": dragOverSection?.id === section.id && dragOverSection.position === "bottom" || void 0,
										onDragOver: (e) => {
											handleSectionDragOver(e, section);
										},
										onDrop: (e) => {
											handleSectionDrop(e, section);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: MessageEditTimelineView_module_css_default["turnHeader"],
											onClick: (e) => {
												const target = e.target;
												if (target && (target.tagName === "INPUT" || target.tagName === "BUTTON" || target.closest("button") || target.closest(`.${MessageEditTimelineView_module_css_default["dragHandle"]}`))) return;
												toggleSectionCollapse(section.id);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: MessageEditTimelineView_module_css_default["turnHeaderLeft"],
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: MessageEditTimelineView_module_css_default["collapseTurnButton"],
														title: isCollapsed ? "展开此回合" : "收起此回合",
														onClick: (e) => {
															e.stopPropagation();
															toggleSectionCollapse(section.id);
														},
														children: isCollapsed ? "▶" : "▼"
													}),
													!busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: MessageEditTimelineView_module_css_default["dragHandle"],
														draggable: true,
														title: "按住拖拽移动整个回合",
														onDragStart: (e) => {
															e.dataTransfer.effectAllowed = "move";
															e.dataTransfer.setData("text/plain", `section:${section.id}`);
															handleSectionDragStart(section);
														},
														onDragEnd: handleDragEnd,
														children: "⋮⋮"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														className: MessageEditTimelineView_module_css_default["checkbox"],
														checked: section.rows.length > 0 && section.rows.every((r) => selectedKeys.has(r.key)),
														ref: (el) => {
															if (el) {
																const count = section.rows.filter((r) => selectedKeys.has(r.key)).length;
																el.indeterminate = count > 0 && count < section.rows.length;
															}
														},
														disabled: busy,
														title: "选择/取消选择该回合下的所有消息",
														onChange: () => {
															toggleSelectSection(section);
														},
														onClick: (e) => {
															e.stopPropagation();
														}
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
														className: MessageEditTimelineView_module_css_default["turnTitle"],
														children: section.turnLabel
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: MessageEditTimelineView_module_css_default["turnPreview"],
														children: section.preview || "（空内容）"
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										}), !isCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: MessageEditTimelineView_module_css_default["messageList"],
											children: section.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageCard, {
												row,
												baseline: baseline.get(row.key),
												editing,
												selected: selectedKeys.has(row.key),
												disabled: busy,
												isDragging: draggingKey === row.key,
												dragOverPosition: dragOverTarget?.key === row.key ? dragOverTarget.position : null,
												onDragStart: handleDragStart,
												onDragEnd: handleDragEnd,
												onDragOver: handleDragOver,
												onDrop: handleDrop,
												onSelectToggle: toggleSelectRow,
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
			if (typeof document !== "undefined") for (const el of Array.from(document.querySelectorAll("[data-message-edit-injected]"))) el.remove();
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
				label: "编辑",
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