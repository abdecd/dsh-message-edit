# DSH Message Edit

[![npm version](https://img.shields.io/npm/v/dsh-message-edit)](https://www.npmjs.com/package/dsh-message-edit)
[![npm downloads](https://img.shields.io/npm/dm/dsh-message-edit)](https://www.npmjs.com/package/dsh-message-edit)
[![license](https://img.shields.io/npm/l/dsh-message-edit)](LICENSE)

`dsh-message-edit`（[npm](https://www.npmjs.com/package/dsh-message-edit) · [GitHub](https://github.com/Moeblack/dsh-message-edit)）为 DeepSeek Harness 补充基于事件溯源的「消息编辑与重生成」能力。插件不改写历史事件，也不修改 DSH 引擎内部；每次编辑、重生成、重试或 Fork 都会创建一个新的会话版本，原会话始终保留并可随时切回。

```bash
dsh plugin --profile web add dsh-message-edit
```

## 功能

- **编辑消息**：可编辑已落定的用户文本、`assistant.reasoning` 思考块与 `assistant.response` 回复文本。
- **重生成**：从最后一条已落定助手回复所属回合之前分支，使用原用户输入重新生成。
- **重试任意回合**：在 Timeline 中选择任意历史回合重新执行。
- **自由 CRUD + Fork**：在 Timeline 右列对已落定消息随意增、删、改，草稿实时显示「新增 · 编辑 · 删除」计数并可一键重置；点击 **Fork** 按草稿内容重建消息历史并生成新版本。以用户消息结尾时，该消息作为新提示排入新会话并生成新的助手回复；以助手消息结尾或历史为空时只创建分支、不生成回复。Fork 顶部可选择目标工作区；不选择时沿用源会话工作区。
- **级联策略**：
  - `truncate`（默认）：只重新执行目标输入，删除该点之后的旧后续。
  - `preserve`：保留后续用户输入，并在新分支中依次重新执行；助手输出与工具链全部重新生成。
- **模型跟随聊天框**：编辑、重生成、重试与 Fork 触发的新回复默认使用底部聊天框当前选中的模型（`session.models` 的 `current` 选择），而不是源历史里最后一次记录请求的旧模型；仅在无法读取当前选择时（如子代理会话、连接不可用）回退到历史推导的路由。
- **版本切换**：会话标题栏的 `←` 撤销当前原子效果，`→` 重施加最新直接子效果；Timeline 展示完整已知分支树、操作时间、编辑前后内容与当前版本。
- **Timeline 标签页**：注册到 `conversation.view`，`order: 15`，位于 Trajectory（10）与 Prompt Studio（20）之间。

## 设计

### 时间可组合性

插件把**完整回合**作为效果原子。目标回合的 `turn/start`、模型请求、工具调用、工具结果与 `turn/end` 不会被局部复制后拼接；新版本从该回合之前的闭合边界分支：

1. 用户消息编辑、Reroll 与 Retry：回退整个目标回合，再把目标用户输入作为新回合交给 Agent。
2. 助手块编辑：回退整个目标回合，以原用户输入和编辑后的助手内容构造一个新的完整闭合回合；原工具链不进入新版本。选择 `preserve` 时，后续用户输入再依次交给 Agent，产生新的完整工具链。
3. Fork：不继承任何前缀（`boundary: -1`），草稿中的消息行就是新历史本身，回合从 1 重新编号；用户行开启回合，助手思考/回复行挂到当前回合。若草稿以用户消息结尾，该消息不进 seed 而是经 `child.agent.followup()` 排入以触发新回复；以助手消息结尾或历史为空时只创建分支、不生成回复。
4. 每个版本都追加一个不可拆分的 `message-edit/version` 效果对：`effect` 记录正向效果，`inverse` 记录恢复目标。父版本链自动导出组合逆；恢复不是删除事件，而是沿逆链切换到仍然存在的版本。
5. 消息历史变换彼此不交换，因此撤销遵循 LIFO：一次只撤销当前原子效果并保留更早效果；各后继分支始终保留，可从父版本重新施加。

### 分支与 Agent 接线

旧实现先用短生命周期 Session 暂存分支、落盘、移除 live Session，再用 `agents.resume()` 重建 Agent。这个过程存在两个分离的生命周期边界：暂存日志已经持久化后，Agent 仍可能创建失败。现实现只使用 `AgentRegistry.create()` 已公开的 `seed + meta` 事务缝：

1. 在来源 Agent 的 runMaintenance() 内，从已闭合边界取得不可变 seed；第一回合之前使用空 seed。
2. 用本地等价的纯事件构造器把版本效果对与可选手工助手回合加入 seed，再调用 `ctx.agents.create({ seed, meta })`。Session 在 Agent 构造前一次性验证完整 seed；任何一步失败都会由 AgentFactory 的结构性逆撤销，外部观察者看不到半成品 Session，Agent 的回合计数也直接从完整历史初始化。
3. 发布后调用 `ctx.sessions.flush()`，在 HTTP 操作成功前建立耐久性屏障。
4. Workspace 挂接与 child Agent 生命周期分别返回原子逆；操作失败时按相反顺序组合恢复。随后通过 `child.agent.followup()` 排入需要重新执行的用户输入。

此路径不接触 `ReactLoopAgent`、AgentLoop 私有方法或 apiproxy 的收窄 fork RPC；分支 seed 仍由同一 Session 公共事件契约验证。

### 空间可组合性

- Host 只依赖公开的 `sessions`、`agents`、`sessionPersistence`、`sessionQuery`、`workspaceRegistry` 与 `webServer` 服务。
- Browser 只通过 `slots`、`conversation`、`connection` 与 runtime `sessions` 服务组合。
- Timeline 与标题栏共享一个按 `sessionId` 建立的值级 Snapshot source；控制器反应式订阅当前 Session 的闭合回合值与 Session 列表中的谱系值，Session 身份替换时重新绑定，不缓存旧 Session 对象。
- 新版本导航等待 runtime Session 列表发布对应 ID 后再执行 `ctx.sessions.open()`，依赖可用性变化直接驱动导航。

## 数据模型

每个插件版本在自己的非继承后缀中包含一个 `message-edit/version` 事件：

```ts
interface MessageEditVersionEvent {
  schemaVersion: 2
  effect: {
    id: string
    operation: 'edit' | 'reroll' | 'retry' | 'fork'
    cascade: 'truncate' | 'preserve'
    targetTurn: number
    targetEventSeq: number
    rowCount?: number
    targetBlockIndex?: number
    blockKind?: 'user' | 'assistant.reasoning' | 'assistant.response'
    before?: string
    after?: string
  }
  inverse: {
    kind: 'restore-version'
    sessionId: string
  }
}
```

会话头的 `parentSession` 构成版本树，且必须与事件中的 `inverse.sessionId` 一致；`seedLength` 区分当前版本自己的元数据与从祖先继承的同名事件。Timeline 通过 `ctx.sessionQuery.traceSession()` 和 `readSession()` 生成完整值级投影，并由原子逆链导出 `undoStack` 与直接 `redoSessionIds`。旧版平面事件仍可读取，并在投影时规范化为同一效果对。

所有 `message-edit/version` 事件信封都携带 `ignorable: true`（`SessionEvent.ignorable` 信封契约）：不认识该事件类型的 harness 构建会跳过这条溯源记录而不是拒绝整个日志。更早版本插件写入的存量日志可用一次性维护脚本修复：`node scripts/repair-session-logs.mjs`（默认 dry-run；`--apply` 写入并自动备份原件）。

## UI

- `conversation.view`
  - `id: message-edit-timeline`
  - `order: 15`
  - `label: Timeline`
  - 左栏为完整版本树（含 Fork 版本的消息计数）；右栏为可自由增删改的消息草稿，顶部实时显示「新增 · 编辑 · 删除」计数与一键重置，主按钮按草稿内容执行 Fork（结尾为用户消息时生成新回复）
- `conversation.session.header.actions`
  - `id: message-edit-controls`
  - 直接父效果撤销、直接子效果重施加、效果链计数、最后回复重生成

组件使用 CSS Modules 与 `--dsw-*` 语义 token，不引入 UI 库。所有产品文案为中文，代码注释为英文。

## 构建

```bash
npm install
npm run build
```

构建基于 npm 发布的 `@deepseek-ai/*@0.1.0-rc.6` 类型与本地工具链（typescript、tsdown、lightningcss），不再依赖 dsh 源码树。构建生成：

- `index.mjs`：Host 插件
- `client.js`：Browser 插件
- `client.js.map`：Browser source map

## 安装

```bash
dsh plugin --profile web add dsh-message-edit
```

或本地开发：

```bash
dsh plugin --profile web add -w link:/path/to/dsh-message-edit
```

`dsh plugin` 是 pnpm 转发器：`add` 后会自动识别 `dsh.bundle` 声明并把插件收编进 profile 的 `dsh.profile.bundles`，重启 dsh 即生效。本地开发建议用 `link:`（符号链接），改动源码重构建后重启即更新。

## HTTP 接口

- `GET /message-edit?sessionId=<id>`：读取可编辑消息、可重试回合与完整版本树。
- `POST /message-edit`：执行 `edit`、`reroll`、`retry` 或 `fork`，返回已发布的新 Session ID。`fork` 的 `rows` 为有序的消息行（`kind` 为 `user` / `assistant.reasoning` / `assistant.response`，`text` 为文本），按行重建整个历史；以 `user` 行结尾时触发新回复。可选 `workspaceId` 将新版本的工作目录与会话挂接到指定工作区；省略时沿用源会话工作区。

## 范围边界

- 不原地改写 Session 事件；历史是 append-only、deep-frozen。
- 不联动恢复或修改工作区文件、命令外部效果与既有产物。
- 不修改 DSH 引擎、apiproxy 或官方 UI 包。
