# dsh-answer-top

**回答结束后自动滚到回答开头** —— 不用每次往上翻。

## 解决什么问题

AI 回答完，页面停在**末尾**。长回答要从头读，就得手动往上翻半天。

## 设置（v0.6.1+）

DSH 设置 → 左侧导航「自动回滚」→ 开关。

```json
// localStorage['dsh-answer-top:config']
{ "v": 1, "enabled": true, "sessions": {} }
```

| 字段 | 说明 |
|---|---|
| `v` | 版本号，为未来迁移预留 |
| `enabled` | 总开关，默认 `true` |
| `sessions` | 预留空对象，首版恒空（按会话设置是 P2） |

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
| 回答比一屏短 | ⏭️ 不滚（避免页面乱跳） |
| 历史消息加载 | ⏭️ 不滚（只对最后一轮生效） |
| 流式输出中 | ⏭️ 不滚（等真正结束才动） |

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

## 与同类插件共存（v0.10.0）

如果同时启用了同样会「自动滚动/跳转」的插件，两个一起动会打架。插件启动时会读
`ctx.modules` 的模块名单（纯内存，不走 loopback、不联网）：

```js
// 命中的任一个都会闸住自动回滚
["dsh-chat-answer-anchor", "dsh-jump-button"]
```

- 命中后**只关自动路径**：回答结束不再自动滚；
- 手动 `__dshAnswerTop.forceScroll()` 不受影响；
- 探测不到（`ctx.modules` 不可用 / 形状不符）时**不降级**——宁可不动，不误伤；
- 启动同步探测一次，1.5 秒后复检一次（兄弟插件可能加载更晚），随后定格。

看探测结果：

```js
__dshAnswerTop.info().coexistence   // { anchor, jumpButton, checked, probe }
__dshAnswerTop.diagnose().coexistence
__dshAnswerTop.moduleIds()          // 核对目标插件 id 是否带 /client 后缀
```

日志只记布尔：`errorType: "coexistence", anchor, jumpButton`（失败时 `probe: "failed"`）。

> 实现依赖 `ctx.modules`，所以 client 端 `exports.inject` 是 `["slots", "modules"]`。
> 这和 package.json 里的 `dsh.client.inject: []` 不是一回事。

## 原理

```
1. 往 conversation.chat.turnTail 插一个隐藏锚点
2. 锚点的祖先 [data-turn-tail] 出现 data-actions-reveal
   → 说明这一轮回答结束了
3. 找出本轮第一个 [data-chat-flow-kind="assistant"] 的节点
4. 把 [data-conversation-scroll] 滚到它的顶部
```

用到的 DOM 契约（从 DSH 客户端里逆向出来的）：

```
[data-conversation-scroll]   滚动容器
[data-chat-turn="N"]         第 N 轮的所有流节点
[data-chat-flow-kind]        节点类型：user / assistant / turn-process / turn-tail
[data-turn-tail]             轮次末尾容器
data-actions-reveal          该属性存在 = 本轮已结束
```

## 文件

```
lib/client.js      浏览器端逻辑（全部功能在这）
lib/index.js       宿主端空插件
cordis.patch.yml   bundle 挂载声明
dev/*.mjs          本地回归测试（simulate + test-*，无需浏览器）
dev/slot-contract.md  slot / DOM 契约笔记
```

## 安装 / 卸载

```bat
dsh plugin --profile desktop add link:<你的插件目录>
dsh plugin --profile desktop remove dsh-answer-top
```

装完**需要重启 DSH**（bundle 层插件）。

## 已知限制

- 只对**最后一轮**生效——翻历史时不会乱跳
- 依赖 DSH 的 DOM 契约，**升级 DSH 后如果失效**，多半是属性名变了
- 滚动是平滑动画，如果觉得慢可以改成瞬时（改 `behavior: "smooth"` → `"auto"`）

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
node dev/test-degrade.mjs       :: 退避保活 + 平台改版
node dev/test-coexist.mjs       :: 共存探测（Item 8）
node dev/test-user-input.mjs    :: 用户输入取消
node dev/test-case3.mjs         :: 滚动复位三条路径
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

**② 滚动动画会被用户输入立即打断**

回滚是平滑动画。动画进行中你一滚，动画**立刻停止**（不是等它跑完），产生一次 `cancelCount`：

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
| 会话切换（`scroller` 元素被替换） | 只摘 `wheel` / `touchmove` / `scrollend`，重新绑到新容器 | `observer` / `interval` 不重建，继续工作 |

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
__dshAnswerTop.teardown()      // 手动全量清理（验证「卸载后零残留」用）
```
