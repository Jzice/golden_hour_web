import { ProgressLedger } from "./progress-ledger.js";
const CLOUD_PREFIX = "gh_kills_v1_";
const COMPONENT_KEY = "gh_toy_component_v1";
const LOCAL_PREFIX = "gh_toy_pending_v1_";
const SDK_URL = "https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js";
const MAX_SCORE = 16777215;
const DEFAULT_PLAYER_NAME = "\u5E72\u5458";
const loaders = /* @__PURE__ */ new WeakMap();
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function randomComponent() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw Error("random unavailable");
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toyURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.bilibilitoy.com" || (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com")) && /^\/toy(?:\/|$)/.test(url.pathname));
  } catch {
    return false;
  }
}
function inToy(window, document) {
  return [window?.location?.href, document?.referrer, ...Array.from(window?.location?.ancestorOrigins ?? [])].some(toyURL);
}
function loadSDK(window, document) {
  if (window?.toy) return Promise.resolve(window.toy);
  if (!document?.createElement) return Promise.reject(Error("document unavailable"));
  if (loaders.has(document)) return loaders.get(document);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve(window.toy);
    };
    const timer = setTimeout(() => finish(Error("SDK timeout")), 15e3);
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => finish(window.toy ? null : Error("SDK unavailable"));
    script.onerror = () => finish(Error("SDK load failed"));
    try {
      (document.head ?? document.documentElement).appendChild(script);
    } catch (error) {
      finish(error);
    }
  });
  loaders.set(document, promise);
  promise.catch(() => loaders.delete(document));
  return promise;
}
function counts(value) {
  if (!value || !Number.isSafeInteger(value.online) || value.online < 0 || !Number.isSafeInteger(value.training) || value.training < 0 || !Number.isSafeInteger(value.online + value.training)) throw Error("invalid ledger");
  return { online: value.online, training: value.training };
}
function merge(a, b) {
  return { online: Math.max(a.online, b.online), training: Math.max(a.training, b.training) };
}
function equal(a, b) {
  return a.online === b.online && a.training === b.training;
}
function cloudComponents(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("invalid cloud storage");
  const components = /* @__PURE__ */ new Map();
  let online = 0, training = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(CLOUD_PREFIX)) continue;
    if (typeof value !== "string") throw Error("invalid cloud component");
    const component = counts(JSON.parse(value));
    online += component.online;
    training += component.training;
    counts({ online, training });
    components.set(key, component);
  }
  return components;
}
function errorText(stage, error) {
  if (error?.type === "not_logged_in" || error?.code === -101)
    return "\u8BF7\u5148\u767B\u5F55 B\u7AD9\uFF0C\u518D\u540C\u6B65 Toy \u8EAB\u4EFD\uFF1B\u4ECD\u53EF\u7EE7\u7EED\u533F\u540D\u8BD5\u73A9\u3002";
  if (error?.type === "http_error" && String(error?.message || "").includes("getUserProfile is unauthorized"))
    return "Toy \u8EAB\u4EFD\u672A\u83B7\u6388\u6743\uFF0C\u8BF7\u767B\u5F55 B\u7AD9\u5E76\u786E\u8BA4\u5E73\u53F0\u6388\u6743\uFF1B\u4ECD\u53EF\u7EE7\u7EED\u533F\u540D\u8BD5\u73A9\u3002";
  if (error?.type === "user_denied")
    return "\u672A\u6388\u6743 Toy \u8EAB\u4EFD\uFF0C\u53EF\u7EE7\u7EED\u533F\u540D\u8BD5\u73A9\uFF1B\u533F\u540D\u51FB\u6740\u4E0D\u8BA1\u5165\u6392\u884C\u699C\u3002";
  if (String(error?.message || "").includes("toy id not available"))
    return "Toy \u5E73\u53F0\u672A\u63D0\u4F9B\u5F53\u524D\u4F5C\u54C1\u4E0A\u4E0B\u6587\uFF0C\u8EAB\u4EFD\u548C\u4E91\u6863\u6682\u4E0D\u53EF\u7528\uFF1B\u53EF\u7EE7\u7EED\u533F\u540D\u8BD5\u73A9\uFF0C\u6B63\u5F0F Toy \u9875\u9762\u767B\u5F55\u540E\u91CD\u8BD5\u3002";
  const raw = error?.code ?? error?.errorCode;
  const code = /^\d{1,9}$/.test(String(raw)) ? `\uFF08\u9519\u8BEF\u7801 ${raw}\uFF09` : "";
  return `${stage}\u5931\u8D25${code}\uFF0C\u53EF\u7A0D\u540E\u624B\u52A8\u91CD\u8BD5\uFF1B\u672A\u540C\u6B65\u8FDB\u5EA6\u4ECD\u4FDD\u7559\u3002`;
}
class ToyAccount extends EventTarget {
  constructor({
    sdk = null,
    storage = browserStorage(),
    locks = globalThis.navigator?.locks,
    window = globalThis.window ?? globalThis,
    document = globalThis.document
  } = {}) {
    super();
    this._sdk = sdk;
    this._injected = !!sdk;
    this._storage = storage;
    this.progress = new ProgressLedger(storage);
    this._locks = locks;
    this._window = window;
    this._document = document;
    this._state = Object.freeze({ status: "anonymous", authenticated: false, nickname: "", total: 0, online: 0, training: 0, sync: "idle", message: "\u533F\u540D\u6E38\u73A9\u4E0D\u8BA1\u5165\u6392\u884C\u699C\u3002" });
    this._queue = Promise.resolve();
    this._prepare = null;
    this._authorization = null;
    this._prepared = false;
    this._writable = false;
    this._scoreWritable = false;
    this._identity = null;
    this._component = null;
    this._own = { online: 0, training: 0 };
    this._cloud = /* @__PURE__ */ new Map();
    this._score = null;
    this._needsScore = false;
    this._rankCache = null;
    this._rankRequest = null;
    this._flushRequest = null;
    this._retryAfter = 0;
    this._warning = "";
  }
  get state() {
    return this._state;
  }
  get isToy() {
    return this._injected || inToy(this._window, this._document);
  }
  get playerName() {
    return this.state.authenticated ? this.state.nickname : this.isToy ? "\u533F\u540D\u5E72\u5458" : DEFAULT_PLAYER_NAME;
  }
  get sdk() {
    return this._sdk;
  }
  get identityKey() {
    return this._identity?.openId ?? null;
  }
  _change(patch) {
    this._state = Object.freeze({ ...this._state, ...patch });
    this.dispatchEvent(new Event("change"));
  }
  _enqueue(operation) {
    const result = this._queue.then(operation);
    this._queue = result.catch(() => {
    });
    return result;
  }
  _lock(name, operation) {
    return this._locks?.request ? this._locks.request(name, { mode: "exclusive" }, operation) : operation();
  }
  _accountLock(operation) {
    return this._lock(`gh-toy-kills-v1:${this._identity.openId ? encodeURIComponent(this._identity.openId) : "session"}`, operation);
  }
  async _componentID() {
    if (this._component) return;
    await this._lock("gh-toy-component-v1", () => {
      try {
        const saved = this._storage?.getItem(COMPONENT_KEY);
        if (saved && /^[a-zA-Z0-9_-]{8,128}$/.test(saved)) this._component = saved;
        else {
          this._component = randomComponent();
          this._storage?.setItem(COMPONENT_KEY, this._component);
        }
        if (!this._storage) this._warning = "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002";
      } catch {
        this._component ??= randomComponent();
        this._storage = null;
        this._warning = "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002";
      }
    });
  }
  _localKey() {
    return this._identity.openId ? `${LOCAL_PREFIX}${encodeURIComponent(this._identity.openId)}_${this._component}` : null;
  }
  _readLocal() {
    const key = this._localKey();
    if (!key || !this._storage) return this._own;
    let raw;
    try {
      raw = this._storage.getItem(key);
    } catch {
      this._warning = "\u672C\u5730\u8BFB\u53D6\u5931\u8D25\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002";
      return this._own;
    }
    return raw === null ? this._own : merge(this._own, counts(JSON.parse(raw)));
  }
  _persist() {
    const key = this._localKey();
    if (key && this._storage) this._storage.setItem(key, JSON.stringify(this._own));
  }
  _totals(own = this._own) {
    let online = own.online, training = own.training;
    for (const [key, value] of this._cloud) {
      if (key === CLOUD_PREFIX + this._component) continue;
      online += value.online;
      training += value.training;
    }
    return counts({ online, training });
  }
  _showCounts(patch = {}) {
    const { online, training } = this._totals();
    this._change({
      online,
      training,
      total: online + training,
      progress: this.progress.ready ? this.progress.snapshot() : null,
      loadout: this.progress.preferences?.value ?? null,
      progressSync: !this.progress.ready ? "idle" : !this._writable ? "readonly" : this.progress.pending() ? "pending" : "synced",
      ...patch
    });
  }
  prepare() {
    if (this._prepared) return Promise.resolve(this.state);
    if (this._prepare) return this._prepare;
    this._prepare = (async () => {
      if (!this.isToy) return this.state;
      this._change({ status: "loading", message: "\u6B63\u5728\u8FDE\u63A5 Toy \u5E73\u53F0\u2026" });
      try {
        this._sdk ??= await loadSDK(this._window, this._document);
        const [cloud, score] = await Promise.all([
          this._sdk.isSupport("setCloudStorage"),
          this._sdk.isSupport("submitScore")
        ]);
        this._writable = cloud === true;
        this._scoreWritable = score === true;
        this._prepared = true;
        this._change({
          status: "anonymous",
          sync: this._writable ? "idle" : "readonly",
          message: this._writable ? "\u533F\u540D\u6E38\u73A9\u4E0D\u8BA1\u5165\u6392\u884C\u699C\u3002" : "\u5F53\u524D Toy \u73AF\u5883\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u4FDD\u5B58\u51FB\u6740\u6216\u63D0\u4EA4\u6392\u884C\u699C\u3002"
        });
      } catch (error) {
        this._change({ status: "anonymous", sync: "error", message: errorText("Toy SDK \u8FDE\u63A5\u6216\u80FD\u529B\u68C0\u6D4B", error) });
      }
      return this.state;
    })().finally(() => {
      this._prepare = null;
    });
    return this._prepare;
  }
  authorize() {
    if (!this.isToy) return Promise.resolve(this.state);
    if (this._authorization) return this._authorization;
    let profile;
    if (this._prepared) {
      try {
        profile = Promise.resolve(this._sdk.getUserProfile());
      } catch (error) {
        profile = Promise.reject(error);
      }
      profile.catch(() => {
      });
    }
    this._change({
      status: "authorizing",
      authenticated: false,
      nickname: "",
      online: 0,
      training: 0,
      total: 0,
      progress: null,
      loadout: null,
      progressSync: "loading",
      message: "\u6B63\u5728\u8BFB\u53D6 Toy \u8EAB\u4EFD\u4E0E\u6210\u957F\u4E91\u6863\u2026"
    });
    this._authorization = this._enqueue(async () => {
      let stage = "Toy \u6388\u6743";
      try {
        if (!this._prepared) await this.prepare();
        if (!this._prepared) throw Error("SDK unavailable");
        const user = await (profile ?? this._sdk.getUserProfile());
        if (!user || typeof user.nickname !== "string" || !user.nickname.trim()) throw Error("invalid profile");
        const openId = typeof user.toyOpenId === "string" && user.toyOpenId ? user.toyOpenId : null;
        const previous = this._identity;
        const retained = openId && previous?.openId === openId ? this._own : { online: 0, training: 0 };
        this._identity = { openId };
        this._own = retained;
        this._cloud = /* @__PURE__ */ new Map();
        this._score = null;
        this._needsScore = true;
        this._rankCache = null;
        this._warning = !this._storage ? "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002" : !openId ? "\u5E73\u53F0\u672A\u63D0\u4F9B\u7A33\u5B9A\u7528\u6237\u6807\u8BC6\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002" : "";
        this._retryAfter = 0;
        this._change({ authenticated: true, nickname: user.nickname, online: 0, training: 0, total: 0 });
        await this._componentID();
        stage = "\u4E91\u6863\u8BFB\u53D6";
        await this._accountLock(async () => {
          const data = await this._sdk.getCloudStorage();
          this._cloud = cloudComponents(data);
          this.progress.open({ identity: openId, component: this._component, data });
          this._own = merge(this._cloud.get(CLOUD_PREFIX + this._component) ?? { online: 0, training: 0 }, this._readLocal());
          this._totals();
          try {
            this._persist();
          } catch {
            this._warning = "\u672C\u5730\u4FDD\u5B58\u5931\u8D25\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002";
          }
        });
        stage = "\u4E2A\u4EBA\u699C\u4F4D\u8BFB\u53D6";
        this._score = this._scoreWritable ? this._rankScore(await this._sdk.getMyRank({ board: 1, period: "all" })) : 0;
        this._needsScore = this._scoreWritable && this._totals().online + this._totals().training > this._score;
        this._showCounts({
          status: "ready",
          nickname: user.nickname,
          sync: this._writable ? this._pending() ? "pending" : "synced" : "readonly",
          message: this._writable ? this._warning : "\u5F53\u524D Toy \u73AF\u5883\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u4FDD\u5B58\u51FB\u6740\u6216\u63D0\u4EA4\u6392\u884C\u699C\u3002"
        });
      } catch (error) {
        if (stage === "Toy \u6388\u6743") {
          this._identity = null;
          this._own = { online: 0, training: 0 };
          this._cloud = /* @__PURE__ */ new Map();
          this.progress.reset();
          this._rankCache = null;
        }
        const ready = stage === "\u4E2A\u4EBA\u699C\u4F4D\u8BFB\u53D6";
        this._change({
          status: ready ? "ready" : "error",
          sync: "error",
          message: errorText(stage, error) + (!ready && this.state.authenticated ? " \u4E91\u6863\u5C1A\u672A\u5C31\u7EEA\uFF0C\u51FB\u6740\u6682\u4E0D\u8BA1\u5165\u6392\u884C\u699C\uFF1B\u6210\u957F\u4EE5\u672C\u5730\u8BD5\u73A9\u4FDD\u5B58\uFF0C\u53EF\u5728\u6062\u590D\u540E\u9009\u62E9\u5BFC\u5165\u3002" : "")
        });
        if (ready) this._showCounts();
      }
      return this.state;
    }).finally(() => {
      this._authorization = null;
    });
    return this._authorization;
  }
  _pending() {
    return !equal(this._own, this._cloud.get(CLOUD_PREFIX + this._component) ?? { online: 0, training: 0 }) || this._needsScore || this.progress.pending();
  }
  _progressOperation(operation) {
    if (this.state.status !== "ready" || !this.progress.ready) return Promise.resolve(false);
    const identity = this._identity;
    return this._enqueue(async () => {
      if (this._identity !== identity) return false;
      try {
        await this._accountLock(() => operation(this.progress));
        this._showCounts({ sync: this._writable ? "pending" : "readonly", message: this.progress.warning || this._warning });
        return true;
      } catch (error) {
        this._change({ sync: "error", progressSync: "error", message: errorText("\u6210\u957F\u5B58\u6863\u4FDD\u5B58", error) });
        return false;
      }
    });
  }
  recordProgress(delta) {
    return this._progressOperation((store) => store.record(delta));
  }
  saveLoadout(value) {
    return this._progressOperation((store) => store.saveLoadout(value));
  }
  importLegacy(value) {
    return this._progressOperation((store) => store.importLegacy(value));
  }
  _rankScore(mine) {
    if (!mine || typeof mine.ranked !== "boolean") throw Error("invalid rank");
    if (!mine.ranked) return 0;
    if (!Number.isInteger(mine.score) || mine.score < 0 || mine.score > MAX_SCORE) throw Error("invalid score");
    return mine.score;
  }
  record(mode, delta) {
    if (this.state.status !== "ready" || !["online", "training"].includes(mode) || !Number.isSafeInteger(delta) || delta <= 0) return Promise.resolve(false);
    const identity = this._identity;
    return this._enqueue(async () => {
      if (this._identity !== identity) return false;
      try {
        return await this._accountLock(() => {
          this._own = this._readLocal();
          const next = { ...this._own, [mode]: this._own[mode] + delta };
          this._totals(next);
          this._own = next;
          let failure = "";
          try {
            this._persist();
          } catch (error) {
            failure = errorText("\u672C\u5730\u4FDD\u5B58", error);
          }
          this._showCounts({
            sync: failure ? "error" : this._writable ? "pending" : "readonly",
            message: failure || (this._writable ? this._warning : "\u5F53\u524D Toy \u73AF\u5883\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u4FDD\u5B58\u51FB\u6740\u6216\u63D0\u4EA4\u6392\u884C\u699C\u3002")
          });
          return true;
        });
      } catch (error) {
        this._change({ sync: "error", message: errorText("\u51FB\u6740\u7D2F\u8BA1", error) });
        return false;
      }
    });
  }
  flush() {
    if (this._flushRequest) return this._flushRequest;
    if (Date.now() < this._retryAfter) return Promise.resolve(this.state);
    if (this.state.status !== "ready") return Promise.resolve(this.state);
    const identity = this._identity;
    this._flushRequest = this._enqueue(async () => {
      if (this._identity !== identity) return this.state;
      if (!this._writable) {
        this._change({ sync: "readonly", message: "\u5F53\u524D Toy \u73AF\u5883\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u4FDD\u5B58\u51FB\u6740\u6216\u63D0\u4EA4\u6392\u884C\u699C\u3002" });
        return this.state;
      }
      let stage = "\u4E91\u6863\u8BFB\u53D6";
      try {
        await this._accountLock(async () => {
          this._own = this._readLocal();
          if (!this._pending()) return;
          this._change({ sync: "syncing", message: "\u6B63\u5728\u540C\u6B65\u6210\u957F\u4E91\u6863\u4E0E\u6218\u7EE9\u2026" });
          const data = await this._sdk.getCloudStorage();
          this._cloud = cloudComponents(data);
          this.progress.mergeCloud(data);
          this.progress.mergeLocal();
          const key = CLOUD_PREFIX + this._component;
          this._own = merge(this._own, this._cloud.get(key) ?? { online: 0, training: 0 });
          try {
            this._persist();
          } catch {
            this._warning = "\u672C\u5730\u4FDD\u5B58\u5931\u8D25\uFF0C\u672A\u540C\u6B65\u51FB\u6740\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\u3002";
          }
          const writes = this.progress.writes();
          if (!equal(this._own, this._cloud.get(key) ?? { online: 0, training: 0 })) writes[key] = JSON.stringify(this._own);
          if (Object.keys(writes).length) {
            stage = "\u4E91\u6863\u4FDD\u5B58";
            await this._sdk.setCloudStorage(writes);
            this._needsScore = this._scoreWritable;
            stage = "\u4E91\u6863\u6C47\u603B\u8BFB\u53D6";
            const confirmedData = await this._sdk.getCloudStorage();
            this._cloud = cloudComponents(confirmedData);
            this.progress.mergeCloud(confirmedData);
            if (this.progress.pending()) throw Error("growth write not confirmed");
            this.progress.persist();
            const confirmed = this._cloud.get(key);
            if (writes[key] && (!confirmed || confirmed.online < this._own.online || confirmed.training < this._own.training)) throw Error("cloud write not confirmed");
            if (confirmed) this._own = merge(this._own, confirmed);
          }
          const { online, training } = this._totals();
          const total = online + training;
          if (this._scoreWritable && (this._score === null || total > this._score)) {
            this._needsScore = true;
            stage = "\u4E2A\u4EBA\u699C\u4F4D\u8BFB\u53D6";
            this._score = Math.max(this._score ?? 0, this._rankScore(await this._sdk.getMyRank({ board: 1, period: "all" })));
          }
          if (this._scoreWritable && total > this._score) {
            stage = total > MAX_SCORE ? "\u6392\u884C\u699C\u63D0\u4EA4\uFF08\u7D2F\u8BA1\u51FB\u6740\u8D85\u51FA\u5E73\u53F0\u4E0A\u9650 16777215\uFF09" : "\u6392\u884C\u699C\u63D0\u4EA4";
            if (total > MAX_SCORE) throw Error("score exceeds platform range");
            await this._sdk.submitScore({ board: 1, score: total });
            this._score = total;
          }
          this._needsScore = false;
          this._rankCache = null;
          this._showCounts({ sync: "synced", message: this.progress.warning || this._warning || (!this._scoreWritable ? "\u6210\u957F\u4E91\u6863\u5DF2\u4FDD\u5B58\uFF1B\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u63D0\u4EA4\u6392\u884C\u699C\u3002" : "") });
        });
      } catch (error) {
        if (Number(error?.code ?? error?.errorCode) === 307044) this._retryAfter = Date.now() + 3e4;
        this._showCounts({ sync: "error", message: errorText(stage, error) });
      }
      return this.state;
    }).finally(() => {
      this._flushRequest = null;
    });
    return this._flushRequest;
  }
  ranks({ refresh = false } = {}) {
    if (!refresh && this._rankCache) return Promise.resolve(this._rankCache);
    if (this._rankRequest) return this._rankRequest;
    const identity = this._identity;
    const authorized = this.state.authenticated;
    this._rankRequest = (async () => {
      await this.prepare();
      try {
        if (!this._prepared) throw Error("SDK unavailable");
        const list = await this._sdk.getRankList({ board: 1, period: "all", limit: 20 });
        if (!Array.isArray(list) || !list.every((entry) => Number.isInteger(entry.rank) && entry.rank > 0 && Number.isInteger(entry.score) && typeof entry.nickname === "string" && typeof entry.avatar === "string")) throw Error("invalid rank list");
        const mine = authorized ? await this._sdk.getMyRank({ board: 1, period: "all" }) : null;
        if (mine) this._rankScore(mine);
        const result = { list, mine };
        if (identity !== this._identity || authorized !== this.state.authenticated) throw Error("identity changed");
        this._rankCache = result;
        return result;
      } catch (error) {
        this._change({ message: errorText("\u6392\u884C\u699C\u8BFB\u53D6", error) });
        throw Error(this.state.message);
      }
    })().finally(() => {
      this._rankRequest = null;
    });
    return this._rankRequest;
  }
}
export {
  DEFAULT_PLAYER_NAME,
  ToyAccount
};
