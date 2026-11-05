/**
 * Item 5 验收：资源清理框架 + 单实例守卫
 *
 * 用可控的假 DOM / 假定时器（手动推进时钟）验证：
 *   ① apply 后 interval / observer / listener / retry / pending 全部登记
 *   ② 二次 apply 不叠加（单实例守卫）
 *   ③ 一轮回答 → 检测 + 60ms 后滚动
 *   ④ 会话切换（scroller 身份变化）→ 只重绑监听，observer/interval 不重建
 *   ⑤ 第二轮计数正常累加、不翻倍
 *   ⑥ pagehide → 全量 teardown（registry/interval/observer/timer 全空）
 *   ⑦ bfcache（event.persisted）→ 不拆
 *   ⑧ teardown 后可重装
 *   ⑨ 无 scroller 时重试链登记、成功后清零
 *   ⑩ 事件日志脱敏（只有枚举/布尔/数字键）
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";

function makeHarness(opts = {}) {
  const store = {
    [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: true, sessions: {} }),
  };

  /* ── 假定时器（手动时钟） ── */
  let clock = 0;
  let seq = 0;
  const timeouts = new Map(); // id -> { fn, at }
  const intervals = new Map(); // id -> { fn, ms, next }
  const timer = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timeouts.set(id, { fn, at: clock + (ms || 0) });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(fn, ms) {
      const id = ++seq;
      intervals.set(id, { fn, ms: ms || 0, next: clock + (ms || 0) });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
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
  function tickIntervals() {
    for (const t of Array.from(intervals.values())) t.fn();
  }

  /* ── 假滚动容器 ── */
  const scrollCalls = [];
  function makeScroller(name) {
    return {
      name,
      scrollTop: 0,
      clientHeight: 800,
      scrollHeight: 6000,
      _handlers: {},
      addEventListener(t, fn) { this._handlers[t] = fn; },
      removeEventListener(t) { delete this._handlers[t]; },
      getBoundingClientRect: () => ({ top: 0, height: 800 }),
      scrollTo(opts) { scrollCalls.push(opts); },
    };
  }
  let scroller = opts.withScroller === false ? null : makeScroller("s1");

  /* ── 假 turn / tail 节点 ── */
  const turnNodes = [
    {
      dataset: { chatFlowKind: "assistant-step" },
      getBoundingClientRect: () => ({ top: 100, bottom: 2000 }),
    },
  ];
  const tails = [];
  function addTurn(n) {
    tails.push({
      getAttribute: (k) => (k === "data-turn-tail" ? String(n) : null),
      hasAttribute: (k) => k === "data-actions-reveal",
    });
  }

  /* ── 假 MutationObserver ── */
  const observers = [];
  class FakeMO {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      this.disconnected = 0;
      observers.push(this);
    }
    observe() { this.active = true; }
    disconnect() { this.active = false; this.disconnected++; }
    fire() { if (this.active && this.cb) this.cb([]); }
  }

  /* ── 假 window / document ── */
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
    querySelector: (sel) =>
      sel === "[data-conversation-scroll]" ? scroller : null,
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
  windowShim.requestAnimationFrame = (fn) => fn();

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

  const slotCalls = { inject: 0, register: 0, unregisters: 0 };
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, factory) => {
        slotCalls.inject++;
        factory();
        return () => {};
      },
      register: () => {
        slotCalls.register++;
        return () => { slotCalls.unregisters++; };
      },
    },
  };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => windowShim.__dshAnswerTop,
    setScroller: (s) => { scroller = s; },
    makeScroller,
    scroller: () => scroller,
    scrollCalls,
    addTurn,
    observers,
    winHandlers,
    docHandlers,
    slotCalls,
    timeouts,
    intervals,
    timer,
    advance,
    tickIntervals,
  };
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    console.log("  ✗ " + name + (detail !== undefined ? "  → " + detail : ""));
  }
}
const countListeners = (h) => h.api().info().listenerRegistry.length;

/* ── ① apply：资源全部登记 ── */
console.log("=== ① apply 后资源登记 ===");
const h = makeHarness();
h.apply();
{
  const info = h.api().info();
  check("intervalId 非空", info.intervalId !== null && info.intervalId !== undefined, String(info.intervalId));
  check("mutationObserver 非空", !!info.mutationObserver);
  check("state.observer = 'body'", info.observer === "body", String(info.observer));
  check("监听 6 条（scroller 3 + document 2 + pagehide 1）", countListeners(h) === 6, countListeners(h));
  check("boundScroller 记录了 scroller", info.boundScroller === h.scroller());
  check("pendingTimers 有 1.5s 共存复检 + 8s 提示", info.pendingTimers.length === 2, info.pendingTimers.length);
  check("retryTimers 为空（一次装好）", info.retryTimers.length === 0, info.retryTimers.length);
  check("applied = true", info.applied === true);
  check("slot 注册一次", h.slotCalls.inject === 1, h.slotCalls.inject);
}

/* ── ② 二次 apply：单实例 ── */
console.log("\n=== ② 二次 apply → 单实例守卫 ===");
h.apply();
h.apply();
{
  const info = h.api().info();
  check("interval 仍只有 1 个", h.intervals.size === 1, h.intervals.size);
  check("observer 仍只有 1 个", h.observers.length === 1, h.observers.length);
  check("slot 注入仍是 1 次", h.slotCalls.inject === 1, h.slotCalls.inject);
  check("监听没有翻倍", countListeners(h) === 6, countListeners(h));
  check("8s 提示没重复登记", info.pendingTimers.length === 2, info.pendingTimers.length);
}

/* ── ③ 一轮回答：检测 + 60ms 后滚动 ── */
console.log("\n=== ③ 一轮回答 → 检测并滚动 ===");
h.addTurn(1);
h.observers[0].fire();
{
  check("detections = 1", h.api().info().detections === 1, h.api().info().detections);
  check("60ms 定时器已登记", h.api().info().pendingTimers.length === 3, h.api().info().pendingTimers.length);
  h.advance(60);
  check("滚动发生", h.scrollCalls.length === 1, h.scrollCalls.length);
  check("scrolls = 1", h.api().info().scrolls === 1, h.api().info().scrolls);
  check("scrolling = true（等 scrollend/兜底）", h.api().info().scrolling === true);
}

/* ── ④ 会话切换：只重绑监听 ── */
console.log("\n=== ④ 会话切换 → 轻量 rebind ===");
const oldScroller = h.scroller();
const s2 = h.makeScroller("s2");
h.setScroller(s2);
h.tickIntervals();
{
  const info = h.api().info();
  check("boundScroller 已指向新 scroller", info.boundScroller === s2);
  check("旧 scroller 监听已摘除", Object.keys(oldScroller._handlers).length === 0, JSON.stringify(Object.keys(oldScroller._handlers)));
  check("新 scroller 有 wheel", typeof s2._handlers.wheel === "function");
  check("新 scroller 有 touchmove", typeof s2._handlers.touchmove === "function");
  check("新 scroller 有 scrollend", typeof s2._handlers.scrollend === "function");
  check("监听总数不变（6）", countListeners(h) === 6, countListeners(h));
  check("observer 没重建", h.observers.length === 1, h.observers.length);
  check("interval 没重建", h.intervals.size === 1, h.intervals.size);
  check("scrolling 已复位", info.scrolling === false);
  check("打了 rebind 清理日志", info.events.some((e) => e.errorType === "cleanup" && e.rebind === true));
}

/* ── ⑤ 第二轮：计数不翻倍 ── */
console.log("\n=== ⑤ 会话内第二轮 ===");
h.addTurn(2);
h.observers[0].fire();
h.advance(60);
{
  const info = h.api().info();
  check("detections = 2（每轮 +1）", info.detections === 2, info.detections);
  check("scrolls = 2（每轮 +1）", info.scrolls === 2, info.scrolls);
  check("监听仍 6 条（没叠加）", countListeners(h) === 6, countListeners(h));
}

/* ── ⑥ pagehide：全量 teardown ── */
console.log("\n=== ⑥ pagehide → 全量 teardown ===");
h.winHandlers.pagehide({ persisted: false });
{
  const info = h.api().info();
  check("listenerRegistry 清空", info.listenerRegistry.length === 0, info.listenerRegistry.length);
  check("intervalId = null", info.intervalId === null);
  check("mutationObserver = null", info.mutationObserver === null);
  check("retryTimers 清空", info.retryTimers.length === 0, info.retryTimers.length);
  check("pendingTimers 清空", info.pendingTimers.length === 0, info.pendingTimers.length);
  check("真实 interval 已 clear", h.intervals.size === 0, h.intervals.size);
  check("observer 已 disconnect", h.observers[0].active === false && h.observers[0].disconnected === 1);
  check("没有遗留 timer", h.timeouts.size === 0, h.timeouts.size);
  check("installed = false", info.installed === false);
  check("scrolling = false", info.scrolling === false);
  check("boundScroller = null", info.boundScroller === null);
  check("slot 已注销", h.slotCalls.unregisters === 1, h.slotCalls.unregisters);
  const ev = info.events.find((e) => e.errorType === "cleanup" && e.scope === "full");
  check("打了 full 清理日志", !!ev);
  check("清理日志只记枚举", !!ev && ev.reason === "pagehide");
}

/* ── ⑦ bfcache：persisted 不拆 ── */
console.log("\n=== ⑦ pagehide(persisted) → 保留资源 ===");
const h2 = makeHarness();
h2.apply();
h2.winHandlers.pagehide({ persisted: true });
{
  const info = h2.api().info();
  check("installed 仍为 true", info.installed === true);
  check("interval 还在", h2.intervals.size === 1, h2.intervals.size);
  check("observer 还连着", h2.observers[0].active === true);
  check("监听还在", countListeners(h2) === 6, countListeners(h2));
}

/* ── ⑧ teardown 后可重装 ── */
console.log("\n=== ⑧ teardown 后再次 apply → 可重装 ===");
h2.winHandlers.pagehide({ persisted: false });
h2.apply();
{
  const info = h2.api().info();
  check("重新 installed", info.installed === true);
  check("新 interval 只有一个", h2.intervals.size === 1, h2.intervals.size);
  check("新 observer 只有一个且连着", h2.observers.length === 2 && h2.observers[1].active === true, h2.observers.length);
  check("监听重新绑定", countListeners(h2) === 6, countListeners(h2));
  check("slot 重新注册", h2.slotCalls.inject === 2, h2.slotCalls.inject);
}

/* ── ⑨ 无 scroller：重试链登记 + 成功后清零 ── */
console.log("\n=== ⑨ 无 scroller → 重试链登记，就绪后清零 ===");
const h3 = makeHarness({ withScroller: false });
h3.apply();
{
  const info = h3.api().info();
  check("未安装", info.installed === false);
  check("两条重试链都登记", info.retryTimers.length === 2, info.retryTimers.length);
  check("按 kind 去重登记", Object.keys(info.retryTimersByKind).sort().join(",") === "input,observer", Object.keys(info.retryTimersByKind));
  check("没有产生 interval", h3.intervals.size === 0);

  const s = h3.makeScroller("late");
  h3.setScroller(s);
  h3.advance(800);
  const after = h3.api().info();
  check("重试后已安装", after.installed === true);
  check("重试表已清零", after.retryTimers.length === 0, after.retryTimers.length);
  check("监听已绑定", after.listenerRegistry.length === 6, after.listenerRegistry.length);
  check("只有一个 interval", h3.intervals.size === 1, h3.intervals.size);
  check("只有一个 observer", h3.observers.length === 1, h3.observers.length);
}

/* ── ⑩ 日志脱敏 ── */
console.log("\n=== ⑩ 事件日志脱敏 ===");
const allEvents = [h, h2, h3].flatMap((x) => x.api().info().events);
{
  const allowed = new Set([
    "errorType", "at", "v", "scope", "reason", "rebind",
    "hadLegacyKey", "legacyWasOff", "enabled",
    "probe", "anchor", "jumpButton", "count",
  ]);
  const badKey = allEvents.find((e) => Object.keys(e).some((k) => !allowed.has(k)));
  check("没有多余字段", !badKey, badKey && JSON.stringify(badKey));

  const raw = JSON.stringify(allEvents);
  const leaks = ["http://", "https://", "session-", "localStorage", "Error:"]
    .filter((s) => raw.indexOf(s) !== -1);
  check("不含 URL / 会话 id / 原始错误", leaks.length === 0, leaks.join(","));

  const badValue = allEvents.find((e) =>
    Object.keys(e).some((k) => typeof e[k] === "object" && e[k] !== null)
  );
  check("没有对象值（只允许枚举/布尔/数字）", !badValue);
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
