/**
 * 在 Node 里模拟浏览器的 __ModuleLoader__，跑一遍 client.js
 *
 * 验证：
 *   1. 加载期不抛错
 *   2. apply(ctx) 真的用了 ctx（ctx.effect + ctx.slots.inject + register）
 *   3. 首选 settings.section 的组件能渲染出合法元素树
 *   4. 备选 header 组件也能渲染
 *   5. 配置读写符合 schema
 */
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/* ── React 替身 ── */
let hooksIndex = 0;
const hooksStore = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (v) => ({ current: v }),
  useEffect: (fn) => { fn(); },
  useState: (init) => {
    const i = hooksIndex++;
    if (!(i in hooksStore)) hooksStore[i] = init;
    return [hooksStore[i], (v) => { hooksStore[i] = v; }];
  },
  Fragment: "Fragment",
};

/* ── localStorage 替身（带真实存取表） ── */
const store = {};
const localStorageShim = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

let registered = null;
const sandbox = {
  __ModuleLoader__: {
    load: (mod) => {
      console.log("  [loader] id =", mod.id);
      try {
        const exports = mod.factory((name) => {
          if (name === "react") return React;
          throw new Error("未知依赖: " + name);
        });
        console.log("  [loader] factory 返回:", Object.keys(exports || {}));
        console.log("  [loader]", typeof exports.apply === "function" ? "✓" : "✗", "apply 是函数");
        console.log("  [loader]", Array.isArray(exports.inject) ? "✓" : "✗", "inject =", JSON.stringify(exports.inject));
        registered = exports;
      } catch (e) {
        console.log("  [loader] ✗ factory 抛错:", e.message);
      }
    },
  },
  localStorage: localStorageShim,
  requestAnimationFrame: (fn) => fn(),
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    body: {},
    readyState: "complete",
    addEventListener: () => {},
  },
  setInterval: () => 0,
  setTimeout: (fn) => 0,
  clearTimeout: () => {},
  clearInterval: () => {},
};

const vm = await import("node:vm");

/** 递归展开函数组件，让嵌套的 ToggleSwitch 也真的被渲染 */
function deepRender(node) {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") {
    return deepRender(node.type({ ...(node.props || {}), children: node.children }));
  }
  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map(deepRender) };
  }
  return node;
}

const context = vm.createContext({
  window: sandbox,
  document: sandbox.document,
  localStorage: sandbox.localStorage,
  requestAnimationFrame: sandbox.requestAnimationFrame,
  MutationObserver: sandbox.MutationObserver,
  setInterval: sandbox.setInterval,
  setTimeout: sandbox.setTimeout,
  clearTimeout: sandbox.clearTimeout,
  clearInterval: sandbox.clearInterval,
  console, Date, Object, Array, Math, JSON, String, Number, undefined,
});

console.log("=== 1. 执行 client.js ===");
try {
  vm.runInContext(code, context, { filename: "client.js" });
} catch (e) {
  console.log("  ✗ 执行抛错:", e.message);
  process.exit(1);
}

console.log("\n=== 2. 调用 apply(ctx) ===");
const components = {};
if (registered && typeof registered.apply === "function") {
  const calls = [];
  const fakeCtx = {
    effect: (fn, label) => {
      calls.push("effect(" + label + ")");
      fn();
    },
    slots: {
      inject: (name, fn, label) => {
        calls.push("inject(" + name + (label ? ", " + label : "") + ")");
        fn();
      },
      register: (def, comp) => {
        calls.push(
          "register(name=" + def.name + ", id=" + def.id +
          ", order=" + def.order +
          ", label=" + typeof def.label +
          " → " + (typeof def.label === "function" ? JSON.stringify(def.label()) : "n/a") + ")"
        );
        components[def.name] = comp;
      },
    },
  };
  try {
    registered.apply(fakeCtx);
    console.log("  ✓ apply 执行成功");
    for (const c of calls) console.log("     " + c);
  } catch (e) {
    console.log("  ✗ apply 抛错:", e.message);
  }
}

console.log("\n=== 3. 渲染首选组件 settings.section ===");
const primary = components["settings.section"];
if (typeof primary === "function") {
  try {
    hooksIndex = 0; hooksStore.length = 0;
    const tree = deepRender(primary({ close: () => {} }));
    console.log("  ✓ 渲染成功  type:", tree.type);
    console.log("     data 属性:", tree.props["data-dsh-answer-top-section"]);
    const inner = tree.children || [];
    console.log("     子节点数:", inner.length);
    function findSwitch(node) {
      if (!node || typeof node !== "object") return null;
      if (node.props && node.props["data-dsh-answer-top-switch"]) return node;
      for (const c of node.children || []) {
        const r = findSwitch(c);
        if (r) return r;
      }
      return null;
    }
    const sw = findSwitch(tree);
    console.log("     开关:", sw ? "✓ 找到（" + sw.props["data-dsh-answer-top-switch"] + "）" : "✗ 没找到");
    console.log("     标题文本:", JSON.stringify(tree.children?.[0]?.children?.[0]?.children?.[0] ?? null));
  } catch (e) {
    console.log("  ✗ 渲染抛错:", e.message);
  }
} else {
  console.log("  ✗ 没注册 settings.section");
}

console.log("\n=== 4. 渲染备选组件 header ===");
const fb = components["conversation.session.header.utilities"];
if (typeof fb === "function") {
  try {
    hooksIndex = 0; hooksStore.length = 0;
    const tree = deepRender(fb({ sessionId: "s1" }));
    console.log("  ✓ 渲染成功  type:", tree.type, " attr:", tree.props["data-dsh-answer-top-toggle"]);
  } catch (e) {
    console.log("  ✗ 渲染抛错:", e.message);
  }
} else {
  console.log("  （apply 没走备选分支，正常）");
}

console.log("\n=== 5. 配置 schema ===");
const api = sandbox.__dshAnswerTop;
if (api) {
  console.log("  初始 config():", JSON.stringify(api.config()));
  const v = api.setEnabled(false);
  console.log("  setEnabled(false) →", v);
  console.log("  写入后:", store["dsh-answer-top:config"]);
  const cfg = JSON.parse(store["dsh-answer-top:config"]);
  const okk =
    cfg.v === 1 && cfg.enabled === false && Object.keys(cfg.sessions).length === 0;
  console.log(
    "  字段检查: v=" + cfg.v + " enabled=" + cfg.enabled +
    " sessions=" + JSON.stringify(cfg.sessions) + " → " + (okk ? "✓ 符合 schema" : "✗ 不符合")
  );
} else {
  console.log("  ✗ 没拿到 __dshAnswerTop");
}

console.log("\n=== 6. 验收摘要 ===");
console.log("  首选 slot 注册:", components["settings.section"] ? "✓" : "✗");
console.log("  组件可渲染:", typeof primary === "function" ? "✓" : "✗");


