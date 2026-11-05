/**
 * Item 4 回归测试：脱敏事件日志的持久化 / 折叠 / 环形轮转。
 *
 * 运行：node dev/test-events.mjs
 *
 * 覆盖：
 *   1. 持久化：apply 后 localStorage['dsh-answer-top:events'] 有 migrated 事件
 *   2. 折叠：连续两次 cleanup → 合并成一条，count=2
 *   3. 200 条上限（读回时严格截断）
 *   4. 50KB 上限（写回时环形轮转丢最旧）
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

function buildEnv(seed) {
  const store = seed ? { ...seed } : {};
  const localStorageShim = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  let exports = null;
  const sandbox = {
    __ModuleLoader__: {
      load: (mod) => {
        exports = mod.factory((name) => {
          if (name === "react") return React;
          throw new Error("未知依赖: " + name);
        });
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
    setInterval: () => 1,
    setTimeout: (fn) => 1,
    clearTimeout: () => {},
    clearInterval: () => {},
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
  return { sandbox, store, getExports: () => exports, context };
}

function fakeCtx() {
  return {
    effect: (fn) => fn(),
    slots: {
      inject: (name, fn) => { fn(); return () => {}; },
      register: (opts, Comp) => () => {},
    },
  };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label); }
}

/* ── 测试 1：持久化 ── */
console.log("=== 1. 持久化 ===");
{
  const { store, getExports } = buildEnv();
  getExports().apply(fakeCtx());
  const raw = store["dsh-answer-top:events"];
  ok(!!raw, "localStorage 已写入 events 键");
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) {}
  ok(Array.isArray(parsed), "events 是合法 JSON 数组");
  ok(parsed && parsed.some((e) => e.errorType === "migrated"), "包含 migrated 事件");
}

/* ── 测试 2：连续同错折叠 ── */
console.log("=== 2. 折叠 count ===");
{
  const { store, getExports, sandbox } = buildEnv();
  getExports().apply(fakeCtx());
  const api = sandbox.__dshAnswerTop;
  api.teardown();                       // logEvent("cleanup") #1
  api.info().disposed = false;          // 复位守卫
  api.teardown();                       // logEvent("cleanup") #2 → 应折叠
  const events = api.info().events;
  const cleanups = events.filter((e) => e.errorType === "cleanup");
  ok(cleanups.length === 1, "连续 cleanup 折叠成一条（实际 " + cleanups.length + " 条）");
  ok(cleanups.length === 1 && cleanups[0].count === 2, "count = 2");
}

/* ── 测试 3：200 条上限（读回时截断）── */
console.log("=== 3. 200 条上限 ===");
{
  const seed = {};
  seed["dsh-answer-top:events"] = JSON.stringify(
    Array.from({ length: 250 }, (_, i) => ({ errorType: "t" + i, at: "x", v: "0.9.2" }))
  );
  const { getExports, sandbox } = buildEnv(seed);
  getExports().apply(fakeCtx());
  const n = sandbox.__dshAnswerTop.info().events.length;
  ok(n <= 200, "读回后截断到 ≤200（实际 " + n + " 条）");
}

/* ── 测试 4：50KB 上限（写回时环形轮转丢最旧）── */
console.log("=== 4. 50KB 上限 ===");
{
  const { store, getExports, sandbox } = buildEnv();
  getExports().apply(fakeCtx());
  const api = sandbox.__dshAnswerTop;
  const events = api.info().events;
  for (let i = 0; i < 80; i++) {
    events.push({ errorType: "bloat" + i, at: "x", v: "0.9.2", pad: "x".repeat(1024) });
  }
  api.teardown(); // 触发 persistEvents
  const raw = store["dsh-answer-top:events"];
  const bytes = raw ? raw.length : 0;
  ok(bytes <= 50 * 1024, "写回后 ≤50KB（实际 " + bytes + " 字节）");
  ok(events.length < 80, "最旧条目被轮转丢弃（剩余 " + events.length + " 条）");
  ok(!events.some((e) => e.errorType === "bloat0"), "最旧 bloat0 已被丢弃");
}

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
