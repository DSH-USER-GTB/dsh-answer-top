/**
 * v0.11.0 验收：启动后首次进入会话 → 跳到最后一轮回答开头
 *
 * 覆盖：
 *   ① 连续两个 tick 后跳转，且只跳一次
 *   ② 切会话不再重复跳
 *   ③ 开关关闭 → 不跳
 *   ④ 启动期间用户已交互 → 不跳
 *   ⑤ 共存插件命中 → 不跳
 *   ⑥ 最后一轮没有回答（只有用户消息）→ 不跳
 *   ⑦ 已有新一轮回答结束（detections > 0）→ 不跳
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";

function makeHarness(opts = {}) {
  const enabled = opts.enabled !== false;
  const store = {
    [CONFIG_KEY]: JSON.stringify({ v: 1, enabled, sessions: {} }),
  };

  /* ── 假定时器 ── */
  let clock = 0;
  let seq = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const timer = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timeouts.set(id, { fn, at: clock + (ms || 0) });
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, ms) {
      const id = ++seq;
      intervals.set(id, { fn, ms: ms || 0, next: clock + (ms || 0) });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
  };
  function advance(ms) {
    const end = clock + ms;
    for (;;) {
      let nextAt = Infinity;
      let kind = null;
      let id = null;
      for (const [k, t] of timeouts) {
        if (t.at <= end && t.at < nextAt) { nextAt = t.at; kind = "t"; id = k; }
      }
      for (const [k, t] of intervals) {
        if (t.next <= end && t.next < nextAt) { nextAt = t.next; kind = "i"; id = k; }
      }
      if (kind === null) break;
      clock = nextAt;
      if (kind === "t") {
        const t = timeouts.get(id);
        timeouts.delete(id);
        t.fn();
      } else {
        const t = intervals.get(id);
        t.next += t.ms;
        t.fn();
      }
    }
    clock = end;
  }

  /* ── 假滚动容器 ── */
  const scrollCalls = [];
  const scroller = {
    scrollTop: 0,
    clientHeight: 800,
    scrollHeight: 6000,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, height: 800 }),
    scrollTo(opts2) {
      scrollCalls.push(opts2);
      if (opts2 && typeof opts2.top === "number") this.scrollTop = opts2.top;
    },
  };

  /* ── 假 turn / tail ── */
  let turnNodes = [
    {
      dataset: { chatFlowKind: "assistant-step" },
      getBoundingClientRect: () => ({ top: 100, bottom: 2000 }),
    },
  ];
  const tails = [];
  function addTail(n, revealed = true) {
    tails.push({
      getAttribute: (k) => (k === "data-turn-tail" ? String(n) : null),
      hasAttribute: (k) => k === "data-actions-reveal" && revealed,
    });
  }

  /* ── 假 MutationObserver ── */
  const observers = [];
  class FakeMO {
    constructor(cb) { this.cb = cb; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
    fire() { if (this.active && this.cb) this.cb([]); }
  }

  const winHandlers = {};
  const docHandlers = {};
  function makeTarget(map) {
    return {
      addEventListener(t, fn) { map[t] = fn; },
      removeEventListener(t) { delete map[t]; },
    };
  }
  const windowShim = makeTarget(winHandlers);
  const documentShim = makeTarget(docHandlers);
  Object.assign(documentShim, {
    readyState: "complete",
    body: {},
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-turn-tail]") return tails;
      if (sel.indexOf("[data-chat-turn=") === 0) return turnNodes;
      if (sel === "[data-chat-turn]") return turnNodes;
      return [];
    },
  });

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
    MutationObserver: FakeMO,
    setInterval: timer.setInterval,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    clearInterval: timer.clearInterval,
    console: { log() {}, warn() {}, error() {} },
    Date, Object, Array, Math, JSON, String, Number, Boolean, undefined,
  });

  vm.runInContext(CODE, context, { filename: "client.js" });

  const ctx = {
    effect: (fn) => fn(),
    modules: opts.modules,
    slots: {
      inject: (name, factory) => { factory(); return () => {}; },
      register: () => () => {},
    },
  };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => windowShim.__dshAnswerTop,
    scrollCalls,
    scroller,
    addTail,
    setTurnNodes: (nodes) => { turnNodes = nodes; },
    observers,
    advance,
  };
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { console.log("  ✗ " + name + (detail !== undefined ? "  → " + detail : "")); }
}

/* ── ① 两个 tick 后跳一次 ── */
console.log("=== ① 首次进入：两个 tick 后跳转，只跳一次 ===");
{
  const h = makeHarness();
  // 模拟「插件已装好时历史已经渲染完」：tail 在 apply 之前就在
  h.addTail(1);
  h.apply();
  h.advance(800); // 第 1 个 tick：记录 tail 候选
  h.advance(800); // 第 2 个 tick：记录 scrollHeight 候选
  check("渲染未稳定时不跳", h.scrollCalls.length === 0, h.scrollCalls.length);
  h.advance(800); // 第 3 个 tick：tail + 高度都稳定 → 跳
  check("稳定后跳到回答开头", h.scrollCalls.length === 1, h.scrollCalls.length);
  check("bootJumps = 1", h.api().info().bootJumps === 1, h.api().info().bootJumps);
  check("bootJumpDone = true", h.api().info().bootJumpDone === true);
  check("没有误记成新回答", h.api().info().detections === 0, h.api().info().detections);
  h.advance(3600); // 后续 tick / 校验都不再跳
  check("之后不再重复跳", h.scrollCalls.length === 1, h.scrollCalls.length);
}

/* ── ② 切会话不重复跳 ── */
console.log("\n=== ② 切会话不再跳 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.apply();
  h.advance(2400);
  const jumps = h.api().info().bootJumps;
  check("首次已跳", jumps === 1, jumps);
  h.addTail(2); // 新会话里出现另一轮
  h.advance(3600);
  check("切会话后 bootJumps 不变", h.api().info().bootJumps === jumps, h.api().info().bootJumps);
}

/* ── ③ 开关关闭 ── */
console.log("\n=== ③ 开关关闭 → 不跳 ===");
{
  const h = makeHarness({ enabled: false });
  h.addTail(1);
  h.apply();
  h.advance(2400);
  check("没有滚动", h.scrollCalls.length === 0, h.scrollCalls.length);
  check("bootJumpDone 已置位", h.api().info().bootJumpDone === true);
}

/* ── ④ 启动期间用户已交互 ── */
console.log("\n=== ④ 用户已交互 → 不跳 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.apply();
  h.api().info().lastUserInputAt = Date.now();
  h.api().info().lastUserInputKind = "wheel";
  h.advance(2400);
  check("没有滚动", h.scrollCalls.length === 0, h.scrollCalls.length);
}

/* ── ⑤ 共存命中 ── */
console.log("\n=== ⑤ 共存插件命中 → 不跳 ===");
{
  const h = makeHarness({
    modules: { manifest: { modules: [{ id: "dsh-chat-answer-anchor" }] } },
  });
  h.addTail(1);
  h.apply();
  h.advance(2400);
  check("没有滚动", h.scrollCalls.length === 0, h.scrollCalls.length);
}

/* ── ⑥ 最后一轮没有回答 ── */
console.log("\n=== ⑥ 最后一轮没有回答 → 不跳 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.setTurnNodes([
    {
      dataset: { chatFlowKind: "user" },
      getBoundingClientRect: () => ({ top: 100, bottom: 200 }),
    },
  ]);
  h.apply();
  h.advance(2400);
  check("没有滚动", h.scrollCalls.length === 0, h.scrollCalls.length);
}

/* ── ⑦ 已有新一轮回答结束 ── */
console.log("\n=== ⑦ detections > 0 → 不跳 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.apply();
  // 模拟先结束了一轮新回答
  h.api().info().detections = 1;
  h.advance(2400);
  check("没有滚动", h.scrollCalls.length === 0, h.scrollCalls.length);
}

/* ── ⑧ 跳完被 DSH 贴回底部 → 校验后重跳 ── */
console.log("\n=== ⑧ 位置被覆盖 → 重跳 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.apply();
  h.advance(2400); // 首次跳转完成
  const before = h.scrollCalls.length;
  check("首次已跳", before === 1, before);

  h.scroller.scrollTop = 5000; // 模拟 DSH 布局完成后贴回底部
  h.advance(1200); // 1.2s 后的校验
  check("检测到偏移并重跳", h.scrollCalls.length === before + 1, h.scrollCalls.length);
  check("重跳次数 = 1", h.api().info().bootJumpRetries === 1, h.api().info().bootJumpRetries);

  // 用户一旦交互，后续校验放手
  const afterRetry = h.scrollCalls.length;
  h.scroller.scrollTop = 5000;
  h.api().info().bootJumpAt = Date.now() - 5000;
  h.api().info().lastUserInputAt = Date.now();
  h.api().info().lastUserInputKind = "wheel";
  h.advance(2400);
  check("用户交互后不再重跳", h.scrollCalls.length === afterRetry, h.scrollCalls.length);
}

/* ── ⑨ 只是点了一下（pointerdown）→ 仍然跳 ── */
console.log("\n=== ⑨ 单纯点击不取消启动跳转 ===");
{
  const h = makeHarness();
  h.addTail(1);
  h.apply();
  h.api().info().lastUserInputAt = Date.now();
  h.api().info().lastUserInputKind = "pointerdown";
  h.advance(2400);
  check("点击后仍然跳到开头", h.scrollCalls.length === 1, h.scrollCalls.length);
  check("bootJumps = 1", h.api().info().bootJumps === 1, h.api().info().bootJumps);
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
