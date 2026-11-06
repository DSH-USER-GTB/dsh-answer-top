/**
 * v0.12.0 手动按键验收：conversation.composer.dock
 *
 * 覆盖：
 *   A. 两个 slot 同时注册（settings.section + conversation.composer.dock），互不覆盖
 *   B. 手动按键组件属性：data / title / aria-label，始终渲染
 *   C. 总开关关闭 + 共存命中时，手动点击仍能滚（force + manual 跳过两道门）
 *   D. 刚 pointerdown 过时，自动路径被拦、手动路径仍能滚
 *   E. teardown 后 unregisterBySlot 清空、手动标记复位
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";
const MANUAL_SLOT = "conversation.composer.dock";

function makeHarness(opts = {}) {
  const store = {};
  if (opts.enabled === false) {
    store[CONFIG_KEY] = JSON.stringify({ v: 1, enabled: false, sessions: {} });
  }
  const bottom = opts.bottom === undefined ? 2000 : opts.bottom;

  const scrollCalls = [];
  const scroller = {
    scrollTop: 0,
    clientHeight: 800,
    scrollHeight: 6000,
    _handlers: {},
    addEventListener(t, fn) { this._handlers[t] = fn; },
    removeEventListener(t) { delete this._handlers[t]; },
    getBoundingClientRect: () => ({ top: 0, height: 800 }),
    scrollTo(o) {
      scrollCalls.push(o);
      if (o && typeof o.top === "number") this.scrollTop = o.top;
    },
  };

  const tails = [
    {
      getAttribute: (k) => (k === "data-turn-tail" ? "1" : null),
      hasAttribute: () => true,
    },
  ];
  const turnNodes = [
    {
      dataset: { chatFlowKind: "assistant-step" },
      getBoundingClientRect: () => ({ top: 100, bottom }),
    },
  ];

  const docHandlers = {};
  const documentShim = {
    readyState: "complete",
    body: {},
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-turn-tail]") return tails;
      if (sel.indexOf("[data-chat-turn=") === 0) return turnNodes;
      if (sel === "[data-chat-turn]") return turnNodes;
      return [];
    },
    addEventListener: (t, fn) => { docHandlers[t] = fn; },
    removeEventListener: (t) => { delete docHandlers[t]; },
  };

  const winHandlers = {};
  const windowShim = {
    addEventListener: (t, fn) => { winHandlers[t] = fn; },
    removeEventListener: (t) => { delete winHandlers[t]; },
  };

  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (v) => ({ current: v }),
    useEffect: (fn) => { fn(); },
    useState: (init) => [init, () => {}],
    Fragment: "Fragment",
  };

  let exportsObj = null;
  const components = {};
  const unregisterCalls = [];
  windowShim.__ModuleLoader__ = {
    load: (mod) => {
      exportsObj = mod.factory((n) => {
        if (n === "react") return React;
        throw new Error("未知依赖: " + n);
      });
    },
  };
  windowShim.localStorage = localStorage;

  const context = vm.createContext({
    window: windowShim,
    document: documentShim,
    localStorage,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    console: { log() {}, warn() {}, error() {} },
    Date, Object, Array, Math, JSON, String, Number, Boolean, undefined,
  });

  vm.runInContext(CODE, context, { filename: "client.js" });

  const modules = opts.anchor
    ? { manifest: { modules: [{ id: "dsh-chat-answer-anchor" }] } }
    : { manifest: { modules: [{ id: "dsh-answer-top" }] } };

  const ctx = {
    effect: (fn) => fn(),
    modules,
    slots: {
      inject: (name, factory) => {
        factory();
        return () => {};
      },
      register: (def, comp) => {
        components[def.name] = comp;
        return () => { unregisterCalls.push(def.name); };
      },
    },
  };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => windowShim.__dshAnswerTop,
    components,
    unregisterCalls,
    scrollCalls,
    docHandlers,
    scroller,
    store,
  };
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.log("  ✗ " + name + (detail !== undefined ? "  → " + String(detail) : ""));
}

/* ── A/B：两个 slot + 按钮属性 ── */
console.log("=== A. 两个 slot 同时注册 + 手动按键属性 ===");
const h = makeHarness({ enabled: false, anchor: true });
h.apply();
{
  const info = h.api().info();
  const keys = Object.keys(info.unregisterBySlot).sort();
  check("开关 slot 已注册", typeof h.components["settings.section"] === "function");
  check("手动按键 slot 已注册", typeof h.components[MANUAL_SLOT] === "function");
  check("unregisterBySlot 两个 slot", JSON.stringify(keys) === JSON.stringify([MANUAL_SLOT, "settings.section"]), JSON.stringify(keys));
  check("manualSlotRegistered = true", info.manualSlotRegistered === true);

  const tree = h.components[MANUAL_SLOT]({});
  check("手动按键是可点击 button", tree.type === "button");
  check("data 属性存在", tree.props["data-dsh-answer-top-manual"] === "1", tree.props["data-dsh-answer-top-manual"]);
  check("title 正确", tree.props.title === "回滚到回答开头", tree.props.title);
  check("aria-label 正确", tree.props["aria-label"] === "回滚到回答开头", tree.props["aria-label"]);
  check("始终渲染（无开关/共存条件）", tree.props.style.opacity === undefined);
  check("渲染后 manualSlotMounted = true", h.api().info().manualSlotMounted === true);
  check("manualSlotMounts = 1", h.api().info().manualSlotMounts === 1, h.api().info().manualSlotMounts);
}

/* ── C：关闭 + 共存命中，手动仍可滚 ── */
console.log("\n=== B. 总开关关闭 + 共存命中 → 手动仍滚 ===");
{
  const info = h.api().info();
  check("开关为关闭", h.api().config().enabled === false);
  check("共存命中", info.coexistence.anchor === true);

  // 自动路径被开关拦下
  const autoOk = h.api().forceScroll();
  check("自动路径返回 false", autoOk === false, autoOk);
  check("lastSkip = disabled", info.lastSkip === "disabled", info.lastSkip);

  h.docHandlers.pointerdown(); // 模拟点击按钮产生的 pointerdown
  check("pointerdown 已记录", h.api().info().lastUserInputKind === "pointerdown");
  check("交互窗口内", Date.now() - h.api().info().lastUserInputAt < 300);

  const tree = h.components[MANUAL_SLOT]({});
  tree.props.onClick();

  const after = h.api().info();
  check("手动点击发生滚动（scrollTop=88）", h.scroller.scrollTop === 88, h.scroller.scrollTop);
  check("scrolls = 1", after.scrolls === 1, after.scrolls);
  check("lastSkip 清空", after.lastSkip === null, after.lastSkip);
  check("瞬时跳转（没有 scrollTo）", h.scrollCalls.length === 0, h.scrollCalls.length);
}

/* ── D：pointerdown 窗口内，自动被拦、手动可用 ── */
console.log("\n=== C. pointerdown 窗口内：自动被拦、手动可用 ===");
{
  const h2 = makeHarness({ enabled: true, anchor: false });
  h2.apply();
  h2.docHandlers.pointerdown();

  const autoOk = h2.api().forceScroll();
  check("自动路径被交互窗口拦下", autoOk === false, autoOk);
  check("lastSkip 标明 user-input", String(h2.api().info().lastSkip).indexOf("user-input(pointerdown") === 0, h2.api().info().lastSkip);

  const tree = h2.components[MANUAL_SLOT]({});
  tree.props.onClick();
  check("手动路径不受交互窗口影响", h2.api().info().scrolls === 1, h2.api().info().scrolls);
  check("瞬时跳转到 88", h2.scroller.scrollTop === 88, h2.scroller.scrollTop);
}

/* ── E：共存命中 + 开关开启，手动可用 ── */
console.log("\n=== D. 共存命中 + 开关开启 → 手动仍滚 ===");
{
  const h3 = makeHarness({ enabled: true, anchor: true });
  h3.apply();
  const tree = h3.components[MANUAL_SLOT]({});
  tree.props.onClick();
  check("共存不拦手动", h3.api().info().scrolls === 1, h3.api().info().scrolls);
}

/* ── F：teardown 全摘 ── */
console.log("\n=== E. teardown → 两个 slot 全部注销 ===");
{
  const h4 = makeHarness({ enabled: true, anchor: false });
  h4.apply();
  check("teardown 前两个 slot", Object.keys(h4.api().info().unregisterBySlot).length === 2);
  h4.components[MANUAL_SLOT]({}); // 渲染手动按键，确认挂载标记会被 teardown 复位
  check("渲染后 manualSlotMounted = true", h4.api().info().manualSlotMounted === true);
  const ok = h4.api().teardown();
  const info = h4.api().info();
  check("teardown 返回 true", ok === true);
  check("unregisterBySlot 清空", Object.keys(info.unregisterBySlot).length === 0, Object.keys(info.unregisterBySlot).length);
  check("两个 slot 的注销函数都调用过", h4.unregisterCalls.length === 2, JSON.stringify(h4.unregisterCalls));
  check("manualSlotRegistered 复位", info.manualSlotRegistered === false);
  check("manualSlotMounted 复位", info.manualSlotMounted === false);
}

/* ── F：短回答也绕过高度阈值 ── */
console.log("\n=== F. 短回答手动仍滚（绕过高度阈值）===");
{
  // blockH = 150 - 100 = 50，远低于阈值 max(200, 80)
  const h5 = makeHarness({ enabled: true, anchor: true, bottom: 150 });
  h5.apply();
  const autoOk = h5.api().forceScroll();
  check("短回答自动路径被阈值拦下",
    autoOk === false && String(h5.api().info().lastSkip).indexOf("short-block") === 0,
    h5.api().info().lastSkip);

  const tree = h5.components[MANUAL_SLOT]({});
  tree.props.onClick();
  check("短回答手动仍滚", h5.api().info().scrolls === 1, h5.api().info().scrolls);
  check("lastSkip 清空", h5.api().info().lastSkip === null, h5.api().info().lastSkip);
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
