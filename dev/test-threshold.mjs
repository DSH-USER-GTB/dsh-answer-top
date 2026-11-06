/**
 * v0.12.0 触发阈值验收测试
 *
 * 覆盖：
 *   A. 默认值：config / 内存状态都是 { ratio: 0.25, px: 80 }
 *   B. 旧配置回填：没有 threshold 字段 → 默认值，原 config 不被改写
 *   C. 钳位：ratio 0.05~1、px 0~200（非法/越界都收敛）
 *   D. 持久化：saveThreshold 写 config.threshold，不动 enabled/sessions/v
 *   E. 行为：有效阈值 = max(视口 × ratio, px)，短回答不滚
 *   F. 重载：刷新后从 config 读回阈值
 *   G. 迁移：旧键迁移出的配置也带默认阈值
 *   H. 控件：两个滑块的范围/默认值/文案/? 提示都对
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";
const LEGACY_KEY = "dsh-answer-top";

function makeHarness(opts = {}) {
  const store = {};
  if (opts.config !== undefined) store[CONFIG_KEY] = JSON.stringify(opts.config);
  if (opts.legacy !== undefined) store[LEGACY_KEY] = opts.legacy;

  const vh = opts.vh || 800;
  const top = opts.top === undefined ? 100 : opts.top;
  const bottom = opts.bottom === undefined ? 2000 : opts.bottom;

  const scrollCalls = [];
  const scroller = {
    scrollTop: 0,
    clientHeight: vh,
    scrollHeight: 6000,
    _handlers: {},
    addEventListener(t, fn) { this._handlers[t] = fn; },
    removeEventListener(t) { delete this._handlers[t]; },
    getBoundingClientRect: () => ({ top: 0, height: vh }),
    scrollTo(o) {
      scrollCalls.push(o);
      if (o && typeof o.top === "number") this.scrollTop = o.top;
    },
  };

  const turnNodes = [
    {
      dataset: { chatFlowKind: "assistant-step" },
      getBoundingClientRect: () => ({ top, bottom }),
    },
  ];
  const tails = [
    {
      getAttribute: (k) => (k === "data-turn-tail" ? "1" : null),
      hasAttribute: () => true,
    },
  ];

  const document = {
    readyState: "complete",
    body: {},
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-turn-tail]") return tails;
      if (sel === '[data-chat-turn="1"]') return turnNodes;
      if (sel.indexOf("[data-chat-turn=") === 0) return [];
      if (sel === "[data-chat-turn]") return turnNodes;
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  /* React 替身：够渲染设置页一次初始树 */
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (v) => ({ current: v }),
    useEffect: (fn) => { fn(); },
    useState: (init) => [init, () => {}],
    Fragment: "Fragment",
  };

  let exportsObj = null;
  let component = null;

  const sandbox = {
    __ModuleLoader__: {
      load: (mod) => {
        exportsObj = mod.factory((n) => {
          if (n === "react") return React;
          throw new Error("未知依赖: " + n);
        });
      },
    },
    localStorage,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} disconnect() {} },
    document,
    setInterval: () => 0,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    clearInterval: () => {},
  };

  const context = vm.createContext({
    window: sandbox,
    document,
    localStorage,
    requestAnimationFrame: sandbox.requestAnimationFrame,
    MutationObserver: sandbox.MutationObserver,
    setInterval: sandbox.setInterval,
    setTimeout: sandbox.setTimeout,
    clearTimeout: sandbox.clearTimeout,
    clearInterval: sandbox.clearInterval,
    console: { log() {}, warn() {}, error() {} },
    Date, Object, Array, Math, JSON, String, Number, undefined,
  });

  vm.runInContext(CODE, context, { filename: "client.js" });

  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (n, fn) => { fn(); return () => {}; },
      register: (opts, comp) => {
        if (opts && opts.name === "settings.section") component = comp;
        return () => {};
      },
    },
  };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => sandbox.__dshAnswerTop,
    store,
    scrollCalls,
    component: () => component,
  };
}

/* ── React 树展开：把函数组件（ThresholdSlider）也渲染成元素 ── */

function expand(node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") {
    return expand(node.type({ ...(node.props || {}), children: node.children }));
  }
  return {
    ...node,
    children: (node.children || []).map(expand),
  };
}

function walk(node, out = []) {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textOf).join("");
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.log("  ✗ " + name + (detail ? "  → " + detail : ""));
}

/* ── A. 默认值 ── */
console.log("=== A. 默认阈值 0.25 / 80px ===");
{
  const h = makeHarness();
  h.apply();
  const c = h.api().config();
  check("config().threshold = {0.25, 80}",
    JSON.stringify(c.threshold) === '{"ratio":0.25,"px":80}', JSON.stringify(c.threshold));
  const info = h.api().info();
  check("内存 minBlockRatio = 0.25", info.minBlockRatio === 0.25, String(info.minBlockRatio));
  check("内存 minBlockPx = 80（修复常量晚初始化）", info.minBlockPx === 80, String(info.minBlockPx));
  const raw = JSON.parse(h.store[CONFIG_KEY]);
  check("迁移写入的 config 也带 threshold",
    raw.threshold && raw.threshold.ratio === 0.25 && raw.threshold.px === 80, JSON.stringify(raw));
}

/* ── B. 旧配置回填，不改写原文 ── */
console.log("\n=== B. 旧配置（无 threshold）回填默认值 ===");
{
  const oldCfg = { v: 1, enabled: true, sessions: { s1: { x: 1 } } };
  const h = makeHarness({ config: oldCfg });
  const rawBefore = h.store[CONFIG_KEY];
  h.apply();
  const c = h.api().config();
  check("config() 回填默认 threshold",
    JSON.stringify(c.threshold) === '{"ratio":0.25,"px":80}', JSON.stringify(c.threshold));
  check("sessions 原样保留", c.sessions && c.sessions.s1 && c.sessions.s1.x === 1, JSON.stringify(c.sessions));
  check("只读取不写盘：原 config 未被改写", h.store[CONFIG_KEY] === rawBefore);
}
{
  const h = makeHarness({ config: { v: 1, enabled: true, sessions: {}, threshold: { ratio: 0.4 } } });
  h.apply();
  check("threshold 缺 px → 回填 80", h.api().config().threshold.px === 80, JSON.stringify(h.api().config().threshold));
  check("threshold 给 ratio → 用 0.4", h.api().config().threshold.ratio === 0.4, JSON.stringify(h.api().config().threshold));
}
{
  const h = makeHarness({ config: { v: 1, enabled: true, sessions: {}, threshold: { ratio: "x", px: null } } });
  h.apply();
  check("非法类型 → 回默认 {0.25, 80}",
    JSON.stringify(h.api().config().threshold) === '{"ratio":0.25,"px":80}', JSON.stringify(h.api().config().threshold));
}
{
  const h = makeHarness({ config: { v: 1, enabled: true, sessions: {}, threshold: { ratio: 1.4, px: 300 } } });
  h.apply();
  check("越界值 → 钳到 {1, 200}",
    JSON.stringify(h.api().config().threshold) === '{"ratio":1,"px":200}', JSON.stringify(h.api().config().threshold));
}

/* ── C. applyThreshold / saveThreshold 钳位 ── */
console.log("\n=== C. 钳位（0.05~1 / 0~200）===");
{
  const h = makeHarness();
  h.apply();
  const api = h.api();
  check("applyThreshold({0.5, 120})", JSON.stringify(api.applyThreshold({ ratio: 0.5, px: 120 })) === '{"ratio":0.5,"px":120}');
  check("applyThreshold({0.01}) → ratio 钳到 0.05",
    JSON.stringify(api.applyThreshold({ ratio: 0.01 })) === '{"ratio":0.05,"px":120}',
    JSON.stringify(api.threshold()));
  check("applyThreshold({px: -9}) → px 钳到 0",
    JSON.stringify(api.applyThreshold({ px: -9 })) === '{"ratio":0.05,"px":0}',
    JSON.stringify(api.threshold()));
  check("applyThreshold 不写盘", h.api().config().threshold.ratio === 0.25, JSON.stringify(h.api().config().threshold));

  const saved = api.saveThreshold({ ratio: 2, px: 999 });
  check("saveThreshold 钳位 return {1, 200}", JSON.stringify(saved) === '{"ratio":1,"px":200}', JSON.stringify(saved));
  check("saveThreshold 已写盘", JSON.stringify(h.api().config().threshold) === '{"ratio":1,"px":200}', JSON.stringify(h.api().config().threshold));
}

/* ── D. 持久化不动别的字段 ── */
console.log("\n=== D. 持久化保留 v / enabled / sessions ===");
{
  const h = makeHarness({ config: { v: 1, enabled: false, sessions: { a: { y: 2 } } } });
  h.apply();
  h.api().saveThreshold({ ratio: 0.4, px: 60 });
  const c = JSON.parse(h.store[CONFIG_KEY]);
  check("v 仍是 1", c.v === 1, String(c.v));
  check("enabled 仍是 false", c.enabled === false, String(c.enabled));
  check("sessions 未被清空", c.sessions && c.sessions.a && c.sessions.a.y === 2, JSON.stringify(c.sessions));
  check("threshold 已保存", JSON.stringify(c.threshold) === '{"ratio":0.4,"px":60}', JSON.stringify(c.threshold));
  check("info().thresholdSaves 累加", h.api().info().thresholdSaves >= 1, String(h.api().info().thresholdSaves));
}

/* ── E. 行为：有效阈值 = max(vh*ratio, px) ── */
console.log("\n=== E. 行为：max(视口比例, 绝对下限) ===");
{
  // vh 800，默认 → max(200, 80) = 200；blockH = 300-100 = 200 → 刚好够
  const h = makeHarness({ bottom: 300 });
  h.apply();
  check("blockH=200 达到阈值 → 滚", h.api().forceScroll() === true);
  check("lastTarget.threshold = 200", h.api().info().lastTarget.threshold === 200, String(h.api().info().lastTarget.threshold));
}
{
  const h = makeHarness({ bottom: 250 });
  h.apply();
  check("blockH=150 低于 200 → 不滚", h.api().forceScroll() === false);
  check("lastSkip = short-block", String(h.api().info().lastSkip).startsWith("short-block"), String(h.api().info().lastSkip));
}
{
  const h = makeHarness({ bottom: 250 });
  h.apply();
  h.api().saveThreshold({ ratio: 0.05, px: 0 });
  check("阈值降到 40 后 blockH=150 → 滚", h.api().forceScroll() === true);
}
{
  // 小窗：vh 200 → 比例只有 50，绝对下限 80 应该生效
  const h = makeHarness({ vh: 200, bottom: 170 });
  h.apply();
  check("小窗 blockH=70 低于 80px 绝对下限 → 不滚", h.api().forceScroll() === false);
  check("小窗 lastTarget.threshold = 80", h.api().info().lastTarget.threshold === 80, String(h.api().info().lastTarget.threshold));
}
{
  const h = makeHarness({ vh: 200, bottom: 190 });
  h.apply();
  check("小窗 blockH=90 达到 80px → 滚", h.api().forceScroll() === true);
}
{
  // 比例可以压过绝对下限：vh 800，ratio 0.5 → 400
  const h = makeHarness({ bottom: 450 });
  h.apply();
  h.api().saveThreshold({ ratio: 0.5, px: 0 });
  check("ratio 0.5 → 阈值 400，blockH=350 不滚", h.api().forceScroll() === false);
  check("lastTarget.threshold = 400", h.api().info().lastTarget.threshold === 400, String(h.api().info().lastTarget.threshold));
}

/* ── F. 重载读回持久化阈值 ── */
console.log("\n=== F. 刷新后读回 config.threshold ===");
{
  const h1 = makeHarness({ vh: 800, bottom: 250 });
  h1.apply();
  h1.api().saveThreshold({ ratio: 0.1, px: 40 });
  const saved = h1.store[CONFIG_KEY];

  const h2 = makeHarness({ vh: 800, bottom: 250 });
  h2.store[CONFIG_KEY] = saved;
  h2.apply();
  const info = h2.api().info();
  check("重载后 ratio = 0.1", info.minBlockRatio === 0.1, String(info.minBlockRatio));
  check("重载后 px = 40", info.minBlockPx === 40, String(info.minBlockPx));
  check("有效阈值 max(80,40)=80，blockH=150 → 滚", h2.api().forceScroll() === true);
}

/* ── G. 旧键迁移出的配置也带默认阈值 ── */
console.log("\n=== G. 旧键迁移兼容 ===");
{
  const h = makeHarness({ legacy: "off" });
  h.apply();
  const c = JSON.parse(h.store[CONFIG_KEY]);
  check("迁移后 enabled=false", c.enabled === false, JSON.stringify(c));
  check("迁移后 threshold 默认", JSON.stringify(c.threshold) === '{"ratio":0.25,"px":80}', JSON.stringify(c.threshold));
  check("旧键被压成 'off'", h.store[LEGACY_KEY] === "off");
}

/* ── H. 控件：两个滑块 + ? 提示 ── */
console.log("\n=== H. 设置页控件 ===");
{
  const h = makeHarness();
  h.apply();
  const tree = expand(h.component()({}));
  const nodes = walk(tree);
  const inputs = nodes.filter((n) => n.type === "input");
  const byId = (id) => inputs.find((n) => n.props["data-dsh-answer-top-slider"] === id);
  const ratio = byId("ratio");
  const px = byId("px");

  check("存在比例滑块", !!ratio);
  check("比例滑块 min=5 max=100 step=1 value=25",
    ratio && ratio.props.min === 5 && ratio.props.max === 100 &&
    ratio.props.step === 1 && ratio.props.value === 25,
    ratio ? JSON.stringify({ min: ratio.props.min, max: ratio.props.max, step: ratio.props.step, value: ratio.props.value }) : "missing");

  check("存在绝对下限滑块", !!px);
  check("px 滑块 min=0 max=200 step=1 value=80",
    px && px.props.min === 0 && px.props.max === 200 &&
    px.props.step === 1 && px.props.value === 80,
    px ? JSON.stringify({ min: px.props.min, max: px.props.max, step: px.props.step, value: px.props.value }) : "missing");

  const hint = nodes.find((n) => n.props && n.props["data-dsh-answer-top-hint"] === "px");
  check("? 提示挂在 px 行", !!hint);
  check("? 提示是原生 title（方案 A）", hint && typeof hint.props.title === "string" && hint.props.title.length > 20,
    hint ? String(hint.props.title).slice(0, 30) : "missing");
  check("提示文案含「绝对下限」和「默认 80px」",
    hint && hint.props.title.includes("绝对下限") && hint.props.title.includes("默认 80px"),
    hint ? hint.props.title : "missing");

  const allText = textOf(tree);
  check("标签「最小回答高度」", allText.includes("最小回答高度"));
  check("标签「绝对下限」", allText.includes("绝对下限"));
  check("比例说明「低于视口 25% 的回答不滚」", allText.includes("低于视口 25% 的回答不滚"));
  check("px 当前值「当前 80px」", allText.includes("当前 80px"));
  check("分组标题「触发阈值」", allText.includes("触发阈值"));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
