/**
 * R1 验收：case 3 —— smooth 动画中用户输入，显式停止
 *
 * 用假 DOM 让 scrollToAnswerStart 真正走到「发起滚动」那一步，
 * 再触发 wheel / scrollend / 700ms 兜底，验证 state.scrolling 的三条复位路径。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";

function makeHarness(opts = {}) {
  const store = { [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: true, sessions: {} }) };
  const bottom = opts.bottom === undefined ? 2000 : opts.bottom;

  /* 假滚动容器 */
  const scrollCalls = [];
  const scroller = {
    scrollTop: 0,
    clientHeight: 800,
    scrollHeight: 6000,
    _handlers: {},
    addEventListener(t, fn) { this._handlers[t] = fn; },
    removeEventListener(t) { delete this._handlers[t]; },
    getBoundingClientRect: () => ({ top: 0, height: 800 }),
    scrollTo(opts) {
      scrollCalls.push(opts);
      if (opts && typeof opts.top === "number") this.scrollTop = opts.top;
    },
  };

  /* 假 turn 节点：一个 assistant-step，高度由 opts.bottom 控制 */
  const turnNodes = [
    {
      dataset: { chatFlowKind: "assistant-step" },
      getBoundingClientRect: () => ({ top: 100, bottom }),
    },
  ];

  const docHandlers = {};
  const document = {
    readyState: "complete",
    body: {},
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel.indexOf("[data-chat-turn=") === 0) return turnNodes;
      if (sel === "[data-turn-tail]") return [];
      if (sel === "[data-chat-turn]") return turnNodes;
      return [];
    },
    addEventListener: (t, fn) => { docHandlers["doc:" + t] = fn; },
    removeEventListener: (t) => { delete docHandlers["doc:" + t]; },
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

  const ctx = { effect: (fn) => fn(), slots: { inject: (n, fn) => { fn(); return () => {}; }, register: () => () => {} } };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => sandbox.__dshAnswerTop,
    scroller, scrollCalls, docHandlers, store,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.log("  ✗ " + name + (detail ? "  → " + detail : ""));
}

/* ── ① 正常滚动：scrolling=true，走 smooth ── */
console.log("=== ① 无输入时正常滚到开头 ===");
{
  const h = makeHarness();
  h.apply();
  const ok = h.api().forceScroll();
  const info = h.api().info();
  check("forceScroll 返回 true", ok === true, String(ok));
  check("scrolling 置为 true", info.scrolling === true, String(info.scrolling));
  check("调用了 smooth 滚动", h.scrollCalls.some((c) => c.behavior === "smooth"), JSON.stringify(h.scrollCalls));
  check("scrollTop 已更新", h.scroller.scrollTop > 0, String(h.scroller.scrollTop));
}

/* ── ② 动画中滚一下 → 立即停 + cancelCount+1 ── */
console.log("\n=== ② 动画中用户滚动 → 显式停止 ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  const before = h.scrollCalls.length;
  const cancelBefore = h.api().info().cancelCount;

  h.scroller._handlers.wheel();          // 用户滚动

  const info = h.api().info();
  const lastCall = h.scrollCalls[h.scrollCalls.length - 1];
  check("scrolling 已复位", info.scrolling === false, String(info.scrolling));
  check("cancelCount +1", info.cancelCount === cancelBefore + 1, info.cancelCount + " (was " + cancelBefore + ")");
  check("追加了一次 auto 滚动（用于中断）", h.scrollCalls.length === before + 1, h.scrollCalls.length + " vs " + before);
  check("中断用的是 behavior:'auto'", lastCall && lastCall.behavior === "auto", JSON.stringify(lastCall));
  check("中断时位置不变", lastCall && lastCall.top === h.scroller.scrollTop);
}

/* ── ③ scrollend 复位 ── */
console.log("\n=== ③ scrollend 复位 ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  check("滚动中 scrolling=true", h.api().info().scrolling === true);
  h.scroller._handlers.scrollend();
  check("scrollend 后 scrolling=false", h.api().info().scrolling === false);
  check("scrollend 不增加 cancelCount", h.api().info().cancelCount === 0, String(h.api().info().cancelCount));
}

/* ── ④ 700ms 兜底复位（scrollend 不触发） ── */
console.log("\n=== ④ 700ms 兜底复位 ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  check("滚动中 scrolling=true", h.api().info().scrolling === true);
  await sleep(780);
  check("780ms 后 scrolling=false（兜底生效）", h.api().info().scrolling === false);
}

/* ── ⑤ 没有动画时滚动 → 不该误取消 ── */
console.log("\n=== ⑤ 非动画期间滚动 → 不消耗 cancelCount ===");
{
  const h = makeHarness();
  h.apply();
  const before = h.scrollCalls.length;
  h.scroller._handlers.wheel();   // 没有进行中的动画
  check("scrolling 仍是 false", h.api().info().scrolling === false);
  check("cancelCount 没增加", h.api().info().cancelCount === 0);
  check("没有多出 scrollTo 调用", h.scrollCalls.length === before, h.scrollCalls.length + " vs " + before);
  check("但 lastUserInputAt 被记录", h.api().info().lastUserInputKind === "wheel");
}

/* ── ⑥ 监听登记表 —— R2 ── */
console.log("\n=== ⑥ R2：监听资源表 ===");
{
  const h = makeHarness();
  h.apply();
  const info = h.api().info();
  check("info 暴露 listenerRegistry", Array.isArray(info.listenerRegistry), typeof info.listenerRegistry);
}

/* ── ⑦ 阈值 0.25 / 80px：短回答也要跳 ── */
console.log("\n=== ⑦ 回滚阈值（0.25 / 80px） ===");
{
  // 视口 800 → 阈值 max(80, 200) = 200；blockH = 300 - 100 = 200 → 刚好够
  const h = makeHarness({ bottom: 300 });
  h.apply();
  const ok = h.api().forceScroll();
  check("blockH=200 达到阈值 → 滚", ok === true, String(ok));
  check("lastTarget.threshold = 200", h.api().info().lastTarget.threshold === 200, String(h.api().info().lastTarget.threshold));
}
{
  // blockH = 250 - 100 = 150 < 200 → 不滚
  const h = makeHarness({ bottom: 250 });
  h.apply();
  const ok = h.api().forceScroll();
  check("blockH=150 低于阈值 → 不滚", ok === false, String(ok));
  check("lastSkip 标 short-block", String(h.api().info().lastSkip).startsWith("short-block"), String(h.api().info().lastSkip));
}
{
  // 运行时把阈值降到 0.1 / 40 → 150 也能滚
  const h = makeHarness({ bottom: 250 });
  h.apply();
  h.api().setThreshold(0.1, 40);
  const ok = h.api().forceScroll();
  check("setThreshold 调低后可滚", ok === true, String(ok));
  check("setThreshold 返回新值", JSON.stringify(h.api().setThreshold()) === '{"ratio":0.1,"px":40}', JSON.stringify(h.api().setThreshold()));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
