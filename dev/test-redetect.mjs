/**
 * 回归测试：DSH 空闲重渲染（同 turn 号换新节点）不得误判成新回答。
 *
 * 运行：node dev/test-redetect.mjs
 *
 * 覆盖：
 *   1. 同一 turn 号、新 DOM 节点 → 不重复检测（v0.11.2 修复的「思考时误上跳」）
 *   2. 新 turn 号 → 正常检测一次
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

function buildEnv() {
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
  let tailsArr = [];
  const scroller = {
    addEventListener: () => {},
    scrollTo: () => {},
    scrollTop: 0,
    clientHeight: 600,
    scrollHeight: 1200,
  };

  const doc = {
    querySelector: (sel) => (sel === "[data-conversation-scroll]" ? scroller : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-turn-tail]") return tailsArr;
      if (sel === "[data-chat-turn]") return [];
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
    sandbox, getExports: () => exports,
    tick() { if (intervalCb) intervalCb(); },
    setTails(list) { tailsArr = list || []; },
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

function tail(turn, revealed) {
  return {
    getAttribute: (a) => (a === "data-turn-tail" ? turn : null),
    hasAttribute: (a) => (a === "data-actions-reveal" ? !!revealed : false),
  };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label); }
}

const env = buildEnv();
// 安装前：已存在一轮已完成的回答 turn="10"
env.setTails([tail("10", true)]);
env.getExports().apply(fakeCtx());

const info = () => env.sandbox.__dshAnswerTop.info();
// 关掉 boot jump，避免它干扰 detections 计数
info().bootJumpDone = true;

console.log("=== 1. 同 turn 号换新节点 → 不重复检测 ===");
// 空闲重渲染：同一轮 turn="10"，换成一个全新节点对象
env.setTails([tail("10", true)]);
env.tick();
ok(info().detections === 0, "重渲染后 detections 仍为 0（实际 " + info().detections + "）");

console.log("=== 2. 新 turn 号 → 正常检测一次 ===");
env.setTails([tail("11", true)]);
env.tick();
ok(info().detections === 1, "新 turn 检测一次（实际 " + info().detections + "）");

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
