/**
 * v0.12.x 瞬时跳转验收
 *
 * scrollTo({behavior:"smooth"}) 在 DSH 新滚动容器（an3WzG_scrollBody）上不生效，
 * 改为 scrollTop 直接赋值。验证：跳转瞬时完成、不进入动画状态，
 * wheel / scrollend 不再消耗 cancelCount，也没有 700ms 兜底定时器。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";

function makeHarness(opts = {}) {
  const store = { [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: true, sessions: {} }) };
  const bottom = opts.bottom === undefined ? 2000 : opts.bottom;
  const tailTurn = opts.tailTurn === undefined ? "1" : opts.tailTurn;

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
    scrollTo(opts2) {
      scrollCalls.push(opts2);
      if (opts2 && typeof opts2.top === "number") this.scrollTop = opts2.top;
    },
  };

  /* 假 tail：turn 可配置，用来验证「识别失败不 fallback:all」 */
  const tails = tailTurn === null
    ? []
    : [{
        getAttribute: (k) => (k === "data-turn-tail" ? tailTurn : null),
        hasAttribute: () => true,
      }];

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
      if (sel === "[data-turn-tail]") return tails;
      if (sel === '[data-chat-turn="1"]') return turnNodes;
      if (sel.indexOf("[data-chat-turn=") === 0) return [];
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

/* ── ① 瞬时跳到回答开头 ── */
console.log("=== ① 瞬时跳转到回答开头 ===");
{
  const h = makeHarness();
  h.apply();
  const ok = h.api().forceScroll();
  const info = h.api().info();
  check("forceScroll 返回 true", ok === true, String(ok));
  check("不进入动画状态（scrolling=false）", info.scrolling === false, String(info.scrolling));
  check("scrollTop 直接赋值到 88", h.scroller.scrollTop === 88, String(h.scroller.scrollTop));
  check("没有调用 scrollTo（无 smooth）", h.scrollCalls.length === 0, h.scrollCalls.length);
  check("cancelCount = 0", info.cancelCount === 0, String(info.cancelCount));
}

/* ── ② wheel 不再中断（没有动画） ── */
console.log("\n=== ② wheel 不再中断（没有动画） ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  const topBefore = h.scroller.scrollTop;
  const cancelBefore = h.api().info().cancelCount;

  h.scroller._handlers.wheel(); // 用户滚动

  const info = h.api().info();
  check("scrolling 仍为 false", info.scrolling === false, String(info.scrolling));
  check("cancelCount 不增加", info.cancelCount === cancelBefore, info.cancelCount + " vs " + cancelBefore);
  check("位置不变", h.scroller.scrollTop === topBefore, h.scroller.scrollTop + " vs " + topBefore);
  check("没有追加 scrollTo", h.scrollCalls.length === 0, h.scrollCalls.length);
  check("记录了用户 wheel", info.lastUserInputKind === "wheel");
}

/* ── ③ scrollend 无副作用 ── */
console.log("\n=== ③ scrollend 无副作用 ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  const topBefore = h.scroller.scrollTop;
  h.scroller._handlers.scrollend();
  check("scrolling 仍为 false", h.api().info().scrolling === false);
  check("cancelCount 仍 0", h.api().info().cancelCount === 0, String(h.api().info().cancelCount));
  check("位置不变", h.scroller.scrollTop === topBefore);
}

/* ── ④ 不再有 700ms 兜底复位 ── */
console.log("\n=== ④ 不再有 700ms 兜底复位 ===");
{
  const h = makeHarness();
  h.apply();
  h.api().forceScroll();
  check("跳转后立即不是动画态", h.api().info().scrolling === false);
  await sleep(780);
  check("780ms 后状态不变", h.api().info().scrolling === false);
}

/* ── ⑤ 非动画期间滚动 → 不该误取消 ── */
console.log("\n=== ⑤ 非动画期间滚动 → 不消耗 cancelCount ===");
{
  const h = makeHarness();
  h.apply();
  const topBefore = h.scroller.scrollTop;
  h.scroller._handlers.wheel();   // 没有进行中的动画
  check("scrolling 仍是 false", h.api().info().scrolling === false);
  check("cancelCount 没增加", h.api().info().cancelCount === 0);
  check("位置不变", h.scroller.scrollTop === topBefore);
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

/* ── ⑧ turn 识别失败 → 放弃，不 fallback 到全部 ── */
console.log("\n=== ⑧ turn 识别失败不 fallback:all ===");
{
  // tail 存在但 turn=999，没有匹配的 [data-chat-turn="999"]
  const h = makeHarness({ tailTurn: "999" });
  h.apply();
  const ok = h.api().forceScroll();
  check("未知 turn → forceScroll 返回 false", ok === false, String(ok));
  check("lastSkip = turn-not-found", h.api().info().lastSkip === "turn-not-found", String(h.api().info().lastSkip));
  check("没有滚动（不误滚到对话开头）", h.scroller.scrollTop === 0, String(h.scroller.scrollTop));
  check("没有调用 scrollTo", h.scrollCalls.length === 0, h.scrollCalls.length);
}
{
  // 完全没有 tail（turn 无法识别）
  const h = makeHarness({ tailTurn: null });
  h.apply();
  const ok = h.api().forceScroll();
  check("无 tail → forceScroll 返回 false", ok === false, String(ok));
  check("lastSkip = turn-not-found（无 tail）", h.api().info().lastSkip === "turn-not-found", String(h.api().info().lastSkip));
  check("没有滚动", h.scroller.scrollTop === 0, String(h.scroller.scrollTop));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
