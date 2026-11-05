/**
 * Item 8 验收：兄弟插件共存探测
 *
 * 用假 ctx.modules 注入三种名单，验证：
 *   ① 含 anchor → 自动回滚被闸，forceScroll 仍可用，日志只含布尔
 *   ② 含 jumpButton（id 带 /client 后缀）→ 同样被闸，后缀已归一化
 *   ③ 两者都无 → 正常自动回滚，coexistence 两 false
 *   ④ ctx.modules 缺失 → 探测返回 null、不降级、不抛错
 *   ⑤ graphRows Map 兜底路径
 *   ⑥ 幂等：checked 置位后不再重复探测
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
    scrollTo(opts) { scrollCalls.push(opts); },
  };

  /* ── 假 turn / tail ── */
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
    constructor(cb) { this.cb = cb; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
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

  const modules = opts.modules;
  const ctx = {
    effect: (fn) => fn(),
    modules: modules,
    slots: {
      inject: (name, factory) => { factory(); return () => {}; },
      register: () => () => {},
    },
  };

  return {
    apply: () => exportsObj.apply(ctx),
    api: () => windowShim.__dshAnswerTop,
    setModules: (m) => { ctx.modules = m; },
    ctx,
    scrollCalls,
    addTurn,
    observers,
    advance,
    events: () => windowShim.__dshAnswerTop.info().events,
    coexistEvents: () =>
      windowShim.__dshAnswerTop.info().events.filter((e) => e.errorType === "coexistence"),
  };
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { console.log("  ✗ " + name + (detail !== undefined ? "  → " + detail : "")); }
}

/** 触发一轮自动检测：新 tail + 60ms 后尝试滚动 */
function autoRound(h, n) {
  h.addTurn(n);
  h.observers[0].fire();
  h.advance(60);
}

const ALLOWED_KEYS = new Set([
  "errorType", "at", "v", "count",
  "anchor", "jumpButton", "probe",
  "scope", "reason", "rebind",
  "hadLegacyKey", "legacyWasOff", "enabled",
]);

/* ── ① 含 anchor → 闸住自动回滚 ── */
console.log("=== ① 名单含 dsh-chat-answer-anchor ===");
{
  const h = makeHarness({
    modules: {
      manifest: {
        modules: [{ id: "dsh-answer-top" }, { id: "dsh-chat-answer-anchor" }],
      },
    },
  });
  h.apply();
  const info = h.api().info();
  check("anchor = true", info.coexistence.anchor === true);
  check("jumpButton = false", info.coexistence.jumpButton === false);
  check("probe = ok", info.coexistence.probe === "ok", String(info.coexistence.probe));
  check("尚未定格（checked=false）", info.coexistence.checked === false);
  const ids = h.api().moduleIds();
  check("moduleIds 能列出名单", Array.isArray(ids) && ids.indexOf("dsh-chat-answer-anchor") !== -1, JSON.stringify(ids));
  check("diagnose 带共存结果", h.api().diagnose().coexistence.anchor === true);

  autoRound(h, 1);
  const after = h.api().info();
  check("自动回滚被闸：scrolls = 0", after.scrolls === 0, String(after.scrolls));
  check("lastSkip 标明共存", after.lastSkip === "coexistence(anchor)", String(after.lastSkip));
  check("coexistSkips = 1", after.coexistSkips === 1, String(after.coexistSkips));

  const ok = h.api().forceScroll();
  check("forceScroll 仍可用", ok === true, String(ok));
  check("forceScroll 真的滚了", h.api().info().scrolls === 1, String(h.api().info().scrolls));

  h.advance(1500);
  check("1.5s 后 checked = true", h.api().info().coexistence.checked === true);

  const evs = h.coexistEvents();
  check("记了 coexistence 事件", evs.length >= 1, String(evs.length));
  check("事件 anchor = true", evs.every((e) => e.anchor === true));
  check("事件字段只有白名单", evs.every((e) => Object.keys(e).every((k) => ALLOWED_KEYS.has(k))), JSON.stringify(evs));
}

/* ── ② 含 jumpButton（@scope + /client）→ 闸住自动回滚 ── */
console.log("\n=== ② 名单含 @community/dsh-jump-button/client ===");
{
  const h = makeHarness({
    modules: { manifest: { modules: [{ id: "@community/dsh-jump-button/client" }] } },
  });
  h.apply();
  check("scope + 后缀归一化后 jumpButton = true", h.api().info().coexistence.jumpButton === true);
  check("anchor = false", h.api().info().coexistence.anchor === false);
  autoRound(h, 1);
  check("自动回滚被闸", h.api().info().scrolls === 0, String(h.api().info().scrolls));
  check("lastSkip 标明 jumpButton", h.api().info().lastSkip === "coexistence(jumpButton)", String(h.api().info().lastSkip));
}

/* ── ③ 都不在 → 正常滚 ── */
console.log("\n=== ③ 名单里没有目标插件 ===");
{
  const h = makeHarness({
    modules: { manifest: { modules: [{ id: "dsh-answer-top" }, { id: "dsh-foo" }] } },
  });
  h.apply();
  autoRound(h, 1);
  const info = h.api().info();
  check("coexistence 两 false", info.coexistence.anchor === false && info.coexistence.jumpButton === false);
  check("自动回滚正常发生", info.scrolls === 1, String(info.scrolls));
  check("lastSkip 为 null", info.lastSkip === null, String(info.lastSkip));
  check("coexistSkips = 0", info.coexistSkips === 0, String(info.coexistSkips));
  const ev = h.coexistEvents();
  check("未命中也有日志（两 false）", ev.some((e) => e.anchor === false && e.jumpButton === false), JSON.stringify(ev));
}

/* ── ④ ctx.modules 缺失 → null，不降级 ── */
console.log("\n=== ④ ctx.modules 缺失 ===");
{
  const h = makeHarness({ modules: undefined });
  let threw = null;
  try { h.apply(); } catch (e) { threw = e; }
  check("apply 不抛错", threw === null, threw && threw.message);
  check("probe = failed", h.api().info().coexistence.probe === "failed", String(h.api().info().coexistence.probe));
  autoRound(h, 1);
  check("不降级：正常滚动", h.api().info().scrolls === 1, String(h.api().info().scrolls));
  h.advance(1500);
  check("复检失败后 checked = true", h.api().info().coexistence.checked === true);
  const ev = h.coexistEvents();
  check("失败日志只记 probe", ev.every((e) => e.probe === "failed" && e.anchor === undefined), JSON.stringify(ev));
}

/* ── ⑤ graphRows 兜底 ── */
console.log("\n=== ⑤ graphRows Map 兜底 ===");
{
  const h = makeHarness({
    modules: { graphRows: new Map([["dsh-chat-answer-anchor", { id: "dsh-chat-answer-anchor" }]]) },
  });
  h.apply();
  check("从 graphRows 命中 anchor", h.api().info().coexistence.anchor === true);
  check("moduleIds 走 graphRows keys", JSON.stringify(h.api().moduleIds()) === '["dsh-chat-answer-anchor"]', JSON.stringify(h.api().moduleIds()));
  autoRound(h, 1);
  check("自动回滚被闸", h.api().info().scrolls === 0, String(h.api().info().scrolls));
}

/* ── ⑥ 幂等：checked 后不再探测 ── */
console.log("\n=== ⑥ checked 后不再重复探测 ===");
{
  const h = makeHarness({
    modules: { manifest: { modules: [{ id: "dsh-foo" }] } },
  });
  h.apply();
  h.advance(1500);
  check("首次复检完成", h.api().info().coexistence.checked === true);
  const before = h.coexistEvents().length;

  // 1.5s 之后兄弟插件才出现（模拟），但不应再探测
  h.setModules({
    manifest: { modules: [{ id: "dsh-chat-answer-anchor" }] },
  });
  h.advance(5000);
  check("不再改判 anchor", h.api().info().coexistence.anchor === false);
  check("没有新增 coexistence 事件", h.coexistEvents().length === before, h.coexistEvents().length + " vs " + before);
}

/* ── ⑦ scope 前缀归一化（含反例，防止相似 id 误判）── */
console.log("\n=== ⑦ scope 前缀归一化 ===");
{
  const h = makeHarness({
    modules: {
      manifest: {
        modules: [
          { id: "@community/dsh-chat-answer-anchor" },
          { id: "@someone/dsh-chat-answer-anchor-extra" },
        ],
      },
    },
  });
  h.apply();
  check("@scope/dsh-chat-answer-anchor 命中", h.api().info().coexistence.anchor === true);
  check("相似 id 不误判 jumpButton", h.api().info().coexistence.jumpButton === false);
  autoRound(h, 1);
  check("自动回滚被闸", h.api().info().scrolls === 0, String(h.api().info().scrolls));
  check("lastSkip 正确", h.api().info().lastSkip === "coexistence(anchor)", String(h.api().info().lastSkip));
}

/* ── ⑧ 日志脱敏 ── */
console.log("\n=== ⑧ 日志脱敏 ===");
{
  const events = [];
  for (const mk of [
    () => makeHarness({ modules: { manifest: { modules: [{ id: "dsh-chat-answer-anchor" }] } } }),
    () => makeHarness({ modules: undefined }),
  ]) {
    const h = mk();
    h.apply();
    events.push(...h.events());
  }
  const badValue = events.find((e) =>
    Object.keys(e).some((k) => typeof e[k] === "object" && e[k] !== null)
  );
  check("没有对象值", !badValue, badValue && JSON.stringify(badValue));
  const raw = JSON.stringify(events);
  const leaks = ["http://", "https://", "session-", "Error:"].filter((s) => raw.indexOf(s) !== -1);
  check("不含 URL / 会话 id / 原始错误", leaks.length === 0, leaks.join(","));
  const badKeys = events.find((e) => Object.keys(e).some((k) => !ALLOWED_KEYS.has(k)));
  check("字段都在白名单", !badKeys, badKeys && JSON.stringify(badKeys));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
