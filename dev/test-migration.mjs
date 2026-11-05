/**
 * 迁移逻辑验收测试
 *
 * 覆盖用户给的三条验收：
 *   ① 旧键="off" + 新键不存在  → 新键 enabled:false（继承旧意图）
 *   ② 旧键缺失 + 新键不存在    → 新键 enabled:true，且旧键被写成 "off"
 *   ③ 重复刷新（apply 多次）   → 不再重复迁移
 *
 * 额外覆盖：
 *   ④ 旧键="on"（非 off）      → 新键 enabled:true，旧键压成 "off"
 *   ⑤ 新键已存在               → 不迁移、不打 migrated 日志
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const CONFIG_KEY = "dsh-answer-top:config";
const LEGACY_KEY = "dsh-answer-top";

function makeRunner(initialStore) {
  const store = { ...initialStore };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
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
      addEventListener: () => {},
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

  const ctx = {
    effect: (fn) => fn(),
    slots: { inject: (n, fn) => fn(), register: () => () => {} },
  };

  return {
    store,
    applyOnce: () => exportsObj.apply(ctx),
    api: () => sandbox.__dshAnswerTop,
  };
}

function cfg(store) {
  const raw = store[CONFIG_KEY];
  return raw === undefined ? null : JSON.parse(raw);
}

let pass = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}

/* ── ① 旧键 off + 新键不存在 ── */
console.log("=== ① 旧键='off' + 新键不存在 → enabled:false ===");
{
  const r = makeRunner({ [LEGACY_KEY]: "off" });
  r.applyOnce();
  const c = cfg(r.store);
  check("新键已创建", c !== null);
  check("enabled = false（继承旧意图）", c && c.enabled === false, JSON.stringify(c));
  check("旧键被压成 'off'", r.store[LEGACY_KEY] === "off");
  check("schema 三字段", c && c.v === 1 && Array.isArray(Object.keys(c.sessions)), JSON.stringify(c));
  const ev = r.api().info().events;
  check("打了 migrated 日志", ev.some((e) => e.errorType === "migrated"), JSON.stringify(ev));
  const mig = ev.find((e) => e.errorType === "migrated");
  check("日志含 legacyWasOff=true", mig && mig.legacyWasOff === true);
}

/* ── ② 旧键缺失 + 新键不存在 ── */
console.log("\n=== ② 旧键缺失 + 新键不存在 → enabled:true，旧键写成 'off' ===");
{
  const r = makeRunner({});
  r.applyOnce();
  const c = cfg(r.store);
  check("新键已创建", c !== null);
  check("enabled = true（默认）", c && c.enabled === true, JSON.stringify(c));
  check("旧键被写成 'off'（不是删除）", r.store[LEGACY_KEY] === "off", String(r.store[LEGACY_KEY]));
  const mig = r.api().info().events.find((e) => e.errorType === "migrated");
  check("日志含 hadLegacyKey=false", mig && mig.hadLegacyKey === false);
}

/* ── ③ 重复刷新 ── */
console.log("\n=== ③ 重复 apply（模拟多次刷新）→ 不重复迁移 ===");
{
  const r = makeRunner({});
  r.applyOnce();
  const firstRaw = r.store[CONFIG_KEY];
  const eventsAfterFirst = r.api().info().events.filter((e) => e.errorType === "migrated").length;

  r.applyOnce();
  r.applyOnce();

  check("新键内容未被重写", r.store[CONFIG_KEY] === firstRaw);
  const migratedCount = r.api().info().events.filter((e) => e.errorType === "migrated").length;
  check("migrated 日志只有 1 条", migratedCount === 1, "实际 " + migratedCount + " 条（首次 " + eventsAfterFirst + "）");
  check("旧键仍为 'off'", r.store[LEGACY_KEY] === "off");
}

/* ── ④ 旧键是其他值 ── */
console.log("\n=== ④ 旧键='on'（非 off）→ enabled:true，旧键压成 'off' ===");
{
  const r = makeRunner({ [LEGACY_KEY]: "on" });
  r.applyOnce();
  const c = cfg(r.store);
  check("enabled = true", c && c.enabled === true, JSON.stringify(c));
  check("旧键被压成 'off'", r.store[LEGACY_KEY] === "off");
}

/* ── ⑤ 新键已存在 ── */
console.log("\n=== ⑤ 新键已存在 → 不迁移、不打 migrated 日志 ===");
{
  const existing = JSON.stringify({ v: 1, enabled: false, sessions: {} });
  const r = makeRunner({ [CONFIG_KEY]: existing });
  r.applyOnce();
  check("新键保持不变", r.store[CONFIG_KEY] === existing);
  const migrated = r.api().info().events.filter((e) => e.errorType === "migrated");
  check("没有 migrated 日志", migrated.length === 0, "实际 " + migrated.length + " 条");
  check("旧键仍被中和为 'off'（幂等安全）", r.store[LEGACY_KEY] === "off");
}

/* ── ⑥ enabled:false 时不滚（回归） ── */
console.log("\n=== ⑥ enabled:false 时 scrollToAnswerStart 直接跳过 ===");
{
  const r = makeRunner({ [CONFIG_KEY]: JSON.stringify({ v: 1, enabled: false, sessions: {} }) });
  r.applyOnce();
  const ok = r.api().forceScroll();
  const info = r.api().info();
  check("forceScroll 返回 false", ok === false, String(ok));
  check("lastSkip = 'disabled'", info.lastSkip === "disabled", String(info.lastSkip));
  check("scrolls 未增加", info.scrolls === 0, String(info.scrolls));
}

console.log("\n" + "=".repeat(50));
console.log(`通过 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
