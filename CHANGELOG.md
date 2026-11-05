# Changelog

All notable changes to `dsh-answer-top`.

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
