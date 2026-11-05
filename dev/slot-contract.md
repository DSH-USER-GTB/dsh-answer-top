# DSH Slot 契约（逆向验证记录）

> 实测环境：DSH Desktop 0.2.1-rc.5 / Win11 26H2
> 验证日期：2026-11-05
> 验证方式：从 `app.asar` 提取官方插件源码 + 运行时实测

---

## 一、Slot 名的可信度

以下 slot 名在 `app.asar` 的 9,458 个 JS 文件中搜到实际引用，
**不是文档、不是猜测，是官方插件自己在用的名字。**

| slot | 引用它的官方插件 | 用途 |
|---|---|---|
| `conversation.session.header.utilities` | conversation / open-in-app / schedule / session-log-export / cordis-client-runner | 会话头部右侧按钮组 |
| `conversation.session.header` | agent-preset / conversation / entry-customization / jobs / open-in-app / schedule … | 会话头部整体 |
| `conversation.chat.turnTail` | chat / deliverables / plan / schedule / cordis-client-runner | 每轮回答末尾 |
| `settings.section` | agent-preset / settings-account / settings-general / settings-models / settings-plugins | 设置页分区 |
| `sidebar.right` | deliverables / entry-customization / open-in-app / plan / schedule / shortcuts … | 右侧边栏标签页 |

**结论：这些名字在当前版本可用。**

---

## 二、注册 API 形态（照抄官方 `dsh-session-log-export`）

```js
const inject = ["slots", "locale"];   // 模块级：声明需要的服务

function apply(ctx) {
  ctx.slots.inject(SLOT_NAME, () =>
    ctx.slots.register(
      {
        name: SLOT_NAME,
        id: "my-plugin-id",
        // locale: NS,                    // 可选：i18n 命名空间
        // inject: () => ({ ... })        // 可选：给组件额外注入 props
      },
      MyComponent
    )
  );
}

exports.apply = apply;
exports.inject = inject;
```

### 关键点

1. `ctx.slots.inject(slotName, callback)` —— **内层再调** `register`，
   不是直接 register。这一层是必需的结构。
2. `id` 要唯一，否则可能被覆盖。
3. `apply` **必须真的接收 ctx**（`function apply(ctx)`）。
   `apply()` 不带参数会拿不到 `ctx.slots`，插件静默不工作。
4. 客户端插件的 `exports.inject` 必须包含 `"slots"`。
   **写成 `[]` 会导致插件完全不加载（连日志都没有）** —— 这是最难查的坑。

---

## 三、`conversation.session.header.utilities` 的真实 props

实测挂载时收到的 props（19 个）：

```
sessionId
useSessions
useSessionStatus
usePanelInfo
useWorkspaces
useResource
useRemoteAccess
useSessionRetainInfo
useSessionAccess
useWorkspaceAccess
inputActions
useSession
useConversation
useInput
useTrajectory
useChat
useProjection
useAccess
renderFactorySlot
```

### 有用的几个

| prop | 用途 |
|---|---|
| `sessionId` | 当前会话 ID —— **做「按会话」开关时用它做 key** |
| `useSessions` | 订阅会话 store：`useSessions(s => s.byId[sessionId]?.cwd)` |
| `useSession` | 当前会话状态 |
| `useChat` / `useConversation` | 对话流相关状态 |
| `inputActions` | 操作输入框（插入文本、发送等） |
| `useTrajectory` | 执行轨迹 |

**注意**：`useXxx` 是 **hook 形式**，在组件内部按 React Hook 规则调用
（不能在条件分支里调用）。

---

## 四、UI 组件库依赖（重要风险）

官方插件用 `@deepseek-ai/dsh-client-ui-primitives`
（`Button`、`Menu`、`IconDownloadOutlineRegular` 等）。

**但我在 `app.asar` 里搜不到这个包** —— 它应该是运行时的内部映射，
第三方插件 require 它可能直接失败。

**当前策略：用原生 `<button>` + 内联样式，零额外依赖。**

如果将来要接 primitives：
1. 先写一个只 `require` 不渲染的空插件
2. 确认 bundle 能加载（看控制台有没有 loaded 日志）
3. 成功后再替换按钮实现

---

## 五、验收清单（每个 slot 插件都该跑一遍）

```js
// 1. 注册成功？
__yourPlugin.info().slotRegistered     // true

// 2. 组件真的渲染了？
__yourPlugin.info().slotMounts         // > 0

// 3. DOM 里真的有？
document.querySelector('[data-your-plugin]')   // 非 null

// 4. 注册报错原因？
__yourPlugin.info().slotError          // null
```

**`slotMounts === 0` 表示 slot 名不对或注册结构有误 → 换备选 slot。**

---

## 六、踩过的坑汇总

| 现象 | 原因 | 修法 |
|---|---|---|
| 插件完全不加载，无任何日志 | `exports.inject = []` | 改成 `["slots"]` |
| `entry did not activate` / `import failed` | `Object.defineProperty` 导出不可枚举 | 用 `exports.x = x` |
| slot 注册成功但组件不渲染 | slot 名不存在或内层没调 `register` | 换 slot / 补内层 |
| 按钮出现但点击无效 | 组件内没接 state（直接读 localStorage） | 用 `React.useState` 驱动重渲染 |
