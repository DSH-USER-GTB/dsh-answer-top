# Changelog

All notable changes to `dsh-answer-top`.

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
