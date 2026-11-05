/**
 * dsh-answer-top v0.10.1
 *
 * 回答结束后自动滚到回答开头。
 *
 * v0.10.1：修复「开启但偶尔不滚」的间歇性 bug
 *   - 快重试预算耗尽后改为「退避慢速保活」（5s），不再永久放弃
 *   - 根因：boot/导航中对话 DOM 晚于 apply 出现时，旧的 10 次上限会永久停掉 observer
 *   - 平台改版判定阈值 3→10 次（8s），避免慢会话切换误判
 *
 * v0.10.0：Item 8 —— 兄弟插件共存探测
 *   - apply 后读 ctx.modules（manifest.modules / graphRows）判断
 *     dsh-chat-answer-anchor / dsh-jump-button 是否已启用
 *   - 命中则闸住自动回滚，forceScroll 手动路径不受影响
 *   - 探测失败不降级（宁可不动，不误伤）
 *
 * v0.9.3：Item 6 —— 降级不刷屏
 *   - 容器找不到时有限重试（10 次或 30s），超限静默降级、只记一条脱敏日志
 *   - 平台改版判定：[data-chat-turn] 与 [data-turn-tail] 连续 3 次为 0 → 停 observer/interval
 *
 * v0.9.2：Item 4 —— 脱敏事件日志落 localStorage
 *   - 200 条 / 50KB 上限，超出环形轮转丢最旧
 *   - 连续同 errorType 折叠成一条，count 累加
 *   - 启动时读回，隐私模式 / 配额满时静默降级
 *
 * v0.9.1：slot 注册可诊断
 *   - 记录 inject 回调次数 / register 次数 / register 错误
 *   - __dshAnswerTop.diagnose()：看 slot 是否已声明、已注册几个 entry
 *   - 修掉「slotRegistered 假阳性」导致的 8 秒误报
 *
 * v0.9.0：Item 5 —— 资源清理框架 + 单实例守卫
 *   - interval / MutationObserver / 监听器 / timer 全部登记在 state，可一键 teardown
 *   - pagehide 全量清理；会话切换（scroller 身份变化）只重绑挂在元素上的监听
 *   - apply 只生效一次，宿主重复加载时不叠加 interval/observer/slot
 *
 * v0.6.1：新增一次性迁移（旧键 → 新键）
 *   - 总开关 UI：settings.section（首选）/ conversation.session.header.utilities（备选）
 *   - 配置存 localStorage['dsh-answer-top:config']
 *     { v: 1, enabled: true, sessions: {} }
 *   - 注册走 ctx.effect(() => ctx.slots.inject(...)) 以支持卸载清理
 *
 * 硬约束：
 *   - 只 require("react")，不碰任何 @deepseek-ai/*
 *   - 不写磁盘、不联网、不新增全局（除 __dshAnswerTop 调试入口）
 *
 * 控制台工具：
 *   __dshAnswerTop.info()         内部状态
 *   __dshAnswerTop.config()       当前配置
 *   __dshAnswerTop.setEnabled(b)  直接改开关
 *   __dshAnswerTop.fallback()     手动切到备选 slot
 *   __dshAnswerTop.probe()        DOM 契约体检
 *   __dshAnswerTop.forceScroll()  对最后一轮手动滚动
 */
window.__ModuleLoader__.load({
  id: "dsh-answer-top",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    var CONFIG_KEY = "dsh-answer-top:config";
    var LEGACY_KEY = "dsh-answer-top"; // v0.5.0 及更早用的旧键，仅用于一次性迁移
    var CONFIG_VERSION = 1;
    var PLUGIN_ID = "dsh-answer-top";

    // Item 4：脱敏事件日志落 localStorage
    var EVENTS_KEY = "dsh-answer-top:events";
    var EVENTS_MAX_COUNT = 200;
    var EVENTS_MAX_BYTES = 50 * 1024; // 50KB 上限

    // Item 6：降级 —— 有限重试 + 平台改版判定
    var RETRY_MAX_ATTEMPTS = 10;
    var RETRY_MAX_WINDOW_MS = 30000;
    var RETRY_SLOW_MS = 5000; // 快预算耗尽后的慢速保活间隔（不放弃）
    var CONTRACT_MISS_LIMIT = 10; // 10 次(8s)：慢会话切换的短暂空窗不算改版

    var SLOT_PRIMARY = "settings.section";
    var SLOT_FALLBACK = "conversation.session.header.utilities";

    var state = {
      version: "0.10.1",
      loadedAt: new Date().toISOString(),
      installed: false,
      detections: 0,
      scrolls: 0,
      lastTurn: null,
      lastTarget: null,
      lastSkip: null,
      lastScrollTop: null,
      scrollerSource: null,
      observer: null,
      probeResult: null,
      log: [],
      slotName: SLOT_PRIMARY,
      slotIsFallback: false,
      slotRegistered: false,
      slotMounted: false,
      unregister: null,
      slotError: null,
      slotMounts: 0,
      toggles: 0,

      // Item 2：用户交互取消
      lastUserInputAt: 0,
      lastUserInputKind: null,
      cancelCount: 0,
      scrolling: false,
      listenerRegistry: [],
      injectReturnType: null,

      // Item 5：资源句柄（全部可清理）
      intervalId: null,
      mutationObserver: null,
      retryTimers: [],
      retryTimersByKind: {},
      pendingTimers: [],
      boundScroller: null,
      applied: false,
      disposed: false,

      // Item 6：降级计数
      retryAttempts: {},
      retryStartAt: {},
      degraded: {},
      contractSeen: false,
      contractMisses: 0,
      contractDegraded: false,

      // v0.9.1：slot 注册诊断
      injectCalls: 0,          // 调用 ctx.slots.inject 的次数
      injectCallbackRuns: 0,   // inject 回调实际执行的次数（slot 声明已就绪）
      registerRuns: 0,         // ctx.slots.register 成功的次数
      registerError: null,     // 最近一次 register 的错误文本（本地调试用）
      slotDeclared: null,      // 诊断时 slot 是否已声明
      slotEntryCount: null,    // 诊断时该 slot 的 entry 数
      slotEntryIds: null,      // 诊断时该 slot 的 entry id 列表

      // Item 8：兄弟插件共存（探测结果全布尔，不存插件原始数据）
      coexistence: {
        anchor: false,
        jumpButton: false,
        checked: false,
        probe: null, // "ok" | "failed"
      },
      coexistSkips: 0,

      // 迁移与事件（脱敏：只记布尔与枚举，不记原始值）
      migrated: false,
      events: [],
    };

    var USER_KINDS = {
      user: 1,
      "input-message": 1,
      steering: 1,
      "developer-message": 1,
      "system-message": 1,
      "request-prompt": 1,
      "turn-tail": 1,
    };

    var SKIP_KINDS = {
      "turn-process": 1,
      "turn-tail": 1,
      "tool-call": 1,
      group: 1,
    };

    function note(msg) {
      state.log.push(new Date().toISOString().substr(11, 8) + " " + msg);
      if (state.log.length > 40) state.log.shift();
    }

    /**
     * 结构化事件日志（脱敏）。
     * 只写 errorType + 布尔/枚举字段，绝不记录原始存储值、会话 id、路径等。
     */
    function loadEvents() {
      try {
        var raw = window.localStorage.getItem(EVENTS_KEY);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed)) {
          state.events = parsed;
          // 读回来的也受上限约束（环形轮转，丢最旧）
          while (state.events.length > EVENTS_MAX_COUNT) state.events.shift();
        }
      } catch (e) {}
    }

    function persistEvents() {
      try {
        var json = JSON.stringify(state.events);
        // 50KB 上限：超了从最旧开始丢（环形轮转），直到装得下
        while (json.length > EVENTS_MAX_BYTES && state.events.length > 1) {
          state.events.shift();
          json = JSON.stringify(state.events);
        }
        window.localStorage.setItem(EVENTS_KEY, json);
      } catch (e) {
        // localStorage 满 / 隐私模式：静默失败，不刷屏
      }
    }

    /**
     * 事件「身份」签名：errorType + 所有 extra 字段（排除 at/v/count 这些易变元数据）。
     * 只有签名完全相同的连续事件才折叠，避免把 scope/reason 不同的同 errorType 事件错误合并。
     */
    function sigOf(entry) {
      var keys = [];
      for (var k in entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, k)) continue;
        if (k === "at" || k === "v" || k === "count" || k === "errorType") continue;
        keys.push(k);
      }
      keys.sort();
      var parts = [entry.errorType];
      for (var i = 0; i < keys.length; i++) {
        parts.push(keys[i] + "=" + entry[keys[i]]);
      }
      return parts.join("|");
    }

    /**
     * 结构化事件日志（脱敏 + 落盘）。
     * 只写 errorType + 布尔/枚举字段，绝不记录原始存储值、会话 id、路径等。
     * 连续同「签名」折叠成一条并累加 count；持久化到 localStorage 并环形轮转。
     */
    function logEvent(errorType, extra) {
      var at = new Date().toISOString();
      var entry = {
        errorType: errorType,
        at: at,
        v: state.version,
      };
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) entry[k] = extra[k];
        }
      }
      var sig = sigOf(entry);

      var prev = state.events[state.events.length - 1];
      if (prev && sigOf(prev) === sig) {
        prev.count = (typeof prev.count === "number" ? prev.count : 1) + 1;
        prev.at = at;
        persistEvents();
        try {
          console.log("[dsh-answer-top] event·" + errorType + " ×" + prev.count);
        } catch (e) {}
        return prev;
      }

      state.events.push(entry);
      if (state.events.length > EVENTS_MAX_COUNT) state.events.shift();
      persistEvents();
      try {
        console.log("[dsh-answer-top] event", entry);
      } catch (e) {}
      return entry;
    }

    /* ───────────────── 配置（Item 3 schema）───────────────── */

    function defaultConfig() {
      return { v: CONFIG_VERSION, enabled: true, sessions: {} };
    }

    function readConfig() {
      try {
        var raw = window.localStorage.getItem(CONFIG_KEY);
        if (!raw) return defaultConfig();
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return defaultConfig();
        return {
          v: typeof parsed.v === "number" ? parsed.v : CONFIG_VERSION,
          enabled: parsed.enabled !== false,
          sessions:
            parsed.sessions && typeof parsed.sessions === "object"
              ? parsed.sessions
              : {},
        };
      } catch (e) {
        return defaultConfig();
      }
    }

    function writeConfig(cfg) {
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
        return true;
      } catch (e) {
        return false;
      }
    }

    function isEnabled() {
      return readConfig().enabled !== false;
    }

    function setEnabled(on) {
      var cfg = readConfig();
      cfg.v = CONFIG_VERSION;
      cfg.enabled = on !== false;
      if (!cfg.sessions || typeof cfg.sessions !== "object") cfg.sessions = {};
      writeConfig(cfg);
      state.toggles = state.toggles + 1;
      note("开关 → " + (cfg.enabled ? "开" : "关"));
      return cfg.enabled;
    }

    /**
     * 一次性迁移：v0.5.0 的旧键 dsh-answer-top → 新键 dsh-answer-top:config
     *
     * 规则：
     *   - 幂等判据 = 「新键是否已存在」，不加 migrated 字段
     *   - 旧键 === "off" → 新键 enabled: false（继承旧意图）
     *   - 旧键缺失/其他 → 新键 enabled: true
     *   - 无论哪种，都把旧键强制写成 "off"（不是删），
     *     用来中和仍残留在浏览器缓存里的旧版本实例
     *   - 迁移事件写脱敏日志 errorType: "migrated"
     */
    function migrateLegacy() {
      var hasNew = null;
      var legacy = null;

      try {
        hasNew = window.localStorage.getItem(CONFIG_KEY);
      } catch (e) {
        return; // 读不到存储就直接放弃迁移，走默认配置
      }

      if (hasNew !== null) {
        // 已迁移过：不重复迁移、不重复打日志。
        // 但仍做一次免费的中和（幂等）：旧键不是 "off" 就压成 "off"。
        try {
          if (window.localStorage.getItem(LEGACY_KEY) !== "off") {
            window.localStorage.setItem(LEGACY_KEY, "off");
          }
        } catch (e) {}
        return;
      }

      try {
        legacy = window.localStorage.getItem(LEGACY_KEY);
      } catch (e) {}

      // ① 继承旧意图
      var enabled = legacy === "off" ? false : true;

      var cfg = { v: CONFIG_VERSION, enabled: enabled, sessions: {} };
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      } catch (e) {
        return;
      }

      // ③ 强制写旧键为 "off"，中和残留旧实例
      try {
        window.localStorage.setItem(LEGACY_KEY, "off");
      } catch (e) {}

      state.migrated = true;

      // ④ 脱敏日志：只记布尔，不记原始值
      logEvent("migrated", {
        hadLegacyKey: legacy !== null,
        legacyWasOff: legacy === "off",
        enabled: enabled,
      });

      note("已迁移旧配置 → enabled=" + enabled);
    }

    /* ─────────────────────── 滚动逻辑 ─────────────────────── */

    function getTails() {
      return document.querySelectorAll("[data-turn-tail]");
    }

    function findScroller() {
      var s = document.querySelector("[data-conversation-scroll]");
      if (s) {
        state.scrollerSource = "data-conversation-scroll";
        return s;
      }
      var t = getTails();
      if (t.length === 0) {
        state.scrollerSource = "no-tail";
        return null;
      }
      var node = t[t.length - 1].parentElement;
      while (node && node !== document.body) {
        var st = window.getComputedStyle(node);
        var oy = st.overflowY;
        if (
          (oy === "auto" || oy === "scroll") &&
          node.scrollHeight > node.clientHeight + 4
        ) {
          state.scrollerSource = "ancestor";
          return node;
        }
        node = node.parentElement;
      }
      state.scrollerSource = "not-found";
      return null;
    }

    /* ───────────── 用户交互取消（Item 2 / R1 / R2）───────────── */

    var USER_INPUT_WINDOW_MS = 300;
    var SCROLL_END_FALLBACK_MS = 700;
    var interactionBound = false;
    var scrollEndTimer = null;

    /**
     * R2：监听资源表。
     * 所有监听器都用具名函数引用登记在这里，供 Item 5 的清理框架统一摘除。
     */
    // 见 state.listenerRegistry

    function addListener(target, type, fn, options) {
      if (!target || typeof target.addEventListener !== "function") return false;
      try {
        target.addEventListener(type, fn, options);
        state.listenerRegistry.push({
          target: target,
          type: type,
          fn: fn,
          options: options,
        });
        return true;
      } catch (e) {
        note("addListener 失败 " + type);
        return false;
      }
    }

    function removeAllListeners() {
      for (var i = 0; i < state.listenerRegistry.length; i++) {
        var l = state.listenerRegistry[i];
        try {
          l.target.removeEventListener(l.type, l.fn, l.options);
        } catch (e) {}
      }
      state.listenerRegistry.length = 0;
      interactionBound = false;
      state.boundScroller = null;
      note("监听资源已全部摘除");
    }

    /* ── Item 5：timer / 观察者登记（全部可清理）── */

    function dropFrom(arr, id) {
      var i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
    }

    /**
     * 重试链 timer：同一个 kind 只保留一个。
     * 重试链会反复调度，先清旧的再 push，避免登记表无限增长。
     *
     * Item 6：快速重试超过预算后**退避到慢速保活**，而不是永久放弃——
     * 容器可能只是「还没出现」（boot / 导航中），恢复后 resetRetry 会清零。
     */
    function scheduleRetry(kind, fn, ms) {
      var attempts = state.retryAttempts[kind] || 0;
      var started = state.retryStartAt[kind];
      if (!started) {
        started = Date.now();
        state.retryStartAt[kind] = started;
      }

      var slow =
        attempts >= RETRY_MAX_ATTEMPTS ||
        Date.now() - started > RETRY_MAX_WINDOW_MS;

      if (slow && !state.degraded[kind]) {
        // 退避（不放弃）：只记一条脱敏日志，不刷屏
        state.degraded[kind] = true;
        logEvent("degraded", { scope: kind, reason: "backoff" });
        note("退避：" + kind + " 进入慢速保活");
      }

      state.retryAttempts[kind] = attempts + 1;
      clearRetryTimer(kind);
      var delay = slow ? RETRY_SLOW_MS : ms;
      var id = setTimeout(function () {
        dropFrom(state.retryTimers, id);
        if (state.retryTimersByKind[kind] === id) {
          delete state.retryTimersByKind[kind];
        }
        if (state.disposed) return;
        fn();
      }, delay);
      state.retryTimers.push(id);
      state.retryTimersByKind[kind] = id;
      return id;
    }

    /** 成功路径复位：清 timer 并清零该 kind 的重试预算，下次失败重新计 */
    function resetRetry(kind) {
      clearRetryTimer(kind);
      delete state.retryAttempts[kind];
      delete state.retryStartAt[kind];
      delete state.degraded[kind];
    }

    function clearRetryTimer(kind) {
      if (!Object.prototype.hasOwnProperty.call(state.retryTimersByKind, kind)) {
        return;
      }
      var id = state.retryTimersByKind[kind];
      try {
        clearTimeout(id);
      } catch (e) {}
      dropFrom(state.retryTimers, id);
      delete state.retryTimersByKind[kind];
    }

    function clearRetryTimers() {
      for (var i = 0; i < state.retryTimers.length; i++) {
        try {
          clearTimeout(state.retryTimers[i]);
        } catch (e) {}
      }
      state.retryTimers.length = 0;
      state.retryTimersByKind = {};
      state.retryAttempts = {};
      state.retryStartAt = {};
      state.degraded = {};
    }

    /** 一次性延时（60ms 滚动、8s 未渲染提示）：登记以便 teardown 清掉 */
    function later(fn, ms) {
      var id = setTimeout(function () {
        dropFrom(state.pendingTimers, id);
        if (state.disposed) return;
        fn();
      }, ms);
      state.pendingTimers.push(id);
      return id;
    }

    function clearPendingTimers() {
      for (var i = 0; i < state.pendingTimers.length; i++) {
        try {
          clearTimeout(state.pendingTimers[i]);
        } catch (e) {}
      }
      state.pendingTimers.length = 0;
    }

    function clearScrollEndTimer() {
      if (scrollEndTimer) {
        clearTimeout(scrollEndTimer);
        scrollEndTimer = null;
      }
    }

    /* ── R1：平滑滚动的显式停止 ── */

    /** 停止正在进行的平滑滚动动画 */
    function stopSmoothScroll() {
      if (!state.scrolling) return false;
      var s = findScroller();
      state.scrolling = false;
      clearScrollEndTimer();
      if (!s) return false;
      try {
        // 用 auto 在同一位置重设，立刻中断 smooth 动画
        s.scrollTo({ top: s.scrollTop, behavior: "auto" });
      } catch (e) {
        s.scrollTop = s.scrollTop;
      }
      state.cancelCount = state.cancelCount + 1;
      note("用户输入 → 已停止回滚动画");
      return true;
    }

    /** 发起平滑滚动，并登记两条复位路径 */
    function startSmoothScroll(s, top) {
      state.scrolling = true;
      try {
        s.scrollTo({ top: top, behavior: "smooth" });
      } catch (e) {
        s.scrollTop = top;
        state.scrolling = false;
        return;
      }
      // 复位路径 ①：scrollend（Chromium 140+ 支持）
      // 复位路径 ②：700ms 兜底（scrollend 不触发时的保险）
      clearScrollEndTimer();
      scrollEndTimer = setTimeout(function () {
        scrollEndTimer = null;
        if (state.scrolling) {
          state.scrolling = false;
          note("scrolling 兜底复位(700ms)");
        }
      }, SCROLL_END_FALLBACK_MS);
    }

    /* ── 具名事件处理器（R2）── */

    function onWheel() {
      markUserInput("wheel");
    }
    function onTouchMove() {
      markUserInput("touchmove");
    }
    function onKeyDown() {
      markUserInput("keydown");
    }
    function onPointerDown() {
      markUserInput("pointerdown");
    }
    function onScrollEnd() {
      clearScrollEndTimer();
      if (state.scrolling) {
        state.scrolling = false;
        note("scrolling 复位(scrollend)");
      }
    }

    /** 记为「用户主动交互」。程序自己调 scrollTo 不会触发这些事件，所以不会自我污染。 */
    function markUserInput(kind) {
      state.lastUserInputAt = Date.now();
      state.lastUserInputKind = kind;
      // case 3：动画进行中被打断 → 立刻停止
      stopSmoothScroll();
    }

    function bindUserInputListeners() {
      if (interactionBound) return;
      var s = findScroller();
      if (!s) {
        scheduleRetry("input", bindUserInputListeners, 800);
        return;
      }
      // 成功路径：先撤掉自己的重试链，并清零重试预算
      resetRetry("input");
      addListener(s, "wheel", onWheel, { passive: true });
      addListener(s, "touchmove", onTouchMove, { passive: true });
      addListener(s, "scrollend", onScrollEnd, { passive: true });
      addListener(document, "keydown", onKeyDown, true);
      addListener(document, "pointerdown", onPointerDown, true);
      interactionBound = true;
      state.boundScroller = s;
      note("用户交互监听已绑定（" + state.listenerRegistry.length + " 条）");
    }

    /** 页面生命周期监听（不属于会话，rebind 后要重新挂回） */
    function bindLifecycleListeners() {
      addListener(window, "pagehide", onPageHide, false);
    }

    /**
     * 会话切换探测（轻量 rebind）。
     *
     * MutationObserver 挂在 document.body、setInterval 每 tick 重找 scroller，
     * 这两者天然抗会话切换；只有 wheel/touchmove/scrollend 绑在具体 scroller 元素上，
     * 元素被替换后监听就「死了但还占引用」。所以这里只重绑监听，不重建 observer/interval。
     */
    function maybeRebindListeners() {
      if (state.disposed || !interactionBound) return false;
      var now = findScroller();
      if (!now || !state.boundScroller || now === state.boundScroller) return false;

      removeAllListeners();
      state.scrolling = false;
      clearScrollEndTimer();
      bindUserInputListeners();
      bindLifecycleListeners(); // removeAllListeners 把 pagehide 也摘了，重新挂回
      logEvent("cleanup", { rebind: true, scope: "listeners" });
      note("会话切换 → 监听已重绑");
      return true;
    }

    /**
     * Item 6：平台改版判定。
     * [data-chat-turn] 与 [data-turn-tail] 同时连续 N 次为 0 → 判定平台改版，
     * 记一条脱敏日志后静默停掉 observer/interval（保留开关 slot，不刷屏）。
     */
    function detectContractRework() {
      var tails = getTails().length;
      var turns = document.querySelectorAll("[data-chat-turn]").length;
      if (tails > 0 || turns > 0) {
        state.contractSeen = true;
        state.contractMisses = 0;
        return;
      }
      if (!state.contractSeen) return; // 还没见过契约元素，可能是空页面，不算改版
      state.contractMisses = state.contractMisses + 1;
      if (state.contractMisses < CONTRACT_MISS_LIMIT || state.contractDegraded) return;
      state.contractDegraded = true;
      logEvent("degraded", { scope: "contract", reason: "rework" });
      note("平台改版：契约元素连续缺失 " + state.contractMisses + " 次，静默降级");
      if (state.mutationObserver) {
        try {
          state.mutationObserver.disconnect();
        } catch (e) {}
        state.mutationObserver = null;
      }
      if (state.intervalId !== null && state.intervalId !== undefined) {
        try {
          clearInterval(state.intervalId);
        } catch (e) {}
        state.intervalId = null;
      }
      state.installed = false;
    }

    /** 本轮是否应当因为「用户刚交互过」而放弃滚动 */
    function blockedByUserInput() {
      if (!state.lastUserInputAt) return false;
      return Date.now() - state.lastUserInputAt < USER_INPUT_WINDOW_MS;
    }

    function probe() {
      var s = findScroller();
      var t = getTails();
      var nodes = document.querySelectorAll("[data-chat-turn]");
      var kinds = {};
      var i;
      for (i = 0; i < nodes.length; i++) {
        var k = nodes[i].dataset.chatFlowKind || "(无)";
        kinds[k] = (kinds[k] || 0) + 1;
      }
      var out = {
        scroller: !!s,
        scrollerSource: state.scrollerSource,
        tailCount: t.length,
        turnNodeCount: nodes.length,
        kinds: kinds,
        lastTailTurn: t.length
          ? t[t.length - 1].getAttribute("data-turn-tail")
          : null,
        lastTailDone: t.length
          ? t[t.length - 1].hasAttribute("data-actions-reveal")
          : null,
        scrollTop: s ? Math.round(s.scrollTop) : null,
        viewportH: s ? s.clientHeight : null,
      };
      state.probeResult = out;
      try {
        console.log("[dsh-answer-top] probe:", out);
      } catch (e) {}
      return out;
    }

    /**
     * slot 注册体检（v0.9.1）。
     *
     * 回答一个具体问题：settings.section 到底「没声明」「声明了但没注册」
     * 还是「注册了但没挂载」。不看日志猜。
     */
    function diagnose() {
      var out = {
        version: state.version,
        slotName: state.slotName,
        slotIsFallback: state.slotIsFallback,
        injectCalls: state.injectCalls,
        injectCallbackRuns: state.injectCallbackRuns,
        registerRuns: state.registerRuns,
        registerError: state.registerError,
        slotRegistered: state.slotRegistered,
        slotMounted: state.slotMounted,
        slotMounts: state.slotMounts,
        slotError: state.slotError,
        injectReturnType: state.injectReturnType,
        slotDeclared: state.slotDeclared,
        slotEntryCount: state.slotEntryCount,
        slotEntryIds: state.slotEntryIds,
        coexistence: {
          anchor: state.coexistence.anchor,
          jumpButton: state.coexistence.jumpButton,
          checked: state.coexistence.checked,
          probe: state.coexistence.probe,
        },
        coexistSkips: state.coexistSkips,
      };
      try {
        if (savedCtx && savedCtx.slots) {
          out.slotDeclared = typeof savedCtx.slots.spec === "function"
            ? !!savedCtx.slots.spec(state.slotName)
            : null;
          var entries = typeof savedCtx.slots.entries === "function"
            ? savedCtx.slots.entries(state.slotName) || []
            : [];
          out.slotEntryCount = entries.length;
          out.slotEntryIds = [];
          for (var i = 0; i < entries.length; i++) {
            var opts = entries[i] && entries[i].options;
            out.slotEntryIds.push((opts && opts.id) || "(no-id)");
          }
          state.slotDeclared = out.slotDeclared;
          state.slotEntryCount = out.slotEntryCount;
          state.slotEntryIds = out.slotEntryIds;
        }
      } catch (e) {
        out.diagError = String((e && e.message) || e);
      }
      try {
        console.log("[dsh-answer-top] diagnose:", out);
      } catch (e) {}
      return out;
    }

    function scrollToAnswerStart(turn) {
      if (!isEnabled()) {
        state.lastSkip = "disabled";
        return false;
      }

      // Item 2：用户刚交互过 → 本轮不滚（不打断用户阅读/输入）
      if (blockedByUserInput()) {
        state.lastSkip =
          "user-input(" + state.lastUserInputKind + "," +
          (Date.now() - state.lastUserInputAt) + "ms)";
        return false;
      }

      var s = findScroller();
      if (!s) {
        state.lastSkip = "no-scroller(" + state.scrollerSource + ")";
        return false;
      }

      var items = [];
      if (turn !== null && turn !== undefined && turn !== "") {
        items = Array.prototype.slice.call(
          document.querySelectorAll('[data-chat-turn="' + turn + '"]')
        );
      }
      if (items.length === 0) {
        items = Array.prototype.slice.call(
          document.querySelectorAll("[data-chat-turn]")
        );
        state.lastSkip = "turn-not-found(fallback:all)";
      }
      if (items.length === 0) {
        state.lastSkip = "no-items";
        return false;
      }

      var target = null;
      var i;
      var order = ["assistant-step", "assistant"];
      var a;
      for (a = 0; a < order.length && target === null; a++) {
        for (i = 0; i < items.length; i++) {
          if (items[i].dataset.chatFlowKind === order[a]) {
            target = items[i];
            break;
          }
        }
      }
      if (target === null) {
        for (i = 0; i < items.length; i++) {
          var k1 = items[i].dataset.chatFlowKind;
          if (k1 && !USER_KINDS[k1] && !SKIP_KINDS[k1]) {
            target = items[i];
            break;
          }
        }
      }
      if (target === null) {
        for (i = 0; i < items.length; i++) {
          var k2 = items[i].dataset.chatFlowKind;
          if (k2 && !USER_KINDS[k2]) {
            target = items[i];
            break;
          }
        }
      }
      if (target === null) target = items[0];

      var sRect = s.getBoundingClientRect();
      var tRect = target.getBoundingClientRect();
      var vh = s.clientHeight || sRect.height || 1;
      var lastItem = items[items.length - 1];
      var blockH = lastItem.getBoundingClientRect().bottom - tRect.top;

      state.lastTurn = turn;
      state.lastTarget = {
        kind: target.dataset.chatFlowKind || null,
        itemCount: items.length,
        blockH: Math.round(blockH),
        viewportH: Math.round(vh),
        threshold: Math.round(vh * 0.55),
      };

      if (blockH < vh * 0.55) {
        state.lastSkip = "short-block(" + Math.round(blockH) + ")";
        return false;
      }

      var top = s.scrollTop + (tRect.top - sRect.top) - 12;
      if (top < 0) top = 0;

      startSmoothScroll(s, top);

      state.scrolls = state.scrolls + 1;
      state.lastScrollTop = Math.round(top);
      state.lastSkip = null;
      return true;
    }

    /* ───────────── Item 8：兄弟插件共存探测 ───────────── */

    // 目标 id = 目标插件 package.json 的 name（Loader entry name），不带 /client
    var COEXIST_IDS = ["dsh-chat-answer-anchor", "dsh-jump-button"];

    /**
     * 归一化模块 id：
     *   ① 去 `/client` 后缀（与 dsh-client-modules 的 stripClientSuffix 同义）
     *   ② 无条件去 `@scope/` 前缀，只留最后一段
     *
     * 覆盖四种写法：
     *   dsh-jump-button / dsh-jump-button/client
     *   @scope/dsh-jump-button / @scope/dsh-jump-button/client
     *
     * 误判方向是安全的：多剥一层最多把「非目标」认成目标 → 降级为仅手动，
     * 不会出现「本应降级却没降级」的漏判。
     */
    function normalizeModuleId(id) {
      var s = String(id || "");
      if (s.slice(-7) === "/client") s = s.slice(0, -7);
      var i = s.lastIndexOf("/");
      return i >= 0 ? s.slice(i + 1) : s;
    }

    /**
     * 输入：apply(ctx) 收到的 ctx
     * 输出：{ anchor: boolean, jumpButton: boolean }
     * 探测失败（ctx.modules 不可用 / API 形状不符）→ null（不降级、不误判）
     */
    function detectCoexistence(ctx) {
      var m = ctx && ctx.modules;
      if (!m) return null;

      // 首选：manifest.modules 数组（composed 模块名单）
      if (m.manifest && Array.isArray(m.manifest.modules)) {
        var rows = m.manifest.modules;
        var out = { anchor: false, jumpButton: false };
        for (var i = 0; i < rows.length; i++) {
          var id = normalizeModuleId(rows[i] && rows[i].id);
          if (id === COEXIST_IDS[0]) out.anchor = true;
          else if (id === COEXIST_IDS[1]) out.jumpButton = true;
        }
        return out;
      }

      // 兜底：graphRows Map（Map<id, row>）
      if (m.graphRows && typeof m.graphRows.has === "function") {
        var hit = { anchor: false, jumpButton: false };
        m.graphRows.forEach(function (row, key) {
          var id = normalizeModuleId(key);
          if (id === COEXIST_IDS[0]) hit.anchor = true;
          else if (id === COEXIST_IDS[1]) hit.jumpButton = true;
        });
        return hit;
      }

      return null;
    }

    /**
     * 探测一次并落状态。
     * phase: "initial"（apply 同步）/ "final"（1.5s 后复检，随后 checked 定格）
     * checked 之后不再探测（幂等）。
     */
    function probeCoexistence(phase) {
      if (state.coexistence.checked) return state.coexistence;

      var res = detectCoexistence(savedCtx);
      if (res === null) {
        state.coexistence.probe = "failed";
        if (phase === "final") state.coexistence.checked = true;
        logEvent("coexistence", { probe: "failed" });
        return state.coexistence;
      }

      state.coexistence.probe = "ok";
      state.coexistence.anchor = res.anchor === true;
      state.coexistence.jumpButton = res.jumpButton === true;
      if (phase === "final") state.coexistence.checked = true;
      logEvent("coexistence", {
        anchor: state.coexistence.anchor,
        jumpButton: state.coexistence.jumpButton,
      });
      return state.coexistence;
    }

    function coexistenceBlocked() {
      var c = state.coexistence;
      return !!(c && (c.anchor || c.jumpButton));
    }

    function coexistenceReason() {
      var c = state.coexistence;
      if (c.anchor && c.jumpButton) return "both";
      return c.anchor ? "anchor" : "jumpButton";
    }

    /**
     * 本地调试用：dump 模块 id（上限 200），核对目标插件 id 是否带 /client 后缀。
     * 只给控制台用，不进日志、不落盘。
     */
    function collectModuleIds(ctx) {
      var m = ctx && ctx.modules;
      if (!m) return null;
      var ids = [];
      if (m.manifest && Array.isArray(m.manifest.modules)) {
        var rows = m.manifest.modules;
        for (var i = 0; i < rows.length && ids.length < 200; i++) {
          ids.push(String((rows[i] && rows[i].id) || ""));
        }
        return ids;
      }
      if (m.graphRows && typeof m.graphRows.forEach === "function") {
        m.graphRows.forEach(function (row, key) {
          if (ids.length < 200) ids.push(String(key));
        });
        return ids;
      }
      return null;
    }

    function installObserver() {
      // 单实例：已经装过就不要再 new 一套 observer + interval
      if (state.disposed || state.installed) return;

      var s = findScroller();
      if (!s) {
        // 退避后不再每轮 note，避免慢速阶段刷内存 log（快阶段仍记）
        if (!state.degraded["observer"]) {
          note("等待滚动容器…(" + state.scrollerSource + ")");
        }
        scheduleRetry("observer", installObserver, 700);
        return;
      }
      resetRetry("observer");

      var existing = getTails();
      var handled = existing.length ? existing[existing.length - 1] : null;

      function check(isTick) {
        // 会话切换探测 + 平台改版判定只在 800ms tick 上做，避免 mutation 风暴里读布局
        if (isTick) {
          maybeRebindListeners();
          detectContractRework();
        }
        var list = getTails();
        if (list.length === 0) return;
        var tail = list[list.length - 1];
        if (tail === handled) return;
        if (!tail.hasAttribute("data-actions-reveal")) return;

        handled = tail;
        var turn = tail.getAttribute("data-turn-tail");
        state.detections = state.detections + 1;

        later(function () {
          // Item 8：兄弟插件共存命中 → 自动回滚闸住（手动 forceScroll 不走这里）
          if (coexistenceBlocked()) {
            state.coexistSkips = state.coexistSkips + 1;
            state.lastSkip = "coexistence(" + coexistenceReason() + ")";
            note("共存命中 → 跳过本轮自动回滚");
            return;
          }
          var ok = scrollToAnswerStart(turn);
          note("turn " + turn + (ok ? " ✓ 滚动" : " ✗ " + state.lastSkip));
        }, 60);
      }

      try {
        state.mutationObserver = new MutationObserver(function () {
          check(false);
        });
        state.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-actions-reveal"],
        });
        state.observer = "body";
      } catch (e) {
        state.mutationObserver = null;
        state.observer = "error:" + String(e && e.message);
      }

      state.intervalId = setInterval(function () {
        check(true);
      }, 800);
      state.installed = true;
      note("监听已启动");
      try {
        console.log("[dsh-answer-top] 滚动监听已启动 v" + state.version);
      } catch (e) {}
    }

    /**
     * 完整 teardown：只用于页面卸载（pagehide）。
     *
     * 与 maybeRebindListeners 的区别：
     *   - rebind 只摘「绑在 scroller 元素上」的监听，observer/interval 保留
     *   - teardown 连 observer/interval/timer 一起拆，并复位状态位让二次 apply 可重装
     */
    function teardown(reason) {
      if (state.disposed) return false;
      state.disposed = true;

      removeAllListeners();

      if (state.intervalId !== null && state.intervalId !== undefined) {
        try {
          clearInterval(state.intervalId);
        } catch (e) {}
        state.intervalId = null;
      }

      if (state.mutationObserver) {
        try {
          state.mutationObserver.disconnect();
        } catch (e) {}
        state.mutationObserver = null;
      }

      clearRetryTimers();
      clearPendingTimers();
      clearScrollEndTimer();

      if (typeof state.unregister === "function") {
        try {
          state.unregister();
        } catch (e) {}
        state.unregister = null;
        state.slotRegistered = false;
        state.slotMounted = false;
      }

      state.installed = false;
      state.scrolling = false;
      state.boundScroller = null;
      state.observer = "disposed";
      interactionBound = false;
      state.applied = false;

      // 脱敏日志：只记枚举与布尔，不记任何原始值
      logEvent("cleanup", { scope: "full", reason: reason });
      note("已清理全部资源（" + reason + "）");
      return true;
    }

    /** pagehide：真正卸载才全量清理；进 bfcache（persisted）时页面还会回来，保留资源 */
    function onPageHide(e) {
      if (e && e.persisted) return;
      teardown("pagehide");
    }

    function onDomReady() {
      if (state.disposed) return;
      installObserver();
      bindUserInputListeners();
    }

    /* ─────────────────── 总开关 UI（Item 3）─────────────────── */

    var COLOR_ON = "#4d6bfe";
    var COLOR_TRACK_OFF = "rgba(127,127,127,0.35)";

    function ToggleSwitch(props) {
      var on = props.on;
      var onClick = props.onClick;
      return React.createElement(
        "span",
        {
          role: "switch",
          "aria-checked": on ? "true" : "false",
          "aria-label": props.label || "自动回滚",
          tabIndex: 0,
          onClick: onClick,
          onKeyDown: function (e) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          },
          "data-dsh-answer-top-switch": on ? "on" : "off",
          style: {
            position: "relative",
            display: "inline-block",
            width: "36px",
            height: "20px",
            flex: "0 0 auto",
            borderRadius: "10px",
            background: on ? COLOR_ON : COLOR_TRACK_OFF,
            cursor: "pointer",
            transition: "background .18s",
            outline: "none",
            userSelect: "none",
          },
        },
        React.createElement("span", {
          style: {
            position: "absolute",
            top: "2px",
            left: on ? "18px" : "2px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left .18s",
            boxShadow: "0 1px 2px rgba(0,0,0,.28)",
          },
        })
      );
    }

    /** 首选：设置页分区 */
    function SettingsSection() {
      // 挂载副作用放在 useEffect 里：渲染期只读，不在 render 里改状态/打日志
      React.useEffect(function () {
        state.slotMounts = state.slotMounts + 1;
        state.slotMounted = true;
        if (state.slotMounts === 1) {
          try {
            console.log("[dsh-answer-top] ✓ slot 渲染成功：" + state.slotName);
          } catch (e) {}
          note("slot 渲染成功（" + state.slotName + "）");
        }
      }, []);

      var hook = React.useState(readConfig().enabled);
      var enabled = hook[0];
      var setEnabledState = hook[1];

      function toggle() {
        var next = setEnabled(!enabled);
        setEnabledState(next);
        try {
          console.log("[dsh-answer-top] 自动回滚已" + (next ? "开启" : "关闭"));
        } catch (e) {}
      }

      return React.createElement(
        "div",
        {
          "data-dsh-answer-top-section": "1",
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            padding: "16px",
            borderRadius: "10px",
            border: "1px solid rgba(127,127,127,0.22)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
            },
          },
          React.createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "4px" } },
            React.createElement(
              "span",
              { style: { fontSize: "14px", fontWeight: "600" } },
              "自动回滚到回答开头"
            ),
            React.createElement(
              "span",
              { style: { fontSize: "12px", opacity: 0.65, lineHeight: "1.5" } },
              "回答结束后自动滚到这次回答的第一行。关闭后完全不滚。"
            )
          ),
          React.createElement(ToggleSwitch, {
            on: enabled,
            onClick: toggle,
            label: "自动回滚",
          })
        ),
        React.createElement(
          "span",
          { style: { fontSize: "11px", opacity: 0.45 } },
          enabled ? "当前：开启" : "当前：关闭"
        )
      );
    }

    /** 备选：会话头部按钮 */
    function HeaderToggle(props) {
      React.useEffect(function () {
        state.slotMounts = state.slotMounts + 1;
        state.slotMounted = true;
        if (state.slotMounts === 1) {
          try {
            console.log(
              "[dsh-answer-top] ✓ slot 渲染成功：" + SLOT_FALLBACK +
              "（props: " + Object.keys(props || {}).join(",") + "）"
            );
          } catch (e) {}
          note("slot 渲染成功（备选）");
        }
      }, []);

      var hook = React.useState(readConfig().enabled);
      var enabled = hook[0];
      var setEnabledState = hook[1];

      function onClick() {
        var next = setEnabled(!enabled);
        setEnabledState(next);
        try {
          console.log("[dsh-answer-top] 自动回滚已" + (next ? "开启" : "关闭"));
        } catch (e) {}
      }

      return React.createElement(
        "button",
        {
          type: "button",
          onClick: onClick,
          title: enabled
            ? "自动回滚：已开启（点击关闭）"
            : "自动回滚：已关闭（点击开启）",
          "aria-label": "自动回滚开关",
          "aria-pressed": enabled,
          "data-dsh-answer-top-toggle": enabled ? "on" : "off",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            height: "24px",
            padding: "0 8px",
            margin: "0 4px",
            borderRadius: "6px",
            border: "1px solid rgba(127,127,127,0.28)",
            background: enabled ? "rgba(77,107,254,0.12)" : "transparent",
            color: "inherit",
            font: "inherit",
            fontSize: "12px",
            lineHeight: "1",
            cursor: "pointer",
            opacity: enabled ? 1 : 0.55,
          },
        },
        enabled ? "⤒" : "⤓",
        React.createElement("span", { style: { marginLeft: "2px" } }, "回滚")
      );
    }

    /* ─────────────────────── slot 注册 ─────────────────────── */

    var savedCtx = null;

    function registerInto(ctx, slotName, Component, isFallback) {
      // 双挂载守卫：已经在这个 slot 挂载成功过，就不再重复注册
      if (state.slotMounted && state.slotName === slotName) {
        note("已在 " + slotName + " 挂载过，跳过重复注册");
        return false;
      }
      // 换 slot 时先注销旧注册，避免两个 slot 同时挂一个开关
      if (typeof state.unregister === "function") {
        try {
          state.unregister();
        } catch (e) {}
        state.unregister = null;
      }

      // register() 返回注销函数（官方写法 unregister ??= ctx.slots.register(...) 可证）
      // inject() 的 factory 返回值会被当作清理函数 —— 两条路都挂上
      state.injectCalls = state.injectCalls + 1;
      var injectReturn = ctx.slots.inject(
        slotName,
        function () {
          // 只有 slot 声明已就绪，这个回调才会执行；次数进诊断
          state.injectCallbackRuns = state.injectCallbackRuns + 1;
          var unregister;
          try {
            unregister = ctx.slots.register(
              {
                name: slotName,
                id: PLUGIN_ID,
                order: 60,
                label: function () {
                  return "自动回滚";
                },
              },
              Component
            );
          } catch (e) {
            state.registerError = String((e && e.message) || e);
            throw e;
          }
          state.registerRuns = state.registerRuns + 1;
          state.registerError = null;
          state.unregister = typeof unregister === "function" ? unregister : null;
          return function () {
            if (typeof state.unregister === "function") {
              try {
                state.unregister();
              } catch (e) {}
              state.unregister = null;
            }
          };
        },
        "dsh-answer-top: slot " + slotName
      );

      state.injectReturnType = typeof injectReturn;
      state.slotName = slotName;
      state.slotIsFallback = !!isFallback;
      // 注意：这里只代表「inject 调用成功」，不代表 register 真的跑过。
      // 真正的证据看 state.registerRuns / diagnose()。
      state.slotRegistered = true;
      state.slotMounts = 0;
      note("slot 已注册：" + slotName);
      try {
        console.log("[dsh-answer-top] slot 已注册：" + slotName);
      } catch (e) {}
      return true;
    }

    function apply(ctx) {
      savedCtx = ctx || null;

      // 单实例守卫：宿主重复加载 / 二次 apply 时只生效一次，
      // 不叠加第二套 interval、observer、slot 注册。
      if (state.applied) {
        note("apply 二次调用已忽略（单实例守卫）");
        return;
      }
      state.applied = true;
      state.disposed = false;

      // Item 4：先把已持久化的事件日志读回内存，再开始记新事件
      loadEvents();

      // ⓪ 先做一次性迁移（幂等，必须在任何 config 读取之前）
      try {
        migrateLegacy();
      } catch (e) {
        logEvent("migrate-failed");
      }

      // Item 8：兄弟插件共存探测 —— apply 同步一次，1.5s 后复检一次（兄弟插件可能更晚加载）
      probeCoexistence("initial");
      later(function () {
        probeCoexistence("final");
      }, 1500);

      try {
        window.__dshAnswerTop = {
          version: state.version,
          probe: probe,
          info: function () {
            return state;
          },
          config: readConfig,
          setEnabled: function (on) {
            var v = setEnabled(on);
            try {
              console.log("[dsh-answer-top] enabled =", v);
            } catch (e) {}
            return v;
          },
          fallback: function () {
            if (!savedCtx) return false;
            try {
              registerInto(savedCtx, SLOT_FALLBACK, HeaderToggle, true);
              return true;
            } catch (e) {
              state.slotError = String((e && e.message) || e);
              return false;
            }
          },
          forceScroll: function () {
            var t = getTails();
            var turn = t.length
              ? t[t.length - 1].getAttribute("data-turn-tail")
              : null;
            try {
              console.log("[dsh-answer-top] forceScroll turn =", turn);
            } catch (e) {}
            return scrollToAnswerStart(turn);
          },
          teardown: function () {
            return teardown("manual");
          },
          diagnose: diagnose,
          moduleIds: function () {
            return collectModuleIds(savedCtx);
          },
        };
        console.log("[dsh-answer-top] loaded v" + state.version);
      } catch (e) {}

      // ① 页面卸载清理（pagehide 比 beforeunload 可靠，且不阻塞卸载）
      bindLifecycleListeners();

      // ② 滚动监听 + 用户交互监听
      if (document.readyState === "loading") {
        addListener(document, "DOMContentLoaded", onDomReady, false);
      } else {
        installObserver();
        bindUserInputListeners();
      }

      // ③ slot 注册
      if (!ctx || !ctx.slots) {
        state.slotError = "ctx.slots 不存在";
        note("slot 注册失败：ctx.slots 缺失");
        try {
          console.warn("[dsh-answer-top] " + state.slotError);
        } catch (e) {}
        return;
      }

      function doRegister() {
        try {
          registerInto(ctx, SLOT_PRIMARY, SettingsSection, false);
        } catch (e) {
          state.slotRegistered = false;
          state.slotError = String((e && e.message) || e);
          note("首选 slot 失败：" + state.slotError);
          try {
            console.warn("[dsh-answer-top] 首选 slot 失败，切备选", e);
          } catch (e2) {}
          try {
            registerInto(ctx, SLOT_FALLBACK, HeaderToggle, true);
          } catch (e3) {
            state.slotError = String((e3 && e3.message) || e3);
            note("备选 slot 也失败：" + state.slotError);
          }
        }
      }

      if (typeof ctx.effect === "function") {
        try {
          ctx.effect(doRegister, "dsh-answer-top: slot registration");
        } catch (e) {
          doRegister();
        }
      } else {
        doRegister();
      }

      // ④ 8 秒后检查：只有 register 真的跑过却没挂载，才提示（避免误报）
      later(function () {
        if (state.registerRuns === 0) {
          // inject 调用成功但回调没执行 → slot 声明还没就绪（或注册被卡住）
          note("8s：inject 回调未执行（slot 未声明）");
          try {
            console.warn(
              "[dsh-answer-top] slot 注册回调 8 秒内未执行。\n" +
                "  执行 __dshAnswerTop.diagnose() 查看 slotDeclared / injectCallbackRuns。"
            );
          } catch (e) {}
          return;
        }
        if (state.slotMounts === 0) {
          note("slot 已注册但未渲染（mounts=0）");
          try {
            console.warn(
              "[dsh-answer-top] slot 已注册但 8 秒内未渲染（打开设置页才会挂载）。\n" +
                "  设置页里仍然看不到的话，执行 __dshAnswerTop.fallback() 切到备选 slot。"
            );
          } catch (e) {}
        }
      }, 8000);
    }

    exports.name = PLUGIN_ID;
    // "modules" 是 ctx.modules 的依赖声明：不写它，ctx.modules 可能不可见，
    // Item 8 的探测会永远返回 null。官方消费方（dsh-client-hmr、settings-general）同样声明。
    exports.inject = ["slots", "modules"];
    exports.apply = apply;

    return module.exports;
  },
});







