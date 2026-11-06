# dsh-answer-top

**回答结束后自动滚到回答开头** —— 不用每次往上翻。

## 解决什么问题

AI 回答完，页面停在**末尾**。长回答要从头读，就得手动往上翻半天。

## 设置（v0.6.1+）

DSH 设置 → 左侧导航「自动回滚」→ 顶部总开关 + 「触发阈值」两个滑块。

### 触发阈值（v0.12.0+）

| 控件 | 范围 | 默认 | 说明 |
|---|---|---|---|
| 最小回答高度 | 视口的 5%～100% | 25% | 回答低于「视口 × 该比例」时不滚 |
| 绝对下限 | 0～200px | 80px | 无论窗口多大，回答低于这个高度都不滚（防止极短回答也跳动） |

两条同时生效、**取更高的一条**：回答高度低于 `max(视口 × 25%, 80px)` 时不滚。
拖动滑块立即生效并自动保存，刷新后保留；`?` 图标上悬停可看绝对下限的说明。

```json
// localStorage['dsh-answer-top:config']（v0.12.0 起）
{
  "v": 1,
  "enabled": true,
  "sessions": {},
  "threshold": { "ratio": 0.25, "px": 80 }
}
```

| 字段 | 说明 |
|---|---|
| `v` | 配置版本，仍为 `1`（新增字段向后兼容） |
| `enabled` | 总开关，默认 `true` |
| `sessions` | 预留空对象，首版恒空（按会话设置是 P2） |
| `threshold.ratio` | 最小回答高度占视口的比例，`0.05`～`1`，默认 `0.25` |
| `threshold.px` | 绝对下限像素，`0～200`，默认 `80` |

旧版本写下的配置没有 `threshold` 字段，读取时自动回填 `{ ratio: 0.25, px: 80 }`，
不会改写原存储；下次拖动滑块时才写回。

**关闭后完全不滚**——不是「滚少一点」，是一次都不滚。

## 从旧版本升级

**v0.6.1 起会自动迁移一次**，无需手动操作：

| 升级前状态 | 迁移后 |
|---|---|
| 旧键 `dsh-answer-top` = `"off"` | 新配置 `enabled: false`（继承你关掉的选择） |
| 旧键不存在 / 其他值 | 新配置 `enabled: true`（默认开） |

迁移只会发生一次（判据：新键 `dsh-answer-top:config` 是否已存在）。
迁移时会把旧键**强制写成 `"off"`**，用来中和仍残留在浏览器缓存里的旧版本实例。

### 如果遇到「开关关了但还在滚」

那是**旧版本实例没被清掉**。一次操作解决：

```js
localStorage.removeItem('dsh-answer-top:config')
localStorage.removeItem('dsh-answer-top')
location.reload()
```

刷新后开关回到默认「开」，再按需关掉即可。


装上这个插件后：

```
回答结束 → 自动滚到这一轮回答的第一行
```

## 行为细节

| 情况 | 行为 |
|---|---|
| 回答比一屏长 | ✅ 滚到回答开头 |
| 回答短于 `max(视口 25%, 80px)` | ⏭️ 不滚（避免页面乱跳；阈值可在设置页调） |
| 历史消息加载 | ⏭️ 不滚（只对最后一轮生效） |
| turn 号识别失败（找不到对应回答块） | ⏭️ 不滚（绝不 fallback 到全部回答，避免误滚到对话开头） |
| 流式输出中 | ⏭️ 不滚（等真正结束才动） |
| 启动后首次进入会话 | ✅ 跳到最后一轮回答开头（整个页面生命周期只一次，切会话不重复） |

> 阈值在设置页调（持久化）；控制台也可临时调：`__dshAnswerTop.setThreshold(0.15, 40)`
> （不持久化，刷新后恢复配置值）。

## 开关

首选在 DSH 设置页「自动回滚」分区里点开关；也可以在浏览器控制台（F12）执行：

```js
__dshAnswerTop.setEnabled(false)   // 关闭
__dshAnswerTop.setEnabled(true)    // 打开
__dshAnswerTop.config()            // 看当前配置
```

改了立即生效，不用刷新。

> v0.6.1 起配置存在 `dsh-answer-top:config`，旧键 `dsh-answer-top` 只用于一次性迁移，
> 已被强制写成 `"off"`，**不要再手动改旧键**。

## 手动回滚按钮（v0.12.0+）

输入框下方的 dock（`conversation.composer.dock`）里常驻一个「⤒ 回滚」小按钮：

- **始终显示**：不依赖自动回滚开关，也不依赖共存状态；
- 点击 → 滚到最后一轮回答开头（即使自动回滚关闭、或检测到 `dsh-chat-answer-anchor`）；
- 点击本身产生的 pointerdown 不会拦住它（手动路径跳过总开关、300ms 交互窗口和高度阈值）；
- DOM 标记：`data-dsh-answer-top-manual="1"`，`title="回滚到回答开头"`。

它和设置页开关是两个独立 slot：开关切首选/备选（`settings.section` ↔ 对话头部）时，
手动按钮不受影响；`teardown()` 会把两个 slot 一起注销。

## 与同类插件共存（v0.10.0，v0.12.0 调整）

如果同时启用了同样会「自动滚动/跳转」的插件，两个一起动会打架。插件会读
`ctx.modules` 的模块名单（纯内存，不走 loopback、不联网）：

```js
// v0.12.0 起只把 dsh-chat-answer-anchor 视为冲突
["dsh-chat-answer-anchor"]
```

- 命中后**只关自动路径**：回答结束不再自动滚，设置页会显示
  「检测到 dsh-chat-answer-anchor，已暂停自动回滚」；
- 手动 `__dshAnswerTop.forceScroll()` 与输入框下方的「⤒ 回滚」按钮都不受影响；
- **自动恢复**：每 800ms 轻量重检一次名单，同会话里禁用/启用 anchor 会自动暂停/恢复
  自动回滚；只在状态变化时记 1 条事件，不刷日志；
- **探测失败不降级**：`ctx.modules` 不可用 / 形状不符时保持上一次结论——宁可不动，不误伤；
- `dsh-jump-button` 不再算冲突（v0.12.0 起）：只装它时自动回滚照常工作。

看探测结果：

```js
__dshAnswerTop.info().coexistence   // { anchor, checked, probe }
__dshAnswerTop.diagnose().coexistence
__dshAnswerTop.moduleIds()          // 核对目标插件 id 是否带 /client 后缀
```

日志只记布尔：`errorType: "coexistence", anchor`（失败时 `probe: "failed"`）。

> 实现依赖 `ctx.modules`，所以 client 端 `exports.inject` 是 `["slots", "modules"]`。
> 这和 package.json 里的 `dsh.client.inject: []` 不是一回事。

## 数据与隐私

**不联网、不上传。** 插件代码里没有任何 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`，
不向 DSH、GitHub 或任何第三方发送数据；宿主端 `lib/index.js` 是空插件（`apply` 不做任何事）。

只在本机 `localStorage` 写两个键：

| 键 | 内容 |
|---|---|
| `dsh-answer-top:config` | 设置：`v`、`enabled`、`sessions`（预留空对象）、`threshold.ratio`、`threshold.px` |
| `dsh-answer-top:events` | 脱敏事件日志，最多 200 条 / 50KB，超出后丢最旧；连续相同事件折叠为一条并累加 `count` |

事件日志只含这些字段：

- `errorType`（`migrated` / `coexistence` / `cleanup` / `degraded` 等）、`at`（时间）、`v`（插件版本）、`count`；
- 具体事件附带的**布尔或枚举**：`anchor`、`probe`、`scope`、`reason`、`rebind`、
  `hadLegacyKey`、`legacyWasOff`、`enabled`。

**不会记录**：消息/回答正文、会话 id、用户输入、文件路径、URL、页面内容、截图、原始错误文本。
运行时为了去重会在内存里临时保存 turn 号和滚动位置，刷新即清空，不写入存储。
共存探测只读取 `ctx.modules` 的模块 id 名单（纯内存），不落盘。

清理方法（浏览器控制台）：

```js
localStorage.removeItem('dsh-answer-top:events')    // 只清日志
localStorage.removeItem('dsh-answer-top:config')    // 连设置一起重置
location.reload()
```

> 旧键 `dsh-answer-top` 只用于一次性迁移开关状态，迁移后会被写成 `"off"`，不含其他数据。
> `__dshAnswerTop` 调试入口只活在当前页面内存里，刷新即清空。

## 原理

```
1. MutationObserver 监听 document.body（data-actions-reveal 属性变化）
   + 800ms interval 兜底（漏事件 / 会话切换时补检）
2. [data-turn-tail] 出现 data-actions-reveal
   → 说明这一轮回答结束了
3. 找出本轮第一个 [data-chat-flow-kind="assistant-step"] 的节点
4. 把 [data-conversation-scroll] 滚到它的顶部
```

用到的 DOM 契约（从 DSH 客户端里逆向出来的）：

```
[data-conversation-scroll]   滚动容器
[data-chat-turn="N"]         第 N 轮的所有流节点
[data-chat-flow-kind]        节点类型：user / assistant-step / tool-call / turn-process / turn-tail
[data-turn-tail]             轮次末尾容器
data-actions-reveal          该属性存在 = 本轮已结束
```

## 文件

```
lib/client.js      浏览器端逻辑（全部功能在这）
lib/index.js       宿主端空插件
cordis.patch.yml   bundle 挂载声明
dev/*.mjs          本地回归测试（11 个 test-* + simulate + verify-boot，共 13 个，无需浏览器）
dev/slot-contract.md  slot / DOM 契约笔记
```

## 安装 / 卸载

在 DSH 里：**设置 → 插件 → 添加插件**，输入本地目录的 link 安装串
（`link:<你的插件目录>`）。也可以命令行：

```bat
dsh plugin --profile desktop add link:<你的插件目录>
dsh plugin --profile desktop remove dsh-answer-top
```

本地开发（改代码即时生效）也用同一条 link 命令；重新添加时保持目录不变即可。

装完**需要重启 DSH**（bundle 层插件）。

## 已知限制

- 只对**最后一轮**生效——翻历史时不会乱跳
- 依赖 DSH 的 DOM 契约，**升级 DSH 后如果失效**，多半是属性名变了
- v0.12.x 起改为**瞬时跳转**（`scrollTop` 直接赋值）；DSH 新滚动容器上 smooth 动画不生效

## 调试

如果没生效，在浏览器控制台跑：

```js
// 看契约元素在不在
document.querySelector('[data-conversation-scroll]')
document.querySelectorAll('[data-chat-turn]').length
document.querySelectorAll('[data-turn-tail]').length

// 看最后一轮结束没
const tails = document.querySelectorAll('[data-turn-tail]');
tails[tails.length-1].hasAttribute('data-actions-reveal')
```

全都有值但还是不滚 → 把控制台报错发我。

### 设置页里看不到开关

v0.9.1 加了 slot 注册体检，一条命令定位问题在哪一层：

```js
__dshAnswerTop.diagnose()
```

| 输出 | 含义 | 下一步 |
|---|---|---|
| `injectCallbackRuns: 0` | slot 还没被声明，注入回调没跑 | 确认 DSH 版本里 `settings.section` 仍存在 |
| `injectCallbackRuns: 1, registerRuns: 0` | 回调跑了但注册失败 | 看 `registerError` |
| `slotEntryCount: 0` | 注册了但列表里没有 | 看 `registerError` / 是否被 `abdicate` |
| `slotEntryCount: 1, slotMounted: 0` | 已注册，只是没打开对应分区 | 打开 设置 →「自动回滚」 |
| `slotEntryCount: 1, slotMounted: 1` | 一切正常 | 看组件是否被 CSS 隐藏 |

> 注意：`teardown()` 会注销 slot，之后必须刷新页面才会重新注册。

## 开发踩坑（重要）

### ❌ 导出属性不能不可枚举

```js
// 错误写法 —— DSH 加载器枚举不到 apply，报
// "web boot: 1 entry did not activate / import failed"
Object.defineProperty(exports, "apply", { get: () => apply });
Object.defineProperty(exports, "inject", { get: () => inject });
```

```js
// 正确写法
exports.name = "dsh-answer-top";
exports.inject = inject;
exports.apply = apply;
```

`Object.defineProperty` 默认 `enumerable: false`，
而 DSH 的 `__ModuleLoader__` 会枚举 `module.exports` 来发现 `apply`。
不可枚举 → 加载器认为这个入口没有激活。

### ✅ 本地验证方法

`dev/simulate.mjs` 可以在 Node 里模拟浏览器加载：

```bat
node dev/simulate.mjs
```

输出里 `factory 返回: [ 'name', 'inject', 'apply' ]` 才算正常。
如果是 `[]`，就是枚举性问题。

全部 Node 回归（不需要浏览器）：

```bat
node dev/simulate.mjs           :: 加载 + apply + 渲染
node dev/test-cleanup.mjs       :: 资源清理 + 单实例
node dev/test-events.mjs        :: 日志持久化 / 折叠 / 轮转
node dev/test-degrade.mjs       :: 退避保活 + 平台改版 + 恢复重装
node dev/test-redetect.mjs      :: 同 turn 重渲染不重复滚
node dev/test-coexist.mjs       :: 共存探测（Item 8）
node dev/test-user-input.mjs    :: 用户输入取消
node dev/test-case3.mjs         :: 滚动复位三条路径
node dev/test-bootjump.mjs      :: 启动首次跳转
node dev/test-threshold.mjs     :: 阈值钳位 / 持久化
node dev/test-manual.mjs        :: 手动按键（跨开关/共存/阈值）
node dev/test-migration.mjs     :: 迁移幂等
node dev/verify-boot.mjs        :: boot 激活
```

---

## 最终可用配置（v0.3.0，2026-11-04 验证）

### 关键：`exports.inject` 必须是 `["slots", "modules"]`（v0.10.0 起）

```js
exports.name = "dsh-answer-top";
exports.inject = ["slots", "modules"];   // ← 不能是 []
exports.apply = apply;
```

用 `[]` 时插件不报错，但**完全不加载**（连日志都没有）。
这是排查了很久才定位的。

### package.json

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [] }
}
```

注意：`package.json` 里的 `dsh.client.inject` 保持 `[]`，
但 `client.js` 里的 `exports.inject` 必须是 `["slots", "modules"]` —— 两者不是一回事。

### 排错清单（踩过的坑）

| 现象 | 原因 | 修法 |
|---|---|---|
| `entry did not activate` / `import failed` | `Object.defineProperty` 导出不可枚举 | 改用 `exports.x = x` |
| 装了但完全不加载、无错误 | `exports.inject = []` | 改成 `["slots", "modules"]` |
| 加载了但不滚动 | 目标类型猜错（`assistant` → 实际是 `assistant-step`） | 见下面的类型表 |
| 开关关了还在滚 | 旧版本实例读旧键 `dsh-answer-top` | v0.6.1+ 会自动迁移并把旧键压成 `"off"`；仍有问题按上面「从旧版本升级」清理 |

### 已知限制

**① 用户交互会取消本轮回滚（设计如此）**

回答结束后 300ms 内，如果你滚动过、打过字、或用 Home/End 跳转，**本轮不会回滚**。

```js
__dshAnswerTop.info().lastSkip   // "user-input(wheel,180ms)" —— 可以看到跳过原因
```

**② 回滚是瞬时跳转，不再有动画打断**

v0.12.x 起用 `scrollTop` 直接赋值，跳转瞬间完成；`cancelCount` 字段保留兼容，
但正常跳转路径通常保持 0：

```js
__dshAnswerTop.info().cancelCount
```

**③ 不做按会话设置**

`sessions` 字段是预留空位，首版恒为 `{}`。全局开关 + 每轮交互取消已经覆盖绝大多数场景。

**④ 与改变会话布局的插件共存**

像对话树这类插件若替换了会话视图，DOM 结构可能变化，导致找不到 `[data-conversation-scroll]`。
插件会自动降级为「从最后一个 `[data-turn-tail]` 往上找可滚动祖先」，但仍可能失效。
用 `__dshAnswerTop.probe()` 可以看到 `scrollerSource` 是哪一种。


### 资源清理（v0.9.0）

插件会把自己用到的资源全部登记下来，分两种清理范围：

| 触发 | 清理内容 | 之后 |
|---|---|---|
| 页面卸载（`pagehide`，非 bfcache） | 摘全部监听、`clearInterval`、`MutationObserver.disconnect()`、清空重试/延时 timer、注销 slot | 页面没了，不重启 |
| DSH 停上下文（`ctx.effect` disposer） | 同全量 teardown，reason = `context-stop` | interval / observer / 监听 / slot 全部停掉，不再空转 |
| 会话切换（`scroller` 元素被替换） | 只摘 `wheel` / `touchmove` / `scrollend`，重新绑到新容器 | `observer` / `interval` 不重建，继续工作 |

> 平台改版判定降级后不会永久停摆：保留 5s 慢速保活，契约元素恢复后自动重装
> observer/interval，并记一条 `redetect(contract, recovered)` 脱敏日志。

会话切换是靠「`scroller` 元素身份变化」探测的（800ms 内生效），不依赖 DSH 内部的会话服务钩子，
所以 DSH 升级改了内部 API 也不会影响这条兜底路径。

手动验证清理结果：

```js
__dshAnswerTop.info().listenerRegistry.length  // 0
__dshAnswerTop.info().intervalId               // null
__dshAnswerTop.info().mutationObserver         // null
__dshAnswerTop.info().retryTimers.length       // 0
```

`pagehide` 时如果 `event.persisted === true`（页面进 bfcache、之后还会回来），插件**不会**清理，
恢复后照常工作。只有真正卸载才会全量 teardown。

### 实测的 DOM 契约（2026-11-04）

```
[data-conversation-scroll]     滚动容器
[data-chat-turn="N"]           第 N 轮的所有流节点（N 是字符串，如 "255"）
[data-turn-tail]               轮次末尾
data-actions-reveal            该属性出现 = 本轮结束
[data-chat-flow-kind]          节点类型
```

**实测的 kind 取值：**

| kind | 是什么 |
|---|---|
| `user` | 用户消息 |
| `assistant-step` | **回答正文**（要滚到这里） |
| `tool-call` | 单个工具调用 |
| `turn-process` | 工具调用折叠块（要跳过） |
| `turn-tail` | 轮次末尾 |
| 空 / `(无)` | 包装节点 |

**注意**：没有 `assistant` 这个类型，是 `assistant-step`。

### 诊断工具

```js
__dshAnswerTop.probe()        // DOM 契约体检
__dshAnswerTop.forceScroll()  // 手动滚动最后一轮
__dshAnswerTop.info()          // 内部状态（detections / scrolls / lastSkip）
__dshAnswerTop.diagnose()      // slot 注册体检 + 共存探测结果
__dshAnswerTop.moduleIds()     // 模块名单 id（核对共存插件 id 格式）
__dshAnswerTop.threshold()     // 当前生效阈值 { ratio, px }
__dshAnswerTop.applyThreshold({ ratio: 0.15, px: 40 })  // 临时改（不持久化）
__dshAnswerTop.saveThreshold({ ratio: 0.15, px: 40 })   // 改并持久化
__dshAnswerTop.setThreshold(0.15, 40)  // 等价于 applyThreshold 的位置参数版（不持久化）
__dshAnswerTop.teardown()      // 手动全量清理（验证「卸载后零残留」用）
```
