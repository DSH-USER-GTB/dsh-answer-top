/**
 * Item 2 验收：用户交互取消本轮滚动
 *
 * 我这边只拿到一条线索——「最近 300ms 用户输入则本轮不滚」。
 * 下面是我按这条线索实现的 8 个边界 case，请对照你的细则逐条核对。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";
const WINDOW_MS = 300;

function makeRunner(storeInit) {
  const store = { [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: true, sessions: {} }), ...storeInit };
  const handlers = {};
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
        exportsObj = mod.factory((name) => {
          if (name === "react") return React;
          throw new Error("未知依赖: " + name);
        });
      },
    },
    localStorage,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} disconnect() {} },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      body: {},
      readyState: "complete",
      addEventListener: (t, fn) => { handlers["doc:" + t] = fn; },
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
  };
  const context = vm.createContext({
    window: sandbox,
    document: sandbox.document,
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

  const scrollerHandlers = {};
  const fakeScroller = {
    addEventListener: (t, fn) => { scrollerHandlers[t] = fn; },
    scrollTop: 0,
    clientHeight: 800,
    scrollHeight: 5000,
    getBoundingClientRect: () => ({ top: 0, height: 800 }),
    scrollTo: () => {},
  };
  sandbox.document.querySelector = () => fakeScroller;

  const ctx = { effect: (fn) => fn(), slots: { inject: (n, fn) => fn(), register: () => () => {} } };

  return {
    store,
    apply: () => exportsObj.apply(ctx),
    api: () => sandbox.__dshAnswerTop,
    scrollHandlers: scrollerHandlers,
    docHandlers: handlers,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.log("  ✗ " + name + (detail ? "  → " + detail : ""));
}

/** 读取一次跳过的原因（不依赖真实 DOM 布局） */
function skipReason(r) {
  r.api().forceScroll();
  return r.api().info().lastSkip;
}

/* ── case 1：完全没有交互 → 不因 user-input 跳过 ── */
{
  const r = makeRunner();
  r.apply();
  const reason = skipReason(r);
  check("case1 无交互 → 不被 user-input 拦截", !String(reason).startsWith("user-input"), String(reason));
}

/* ── case 2：300ms 内滚了滚轮 → 本轮不滚 ── */
{
  const r = makeRunner();
  r.apply();
  r.scrollHandlers.wheel();
  const reason = skipReason(r);
  check("case2 wheel 后立即滚 → 拦截", String(reason).startsWith("user-input"), String(reason));
  check("case2 原因里带 wheel", String(reason).includes("wheel"), String(reason));
}

/* ── case 3：300ms 内触摸滑动 → 本轮不滚 ── */
{
  const r = makeRunner();
  r.apply();
  r.scrollHandlers.touchmove();
  const reason = skipReason(r);
  check("case3 touchmove 后立即滚 → 拦截", String(reason).startsWith("user-input"), String(reason));
}

/* ── case 4：300ms 内打字 → 本轮不滚 ── */
{
  const r = makeRunner();
  r.apply();
  r.docHandlers["doc:keydown"]();
  const reason = skipReason(r);
  check("case4 keydown 后立即滚 → 拦截", String(reason).startsWith("user-input"), String(reason));
  check("case4 原因里带 keydown", String(reason).includes("keydown"), String(reason));
}

/* ── case 5：300ms 内点击（选文字）→ 本轮不滚 ── */
{
  const r = makeRunner();
  r.apply();
  r.docHandlers["doc:pointerdown"]();
  const reason = skipReason(r);
  check("case5 pointerdown 后立即滚 → 拦截", String(reason).startsWith("user-input"), String(reason));
}

/* ── case 6：交互超过 300ms → 恢复滚动 ── */
{
  const r = makeRunner();
  r.apply();
  r.scrollHandlers.wheel();
  await sleep(WINDOW_MS + 80);
  const reason = skipReason(r);
  check("case6 wheel 后等 380ms → 不再拦截", !String(reason).startsWith("user-input"), String(reason));
}

/* ── case 7：插件关闭时优先报 disabled（优先级） ── */
{
  const r = makeRunner({ [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: false, sessions: {} }) });
  r.apply();
  r.scrollHandlers.wheel();
  const reason = skipReason(r);
  check("case7 关闭 + 刚交互 → lastSkip = disabled（关闭优先）", reason === "disabled", String(reason));
}

/* ── case 8：程序自己的 scrollTo 不算用户交互 ── */
{
  const r = makeRunner();
  r.apply();
  // 我们的滚动用 scrollTo，不派发 wheel/keydown，所以监听器不会被触发
  const before = r.api().info().lastUserInputAt;
  r.api().forceScroll(); // 内部会调 scroller.scrollTo
  const after = r.api().info().lastUserInputAt;
  check("case8 程序滚动不改变 lastUserInputAt", before === after, before + " → " + after);
}

/* ── 额外：cancelCount / lastSkip 可观测 ── */
{
  const r = makeRunner();
  r.apply();
  r.scrollHandlers.wheel();
  skipReason(r);
  const info = r.api().info();
  check("额外 lastUserInputKind 已记录", info.lastUserInputKind === "wheel", String(info.lastUserInputKind));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
