/**
 * Item 6 回归测试：退避保活 + 平台改版判定。
 *
 * 运行：node dev/test-degrade.mjs
 *
 * 覆盖：
 *   1. 容器找不到时，observer/input 两条链快重试耗尽后进入「退避慢速保活」，不永久放弃
 *   2. 容器晚到后，慢速保活能恢复安装（回归 v0.10.1 修复的 bug）
 *   3. 契约元素（[data-chat-turn] 与 [data-turn-tail]）连续 10 次为 0 → 停 observer/interval
 *   4. 降级后慢速保活重检，契约恢复 → 自动重装 observer/interval
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (v) => ({ current: v }),
  useEffect: (fn) => { fn(); },
  useState: (init) => [init, (v) => v],
  Fragment: "Fragment",
};

function buildEnv(opts) {
  let scroller = opts.scroller || null;
  let tailsArr = opts.tails || [];
  let turnsArr = opts.turns || [];
  const store = {};
  const localStorageShim = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  let exports = null;
  const timers = new Map();
  let timerSeq = 0;
  let intervalCb = null;

  const doc = {
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-turn-tail]") return tailsArr;
      if (sel === "[data-chat-turn]") return turnsArr;
      return [];
    },
    body: {},
    readyState: "complete",
    addEventListener: () => {},
  };

  const sandbox = {
    __ModuleLoader__: {
      load: (mod) => {
        exports = mod.factory((n) => {
          if (n === "react") return React;
          throw new Error("未知依赖: " + n);
        });
      },
    },
    localStorage: localStorageShim,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} disconnect() {} },
    document: doc,
    setTimeout: (fn) => { const id = ++timerSeq; timers.set(id, { fn, cleared: false }); return id; },
    clearTimeout: (id) => { if (timers.has(id)) timers.get(id).cleared = true; },
    setInterval: (fn) => { intervalCb = fn; return 100; },
    clearInterval: () => { intervalCb = null; },
  };

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
  vm.runInContext(code, context, { filename: "client.js" });

  return {
    sandbox, store, getExports: () => exports,
    fireNextTimer() {
      for (const t of timers.values()) {
        if (!t.cleared) { t.cleared = true; t.fn(); return true; }
      }
      return false;
    },
    pendingTimerCount() { let n = 0; for (const t of timers.values()) if (!t.cleared) n++; return n; },
    tick() { if (intervalCb) intervalCb(); },
    setNodes(t, r) { tailsArr = t || []; turnsArr = r || []; },
    setScroller(s) { scroller = s; },
  };
}

function fakeCtx() {
  return {
    effect: (fn) => fn(),
    slots: {
      inject: (name, fn) => { fn(); return () => {}; },
      register: () => () => {},
    },
  };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label); }
}

/* ── 测试 1：快预算耗尽 → 退避慢速保活（不永久放弃）── */
console.log("=== 1. 退避保活（不再永久放弃）===");
{
  const env = buildEnv({ scroller: null, tails: [], turns: [] });
  env.getExports().apply(fakeCtx());
  const info = () => env.sandbox.__dshAnswerTop.info();
  let guard = 0;
  while (guard++ < 60 && !(info().degraded.observer && info().degraded.input)) {
    env.fireNextTimer();
  }
  ok(info().degraded.observer === true, "observer 进入退避（degraded=true）");
  ok(info().degraded.input === true, "input 进入退避（degraded=true）");
  ok(env.pendingTimerCount() >= 1, "退避后仍有慢速保活 timer（不永久放弃）");
  ok(info().events.some((e) => e.errorType === "degraded" && e.scope === "observer" && e.reason === "backoff"), "有脱敏 degraded(observer, backoff) 日志");
}

/* ── 测试 2：容器晚到 → 恢复 ── */
console.log("=== 2. 容器晚到仍能恢复 ===");
{
  const env = buildEnv({ scroller: null, tails: [], turns: [] });
  env.getExports().apply(fakeCtx());
  const info = () => env.sandbox.__dshAnswerTop.info();
  let guard = 0;
  while (guard++ < 60 && !(info().degraded.observer && info().degraded.input)) {
    env.fireNextTimer();
  }
  ok(info().installed === false, "退避阶段 observer 尚未安装");
  env.setScroller({ addEventListener: () => {} }); // 容器此刻才出现
  let recovered = false;
  for (let i = 0; i < 40 && !recovered; i++) {
    if (!env.fireNextTimer()) break;
    if (info().installed) recovered = true;
  }
  ok(recovered, "容器晚到后 observer 恢复安装");
  ok(info().degraded.observer !== true, "恢复后 observer 退避标记已清（resetRetry）");
}

/* ── 测试 3：平台改版判定 ── */
console.log("=== 3. 平台改版（连续 10 次契约缺失）===");
{
  const fakeTail = { hasAttribute: () => false };
  const fakeTurn = {};
  const env = buildEnv({
    scroller: { addEventListener: () => {} },
    tails: [fakeTail],
    turns: [fakeTurn],
  });
  env.getExports().apply(fakeCtx());
  const s = () => env.sandbox.__dshAnswerTop.info();

  env.tick(); // 第 1 tick：契约在场 → contractSeen=true
  ok(s().contractSeen === true, "契约元素已被观测到");

  env.setNodes([], []); // 契约元素全部消失（改版）
  for (let i = 0; i < 9; i++) env.tick(); // 缺失 1..9
  ok(s().contractDegraded !== true, "9 次缺失尚未降级（慢切换不算改版）");
  env.tick(); // 缺失 10 → 降级
  ok(s().contractDegraded === true, "连续 10 次缺失 → 已降级");
  ok(s().installed === false, "已停 observer/interval（installed=false）");
  ok(s().intervalId === null, "intervalId 已清空");
  ok(s().events.some((e) => e.errorType === "degraded" && e.scope === "contract"), "有脱敏 degraded(contract) 日志");
}

/* ── 测试 4：降级后契约恢复 → 自动重装 ── */
console.log("=== 4. 契约恢复 → 自动重装 ===");
{
  const env = buildEnv({
    scroller: { addEventListener: () => {} },
    tails: [{ hasAttribute: () => false }],
    turns: [{}],
  });
  env.getExports().apply(fakeCtx());
  const s = () => env.sandbox.__dshAnswerTop.info();

  env.tick(); // 契约在场 → contractSeen=true
  env.setNodes([], []);
  for (let i = 0; i < 10; i++) env.tick(); // 触发降级
  ok(s().contractDegraded === true, "已降级");
  ok(s().installed === false, "降级后 installed=false");
  ok(typeof s().retryTimersByKind.contract === "number", "5s 保活 timer 已登记在 contract");

  // 契约恢复（tail/turn 重新出现）
  env.setNodes([{ hasAttribute: () => false }], [{}]);
  let recovered = false;
  for (let i = 0; i < 20 && !recovered; i++) {
    if (!env.fireNextTimer()) break;
    if (s().installed) recovered = true;
  }
  ok(recovered, "契约恢复后自动重装 observer/interval");
  ok(s().contractDegraded === false, "contractDegraded 已复位");
  ok(s().contractMisses === 0, "contractMisses 已清零");
  ok(s().intervalId !== null, "intervalId 已重新建立");
  ok(s().events.some((e) => e.errorType === "redetect" && e.scope === "contract" && e.reason === "recovered"), "有脱敏 redetect(contract, recovered) 日志");
}

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
