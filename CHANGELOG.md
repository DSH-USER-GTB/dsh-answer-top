# Changelog

All notable changes to `dsh-answer-top`.

## [1.0.0]

### Fixed

- 平台改版降级后不再永久停摆：降级时保留 5s 慢速保活，契约恢复后自动重装
  observer/interval（记 `redetect` 事件），避免 DSH 改版恢复或临时空 DOM 后插件永久失效。
- 重装观察者（平台改版恢复 / 会话切换）时，去重基线只取「最后一个已结束的 tail」：
  推理中的 turn 不再被当成已处理，结束后能正常回滚；已结束的上一个 turn 仍会被正确去重。
- 启动跳转后鼠标拖滚动条被误判为「非交互」，导致 `verifyBootJump` 把视图拽回：
  新增 `scroll` 监听（拖滚动条也会记为 `scroll` 交互），并加 100ms 程序滚动窗口，
  忽略插件自己 `scrollTop` 赋值触发的 scroll，避免自我污染；
  只有 `pointerdown → scroll → pointerup` 的拖拽才算用户交互，DSH 自己贴底滚动不再误判。
- `blockedByUserInput` 排除 `pointerdown`：单纯点一下（聚焦/点窗口）不再打断自动回滚，
  与启动跳转的判断保持一致；滚轮/触摸/拖滚动条/打字仍会取消。
- 切回前台时主动补检：`visibilitychange` → visible 后 **150 / 400 / 900ms 三次**跑 tick，
  把后台完成的回答在用户观察/滚动之前滚掉；多次补检由 handledTurn 去重，不会重复滚；
  监听随生命周期绑定/清理。
- 晚滚防护：回答结束检测后、60ms 滚动前，若已出现 `turn + 1`（用户已发下一条），
  跳过滚动并记 `lastSkip = "newer-turn"`，避免把视图拽回上一条回答；
  `handledTurn` 仍照常记录，不会反复检测。

### Changed

- `MutationObserver` 回调改为 rAF 合并：同一帧内的多次 mutation 只跑一次 `check(false)`，
  降低流式输出时的重复布局读取。
- tick 内的 `getTails()` 复用给 `detectContractRework`，减少一次重复 DOM 查询。
- `logEvent` 不再向控制台逐条打印事件（保留 localStorage 事件日志与内存 `note()`），
  减少刷屏与开销。

## [0.12.0]

### Added

- 设置页新增「触发阈值」两个滑块（拖动即生效，自动保存，刷新后保留）：
  - **最小回答高度**：视口的 5%～100%，默认 25%；
  - **绝对下限**：0～200px，默认 80px，`?` 图标悬停显示原生提示。
- 有效阈值 = `max(视口高度 × ratio, px)`，回答高度低于它的不滚。
- 配置新增 `threshold: { ratio, px }`（schema 仍为 `v: 1`，旧配置读取时自动回填默认值）。
- 新控制台 API：`threshold()`、`applyThreshold(patch)`（临时）、`saveThreshold(patch)`（持久化）。
- 设置页在共存命中时显示「检测到 dsh-chat-answer-anchor，已暂停自动回滚」。
- 输入框下方 dock 新增常驻「⤒ 回滚」手动按钮（`data-dsh-answer-top-manual`）：
  始终显示，点击直接滚到最后一轮回答开头，不受总开关 / 共存 / 300ms 交互窗口 / 高度阈值限制。

### Changed

- slot 注册重构为按 slot 名记账（`unregisterBySlot`）：开关 slot 与常驻手动按键 slot
  可以同时挂载、互不覆盖；`fallback()` 只切换开关 slot，`teardown()` 两个一起注销。

- 共存探测只认 `dsh-chat-answer-anchor`：不再把 `dsh-jump-button` 当冲突，只装它时自动回滚照常。
- 共存检测从「apply 一次 + 1.5s 复检后定格」改为**每 800ms 轮询**：同会话禁用/启用 anchor
  会自动暂停/恢复自动回滚；只在状态变化时记 1 条事件，探测失败不刷日志。
- 回滚改为**瞬时跳转**（`scrollTop` 直接赋值）：DSH 新滚动容器
  （`an3WzG_scrollBody`）上 `scrollTo({behavior:"smooth"})` 不生效；不再需要
  scrollend / 700ms 兜底复位，`state.scrolling` 保持 false。

### Fixed

- turn 识别失败时不再 fallback 到全部回答块：旧逻辑会挑对话最早的 `assistant-step`，
  可能误滚到对话开头；现在直接放弃本轮滚动（`lastSkip = "turn-not-found"`），
  「漏滚一次」好过「误滚打断阅读」。
- 绝对下限 80px 实际从未生效：阈值常量在 `state` 初始化之后才赋值，
  `state.minBlockPx` 初始为 `undefined`，小窗口下只剩比例阈值。现在常量先定义，
  启动即为 `0.25 / 80`。
- DSH 停上下文后 interval / observer 继续空转、`detectCoexistence` 在 inactive context
  上反复抛错刷屏：整套 DOM setup 现在挂 `ctx.effect`，disposer 调
  `teardown("context-stop")`；`detectCoexistence` 整体 try/catch，异常按探测失败处理
  （不降级、不刷日志）。

## [0.11.2]

### Fixed

- 修复「思考/空闲时偶发自动上跳」：回答去重从 DOM 节点引用改为 turn 号。DSH 空闲重渲染会替换节点但 turn 不变，旧的节点比较会把同一轮重渲染误判成新回答。

### Changed

- 回滚触发阈值从「视口的 55%」降到 **25%，绝对下限 80px**：
  小窗口下短一些的回答也会跳到开头。
- 新增 `__dshAnswerTop.setThreshold(ratio, px)` 运行时调参（不持久化）。

## [0.11.1]

### Changed

- 安装说明改为 npm 包名（`dsh plugin add dsh-answer-top` / 设置 → 插件 → 添加插件），
  本地开发才用 `link:`。
- 首次发布到 npm。

## [0.11.0]

### Added

- 启动后首次进入会话时，自动跳到最后一轮回答的开头（每个页面生命周期只执行一次；切会话不重复）。
- 触发前要求连续两个 800ms tick 看到同一个已结束的 tail，避免 DSH 渲染未完成时跳错位置。
- 用户已经交互、共存插件命中、开关关闭、最后一轮没有回答时放弃，不强行覆盖。

## [0.10.1]

### Fixed

- 修复「开启但偶尔不滚」的间歇性 bug：容器快重试预算耗尽后改为退避慢速保活（5s），不再永久放弃（boot/导航中对话 DOM 晚于插件加载时会触发）。
- 平台改版判定阈值 3 → 10 次（8s），避免慢会话切换被误判成改版。

## [0.10.0]

### Added

- 兄弟插件共存探测（Item 8）：命中 `dsh-chat-answer-anchor` / `dsh-jump-button` 时，自动回滚降级为「仅手动触发」并记脱敏 `coexistence` 日志；探测失败不降级。

## [0.9.3]

### Added

- 降级不刷屏（Item 6）：容器找不到时有限重试 + 静默降级 + 平台改版判定。

## [0.9.2]

### Added

- 脱敏事件日志落 localStorage（Item 4）：200 条 / 50KB 上限、连续同错折叠 `count`、环形轮转。

## [0.9.1]

### Added

- slot 注册诊断（`__dshAnswerTop.diagnose()`，记录 inject/register 次数与错误）。

## [0.9.0]

### Added

- 资源清理框架 + 单实例守卫（Item 5）：interval / MutationObserver / 监听器 / timer 全登记，`pagehide` 全量清理、会话切换重绑监听、`apply` 单实例。

## [0.6.1]

### Added

- 一次性迁移（旧键 → 新键）+ 总开关 UI + 配置 schema（`{ v, enabled, sessions }`）。

## [0.5.0] 及更早

- 初始版本：回答结束后自动滚到回答开头。
