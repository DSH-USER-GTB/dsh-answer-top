/**
 * Item 8 验收：兄弟插件共存探测（v0.12.0 版）
 *
 * 用假 ctx.modules 注入不同名单，验证：
 *   ① 含 anchor → 自动回滚被闸，forceScroll 仍可用，日志只含布尔
 *   ② 只装 jump-button → 不再视为冲突，自动回滚正常
 *   ③ 都没有 → 正常自动回滚，anchor=false
 *   ④ ctx.modules 缺失 → 探测失败、不降级、不刷日志；恢复后继续工作
 *   ⑤ graphRows Map 兜底路径
 *   ⑥ 自动恢复：有→无恢复、无→有重新闸住，只在变化时记 1 条日志
 *   ⑦ scope 前缀归一化 + 相似 id 不误判
 *   ⑧ 日志脱敏
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

const manifest = (ids) => ({ manifest: { modules: ids.map((id) => ({ id })) } });

const ALLOWED_KEYS = new Set([
  "errorType", "at", "v", "count",
  "anchor", "probe",
  "scope", "reason", "rebind",
  "hadLegacyKey", "legacyWasOff", "enabled",
]);

/* ── ① 含 anchor → 闸住自动回滚 ── */
console.log("=== ① 名单含 dsh-chat-answer-anchor ===");
{
  const h = makeHarness({
    modules: manifest(["dsh-answer-top", "dsh-chat-answer-anchor"]),
  });
  h.apply();
  const info = h.api().info();
  check("anchor = true", info.coexistence.anchor === true);
  check("probe = ok", info.coexistence.probe === "ok", String(info.coexistence.probe));
  check("首次成功后 checked = true", info.coexistence.checked === true);
  check("已移除 jumpButton 字段", !("jumpButton" in info.coexistence), JSON.stringify(info.coexistence));
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

  const evs = h.coexistEvents();
  check("记了 coexistence 事件", evs.length === 1, String(evs.length));
  check("事件 anchor = true", evs.every((e) => e.anchor === true));
  check("事件字段只有白名单", evs.every((e) => Object.keys(e).every((k) => ALLOWED_KEYS.has(k))), JSON.stringify(evs));
}

/* ── ② 只装 jump-button → 不再算冲突 ── */
console.log("\n=== ② 名单只有 @community/dsh-jump-button/client ===");
{
  const h = makeHarness({
    modules: manifest(["@community/dsh-jump-button/client"]),
  });
  h.apply();
  check("anchor = false（不再认 jump-button）", h.api().info().coexistence.anchor === false);
  autoRound(h, 1);
  check("自动回滚正常发生", h.api().info().scrolls === 1, String(h.api().info().scrolls));
  check("lastSkip 为 null", h.api().info().lastSkip === null, String(h.api().info().lastSkip));
  check("日志 anchor = false", h.coexistEvents().every((e) => e.anchor === false));
}

/* ── ③ 都不在 → 正常滚 ── */
console.log("\n=== ③ 名单里没有目标插件 ===");
{
  const h = makeHarness({
    modules: manifest(["dsh-answer-top", "dsh-foo"]),
  });
  h.apply();
  autoRound(h, 1);
  const info = h.api().info();
  check("anchor = false", info.coexistence.anchor === false);
  check("自动回滚正常发生", info.scrolls === 1, String(info.scrolls));
  check("lastSkip 为 null", info.lastSkip === null, String(info.lastSkip));
  check("coexistSkips = 0", info.coexistSkips === 0, String(info.coexistSkips));
  check("未命中也有基线日志", h.coexistEvents().some((e) => e.anchor === false), JSON.stringify(h.coexistEvents()));
}

/* ── ④ ctx.modules 缺失 → 失败不降级、不刷日志、可恢复 ── */
console.log("\n=== ④ ctx.modules 缺失 → 失败不刷日志 ===");
{
  const h = makeHarness({ modules: undefined });
  let threw = null;
  try { h.apply(); } catch (e) { threw = e; }
  check("apply 不抛错", threw === null, threw && threw.message);
  check("probe = failed", h.api().info().coexistence.probe === "failed", String(h.api().info().coexistence.probe));
  autoRound(h, 1);
  check("不降级：正常滚动", h.api().info().scrolls === 1, String(h.api().info().scrolls));

  const failedEvents = h.coexistEvents().length;
  check("初始失败只记 1 条", failedEvents === 1, String(failedEvents));
  h.advance(4000); // 5 轮 tick 都探测失败
  check("后续失败不刷日志", h.coexistEvents().length === failedEvents, String(h.coexistEvents().length));
  check("失败期间 probe 仍为 failed", h.api().info().coexistence.probe === "failed");

  // 名单恢复（无 anchor）→ 自动回到 ok
  h.setModules(manifest(["dsh-foo"]));
  h.advance(800);
  check("恢复后 probe = ok", h.api().info().coexistence.probe === "ok", String(h.api().info().coexistence.probe));
  check("恢复记 1 条基线日志", h.coexistEvents().length === failedEvents + 1, String(h.coexistEvents().length));
  autoRound(h, 2);
  check("恢复后仍能正常滚动", h.api().info().scrolls === 2, String(h.api().info().scrolls));
}

/* ── ④-b ctx.modules 抛异常（inactive）→ 探测失败、不降级、不刷日志 ── */
console.log("\n=== ④-b 上下文停止 / modules 抛异常 ===");
{
  const badModules = {};
  Object.defineProperty(badModules, "manifest", {
    get() { throw new Error("context inactive"); },
  });
  const h = makeHarness({ modules: badModules });
  let threw = null;
  try { h.apply(); } catch (e) { threw = e; }
  check("apply 不抛错", threw === null, threw && threw.message);
  check("异常 → probe = failed", h.api().info().coexistence.probe === "failed", String(h.api().info().coexistence.probe));
  check("异常 → 不降级（anchor = false）", h.api().info().coexistence.anchor === false);
  autoRound(h, 1);
  check("异常时自动回滚正常", h.api().info().scrolls === 1, String(h.api().info().scrolls));
  const failedEvents = h.coexistEvents().length;
  check("初始失败只记 1 条", failedEvents === 1, String(failedEvents));
  h.advance(4000);
  check("后续 tick 异常不刷日志", h.coexistEvents().length === failedEvents, String(h.coexistEvents().length));
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

/* ── ⑥ 自动恢复：有 ↔ 无 ── */
console.log("\n=== ⑥ 同会话自动恢复 / 重新闸住 ===");
{
  const h = makeHarness({ modules: manifest(["dsh-chat-answer-anchor"]) });
  h.apply();
  check("初始 anchor = true", h.api().info().coexistence.anchor === true);
  check("初始 1 条日志", h.coexistEvents().length === 1, String(h.coexistEvents().length));

  // 有 → 无
  h.setModules(manifest(["dsh-answer-top"]));
  h.advance(800);
  check("移除 anchor 后下一轮 tick 恢复", h.api().info().coexistence.anchor === false);
  check("恢复时记 1 条日志", h.coexistEvents().length === 2, String(h.coexistEvents().length));
  autoRound(h, 1);
  check("恢复后自动回滚真的发生", h.api().info().scrolls === 1, String(h.api().info().scrolls));

  // 无 → 有
  h.setModules(manifest(["dsh-chat-answer-anchor"]));
  h.advance(800);
  check("重新出现 anchor 后再次闸住", h.api().info().coexistence.anchor === true);
  check("重新闸住记 1 条日志", h.coexistEvents().length === 3, String(h.coexistEvents().length));
  autoRound(h, 2);
  check("重新闸住后不再自动滚", h.api().info().scrolls === 1, String(h.api().info().scrolls));
  check("lastSkip 标明共存", h.api().info().lastSkip === "coexistence(anchor)", String(h.api().info().lastSkip));
  check("coexistSkips = 1", h.api().info().coexistSkips === 1, String(h.api().info().coexistSkips));

  // 状态稳定时多轮 tick 不再记日志
  const before = h.coexistEvents().length;
  h.advance(5000);
  check("空闲期间不刷日志", h.coexistEvents().length === before, h.coexistEvents().length + " vs " + before);
  check("事件序列 true→false→true", JSON.stringify(h.coexistEvents().map((e) => e.anchor)) === "[true,false,true]", JSON.stringify(h.coexistEvents().map((e) => e.anchor)));
}

/* ── ⑦ scope 前缀归一化（含反例，防止相似 id 误判）── */
console.log("\n=== ⑦ scope 前缀归一化 ===");
{
  const h = makeHarness({ modules: manifest(["@community/dsh-chat-answer-anchor"]) });
  h.apply();
  check("@scope/dsh-chat-answer-anchor 命中", h.api().info().coexistence.anchor === true);
  autoRound(h, 1);
  check("自动回滚被闸", h.api().info().scrolls === 0, String(h.api().info().scrolls));
  check("lastSkip 正确", h.api().info().lastSkip === "coexistence(anchor)", String(h.api().info().lastSkip));
}
{
  const h = makeHarness({
    modules: manifest(["@someone/dsh-chat-answer-anchor-extra"]),
  });
  h.apply();
  check("相似 id 不误判", h.api().info().coexistence.anchor === false);
  autoRound(h, 1);
  check("相似 id 不闸自动回滚", h.api().info().scrolls === 1, String(h.api().info().scrolls));
}

/* ── ⑧ 日志脱敏 ── */
console.log("\n=== ⑧ 日志脱敏 ===");
{
  const events = [];
  for (const mk of [
    () => makeHarness({ modules: manifest(["dsh-chat-answer-anchor"]) }),
    () => makeHarness({ modules: undefined }),
    () => makeHarness({ modules: manifest(["dsh-foo"]) }),
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
