/**
 * dsh-answer-top v0.12.1
 *
 * 回答结束后自动滚到回答开头。
 *
 * v0.12.0：设置页加「触发阈值」两个滑块（持久化）
 *   - 最小回答高度（视口比例）5%~100%，默认 25%
 *   - 绝对下限 0~200px，默认 80px，? 图标用原生 title 做提示
 *   - config 增加 threshold: { ratio, px }，schema 仍为 v:1（旧配置自动回填默认值）
 *   - 有效阈值 = max(视口高度 × ratio, px)；回答块比它矮就不滚
 *   - 顺带修掉：阈值常量在 state 初始化之后才赋值，导致绝对下限 80px
 *     实际从未生效（state.minBlockPx 初始为 undefined）
 *   - 共存探测只认 dsh-chat-answer-anchor（不再把 dsh-jump-button 当冲突）
 *   - 共存状态改为每 800ms 轮询：同会话「有→无」自动恢复、「无→有」重新闸住，
 *     只在状态变化时记一条事件
 *   - 设置页在共存命中时显示「已暂停自动回滚」提示
 *   - 多 slot：开关 slot（settings.section / 头部备选）与常驻手动按键
 *     slot（conversation.composer.dock）并存，按 slot 名分别记账/注销
 *   - 手动按键始终显示，点击滚到最后一轮回答开头；不受总开关 / 共存 / 输入窗口限制
 *
 * v0.11.2：修复「思考/空闲时偶发自动上跳」+ 触发阈值 0.55→0.25
 *   - 回答去重从 DOM 节点引用改成 turn 号：DSH 空闲重渲染会替换节点但 turn 不变，
 *     旧的节点比较会把同一轮重渲染误判成新回答 → 向上跳
 *   - 触发阈值 0.55 → 0.25（绝对下限 80px），小窗也能覆盖短回答
 *   - 可用 __dshAnswerTop.setThreshold(ratio, px) 运行时临时调整
 *
 * v0.11.1：安装说明改为 npm 包名；首次发布到 npm（代码无变化）
 *
 * v0.11.0：启动后首次进入会话 → 跳到最后一轮回答开头（只一次）
 *   - 连续两个 800ms tick 看到同一个已结束的 tail 才动手，等 DSH 渲染稳定
 *   - 用户已交互 / 共存命中 / 开关关闭 / 最后一轮没有回答 → 放弃
 *   - 只在一个页面生命周期内生效一次，切会话不重复
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

    // 回滚触发阈值（v0.12.0 起可在设置页调整并持久化）。
    // 有效阈值 = max(视口高度 × ratio, px)；回答块比它矮就不滚。
    // ratio: 0.25 = 视口的 25%；px: 80 = 绝对下限 80px（无论窗口多大都不低于它）。
    var MIN_BLOCK_RATIO = 0.25;
    var MIN_BLOCK_PX = 80;
    var THRESHOLD_RATIO_MIN = 0.05;
    var THRESHOLD_RATIO_MAX = 1.0;
    var THRESHOLD_PX_MIN = 0;
    var THRESHOLD_PX_MAX = 200;
    var THRESHOLD_PX_HINT =
      "绝对下限：回答比这个高度（像素）还短就不滚，无论窗口多大。" +
      "默认 80px，用来防止极短回答也触发跳动。";

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
    // v0.12.0：常驻手动按键 slot，和开关 slot 并存（不参与首选/备选切换）
    var SLOT_MANUAL = "conversation.composer.dock";
    var MANUAL_SLOT_ID = "dsh-answer-top-manual";

    var state = {
      version: "0.12.1",
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
      // v0.12.0：按 slot 名记账，支持开关 slot + 常驻手动按键 slot 并存
      unregisterBySlot: {},
      slotError: null,
      slotMounts: 0,
      toggleRegisterRuns: 0,
      manualSlotRegistered: false,
      manualSlotMounted: false,
      manualSlotMounts: 0,
      manualSlotError: null,
      toggles: 0,

      // Item 2：用户交互取消
      lastUserInputAt: 0,
      lastUserInputKind: null,
      lastUserInputKey: null,
      cancelCount: 0,
      scrolling: false,
      listenerRegistry: [],
      injectReturnType: null,

      // 回滚触发阈值（v0.12.0 起存 config.threshold，apply 时读回）
      minBlockRatio: MIN_BLOCK_RATIO,
      minBlockPx: MIN_BLOCK_PX,
      thresholdSaves: 0,

      // Item 5：资源句柄（全部可清理）
      intervalId: null,
      mutationObserver: null,
      checkTick: null, // installObserver 内 check 的引用，供 visibilitychange 补检
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

      // v0.11.0：启动后首次进入会话 → 跳到最后一轮回答开头（只一次）
      bootJumpDone: false,
      bootJumpTail: null,
      bootJumps: 0,
      bootJumpHeight: -1,
      bootJumpAt: 0,
      bootJumpTurn: null,
      bootJumpChecks: 0,
      bootJumpRetries: 0,
      bootJumpSkip: null, // 跳过原因："detections" / "disabled" / "coexist" / "user-input" / "no-answer" / "retry-exhausted"

      // v0.12.1：程序滚动窗口，忽略自己 scrollTop 赋值触发的 scroll 事件
      programmaticScrollUntil: 0,

      // v0.9.1：slot 注册诊断
      injectCalls: 0,          // 调用 ctx.slots.inject 的次数
      injectCallbackRuns: 0,   // inject 回调实际执行的次数（slot 声明已就绪）
      registerRuns: 0,         // ctx.slots.register 成功的次数
      registerError: null,     // 最近一次 register 的错误文本（本地调试用）
      slotDeclared: null,      // 诊断时 slot 是否已声明
      slotEntryCount: null,    // 诊断时该 slot 的 entry 数
      slotEntryIds: null,      // 诊断时该 slot 的 entry id 列表

      // Item 8：兄弟插件共存（v0.12.0 起只认 dsh-chat-answer-anchor）
      coexistence: {
        anchor: false,
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
        return prev;
      }

      state.events.push(entry);
      if (state.events.length > EVENTS_MAX_COUNT) state.events.shift();
      persistEvents();
      return entry;
    }

    /* ───────────────── 配置（Item 3 schema）───────────────── */

    function defaultConfig() {
      return {
        v: CONFIG_VERSION,
        enabled: true,
        sessions: {},
        threshold: { ratio: MIN_BLOCK_RATIO, px: MIN_BLOCK_PX },
      };
    }

    function isFiniteNumber(n) {
      return typeof n === "number" && isFinite(n);
    }

    function clampNumber(n, min, max) {
      if (n < min) return min;
      if (n > max) return max;
      return n;
    }

    /**
     * 把任意输入收敛成合法阈值：{ ratio: 0.05~1, px: 0~200 }。
     * 缺省 / 非数字 → 回填默认值（0.25 / 80）；越界 → 钳位。
     */
    function normalizeThreshold(raw) {
      var out = { ratio: MIN_BLOCK_RATIO, px: MIN_BLOCK_PX };
      if (!raw || typeof raw !== "object") return out;
      if (isFiniteNumber(raw.ratio)) {
        out.ratio = clampNumber(
          raw.ratio,
          THRESHOLD_RATIO_MIN,
          THRESHOLD_RATIO_MAX
        );
      }
      if (isFiniteNumber(raw.px)) {
        out.px = clampNumber(raw.px, THRESHOLD_PX_MIN, THRESHOLD_PX_MAX);
      }
      return out;
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
          // v0.12.0 新字段：旧配置没有它就回填默认值（schema 仍是 v:1）
          threshold: normalizeThreshold(parsed.threshold),
        };
      } catch (e) {
        return defaultConfig();
      }
    }

    /**
     * 运行时应用阈值（只改内存，不写 localStorage）。
     * 缺省字段沿用当前值；返回钳位后的 { ratio, px }。
     */
    function applyThreshold(patch) {
      var next = normalizeThreshold({
        ratio:
          patch && isFiniteNumber(patch.ratio)
            ? patch.ratio
            : state.minBlockRatio,
        px: patch && isFiniteNumber(patch.px) ? patch.px : state.minBlockPx,
      });
      state.minBlockRatio = next.ratio;
      state.minBlockPx = next.px;
      return next;
    }

    /**
     * 持久化阈值（config.threshold）并立即生效。
     * 缺省字段沿用当前值；返回钳位后的 { ratio, px }。
     */
    function saveThreshold(patch) {
      var next = normalizeThreshold({
        ratio:
          patch && isFiniteNumber(patch.ratio)
            ? patch.ratio
            : state.minBlockRatio,
        px: patch && isFiniteNumber(patch.px) ? patch.px : state.minBlockPx,
      });
      var cfg = readConfig();
      cfg.v = CONFIG_VERSION;
      cfg.threshold = { ratio: next.ratio, px: next.px };
      writeConfig(cfg);
      state.minBlockRatio = next.ratio;
      state.minBlockPx = next.px;
      state.thresholdSaves = state.thresholdSaves + 1;
      return next;
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

      var cfg = {
        v: CONFIG_VERSION,
        enabled: enabled,
        sessions: {},
        threshold: { ratio: MIN_BLOCK_RATIO, px: MIN_BLOCK_PX },
      };
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

    // 回滚触发阈值：回答块高度至少占视口这个比例，且不低于绝对下限。
    // 默认值已上移到文件顶部常量区（v0.12.0 修掉「常量晚于 state 初始化、
    // 绝对下限实际不生效」的问题）；运行时可用 setThreshold() 临时调。

    var interactionBound = false;
    var pointerDragging = false; // 是否正在拖滚动条（pointerdown 后、pointerup 前）
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

    /* ── R1：兼容入口（瞬时跳转后通常 no-op） ── */

    /** 停止平滑滚动动画（v0.12.x 起瞬时跳转，不再进入 scrolling=true，通常直接返回） */
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

    /**
     * v0.12.x：DSH 新滚动容器（an3WzG_scrollBody）上 scrollTo({behavior:"smooth"})
     * 不生效，改用 scrollTop 直接赋值（瞬时跳转，与手动验证一致，已验证有效）。
     */
    function startSmoothScroll(s, top) {
      state.scrolling = false;
      state.programmaticScrollUntil = Date.now() + 100; // 程序滚动窗口，避免 scroll 事件自我污染
      clearScrollEndTimer();
      try {
        s.scrollTop = top;
      } catch (e) {}
    }

    /* ── 具名事件处理器（R2）── */

    function onWheel() {
      markUserInput("wheel");
    }
    function onTouchMove() {
      markUserInput("touchmove");
    }
    /**
     * F12 / Ctrl+Shift+I/J/C 是打开 DevTools 的快捷键，
     * 不代表「在读在写」，不应该取消启动跳转。
     */
    function isDevToolsKey(e) {
      if (!e) return false;
      if (e.key === "F12") return true;
      if (!e.ctrlKey || !e.shiftKey) return false;
      var k = String(e.key || "").toUpperCase();
      return k === "I" || k === "J" || k === "C";
    }
    function onKeyDown(e) {
      if (isDevToolsKey(e)) return;
      state.lastUserInputKey = e && e.key ? String(e.key) : null;
      markUserInput("keydown");
    }
    function onPointerDown() {
      pointerDragging = true;
      markUserInput("pointerdown");
    }
    function onPointerUp() {
      pointerDragging = false;
    }
    function onScrollEnd() {
      clearScrollEndTimer();
      if (state.scrolling) {
        state.scrolling = false;
        note("scrolling 复位(scrollend)");
      }
    }
    function onScroll() {
      // 程序自己 scrollTop 赋值触发的 scroll 在窗口内，忽略
      if (Date.now() < state.programmaticScrollUntil) return;
      // DSH 自己滚动（无拖拽）不算用户交互；只有 pointerdown→scroll 的拖滚动条才算
      if (!pointerDragging) return;
      markUserInput("scroll");
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
      addListener(s, "scroll", onScroll, { passive: true });
      addListener(s, "scrollend", onScrollEnd, { passive: true });
      addListener(document, "keydown", onKeyDown, true);
      addListener(document, "pointerdown", onPointerDown, true);
      addListener(document, "pointerup", onPointerUp, true);
      interactionBound = true;
      state.boundScroller = s;
      note("用户交互监听已绑定（" + state.listenerRegistry.length + " 条）");
    }

    /** 页面生命周期监听（不属于会话，rebind 后要重新挂回） */
    function bindLifecycleListeners() {
      addListener(window, "pagehide", onPageHide, false);
      addListener(document, "visibilitychange", onVisibilityChange, false);
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
     * Item 6 / v0.12.x：平台改版判定 + 慢速保活恢复。
     * 契约元素连续 N 次为 0 → 停 observer/interval 降级，但保留 5s 一次的保活；
     * 契约恢复后自动 installObserver() 重装并清掉保活。
     */
    function detectContractRework(tailsList) {
      var tails = (tailsList || getTails()).length;
      var turns = document.querySelectorAll("[data-chat-turn]").length;
      if (tails > 0 || turns > 0) {
        state.contractSeen = true;
        state.contractMisses = 0;
        // 契约恢复：重装 observer/interval，停掉保活
        if (state.contractDegraded && !state.disposed) {
          state.contractDegraded = false;
          resetRetry("contract");
          installObserver();
          logEvent("redetect", { scope: "contract", reason: "recovered" });
          note("契约恢复 → 重新安装监听");
        }
        return;
      }
      if (!state.contractSeen) return; // 还没见过契约元素，可能是空页面，不算改版
      if (state.contractDegraded) {
        // 已降级、契约仍未恢复 → 继续慢速保活重检
        scheduleRetry("contract", detectContractRework, RETRY_SLOW_MS);
        return;
      }
      state.contractMisses = state.contractMisses + 1;
      if (state.contractMisses < CONTRACT_MISS_LIMIT) return;
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
      state.checkTick = null;
      // 慢速保活：5s 后重检契约，恢复则重装
      scheduleRetry("contract", detectContractRework, RETRY_SLOW_MS);
    }

    /** 本轮是否应当因为「用户刚交互过」而放弃滚动 */
    function blockedByUserInput() {
      if (!state.lastUserInputAt) return false;
      // 点一下（聚焦/点窗口）不算主动阅读/输入，与 maybeBootJump / verifyBootJump 保持一致
      if (state.lastUserInputKind === "pointerdown") return false;
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
        unregisterSlots: Object.keys(state.unregisterBySlot || {}),
        toggleRegisterRuns: state.toggleRegisterRuns,
        manualSlotRegistered: state.manualSlotRegistered,
        manualSlotMounted: state.manualSlotMounted,
        manualSlotMounts: state.manualSlotMounts,
        manualSlotError: state.manualSlotError,
        slotError: state.slotError,
        injectReturnType: state.injectReturnType,
        slotDeclared: state.slotDeclared,
        slotEntryCount: state.slotEntryCount,
        slotEntryIds: state.slotEntryIds,
        coexistence: {
          anchor: state.coexistence.anchor,
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

    /**
     * 滚到回答开头。
     * force: 启动首次跳转用，绕过「用户刚交互」窗口（仍受总开关约束）。
     * manual: 手动按键用，跳过总开关 + 交互窗口 + 短回答阈值三道门（手动动作永远生效）。
     */
    function scrollToAnswerStart(turn, force, manual) {
      if (!manual && !isEnabled()) {
        state.lastSkip = "disabled";
        return false;
      }

      // Item 2：用户刚交互过 → 本轮不滚（不打断用户阅读/输入）。
      // force 只给「启动首次跳转」用：它已经单独判断过交互类型（pointerdown 不算）。
      // manual 跳过这道门：点按钮本身就会触发 pointerdown。
      if (!manual && !force && blockedByUserInput()) {
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
        // turn 识别失败时放弃滚动，绝不 fallback 到全部（避免误滚到对话开头）
        state.lastSkip = "turn-not-found";
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

      var minBlock = Math.max(
        state.minBlockPx || 0,
        vh * (typeof state.minBlockRatio === "number" ? state.minBlockRatio : MIN_BLOCK_RATIO)
      );

      state.lastTurn = turn;
      state.lastTarget = {
        kind: target.dataset.chatFlowKind || null,
        itemCount: items.length,
        blockH: Math.round(blockH),
        viewportH: Math.round(vh),
        threshold: Math.round(minBlock),
      };

      if (!manual && blockH < minBlock) {
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

    // v0.12.0：只把 dsh-chat-answer-anchor 视为冲突；dsh-jump-button 不再降级。
    // 目标 id = 目标插件 package.json 的 name（Loader entry name），不带 /client
    var COEXIST_ANCHOR_ID = "dsh-chat-answer-anchor";

    /**
     * 归一化模块 id：
     *   ① 去 `/client` 后缀（与 dsh-client-modules 的 stripClientSuffix 同义）
     *   ② 无条件去 `@scope/` 前缀，只留最后一段
     *
     * 覆盖四种写法：
     *   dsh-chat-answer-anchor / dsh-chat-answer-anchor/client
     *   @scope/dsh-chat-answer-anchor / @scope/dsh-chat-answer-anchor/client
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
     * 输入：apply(ctx) 收到的 ctx（每次轮询都重新读，支持同会话热插拔）
     * 输出：{ anchor: boolean }
     * 探测失败（ctx.modules 不可用 / API 形状不符 / 上下文已停止）→ null
     * （不改判、不误伤、不刷日志）
     */
    function detectCoexistence(ctx) {
      try {
        var m = ctx && ctx.modules;
        if (!m) return null;

        // 首选：manifest.modules 数组（composed 模块名单）
        if (m.manifest && Array.isArray(m.manifest.modules)) {
          var rows = m.manifest.modules;
          var out = { anchor: false };
          for (var i = 0; i < rows.length; i++) {
            var id = normalizeModuleId(rows[i] && rows[i].id);
            if (id === COEXIST_ANCHOR_ID) out.anchor = true;
          }
          return out;
        }

        // 兜底：graphRows Map（Map<id, row>）
        if (m.graphRows && typeof m.graphRows.has === "function") {
          var hit = { anchor: false };
          m.graphRows.forEach(function (row, key) {
            if (normalizeModuleId(key) === COEXIST_ANCHOR_ID) hit.anchor = true;
          });
          return hit;
        }

        return null;
      } catch (e) {
        // 上下文已停止（inactive）/ 服务不可用 → 探测失败，不降级
        return null;
      }
    }

    /**
     * 探测一次并落状态。
     * phase: "initial"（apply 同步）/ "tick"（800ms 轮询）。
     *
     * 只在「首次成功」或「anchor 有↔无变化」时更新状态并记一条事件：
     *   - 同会话禁用 anchor → 下一轮 tick 自动恢复自动回滚
     *   - 同会话启用 anchor → 下一轮 tick 重新闸住
     *   - 探测失败保持上一次结论，不降级、不刷日志
     */
    function probeCoexistence(phase) {
      var res = detectCoexistence(savedCtx);
      if (res === null) {
        var firstFailure = state.coexistence.probe !== "failed";
        state.coexistence.probe = "failed";
        if (phase === "initial" && firstFailure) {
          logEvent("coexistence", { probe: "failed" });
        }
        return state.coexistence;
      }

      var nextAnchor = res.anchor === true;
      var firstOk = state.coexistence.probe !== "ok";
      state.coexistence.probe = "ok";
      state.coexistence.checked = true;

      if (!firstOk && nextAnchor === state.coexistence.anchor) {
        return state.coexistence;
      }

      state.coexistence.anchor = nextAnchor;
      logEvent("coexistence", { anchor: nextAnchor });
      note(
        "共存探测 → " +
          (nextAnchor ? "命中 anchor，自动回滚暂停" : "无冲突，自动回滚恢复")
      );
      return state.coexistence;
    }

    function coexistenceBlocked() {
      var c = state.coexistence;
      return !!(c && c.anchor);
    }

    function coexistenceReason() {
      return "anchor";
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

    /**
     * 启动后首次进入会话：把视图跳到「最后一轮回答的开头」。
     *
     * 只做一次（每次页面加载一个 boot 周期）：
     *   - 连续两个 800ms tick 看到同一个已结束的 tail、且 scrollHeight 稳定才动手
     *     （DSH 的 markdown / 历史加载是异步的，太早跳会算错位置）
     *   - 用户已经交互过 / 共存插件命中 / 开关关闭 / 最后一轮没有回答 → 放弃
     *   - 期间如果已经有新一轮回答结束（detections > 0），说明已不是「首次进入」→ 放弃
     *   - 跳完后再校验位置：被 DSH 的「贴底」覆盖时重跳，最多 3 次
     */
    function maybeBootJump() {
      if (state.bootJumpDone || state.disposed) return;

      if (state.detections > 0) {
        state.bootJumpDone = true;
        state.bootJumpSkip = "detections";
        return;
      }
      if (!isEnabled()) {
        state.bootJumpDone = true;
        state.bootJumpSkip = "disabled";
        return;
      }
      if (coexistenceBlocked()) {
        state.bootJumpDone = true;
        state.bootJumpSkip = "coexist";
        note("启动跳转：共存命中，跳过");
        return;
      }
      // 只有「真的在阅读/输入」的交互才放弃：滚轮、触摸、键盘。
      // 单纯点一下（pointerdown，比如点窗口、点会话、点输入框聚焦）不算，
      // 否则打开 DSH 后随手一点就把启动跳转取消了。
      if (state.lastUserInputAt && state.lastUserInputKind !== "pointerdown") {
        state.bootJumpDone = true;
        state.bootJumpSkip =
          "user-input:" +
          state.lastUserInputKind +
          (state.lastUserInputKey ? "/" + state.lastUserInputKey : "");
        note("启动跳转：用户已交互，跳过");
        return;
      }

      var list = getTails();
      if (list.length === 0) return;

      var tail = list[list.length - 1];
      // 流式输出中不跳，等下一轮 tick
      if (!tail.hasAttribute("data-actions-reveal")) return;
      // 连续两个 tick 指向同一个 tail，说明渲染已稳定
      if (tail !== state.bootJumpTail) {
        state.bootJumpTail = tail;
        state.bootJumpHeight = -1;
        return;
      }

      // 内容高度也要连续两个 tick 不变，避免历史/代码块还在长高
      var s = findScroller();
      if (!s) return;
      if (s.scrollHeight !== state.bootJumpHeight) {
        state.bootJumpHeight = s.scrollHeight;
        return;
      }

      var turn = tail.getAttribute("data-turn-tail");
      var items = document.querySelectorAll('[data-chat-turn="' + turn + '"]');
      var hasAnswer = false;
      for (var i = 0; i < items.length; i++) {
        var kind = items[i].dataset && items[i].dataset.chatFlowKind;
        if (kind && !USER_KINDS[kind]) {
          hasAnswer = true;
          break;
        }
      }
      if (!hasAnswer) {
        state.bootJumpDone = true;
        state.bootJumpSkip = "no-answer";
        note("启动跳转：最后一轮没有回答，跳过");
        return;
      }

      state.bootJumpDone = true;
      state.bootJumpSkip = null;
      // force=true：pointerdown 已经在上面放行，这里不再被 300ms 交互窗口二次拦下
      var ok = scrollToAnswerStart(turn, true);
      if (!ok) {
        state.bootJumpSkip = "scroll-failed:" + state.lastSkip;
        note("首次进入会话 → 未跳：" + state.lastSkip);
        return;
      }

      state.bootJumps = state.bootJumps + 1;
      state.bootJumpAt = Date.now();
      state.bootJumpTurn = turn;
      note("首次进入会话 → 跳到最后一轮开头");
      later(verifyBootJump, 1200);
    }

    /**
     * 跳转后校验：DSH 可能在布局完成后再把视图贴回底部。
     * 偏离超过 80px 就重跳，最多 3 次；用户一旦真正开始阅读（滚轮/触摸/键盘）就放手。
     */
    function verifyBootJump() {
      if (state.disposed || !state.bootJumpTurn || !state.bootJumpDone) return;
      if (
        state.lastUserInputAt > state.bootJumpAt &&
        state.lastUserInputKind !== "pointerdown"
      ) {
        return; // 用户接管，别抢
      }
      if (state.bootJumpChecks >= 5 || state.bootJumpRetries >= 3) {
        if (state.bootJumpRetries >= 3) state.bootJumpSkip = "retry-exhausted";
        return;
      }
      state.bootJumpChecks = state.bootJumpChecks + 1;

      var s = findScroller();
      if (!s) return;

      var target = typeof state.lastScrollTop === "number" ? state.lastScrollTop : 0;
      var drift = Math.abs(s.scrollTop - target);
      if (drift > 80) {
        state.bootJumpRetries = state.bootJumpRetries + 1;
        var ok = scrollToAnswerStart(state.bootJumpTurn, true);
        note(
          "启动跳转：位置被覆盖(" + Math.round(drift) + "px) → 重跳 " +
            state.bootJumpRetries + "/3" + (ok ? "" : "（失败：" + state.lastSkip + "）")
        );
        if (!ok) return;
      }
      later(verifyBootJump, 1200);
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
      // 找最后一个「已结束」的 tail 作为去重基线：不把推理中（未结束）的 turn 当已处理，
      // 避免它结束时漏滚、或 DOM 抖动后误滚到上一个回答。
      var lastDone = null;
      for (var i = existing.length - 1; i >= 0; i--) {
        if (existing[i].hasAttribute("data-actions-reveal")) {
          lastDone = existing[i];
          break;
        }
      }
      // 用 turn id 去重，而不是 DOM 节点：
      // DSH 空闲重渲染会替换节点但 turn 不变，用节点比较会把「同一轮重渲染」
      // 误判成新回答 → 空闲时莫名向上跳。
      var handledTurn =
        lastDone && typeof lastDone.getAttribute === "function"
          ? lastDone.getAttribute("data-turn-tail")
          : null;
      var handledNode = lastDone;

      function check(isTick) {
        var list = getTails(); // 查一次，tick 内复用（避免 detectContractRework 重复查询）
        // 会话切换探测 / 平台改版判定 / 启动首次跳转只在 800ms tick 上做，
        // 避免 mutation 风暴里读布局
        if (isTick) {
          maybeRebindListeners();
          detectContractRework(list);
          maybeBootJump();
          // v0.12.0：每轮 tick 轻量重检共存名单（只在 anchor 有↔无变化时落状态/记日志）
          probeCoexistence("tick");
        }
        if (list.length === 0) return;
        var tail = list[list.length - 1];
        var turn =
          typeof tail.getAttribute === "function"
            ? tail.getAttribute("data-turn-tail")
            : null;

        // 同一个 turn 已处理过：无论节点是否被替换，都跳过
        if (turn !== null && turn === handledTurn) return;
        if (turn === null && tail === handledNode) return;
        if (!tail.hasAttribute("data-actions-reveal")) return;

        handledTurn = turn;
        handledNode = tail;
        state.detections = state.detections + 1;

        later(function () {
          // Item 8：兄弟插件共存命中 → 自动回滚闸住（手动 forceScroll 不走这里）
          if (coexistenceBlocked()) {
            state.coexistSkips = state.coexistSkips + 1;
            state.lastSkip = "coexistence(" + coexistenceReason() + ")";
            note("共存命中 → 跳过本轮自动回滚");
            return;
          }

          // 晚滚防护：已经出现更新的 turn（用户已发下一条），说明这次检测晚了，跳过
          var tn = parseInt(turn, 10);
          if (!isNaN(tn)) {
            var newer =
              document.querySelectorAll('[data-chat-turn="' + (tn + 1) + '"]')
                .length > 0;
            if (newer) {
              state.lastSkip = "newer-turn";
              note("turn " + turn + " 检测晚到（已有更新 turn），跳过滚动");
              return;
            }
          }

          var ok = scrollToAnswerStart(turn);
          note("turn " + turn + (ok ? " ✓ 滚动" : " ✗ " + state.lastSkip));
        }, 60);
      }
      state.checkTick = check;

      try {
        // v0.12.1：mutation 风暴用 rAF 合并，同帧只跑一次 check(false)
        var mutationPending = false;
        state.mutationObserver = new MutationObserver(function () {
          if (mutationPending) return;
          mutationPending = true;
          requestAnimationFrame(function () {
            mutationPending = false;
            if (state.disposed) return;
            check(false);
          });
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

      // v0.12.0：按 slot 账本全部注销（开关 slot + 手动按键 slot），零残留
      unregisterAllSlots();

      state.installed = false;
      state.checkTick = null;
      state.scrolling = false;
      state.boundScroller = null;
      state.observer = "disposed";
      interactionBound = false;
      pointerDragging = false;
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

    /** 切回前台：后台完成的回答立即补检，抢在用户观察/滚动之前滚掉 */
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      // 切回后 DOM 可能还在从虚拟滚动回收中恢复，150/400/900ms 三个时间点抢跑检测
      var delays = [150, 400, 900];
      for (var i = 0; i < delays.length; i++) {
        (function (d) {
          later(function () {
            if (
              !state.disposed &&
              document.visibilityState === "visible" &&
              typeof state.checkTick === "function"
            ) {
              state.checkTick(true);
            }
          }, d);
        })(delays[i]);
      }
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

    function pctOf(ratio) {
      var r = isFiniteNumber(ratio) ? ratio : MIN_BLOCK_RATIO;
      return Math.round(r * 100);
    }

    /**
     * 设置页滑块行：标签（可带 ? 原生 title 提示）+ range + 说明。
     * 提示用方案 A（原生 title），零依赖；悬停 ? 图标出浏览器气泡。
     */
    function ThresholdSlider(props) {
      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "6px" } },
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px" } },
          React.createElement(
            "span",
            { style: { fontSize: "12px", fontWeight: "500" } },
            props.label
          ),
          props.hint
            ? React.createElement(
                "span",
                {
                  title: props.hint,
                  "aria-label": props.hint,
                  tabIndex: 0,
                  "data-dsh-answer-top-hint": props.sliderId,
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    border: "1px solid currentColor",
                    fontSize: "9px",
                    lineHeight: "1",
                    opacity: 0.5,
                    cursor: "help",
                    userSelect: "none",
                    flex: "0 0 auto",
                  },
                },
                "?"
              )
            : null
        ),
        React.createElement("input", {
          type: "range",
          min: props.min,
          max: props.max,
          step: props.step,
          value: props.value,
          "aria-label": props.label,
          "data-dsh-answer-top-slider": props.sliderId,
          onChange: props.onChange,
          style: {
            width: "100%",
            margin: "0",
            accentColor: COLOR_ON,
            cursor: "pointer",
          },
        }),
        React.createElement(
          "span",
          { style: { fontSize: "11px", opacity: 0.55, lineHeight: "1.5" } },
          props.caption
        )
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

      var thresholdHook = React.useState(readConfig().threshold);
      var threshold = thresholdHook[0];
      var setThresholdState = thresholdHook[1];

      // v0.12.0：共存状态随 800ms 重检变化，设置页打开时让提示自动出现/消失
      var coexistHook = React.useState(state.coexistence.anchor);
      var coexistAnchor = coexistHook[0];
      var setCoexistAnchor = coexistHook[1];
      React.useEffect(function () {
        var id = setInterval(function () {
          setCoexistAnchor(state.coexistence.anchor);
        }, 800);
        return function () {
          clearInterval(id);
        };
      }, []);

      function toggle() {
        var next = setEnabled(!enabled);
        setEnabledState(next);
        try {
          console.log("[dsh-answer-top] 自动回滚已" + (next ? "开启" : "关闭"));
        } catch (e) {}
      }

      /** 滑块变化：钳位 + 落 localStorage + 刷新显示（保存的是比例，不是百分数） */
      function changeThreshold(patch) {
        var next = saveThreshold(patch);
        setThresholdState({ ratio: next.ratio, px: next.px });
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
        ),
        coexistAnchor
          ? React.createElement(
              "span",
              {
                "data-dsh-answer-top-coexist-hint": "anchor",
                style: {
                  fontSize: "11px",
                  lineHeight: "1.5",
                  color: "#d97706",
                },
              },
              "检测到 dsh-chat-answer-anchor，已暂停自动回滚"
            )
          : null,
        React.createElement(
          "div",
          {
            "data-dsh-answer-top-threshold": "1",
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              paddingTop: "10px",
              borderTop: "1px solid rgba(127,127,127,0.18)",
            },
          },
          React.createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "2px" } },
            React.createElement(
              "span",
              { style: { fontSize: "13px", fontWeight: "600" } },
              "触发阈值"
            ),
            React.createElement(
              "span",
              { style: { fontSize: "11px", opacity: 0.55, lineHeight: "1.5" } },
              "两条同时生效、取更高的一条：回答高度低于它的不滚。"
            )
          ),
          React.createElement(ThresholdSlider, {
            sliderId: "ratio",
            label: "最小回答高度",
            min: 5,
            max: 100,
            step: 1,
            value: pctOf(threshold.ratio),
            onChange: function (e) {
              changeThreshold({ ratio: Number(e.target.value) / 100 });
            },
            caption: "低于视口 " + pctOf(threshold.ratio) + "% 的回答不滚",
          }),
          React.createElement(ThresholdSlider, {
            sliderId: "px",
            label: "绝对下限",
            hint: THRESHOLD_PX_HINT,
            min: 0,
            max: 200,
            step: 1,
            value: threshold.px,
            onChange: function (e) {
              changeThreshold({ px: Number(e.target.value) });
            },
            caption: "当前 " + threshold.px + "px",
          })
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

    /**
     * v0.12.0：常驻手动按键（conversation.composer.dock）。
     * 始终显示，不依赖总开关 / 共存状态；点击走 manual 路径绕开三道门。
     */
    function ManualButton() {
      React.useEffect(function () {
        state.manualSlotMounts = state.manualSlotMounts + 1;
        state.manualSlotMounted = true;
        if (state.manualSlotMounts === 1) {
          try {
            console.log("[dsh-answer-top] ✓ 手动按键渲染成功：" + SLOT_MANUAL);
          } catch (e) {}
          note("手动按键已渲染");
        }
      }, []);

      function onClick() {
        var tails = getTails();
        var turn = tails.length
          ? tails[tails.length - 1].getAttribute("data-turn-tail")
          : null;
        var ok = scrollToAnswerStart(turn, true, true);
        note("手动按键 → " + (ok ? "滚动" : state.lastSkip));
      }

      return React.createElement(
        "button",
        {
          type: "button",
          onClick: onClick,
          title: "回滚到回答开头",
          "aria-label": "回滚到回答开头",
          "data-dsh-answer-top-manual": "1",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            height: "18px",
            padding: "0 6px",
            margin: "0 2px",
            borderRadius: "5px",
            border: "1px solid rgba(127,127,127,0.28)",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontSize: "11px",
            lineHeight: "1",
            whiteSpace: "nowrap",
            cursor: "pointer",
          },
        },
        "⤒",
        React.createElement("span", null, "回滚")
      );
    }

    /* ─────────────────────── slot 注册 ─────────────────────── */

    var savedCtx = null;

    /** 注销单个 slot（先删账本再调用，避免 cleanup 重入） */
    function unregisterSlot(slotName) {
      var fn = state.unregisterBySlot[slotName];
      delete state.unregisterBySlot[slotName];
      if (typeof fn !== "function") return false;
      try {
        fn();
      } catch (e) {}
      return true;
    }

    /** teardown 用：注销所有 slot 并复位账本/挂载标记（零残留） */
    function unregisterAllSlots() {
      var names = state.unregisterBySlot
        ? Object.keys(state.unregisterBySlot)
        : [];
      for (var i = 0; i < names.length; i++) unregisterSlot(names[i]);
      state.unregisterBySlot = {};
      state.slotName = SLOT_PRIMARY;
      state.slotIsFallback = false;
      state.slotRegistered = false;
      state.slotMounted = false;
      state.slotMounts = 0;
      state.manualSlotRegistered = false;
      state.manualSlotMounted = false;
      state.manualSlotMounts = 0;
      return names.length;
    }

    /**
     * 向一个 slot 注入并注册；按 slot 名分别记账。
     * isToggle: 只用于诊断（toggleRegisterRuns），与手动按键 slot 区分。
     */
    function injectSlot(ctx, slotName, options, Component, isToggle) {
      unregisterSlot(slotName); // 同名 slot 先注销，避免重复注册

      state.injectCalls = state.injectCalls + 1;
      var injectReturn = ctx.slots.inject(
        slotName,
        function () {
          if (state.disposed) return function () {};
          // 只有 slot 声明已就绪，这个回调才会执行；次数进诊断
          state.injectCallbackRuns = state.injectCallbackRuns + 1;
          var unregister;
          try {
            unregister = ctx.slots.register(options, Component);
          } catch (e) {
            state.registerError = String((e && e.message) || e);
            throw e;
          }
          var stored = typeof unregister === "function" ? unregister : null;
          state.registerRuns = state.registerRuns + 1;
          if (isToggle) state.toggleRegisterRuns = state.toggleRegisterRuns + 1;
          state.registerError = null;
          state.unregisterBySlot[slotName] = stored;

          // inject() 的 factory 返回值会被当作清理函数：只注销本 slot
          return function () {
            if (state.unregisterBySlot[slotName] !== stored) return;
            delete state.unregisterBySlot[slotName];
            if (typeof stored === "function") {
              try {
                stored();
              } catch (e) {}
            }
          };
        },
        "dsh-answer-top: slot " + slotName
      );

      state.injectReturnType = typeof injectReturn;
      return injectReturn;
    }

    /** 开关 slot（首选 settings.section / 备选对话头部） */
    function registerInto(ctx, slotName, Component, isFallback) {
      injectSlot(
        ctx,
        slotName,
        {
          name: slotName,
          id: PLUGIN_ID,
          order: 60,
          label: function () {
            return "自动回滚";
          },
        },
        Component,
        true
      );

      state.slotName = slotName;
      state.slotIsFallback = !!isFallback;
      // 注意：这里只代表「inject 调用成功」，不代表 register 真的跑过。
      // 真正的证据看 state.toggleRegisterRuns / diagnose()。
      state.slotRegistered = true;
      state.slotMounted = false;
      state.slotMounts = 0;
      note("slot 已注册：" + slotName);
      try {
        console.log("[dsh-answer-top] slot 已注册：" + slotName);
      } catch (e) {}
      return true;
    }

    /** 常驻手动按键 slot（与开关 slot 独立，不参与首选/备选切换） */
    function registerManualSlot(ctx) {
      injectSlot(
        ctx,
        SLOT_MANUAL,
        {
          name: SLOT_MANUAL,
          id: MANUAL_SLOT_ID,
          order: 2,
        },
        ManualButton,
        false
      );

      state.manualSlotRegistered = true;
      state.manualSlotMounted = false;
      state.manualSlotMounts = 0;
      note("手动按键 slot 已注册：" + SLOT_MANUAL);
      try {
        console.log(
          "[dsh-answer-top] 手动按键 slot 已注册：" + SLOT_MANUAL
        );
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

      // ⓪-2 阈值：从 config 读回（旧配置没有 threshold 时 normalize 回填 0.25/80）
      try {
        applyThreshold(readConfig().threshold);
      } catch (e) {
        logEvent("threshold-load-failed");
      }

      // Item 8：兄弟插件共存探测 —— apply 同步一次，之后由 800ms tick 持续重检
      // （同会话禁用/启用 anchor 会自动恢复/重新闸住，见 probeCoexistence）
      probeCoexistence("initial");

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
              // 只注销旧开关 slot；手动按键 slot 常驻，不受切换影响
              unregisterSlot(state.slotName);
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
          /**
           * 运行时调整回滚阈值（不持久化，刷新恢复默认）。
           * ratio: 回答块高度 / 视口高度，0~1；px: 绝对下限像素。
           * 例：__dshAnswerTop.setThreshold(0.15, 40) —— 更激进地跳。
           */
          setThreshold: function (ratio, px) {
            if (typeof ratio === "number" && ratio >= 0 && ratio <= 1) {
              state.minBlockRatio = ratio;
            }
            if (typeof px === "number" && px >= 0) {
              state.minBlockPx = px;
            }
            try {
              console.log(
                "[dsh-answer-top] threshold =",
                state.minBlockRatio,
                state.minBlockPx + "px"
              );
            } catch (e) {}
            return { ratio: state.minBlockRatio, px: state.minBlockPx };
          },
          /** 当前生效阈值（不一定已持久化） */
          threshold: function () {
            return { ratio: state.minBlockRatio, px: state.minBlockPx };
          },
          /**
           * 运行时应用阈值（不持久化，钳位 0.05~1 / 0~200），缺省字段沿用当前值。
           * 例：__dshAnswerTop.applyThreshold({ ratio: 0.15, px: 40 })
           */
          applyThreshold: function (patch) {
            var next = applyThreshold(patch);
            try {
              console.log(
                "[dsh-answer-top] threshold =",
                next.ratio,
                next.px + "px"
              );
            } catch (e) {}
            return next;
          },
          /** 持久化阈值（写入 config.threshold）并立即生效 */
          saveThreshold: function (patch) {
            var next = saveThreshold(patch);
            try {
              console.log(
                "[dsh-answer-top] threshold saved =",
                next.ratio,
                next.px + "px"
              );
            } catch (e) {}
            return next;
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

      // ① + ② 页面生命周期 / observer / interval / 输入监听
      // 整套 setup 挂进 ctx.effect：DSH 停上下文时 disposer 调 teardown，
      // 避免 interval/observer 在 inactive context 上继续空转。
      function setupDom() {
        bindLifecycleListeners();

        if (document.readyState === "loading") {
          addListener(document, "DOMContentLoaded", onDomReady, false);
        } else {
          installObserver();
          bindUserInputListeners();
        }

        return function () {
          teardown("context-stop");
        };
      }

      if (typeof ctx.effect === "function") {
        try {
          ctx.effect(setupDom, "dsh-answer-top: dom setup");
        } catch (e) {
          setupDom();
        }
      } else {
        setupDom();
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
        // ① 常驻手动按键：与开关 slot 独立，失败不影响开关
        try {
          registerManualSlot(ctx);
        } catch (e) {
          state.manualSlotError = String((e && e.message) || e);
          note("手动按键 slot 失败：" + state.manualSlotError);
          try {
            console.warn("[dsh-answer-top] 手动按键 slot 失败", e);
          } catch (e2) {}
        }

        // ② 开关 slot：首选 settings.section，失败切头部备选
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
            unregisterSlot(SLOT_PRIMARY);
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
        if (state.toggleRegisterRuns === 0) {
          // inject 调用成功但回调没执行 → slot 声明还没就绪（或注册被卡住）
          note("8s：开关 slot 的 inject 回调未执行（slot 未声明）");
          try {
            console.warn(
              "[dsh-answer-top] 开关 slot 注册回调 8 秒内未执行。\n" +
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
        if (state.manualSlotRegistered && state.manualSlotMounts === 0) {
          note("8s：手动按键已注册但未渲染");
          try {
            console.warn(
              "[dsh-answer-top] 手动按键 slot 已注册但 8 秒内未渲染（" +
                SLOT_MANUAL + "）。"
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







