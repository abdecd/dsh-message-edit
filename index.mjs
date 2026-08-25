import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
//#region src/shared.ts
/** Same-origin endpoint owned by the Message Edit host plugin. */
const MESSAGE_EDIT_PATH = "/message-edit";
/** Timeline sits between Trajectory (10) and Prompt Studio (20). */
const MESSAGE_EDIT_VIEW_ORDER = 15;
/** Current durable event schema for structurally paired version effects. */
const MESSAGE_EDIT_VERSION_SCHEMA = 2;
//#endregion
//#region src/index.ts
KNOWN_SESSION_EVENT_TYPES.add("message-edit/version");
/** Stable Cordis plugin name. */
const name = "message-edit";
/** Public services used by the branch transaction and timeline projection. */
const inject = [
	"sessions",
	"agents",
	"sessionPersistence",
	"sessionQuery",
	"workspaceRegistry",
	"webServer"
];
function pairVersionEffect(sourceSessionId, effect) {
	return {
		schemaVersion: 2,
		effect: {
			...effect,
			id: crypto.randomUUID()
		},
		inverse: {
			kind: "restore-version",
			sessionId: sourceSessionId
		}
	};
}
function isTextualBlock(block) {
	return block?.type === "text" || block?.type === "reasoning";
}
function userText(message) {
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
function cloneUser(message, content = structuredClone(message.content)) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze(content),
		source: Object.freeze({ kind: "user" })
	});
}
/** Build a fresh user message from composed text. */
function newUserMessage(text) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze([{
			type: "text",
			text
		}]),
		source: Object.freeze({ kind: "user" })
	});
}
function newInjectedUserMessage(text) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze([{
			type: "text",
			text
		}]),
		source: Object.freeze({
			kind: "plugin",
			plugin: "context-injection"
		})
	});
}
function newToolResultMessage(text, callId = crypto.randomUUID()) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze([{
			type: "tool-result",
			toolCallId: callId,
			content: [{
				type: "text",
				text
			}]
		}]),
		source: Object.freeze({
			kind: "tool",
			callId
		})
	});
}
function replaceTextBlock(content, blockIndex, text) {
	const block = content[blockIndex];
	if (!isTextualBlock(block) && block?.type !== "tool-call") throw new Error("所选内容块不是可编辑文本。");
	return content.map((candidate, index) => index === blockIndex ? {
		type: "text",
		text
	} : structuredClone(candidate));
}
/** Fold turn brackets; open tails are included so generated nodes appear immediately. */
function closedTurns(events, includeOpen = true) {
	const result = [];
	let current;
	for (const event of events) {
		if (event.type === "turn/start") {
			if (includeOpen && current !== void 0) result.push({
				...current,
				endSeq: event.seq - 1
			});
			current = {
				turn: event.data.turn,
				startSeq: event.seq,
				assistants: [],
				events: []
			};
			continue;
		}
		if (current === void 0) {
			if (event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result" || event.type === "request/header" || event.type === "request/context") current = {
				turn: typeof event.data?.turn === "number" ? event.data.turn : 1,
				startSeq: event.seq,
				assistants: [],
				events: []
			};
			else continue;
		}
		if (event.type === "user/message") {
			if (event.data.source.kind === "user" && current.user === void 0) current.user = event;
			current.events.push(event);
			continue;
		}
		if (event.type === "assistant/message" && (event.data.turn === void 0 || event.data.turn === current.turn)) {
			current.assistants.push(event);
			current.events.push(event);
			continue;
		}
		if (event.type === "tool/result" && (event.data.turn === void 0 || event.data.turn === current.turn)) {
			current.events.push(event);
			continue;
		}
		if (event.type === "request/header" || event.type === "request/context") {
			current.events.push(event);
			continue;
		}
		if (event.type === "turn/end" && (event.data.turn === void 0 || event.data.turn === current.turn)) {
			result.push({
				...current,
				endSeq: event.seq
			});
			current = void 0;
		}
	}
	if (includeOpen && current !== void 0) result.push({
		...current,
		endSeq: Number.POSITIVE_INFINITY
	});
	return result;
}
function formatToolResultText(event) {
	const msg = event.data.message;
	const parts = [];
	for (const block of msg.content) if (block.type === "tool-result" && Array.isArray(block.content)) {
		for (const nested of block.content) if (nested.type === "text") parts.push(nested.text);
	}
	return parts.join("\n") || "";
}
function editableMessages(turns) {
	const result = [];
	for (const turn of turns) for (const event of turn.events) if (event.type === "request/header") {
		if (event.data.header?.system) result.push({
			key: `${String(event.seq)}:sys`,
			turn: turn.turn,
			eventSeq: event.seq,
			blockIndex: 0,
			kind: "system",
			text: event.data.header.system,
			time: event.time
		});
	} else if (event.type === "user/message") {
		const isDirectUser = event.data.source.kind === "user";
		for (const [blockIndex, block] of event.data.content.entries()) {
			if (block.type !== "text") continue;
			result.push({
				key: `${String(event.seq)}:${String(blockIndex)}`,
				turn: turn.turn,
				eventSeq: event.seq,
				blockIndex,
				kind: isDirectUser ? "user" : "context.inject",
				text: block.text,
				time: event.time
			});
		}
	} else if (event.type === "assistant/message") {
		for (const [blockIndex, block] of event.data.message.content.entries()) if (isTextualBlock(block)) result.push({
			key: `${String(event.seq)}:${String(blockIndex)}`,
			turn: turn.turn,
			eventSeq: event.seq,
			blockIndex,
			kind: block.type === "reasoning" ? "assistant.reasoning" : "assistant.response",
			text: block.text,
			time: event.time
		});
		else if (block?.type === "tool-call") result.push({
			key: `${String(event.seq)}:${String(blockIndex)}`,
			turn: turn.turn,
			eventSeq: event.seq,
			blockIndex,
			kind: "tool.call",
			text: block.arguments || "{}",
			time: event.time,
			toolName: block.name,
			callId: block.id
		});
	} else if (event.type === "tool/result") result.push({
		key: `${String(event.seq)}:res`,
		turn: turn.turn,
		eventSeq: event.seq,
		blockIndex: 0,
		kind: "tool.result",
		text: formatToolResultText(event),
		time: event.time,
		callId: event.data.message.source.callId
	});
	return result;
}
function retryableTurns(turns) {
	return turns.flatMap((turn) => turn.user === void 0 ? [] : [{
		turn: turn.turn,
		userEventSeq: turn.user.seq,
		preview: userText(turn.user.data),
		time: turn.user.time
	}]);
}
function downstreamUsers(turns, start) {
	return turns.slice(start).flatMap((turn) => turn.user === void 0 ? [] : [cloneUser(turn.user.data)]);
}
function assistantReplacement(event, blockIndex, text) {
	const replaced = replaceTextBlock(event.data.message.content, blockIndex, text).filter((block) => block.type === "text" || block.type === "reasoning" || block.type === "tool-call");
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "assistant",
		content: Object.freeze(replaced),
		source: Object.freeze({
			kind: "model",
			provider: event.data.message.source.provider,
			model: event.data.message.source.model
		})
	});
}
function editPlan(operation, turns, events, fallback, preferred) {
	const turnIndex = turns.findIndex((turn) => operation.eventSeq >= turn.startSeq && (turn.endSeq === Number.POSITIVE_INFINITY || operation.eventSeq <= turn.endSeq));
	const turn = turns[turnIndex];
	if (turn === void 0) throw new Error("所选消息不属于已落定回合。");
	const event = turn.user?.seq === operation.eventSeq ? turn.user : turn.assistants.find((candidate) => candidate.seq === operation.eventSeq) ?? turn.events.find((candidate) => candidate.seq === operation.eventSeq);
	if (event === void 0) throw new Error("所选消息不存在或不可编辑。");
	if (event.type === "user/message") {
		const before = event.data.content[operation.blockIndex];
		if (before?.type !== "text") throw new Error("所选用户消息块不是文本。");
		const edited = cloneUser(event.data, replaceTextBlock(event.data.content, operation.blockIndex, operation.text));
		const later = operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : [];
		return {
			boundary: turn.startSeq - 1,
			version: pairVersionEffect(operation.sessionId, {
				operation: "edit",
				cascade: operation.cascade,
				targetTurn: turn.turn,
				targetEventSeq: event.seq,
				targetBlockIndex: operation.blockIndex,
				blockKind: "user",
				before: before.text,
				after: operation.text
			}),
			manualTurns: [],
			queuedUsers: [edited, ...later]
		};
	}
	if (event.type === "request/header") {
		const beforeText = event.data.header?.system ?? "";
		const later = operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : [];
		const turnUser = turn.user ? [cloneUser(turn.user.data)] : [];
		return {
			boundary: turn.startSeq - 1,
			version: pairVersionEffect(operation.sessionId, {
				operation: "edit",
				cascade: operation.cascade,
				targetTurn: turn.turn,
				targetEventSeq: event.seq,
				targetBlockIndex: operation.blockIndex,
				blockKind: "system",
				before: beforeText,
				after: operation.text
			}),
			manualTurns: [],
			queuedUsers: [...turnUser, ...later]
		};
	}
	if (event.type !== "assistant/message") throw new Error("所选消息不存在或不可编辑。");
	const before = event.data.message.content[operation.blockIndex];
	if (!isTextualBlock(before) && before?.type !== "tool-call") throw new Error("所选助手消息块不是文本或工具调用。");
	const blockKind = before.type === "reasoning" ? "assistant.reasoning" : "assistant.response";
	const beforeText = isTextualBlock(before) ? before.text : `[工具调用: ${before.name || "tool"}]${before.arguments ? ` ${before.arguments}` : ""}`;
	if (turn.user === void 0) throw new Error("所选助手消息没有可重建的用户输入。");
	const route = modelRoute(events, fallback, preferred);
	const manualTurnItems = [{
		kind: "user",
		user: cloneUser(turn.user.data)
	}];
	if (turnIndex === 0) {
		const header = sourceLatestHeader(events, route);
		const context = sourceLatestContext(events, route);
		manualTurnItems.push({
			kind: "header",
			header,
			...context === void 0 ? {} : { context }
		});
	}
	manualTurnItems.push({
		kind: "assistant",
		assistant: assistantReplacement(event, operation.blockIndex, operation.text)
	});
	return {
		boundary: turn.startSeq - 1,
		version: pairVersionEffect(operation.sessionId, {
			operation: "edit",
			cascade: operation.cascade,
			targetTurn: turn.turn,
			targetEventSeq: event.seq,
			targetBlockIndex: operation.blockIndex,
			blockKind,
			before: beforeText,
			after: operation.text
		}),
		manualTurns: [{
			turn: turn.turn,
			items: manualTurnItems
		}],
		queuedUsers: operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : []
	};
}
function retryPlan(sessionId, turnNumber, cascade, turns) {
	const turnIndex = turns.findIndex((turn) => turn.turn === turnNumber);
	const turn = turns[turnIndex];
	if (turn?.user === void 0) throw new Error("所选回合没有可重放的用户输入。");
	return {
		boundary: turn.startSeq - 1,
		version: pairVersionEffect(sessionId, {
			operation: "retry",
			cascade,
			targetTurn: turn.turn,
			targetEventSeq: turn.user.seq
		}),
		manualTurns: [],
		queuedUsers: cascade === "preserve" ? downstreamUsers(turns, turnIndex) : [cloneUser(turn.user.data)]
	};
}
function rerollPlan(sessionId, turns) {
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		if (turn?.user === void 0) continue;
		const target = turn.assistants.findLast((event) => event.data.message.content.some(isTextualBlock));
		if (target === void 0) continue;
		return {
			boundary: turn.startSeq - 1,
			version: pairVersionEffect(sessionId, {
				operation: "reroll",
				cascade: "truncate",
				targetTurn: turn.turn,
				targetEventSeq: target.seq
			}),
			manualTurns: [],
			queuedUsers: [cloneUser(turn.user.data)]
		};
	}
	throw new Error("当前会话没有可重生成的已落定助手回复。");
}
/** Resolve client provenance only against the source session named by the operation. */
function sourceEvent(row, events) {
	if (row.sourceEventSeq === void 0) return void 0;
	const event = events[row.sourceEventSeq];
	if (event === void 0 || event.seq !== row.sourceEventSeq) throw new Error(`Fork 行引用的源事件 ${row.sourceEventSeq} 不存在。`);
	return event;
}
function sourceUserMessage(row, events, expectedSource) {
	const event = sourceEvent(row, events);
	if (event === void 0) return void 0;
	if (event.type !== "user/message" || event.data.source.kind !== expectedSource) throw new Error(`Fork 行 ${row.sourceEventSeq} 的来源不是预期的用户消息。`);
	const index = row.sourceBlockIndex;
	const block = index === void 0 ? void 0 : event.data.content[index];
	if (block?.type !== "text") throw new Error("Fork 行引用的用户文本块不存在。");
	if (block.text === row.text) return event.data;
	return {
		...event.data,
		content: event.data.content.map((candidate, at) => at === index ? {
			...candidate,
			text: row.text
		} : candidate)
	};
}
function sourceHeader(row, events, route) {
	const event = sourceEvent(row, events);
	if (event === void 0) return void 0;
	if (event.type !== "request/header") throw new Error("Fork 行引用的来源不是 request/header。");
	const base = event.data.header;
	const config = route !== void 0 ? {
		...base.config,
		provider: route.provider,
		model: route.model
	} : base.config;
	if (base.system === row.text && config === base.config) return base;
	return {
		...base,
		config,
		system: row.text
	};
}
function sourceLatestHeader(events, route, fallbackSystem) {
	const lastEvent = events.findLast((event) => event.type === "request/header");
	if (lastEvent !== void 0) {
		const base = lastEvent.data.header;
		return {
			...base,
			config: {
				...base.config,
				provider: route.provider,
				model: route.model
			},
			...fallbackSystem !== void 0 ? { system: fallbackSystem } : {}
		};
	}
	return {
		config: {
			provider: route.provider,
			model: route.model
		},
		...fallbackSystem !== void 0 && fallbackSystem.length > 0 ? { system: fallbackSystem } : {}
	};
}
function sourceLatestContext(events, route) {
	const lastEvent = events.findLast((event) => event.type === "request/context");
	if (lastEvent !== void 0) return {
		...lastEvent.data,
		provider: route.provider,
		model: route.model
	};
}
function sourceToolResult(row, events) {
	const event = sourceEvent(row, events);
	if (event === void 0) return void 0;
	if (event.type !== "tool/result") throw new Error("Fork 行引用的来源不是 tool/result。");
	const original = event.data.message;
	if (formatToolResultText(event) === row.text) return {
		toolResult: original,
		...event.data.error === void 0 ? {} : { toolResultError: event.data.error },
		...event.data.meta === void 0 ? {} : { toolResultMeta: event.data.meta }
	};
	const result = original.content[0];
	let replaced = false;
	const content = result.content.flatMap((block) => {
		if (block.type !== "text") return [block];
		if (replaced) return [];
		replaced = true;
		return [{
			...block,
			text: row.text
		}];
	});
	if (!replaced) content.unshift({
		type: "text",
		text: row.text
	});
	return {
		toolResult: {
			...original,
			content: [{
				...result,
				content
			}]
		},
		...event.data.error === void 0 ? {} : { toolResultError: event.data.error },
		...event.data.meta === void 0 ? {} : { toolResultMeta: event.data.meta }
	};
}
/** Recover the model-side call head when a result is selected without its call
* row, or when reading a branch produced by the older mismatched-ID Fork code. */
function fallbackAssistantForToolResult(row, events, route) {
	const resultEvent = sourceEvent(row, events);
	const result = resultEvent?.type === "tool/result" ? resultEvent : void 0;
	const callId = result?.data.message.source.callId ?? row.callId;
	if (callId === void 0) return void 0;
	let exactBlock;
	let nearbyBlock;
	let modelSource;
	let callEvent;
	const limit = result?.seq ?? Number.POSITIVE_INFINITY;
	for (const event of events) {
		if (event.seq >= limit) break;
		if (event.type === "tool/call" && event.data.callId === callId) callEvent = event;
		if (event.type !== "assistant/message") continue;
		for (const block of event.data.message.content) {
			if (block.type !== "tool-call") continue;
			if (block.id === callId) {
				exactBlock = block;
				modelSource = event.data.message.source;
			} else if (result !== void 0 && event.data.turn === result.data.turn && event.data.step === result.data.step) {
				nearbyBlock = block;
				modelSource = event.data.message.source;
			}
		}
	}
	const template = exactBlock ?? nearbyBlock;
	const call = template === void 0 ? {
		type: "tool-call",
		id: callId,
		name: callEvent?.data.name ?? row.toolName ?? "tool",
		arguments: callEvent?.data.arguments ?? "{}"
	} : {
		...template,
		id: callId
	};
	return {
		id: crypto.randomUUID(),
		role: "assistant",
		content: [call],
		source: modelSource ?? {
			kind: "model",
			provider: route.provider,
			model: route.model
		}
	};
}
/** Group draft rows into structured manual turns while cloning complete source
* messages for unchanged/provenanced rows. New rows alone use text reconstruction. */
function groupForkRowsToTurns(rows, route, events) {
	const turns = [];
	let current;
	let pendingAssistantRows = [];
	const flushAssistant = (turn) => {
		if (pendingAssistantRows.length === 0) return;
		const sourceSeq = pendingAssistantRows[0]?.sourceEventSeq;
		const source = sourceSeq === void 0 ? void 0 : sourceEvent(pendingAssistantRows[0], events);
		if (source !== void 0 && pendingAssistantRows.every((row) => row.sourceEventSeq === sourceSeq) && source?.type === "assistant/message") {
			const editable = source.data.message.content.map((block, index) => ({
				block,
				index
			})).filter(({ block }) => block.type === "text" || block.type === "reasoning" || block.type === "tool-call");
			if (editable.length === pendingAssistantRows.length && editable.every(({ index }, at) => pendingAssistantRows[at]?.sourceBlockIndex === index)) {
				const replacements = new Map(pendingAssistantRows.map((row) => [row.sourceBlockIndex, row]));
				const content = source.data.message.content.map((block, index) => {
					const row = replacements.get(index);
					if (row === void 0) return block;
					if (block.type === "text" || block.type === "reasoning") return block.text === row.text ? block : {
						...block,
						text: row.text
					};
					if (block.type === "tool-call") return block.arguments === row.text ? block : {
						...block,
						arguments: row.text
					};
					return block;
				});
				const unchanged = content.every((block, index) => block === source.data.message.content[index]);
				turn.items.push({
					kind: "assistant",
					assistant: unchanged ? source.data.message : {
						...source.data.message,
						content
					},
					...source.data.usage === void 0 ? {} : { assistantUsage: source.data.usage },
					...source.data.interrupted === void 0 ? {} : { assistantInterrupted: source.data.interrupted }
				});
				pendingAssistantRows = [];
				return;
			}
		}
		const content = pendingAssistantRows.flatMap((row) => {
			if (row.kind === "assistant.reasoning") return row.text.length === 0 ? [] : [{
				type: "reasoning",
				text: row.text
			}];
			if (row.kind === "assistant.response") return row.text.length === 0 ? [] : [{
				type: "text",
				text: row.text
			}];
			if (row.kind === "tool.call") return [{
				type: "tool-call",
				id: row.callId || crypto.randomUUID(),
				name: row.toolName || "tool",
				arguments: row.text || "{}"
			}];
			return [];
		});
		if (content.length > 0) turn.items.push({
			kind: "assistant",
			assistant: {
				id: crypto.randomUUID(),
				role: "assistant",
				content,
				source: {
					kind: "model",
					provider: route.provider,
					model: route.model
				}
			}
		});
		pendingAssistantRows = [];
	};
	for (const row of rows) {
		if (row.kind === "user") {
			if (current !== void 0) flushAssistant(current);
			current = {
				turn: turns.length + 1,
				items: []
			};
			current.items.push({
				kind: "user",
				user: sourceUserMessage(row, events, "user") ?? newUserMessage(row.text)
			});
			turns.push(current);
			continue;
		}
		if (current === void 0) {
			current = {
				turn: turns.length + 1,
				items: []
			};
			turns.push(current);
		}
		if (row.kind === "assistant.reasoning" || row.kind === "assistant.response" || row.kind === "tool.call") {
			const pendingSource = pendingAssistantRows[0]?.sourceEventSeq;
			if (pendingAssistantRows.length > 0 && pendingSource !== row.sourceEventSeq) flushAssistant(current);
			pendingAssistantRows.push(row);
		} else if (row.kind === "system") {
			flushAssistant(current);
			const header = sourceHeader(row, events, route) ?? {
				config: {
					provider: route.provider,
					model: route.model
				},
				system: row.text
			};
			const context = sourceLatestContext(events, route);
			current.items.push({
				kind: "header",
				header,
				...context === void 0 ? {} : { context }
			});
		} else if (row.kind === "context.inject") {
			flushAssistant(current);
			current.items.push({
				kind: "user",
				user: sourceUserMessage(row, events, "plugin") ?? newInjectedUserMessage(row.text)
			});
		} else if (row.kind === "tool.result") {
			flushAssistant(current);
			const cloned = sourceToolResult(row, events);
			const toolResult = cloned?.toolResult ?? newToolResultMessage(row.text, row.callId);
			const fallbackAssistant = fallbackAssistantForToolResult(row, events, route) ?? {
				id: crypto.randomUUID(),
				role: "assistant",
				content: [{
					type: "tool-call",
					id: toolResult.source.callId,
					name: row.toolName || "tool",
					arguments: "{}"
				}],
				source: {
					kind: "model",
					provider: route.provider,
					model: route.model
				}
			};
			current.items.push({
				kind: "tool.result",
				...cloned ?? {},
				toolResult,
				toolResultFallbackAssistant: fallbackAssistant
			});
		}
	}
	if (current !== void 0) flushAssistant(current);
	const filteredTurns = turns.filter((turn) => turn.items.length > 0);
	if (!filteredTurns.some((turn) => turn.items.some((item) => item.kind === "header")) && filteredTurns.length > 0) {
		const header = sourceLatestHeader(events, route);
		const context = sourceLatestContext(events, route);
		const firstTurn = filteredTurns[0];
		const headerItem = {
			kind: "header",
			header,
			...context === void 0 ? {} : { context }
		};
		const userIndex = firstTurn.items.findIndex((item) => item.kind === "user");
		if (userIndex !== -1) firstTurn.items.splice(userIndex + 1, 0, headerItem);
		else firstTurn.items.unshift(headerItem);
	}
	return filteredTurns;
}
function forkPlan(operation, events, fallback, preferred) {
	const rows = operation.rows;
	let queuedUsers = [];
	let seedRows = rows;
	const last = rows[rows.length - 1];
	if (last !== void 0 && last.kind === "user") {
		queuedUsers = [sourceUserMessage(last, events, "user") ?? newUserMessage(last.text)];
		seedRows = rows.slice(0, -1);
	}
	const route = modelRoute(events, fallback, preferred);
	const manualTurns = groupForkRowsToTurns(seedRows, route, events);
	return {
		boundary: -1,
		version: pairVersionEffect(operation.sessionId, {
			operation: "fork",
			cascade: "truncate",
			targetTurn: 0,
			targetEventSeq: 0,
			rowCount: rows.length
		}),
		manualTurns,
		queuedUsers
	};
}
function planOperation(operation, events, fallback, preferred) {
	const turns = closedTurns(events);
	const route = preferred ?? ("route" in operation ? operation.route : void 0);
	switch (operation.action) {
		case "edit": return editPlan(operation, turns, events, fallback, route);
		case "reroll": return rerollPlan(operation.sessionId, turns);
		case "retry": return retryPlan(operation.sessionId, operation.turn, operation.cascade, turns);
		case "fork": return forkPlan(operation, events, fallback, route);
	}
}
function modelRoute(events, fallback, preferred) {
	if (preferred?.provider && preferred?.model) return {
		provider: preferred.provider,
		model: preferred.model
	};
	const config = events.findLast((event) => event.type === "request/header")?.data.header.config;
	const provider = preferred?.provider ?? config?.provider ?? fallback?.provider;
	const model = preferred?.model ?? config?.model ?? fallback?.model;
	if (provider === void 0 || provider.length === 0 || model === void 0 || model.length === 0) throw new Error("无法从会话历史解析模型路由。");
	return {
		provider,
		model
	};
}
function agentOptions(events, fallback, preferred) {
	const route = modelRoute(events, fallback, preferred);
	const maxTokens = events.findLast((event) => event.type === "request/header")?.data.header.config?.maxTokens ?? fallback?.maxTokens;
	return {
		...route,
		...maxTokens === void 0 ? {} : { maxTokens }
	};
}
async function withSourceAgent(ctx, sessionId, operation) {
	let handle;
	let agent = ctx.agents.get(sessionId);
	if (agent === void 0) {
		const snapshot = await ctx.sessionQuery.readSession(sessionId);
		handle = await ctx.agents.resume({
			resumeSessionId: sessionId,
			agentOptions: agentOptions(snapshot.events)
		});
		agent = handle.agent;
	}
	try {
		return await agent.runMaintenance(async () => operation(agent));
	} finally {
		await handle?.dispose();
	}
}
function inheritedSeed(source, boundary) {
	if (boundary === -1) return [];
	const boundaryEvent = source.events[boundary];
	if (boundary < 0 || boundaryEvent === void 0 || boundaryEvent.seq !== boundary) throw new Error("分支边界不是连续会话事件。");
	return source.events.slice(0, boundary + 1);
}
/** Build seed envelopes locally; Session construction performs canonical validation and freezing. */
function appendLogSeedEvent(events, type, data, ignorable = false) {
	events.push({
		type,
		seq: events.length,
		time: Date.now(),
		data,
		...ignorable ? { ignorable: true } : {}
	});
}
function appendSurfaceSeedEvent(events, type, data, intent) {
	events.push({
		type,
		seq: events.length,
		time: Date.now(),
		data,
		surfaceOp: intent.surfaceOp,
		...intent.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: intent.sourceEventSeqs }
	});
}
function appendManualTurn(events, manual, emittedCallIds) {
	const { turn, items } = manual;
	appendLogSeedEvent(events, "turn/start", { turn });
	let step = 1;
	let stepOpen = false;
	const pendingCalls = /* @__PURE__ */ new Set();
	const closeStep = () => {
		if (!stepOpen) return;
		appendLogSeedEvent(events, "step/end", {
			turn,
			step
		});
		step += 1;
		stepOpen = false;
		pendingCalls.clear();
	};
	const openAssistantStep = (assistant, usage, interrupted) => {
		closeStep();
		appendLogSeedEvent(events, "step/start", {
			turn,
			step
		});
		stepOpen = true;
		appendSurfaceSeedEvent(events, "assistant/message", {
			turn,
			step,
			message: assistant,
			...usage === void 0 ? {} : { usage },
			...interrupted === void 0 ? {} : { interrupted }
		}, {
			surfaceOp: "append",
			sourceEventSeqs: []
		});
		for (const block of assistant.content) {
			if (block.type !== "tool-call") continue;
			if (!emittedCallIds.has(block.id)) {
				appendLogSeedEvent(events, "tool/call", {
					turn,
					step,
					callId: block.id,
					name: block.name,
					arguments: block.arguments
				});
				emittedCallIds.add(block.id);
			}
			pendingCalls.add(block.id);
		}
		if (pendingCalls.size === 0) closeStep();
	};
	for (const item of items) if (item.kind === "header") {
		closeStep();
		if (item.header !== void 0) appendLogSeedEvent(events, "request/header", {
			header: item.header,
			reason: item.headerReason ?? (events.some((e) => e.type === "request/header") ? "change" : "initial")
		});
		if (item.context !== void 0) appendLogSeedEvent(events, "request/context", item.context);
	} else if (item.kind === "user" && item.user !== void 0) {
		closeStep();
		appendSurfaceSeedEvent(events, "user/message", item.user, { surfaceOp: "append" });
	} else if (item.kind === "assistant" && item.assistant !== void 0) openAssistantStep(item.assistant, item.assistantUsage, item.assistantInterrupted);
	else if (item.kind === "tool.result" && item.toolResult !== void 0) {
		let toolResult = item.toolResult;
		let callId = toolResult.source.callId;
		if (stepOpen && !pendingCalls.has(callId) && pendingCalls.size > 0) {
			const inferred = pendingCalls.values().next().value;
			if (inferred !== void 0) {
				const block = toolResult.content[0];
				callId = inferred;
				toolResult = {
					...toolResult,
					source: {
						...toolResult.source,
						callId
					},
					content: [{
						...block,
						toolCallId: callId
					}]
				};
			}
		}
		if (!stepOpen || !pendingCalls.has(callId)) {
			if (!emittedCallIds.has(callId) && item.toolResultFallbackAssistant !== void 0) openAssistantStep(item.toolResultFallbackAssistant);
			else {
				if (!stepOpen) {
					appendLogSeedEvent(events, "step/start", {
						turn,
						step
					});
					stepOpen = true;
				}
				pendingCalls.add(callId);
			}
		}
		if (!stepOpen || !pendingCalls.has(callId)) throw new Error(`无法为工具结果 ${callId} 恢复对应的工具调用。`);
		appendSurfaceSeedEvent(events, "tool/result", {
			turn,
			step,
			message: toolResult,
			...item.toolResultError === void 0 ? {} : { error: item.toolResultError },
			...item.toolResultMeta === void 0 ? {} : { meta: item.toolResultMeta }
		}, { surfaceOp: "append" });
		pendingCalls.delete(callId);
		if (pendingCalls.size === 0) closeStep();
	}
	closeStep();
	appendLogSeedEvent(events, "turn/end", {
		turn,
		reason: { kind: "completed" }
	});
}
function versionSeed(source, plan) {
	const events = inheritedSeed(source, plan.boundary);
	const inheritedLength = events.length;
	const emittedCallIds = /* @__PURE__ */ new Set();
	for (const event of events) if (event.type === "tool/call" && typeof event.data?.callId === "string") emittedCallIds.add(event.data.callId);
	appendLogSeedEvent(events, "message-edit/version", plan.version, true);
	for (const manual of plan.manualTurns) appendManualTurn(events, manual, emittedCallIds);
	return {
		events,
		inheritedLength
	};
}
function sessionPreset(session) {
	for (let index = session.events.length - 1; index >= 0; index -= 1) {
		const event = session.events[index];
		if (event?.type === "agent-preset/selected") return event.data.agentPreset;
	}
	return session.header.agentPreset;
}
function resolveSourceTitle(ctx, source, proposedTitle) {
	if (typeof proposedTitle === "string" && proposedTitle.length > 0) return proposedTitle;
	const titleService = ctx.get("sessionTitle");
	if (titleService?.resolve !== void 0) try {
		const resolved = titleService.resolve(source);
		if (typeof resolved === "string" && resolved.length > 0) return resolved;
	} catch {}
	for (let index = source.events.length - 1; index >= 0; index -= 1) {
		const event = source.events[index];
		if (event?.type === "session/title" && typeof event.data === "object" && event.data !== null && "title" in event.data) {
			const title = event.data.title;
			if (typeof title === "string" && title.length > 0) return title;
		}
	}
}
async function createVersionAgent(ctx, source, childId, plan, options, title, cwd) {
	const seed = versionSeed(source, plan);
	if (title !== void 0 && (plan.boundary === -1 || plan.version.effect.operation === "fork")) appendLogSeedEvent(seed.events, "session/title", { title });
	const presets = ctx.get("agentPresets");
	const presetId = sessionPreset(source);
	let agentPreset;
	let setup;
	if (presets !== void 0 && presetId !== void 0) {
		const resolved = (await presets.resolve(presetId)).id;
		agentPreset = resolved;
		setup = async (agentCtx) => {
			await presets.mount(agentCtx, resolved);
		};
	}
	const childCwd = cwd ?? source.header.cwd;
	const child = await ctx.agents.create({
		sessionId: childId,
		seed: seed.events,
		meta: {
			...childCwd === void 0 ? {} : { cwd: childCwd },
			parentSession: source.id,
			seedLength: seed.inheritedLength,
			...agentPreset === void 0 ? {} : { agentPreset }
		},
		agentOptions: options,
		...setup === void 0 ? {} : { setup }
	});
	try {
		if (title !== void 0) {
			const titleService = ctx.get("sessionTitle");
			if (titleService?.rename !== void 0) try {
				titleService.rename(child.agent.session, title);
			} catch {}
		}
		await ctx.sessions.flush(child.agent.session);
		return child;
	} catch (error) {
		await child.dispose();
		throw error;
	}
}
function sourceWorkspace(ctx, sessionId) {
	return ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId));
}
function operationWorkspace(ctx, sourceId, operation) {
	if (operation.action === "fork" && operation.workspaceId !== void 0) {
		const workspace = ctx.workspaceRegistry.get(operation.workspaceId);
		if (workspace === void 0) throw new Error("目标工作区不存在。");
		return workspace;
	}
	return sourceWorkspace(ctx, sourceId);
}
async function recoverOperation(inverses) {
	const failures = [];
	for (const inverse of inverses.reverse()) try {
		await inverse();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0) throw new AggregateError(failures, "版本操作恢复失败。");
}
async function runOperation(ctx, operation) {
	const sourceId = sessionIdOf(operation.sessionId);
	return withSourceAgent(ctx, sourceId, async (source) => {
		const childId = sessionIdOf(`session-${crypto.randomUUID()}`);
		const inverses = [];
		try {
			const events = source.session.events;
			const title = resolveSourceTitle(ctx, source.session, operation.title);
			const workspace = operationWorkspace(ctx, sourceId, operation);
			const targetCwd = operation.action === "fork" && operation.workspaceId !== void 0 ? workspace?.path : void 0;
			const plan = planOperation(operation, events, source.options, operation.route);
			const options = agentOptions(events, source.options, operation.route);
			const child = await createVersionAgent(ctx, source.session, childId, plan, options, title, targetCwd);
			inverses.push(() => child.dispose());
			if (workspace !== void 0) {
				await workspace.attachSession(childId);
				inverses.push(() => workspace.detachSession(childId));
				if (operation.action === "fork" && operation.workspaceId !== void 0) for (const candidate of ctx.workspaceRegistry.list()) {
					if (candidate.id === workspace.id || !candidate.sessionIds.includes(childId)) continue;
					await candidate.detachSession(childId);
					inverses.push(() => candidate.attachSession(childId));
				}
			}
			for (const message of plan.queuedUsers) child.agent.followup(message);
			inverses.length = 0;
			return {
				sessionId: childId,
				queuedTurns: plan.queuedUsers.length
			};
		} catch (error) {
			try {
				await recoverOperation(inverses);
			} catch (recoveryError) {
				throw new AggregateError([error, recoveryError], "版本操作及其恢复均失败。");
			}
			throw error;
		}
	});
}
function ownVersionEvent(header, events) {
	const inherited = header.seedLength ?? 0;
	const ownEvents = events.filter((event) => event.type === "message-edit/version" && event.seq >= inherited);
	if (ownEvents.length === 0) return void 0;
	if (ownEvents.length > 1) throw new Error(`会话 ${header.id} 包含多个自身版本效果。`);
	const event = ownEvents[0];
	if (event === void 0) return void 0;
	const parent = header.parentSession;
	if ("schemaVersion" in event.data) {
		const version = event.data;
		if (version.schemaVersion !== 2) throw new Error(`会话 ${header.id} 使用不支持的版本效果结构。`);
		if (version.inverse.kind !== "restore-version" || parent === void 0 || version.inverse.sessionId !== parent) throw new Error(`会话 ${header.id} 的版本效果与逆不匹配。`);
		return {
			effect: version.effect,
			inverseSessionId: version.inverse.sessionId,
			time: event.time
		};
	}
	const legacy = event.data;
	if (parent === void 0 || legacy.sourceSessionId !== parent) throw new Error(`会话 ${header.id} 的旧版恢复目标与父版本不匹配。`);
	return {
		effect: {
			id: `legacy:${header.id}:${String(event.seq)}`,
			operation: legacy.operation,
			cascade: legacy.cascade,
			targetTurn: legacy.targetTurn,
			targetEventSeq: legacy.targetEventSeq,
			...legacy.targetBlockIndex === void 0 ? {} : { targetBlockIndex: legacy.targetBlockIndex },
			...legacy.blockKind === void 0 ? {} : { blockKind: legacy.blockKind },
			...legacy.before === void 0 ? {} : { before: legacy.before },
			...legacy.after === void 0 ? {} : { after: legacy.after }
		},
		inverseSessionId: legacy.sourceSessionId,
		time: event.time
	};
}
function flattenLineage(root, descendants) {
	const result = [{
		record: root,
		depth: 0
	}];
	const visit = (nodes, depth) => {
		const ordered = [...nodes].sort((left, right) => left.session.header.createdAt - right.session.header.createdAt || String(left.session.header.id).localeCompare(String(right.session.header.id)));
		for (const node of ordered) {
			result.push({
				record: node.session,
				depth
			});
			visit(node.descendants, depth + 1);
		}
	};
	visit(descendants, 1);
	return result;
}
/** Bounded parallel inspection of persisted branches; matches the corpus worker shape. */
const TIMELINE_READ_CONCURRENCY = 4;
async function mapConcurrent(items, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	const run = async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index]);
		}
	};
	const workers = Math.min(TIMELINE_READ_CONCURRENCY, items.length);
	await Promise.all(Array.from({ length: workers }, () => run()));
	return results;
}
/** Full log for the requested session: live borrow, persisted inspection, query fallback. */
async function readCurrentLog(ctx, sessionId) {
	const live = ctx.sessions.get(sessionId);
	if (live !== void 0) return live.events;
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) return (await persistence.inspect(sessionId)).events;
	return (await ctx.sessionQuery.readSession(sessionId)).events;
}
/** Own-version scan window for one lineage node: the tail from the durable
* seed boundary is enough, and root nodes cannot carry a version effect. */
async function versionLog(ctx, record) {
	const inherited = record.header.seedLength ?? 0;
	const live = ctx.sessions.get(record.header.id);
	if (live !== void 0) return live.events.slice(inherited);
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) return (await persistence.readFrom(record.header.id, inherited)).events;
	return (await ctx.sessionQuery.readSession(record.header.id)).events.slice(inherited);
}
async function timeline(ctx, sessionId) {
	const targetTrace = await ctx.sessionQuery.traceSession(sessionId);
	const rootId = targetTrace.complete ? targetTrace.root.header.id : targetTrace.ancestors.at(-1)?.header.id ?? sessionId;
	const rootTrace = rootId === sessionId ? targetTrace : await ctx.sessionQuery.traceSession(rootId);
	const lineage = flattenLineage(rootTrace.target, rootTrace.descendants);
	const logs = await mapConcurrent(lineage, async ({ record }) => {
		if (record.header.id === sessionId) return readCurrentLog(ctx, sessionId);
		if (record.header.parentSession === void 0) return [];
		return versionLog(ctx, record);
	});
	const recordsById = new Map(lineage.map(({ record }) => [record.header.id, record]));
	const currentPath = /* @__PURE__ */ new Set();
	let pathId = sessionId;
	while (pathId !== void 0 && !currentPath.has(pathId)) {
		currentPath.add(pathId);
		pathId = recordsById.get(pathId)?.header.parentSession;
	}
	const versions = lineage.map(({ record, depth }, index) => {
		const version = ownVersionEvent(record.header, logs[index] ?? []);
		return {
			sessionId: record.header.id,
			...record.header.parentSession === void 0 ? {} : { parentSessionId: record.header.parentSession },
			...version === void 0 ? {} : {
				effectId: version.effect.id,
				inverseSessionId: version.inverseSessionId
			},
			createdAt: version?.time ?? record.header.createdAt,
			depth,
			current: record.header.id === sessionId,
			onCurrentEffectPath: currentPath.has(record.header.id),
			...version === void 0 ? {} : {
				operation: version.effect.operation,
				cascade: version.effect.cascade,
				targetTurn: version.effect.targetTurn,
				...version.effect.blockKind === void 0 ? {} : { blockKind: version.effect.blockKind },
				...version.effect.before === void 0 ? {} : { before: version.effect.before },
				...version.effect.after === void 0 ? {} : { after: version.effect.after },
				...version.effect.rowCount === void 0 ? {} : { rowCount: version.effect.rowCount }
			}
		};
	});
	const effectIds = /* @__PURE__ */ new Set();
	for (const version of versions) {
		if (version.effectId === void 0) continue;
		if (effectIds.has(version.effectId)) throw new Error(`版本效果 ${version.effectId} 重复。`);
		effectIds.add(version.effectId);
	}
	const versionsById = new Map(versions.map((version) => [version.sessionId, version]));
	const undoStack = [];
	let undoCursor = versionsById.get(sessionId);
	while (undoCursor?.inverseSessionId !== void 0) {
		const inverseId = undoCursor.inverseSessionId;
		if (undoStack.includes(inverseId)) throw new Error("版本效果逆链包含循环。");
		if (!versionsById.has(inverseId)) throw new Error(`恢复目标 ${inverseId} 不在可见版本树中。`);
		undoStack.push(inverseId);
		undoCursor = versionsById.get(inverseId);
	}
	const redoSessionIds = versions.filter((version) => version.inverseSessionId === sessionId).map((version) => version.sessionId);
	const currentIndex = versions.findIndex((version) => version.current);
	const currentLog = logs[currentIndex];
	if (currentIndex < 0 || currentLog === void 0) throw new Error("当前版本不在版本树中。");
	const turns = closedTurns(currentLog);
	return {
		sessionId,
		messages: editableMessages(turns),
		retryableTurns: retryableTurns(turns),
		versions,
		undoStack,
		redoSessionIds
	};
}
function objectValue(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("请求体必须是 JSON 对象。");
	return value;
}
function sessionIdOf(value) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError("sessionId 必须是非空字符串。");
	return value;
}
function optionalWorkspaceIdOf(value) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.length === 0) throw new TypeError("workspaceId 必须是非空字符串。");
	return value;
}
function integerOf(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} 必须是非负安全整数。`);
	return value;
}
function blockKindOf(value, label) {
	if (value === "user" || value === "assistant.reasoning" || value === "assistant.response" || value === "system" || value === "tool.call" || value === "tool.result" || value === "context.inject") return value;
	throw new TypeError(`${label} 消息块类型无效。`);
}
function cascadeOf(value) {
	if (value !== "truncate" && value !== "preserve") throw new TypeError("cascade 必须是 truncate 或 preserve。");
	return value;
}
/** Optional composer-forwarded model selection; absence keeps the logged route. */
function modelRouteOf(value) {
	if (value === void 0) return void 0;
	const record = objectValue(value);
	const provider = record["provider"];
	const model = record["model"];
	if (typeof provider !== "string" || provider.length === 0) throw new TypeError("route.provider 必须是非空字符串。");
	if (typeof model !== "string" || model.length === 0) throw new TypeError("route.model 必须是非空字符串。");
	return {
		provider,
		model
	};
}
function decodeOperation(value) {
	const record = objectValue(value);
	const sessionId = sessionIdOf(record["sessionId"]);
	const route = modelRouteOf(record["route"]);
	const title = typeof record["title"] === "string" && record["title"].length > 0 ? record["title"] : void 0;
	switch (record["action"]) {
		case "edit":
			if (typeof record["text"] !== "string") throw new TypeError("text 必须是字符串。");
			return {
				action: "edit",
				sessionId,
				eventSeq: integerOf(record["eventSeq"], "eventSeq"),
				blockIndex: integerOf(record["blockIndex"], "blockIndex"),
				text: record["text"],
				cascade: cascadeOf(record["cascade"]),
				...route === void 0 ? {} : { route },
				...title === void 0 ? {} : { title }
			};
		case "reroll": return {
			action: "reroll",
			sessionId,
			...route === void 0 ? {} : { route },
			...title === void 0 ? {} : { title }
		};
		case "retry": return {
			action: "retry",
			sessionId,
			turn: integerOf(record["turn"], "turn"),
			cascade: cascadeOf(record["cascade"]),
			...route === void 0 ? {} : { route },
			...title === void 0 ? {} : { title }
		};
		case "fork": {
			const workspaceId = optionalWorkspaceIdOf(record["workspaceId"]);
			const rowsValue = record["rows"];
			if (!Array.isArray(rowsValue)) throw new TypeError("rows 必须是数组。");
			return {
				action: "fork",
				sessionId,
				rows: rowsValue.map((row, index) => {
					const item = objectValue(row);
					const kind = blockKindOf(item["kind"], `rows[${index}].kind`);
					if (typeof item["text"] !== "string") throw new TypeError(`rows[${index}].text 必须是字符串。`);
					const toolName = typeof item["toolName"] === "string" ? item["toolName"] : void 0;
					const callId = typeof item["callId"] === "string" ? item["callId"] : void 0;
					const sourceEventSeq = item["sourceEventSeq"] === void 0 ? void 0 : integerOf(item["sourceEventSeq"], `rows[${index}].sourceEventSeq`);
					const sourceBlockIndex = item["sourceBlockIndex"] === void 0 ? void 0 : integerOf(item["sourceBlockIndex"], `rows[${index}].sourceBlockIndex`);
					return {
						kind,
						text: item["text"],
						...toolName ? { toolName } : {},
						...callId ? { callId } : {},
						...sourceEventSeq === void 0 ? {} : { sourceEventSeq },
						...sourceBlockIndex === void 0 ? {} : { sourceBlockIndex }
					};
				}),
				...workspaceId === void 0 ? {} : { workspaceId },
				...route === void 0 ? {} : { route },
				...title === void 0 ? {} : { title }
			};
		}
		default: throw new TypeError("action 必须是 edit、reroll、retry 或 fork。");
	}
}
function requestJson(request) {
	return new Promise((resolve, reject) => {
		const decoder = new TextDecoder();
		let text = "";
		request.on("data", (chunk) => {
			text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
		});
		request.on("end", () => {
			try {
				text += decoder.decode();
				resolve(JSON.parse(text));
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}
function respondJson(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(JSON.stringify(value));
}
async function handleRoute(ctx, request, response) {
	try {
		if (request.method === "GET") {
			respondJson(response, 200, await timeline(ctx, sessionIdOf(new URL(request.url ?? "/message-edit", "http://message-edit.local").searchParams.get("sessionId"))));
			return;
		}
		if (request.method === "POST") {
			respondJson(response, 200, await runOperation(ctx, decodeOperation(await requestJson(request))));
			return;
		}
		response.writeHead(405);
		response.end();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		respondJson(response, error instanceof TypeError ? 400 : 409, { error: message });
	}
}
/** Register the reversible route contribution. */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: MESSAGE_EDIT_PATH,
		handler: (request, response) => handleRoute(ctx, request, response)
	}), "message-edit: HTTP route");
}
//#endregion
export { MESSAGE_EDIT_PATH, MESSAGE_EDIT_VERSION_SCHEMA, MESSAGE_EDIT_VIEW_ORDER, apply, inject, name };
