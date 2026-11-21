const WEAPON_CAMPAIGN = Object.freeze({
  bvid: "BV1drWB6wEyr",
  aid: 117609609626997,
  author: "49800433",
  title: "B\u7AD9\u70B9\u5F00\u5C31\u80FD\u73A9\uFF0C\u968F\u65F6\u968F\u5730 COD\uFF0C\u4F7F\u547D\u5728\u53EC\u5524\uFF015V5\u5C04\u51FB\u5B9E\u673A"
});
const INITIAL = /* @__PURE__ */ new Set(["ar", "pistol"]);
class ToyWeaponAccess extends EventTarget {
  constructor(account, campaign = WEAPON_CAMPAIGN) {
    super();
    this.account = account;
    this.campaign = campaign;
    this.generation = 0;
    this.state = Object.freeze({ status: "idle", unlocked: false, message: "\u5173\u6CE8\u4F5C\u8005\u5E76\u4E3A\u5BA3\u4F20\u89C6\u9891\u70B9\u8D5E\u3001\u6295\u5E01\u3001\u6536\u85CF\uFF0C\u53EF\u89E3\u9501 VESPER 9 \u4E0E M12\u3002" });
    let previous = account.state.status;
    account.addEventListener("change", () => {
      const status = account.state.status;
      if (status === "authorizing" && previous !== status) {
        this.generation++;
        this.request = null;
        this.change({ status: "idle", unlocked: false, following: false, liked: false, coined: false, favorited: false, author: false, message: "\u6B63\u5728\u5207\u6362 Toy \u8EAB\u4EFD\u2026" });
      }
      previous = status;
      if (status === "ready" && this.state.status === "idle") void this.check();
    });
  }
  change(patch) {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.dispatchEvent(new Event("change"));
  }
  canUse(weapon) {
    return INITIAL.has(weapon) || ["smg", "shotgun"].includes(weapon) && this.state.unlocked;
  }
  check({ refresh = false } = {}) {
    if (this.request) return this.request;
    if (!refresh && !["idle", "login"].includes(this.state.status)) return Promise.resolve(this.state);
    if (!this.account.state.authenticated || !this.account.sdk) {
      this.change({ status: "login", unlocked: false, message: "\u8BF7\u5148\u5728\u6B63\u5F0F B\u7AD9 Toy \u9875\u9762\u540C\u6B65 B\u7AD9\u8EAB\u4EFD\uFF0C\u518D\u6821\u9A8C\u89E3\u9501\u6761\u4EF6\u3002\u521D\u59CB\u4E24\u628A\u67AA\u53EF\u76F4\u63A5\u4F7F\u7528\u3002" });
      return Promise.resolve(this.state);
    }
    const token = this.generation, sdk = this.account.sdk;
    this.change({ status: "checking", message: "\u6B63\u5728\u901A\u8FC7 Toy \u6821\u9A8C\u5173\u6CE8\u4E0E\u89C6\u9891\u4E09\u8FDE\u72B6\u6001\u2026" });
    const operation = (async () => {
      try {
        const supported = await Promise.all([sdk.isSupport("getAuthorRelation"), sdk.isSupport("getVideoUserActions")]);
        if (supported.some((value) => value !== true)) throw Error("unsupported");
        const [relation, videos] = await Promise.all([
          sdk.getAuthorRelation(),
          sdk.getVideoUserActions({ videos: [{ bvid: this.campaign.bvid }] })
        ]);
        if (token !== this.generation) return this.state;
        if (relation?.status !== "ok" || typeof relation.data?.isFollowing !== "boolean") throw Error(relation?.status || "unavailable");
        const author = relation.data.isAuthor === true;
        const item = videos?.items?.find((item2) => item2.bvid === this.campaign.bvid && item2.aid === this.campaign.aid);
        if (!author && (!["ok", "partial"].includes(videos?.status) || item?.status !== "ok" || typeof item.liked !== "boolean" || !Number.isInteger(item.coinCount) || item.coinCount < 0 || typeof item.favorited !== "boolean")) throw Error(videos?.status || "unavailable");
        const following = relation.data.isFollowing, liked = item?.liked === true, coined = item?.coinCount > 0, favorited = item?.favorited === true;
        const unlocked = author || following && liked && coined && favorited;
        this.change({
          status: unlocked ? "unlocked" : "locked",
          unlocked,
          following,
          liked,
          coined,
          favorited,
          author,
          message: author ? "Toy \u5DF2\u6838\u9A8C\u4F5C\u8005\u672C\u4EBA\uFF0C\u53EF\u6D4B\u8BD5\u5168\u90E8\u6B66\u5668\u3002" : unlocked ? "\u5173\u6CE8\u4E0E\u89C6\u9891\u4E09\u8FDE\u5DF2\u6838\u9A8C\uFF0CVESPER 9 \u548C M12 \u5DF2\u89E3\u9501\u3002" : "\u5B8C\u6210\u4E0B\u65B9\u6761\u4EF6\u540E\uFF0C\u8FD4\u56DE\u70B9\u51FB\u300C\u91CD\u65B0\u6821\u9A8C\u300D\u3002\u4EC5\u6253\u5F00\u9875\u9762\u4E0D\u4F1A\u89E3\u9501\u3002"
        });
      } catch (error) {
        if (token !== this.generation) return this.state;
        const status = String(error?.message || error?.type || "");
        this.change({ status: "unavailable", unlocked: false, message: status.includes("unsupported") ? "\u5F53\u524D\u5BB9\u5668\u4E0D\u652F\u6301\u4E92\u52A8\u72B6\u6001\u6821\u9A8C\uFF0C\u8BF7\u5728 B\u7AD9 App \u6216\u684C\u9762\u6B63\u5F0F Toy \u9875\u9762\u91CD\u8BD5\u3002\u521D\u59CB\u4E24\u628A\u67AA\u4ECD\u53EF\u4F7F\u7528\u3002" : "\u6682\u65F6\u65E0\u6CD5\u6838\u9A8C\u4E92\u52A8\u72B6\u6001\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u5E76\u7A0D\u540E\u624B\u52A8\u91CD\u8BD5\u3002\u521D\u59CB\u4E24\u628A\u67AA\u4ECD\u53EF\u4F7F\u7528\u3002" });
      }
      return this.state;
    })();
    this.request = operation;
    operation.finally(() => {
      if (this.request === operation) this.request = null;
    });
    return operation;
  }
  navigate(type) {
    const sdk = this.account.sdk;
    if (!sdk?.navigate) {
      this.change({ message: "\u8BF7\u5728 B\u7AD9 Toy \u9875\u9762\u6253\u5F00\u4F5C\u8005\u6216\u89C6\u9891\u3002" });
      return Promise.resolve(false);
    }
    let promise;
    try {
      promise = sdk.navigate({ type: type === "author" ? "space" : "video", id: type === "author" ? this.campaign.author : this.campaign.bvid });
    } catch (error) {
      promise = Promise.reject(error);
    }
    return Promise.resolve(promise).then(() => true, () => {
      this.change({ message: "\u9875\u9762\u6253\u5F00\u5931\u8D25\uFF0C\u8BF7\u5728 B\u7AD9 App \u5185\u91CD\u8BD5\u3002" });
      return false;
    });
  }
}
function installWeaponGate({ access, engine, progression, authorize }) {
  const { menus } = engine.ctx.hud;
  let returnPage = "gunsmith";
  const page = menus._page("toy-unlock", `
    <header class="topbar"><button class="backb" data-nav data-act="unlock-back">\u2039 <span>\u8FD4\u56DE</span></button><h2>\u6B66\u5668\u89E3\u9501</h2><span class="online-mode">KR-7 \xB7 STRIX 9 \u521D\u59CB\u53EF\u7528</span></header>
    <div class="online-layout toy-unlock-layout">
      <section class="online-commands">
        <div class="sech"><span>\u6269\u5C55\u519B\u68B0</span><span>VESPER 9 / M12</span></div>
        <h3>\u5173\u6CE8\u4F5C\u8005 \uFF0B \u89C6\u9891\u4E09\u8FDE</h3>
        <p>\u5173\u6CE8\u672C\u4F5C\u54C1\u4F5C\u8005\uFF0C\u5E76\u4E3A\u300A\u968F\u65F6\u968F\u5730 COD\u300B\u5BA3\u4F20\u89C6\u9891\u70B9\u8D5E\u3001\u6295\u5E01\u3001\u6536\u85CF\uFF0C\u5373\u53EF\u4F7F\u7528\u53E6\u5916\u4E24\u628A\u4E3B\u6B66\u5668\u3002</p>
        <p data-unlock-status role="status"></p>
        <button class="nv" data-nav data-act="unlock-author"><b>\u53BB\u5173\u6CE8\u4F5C\u8005</b><em>B\u7AD9\u4E3B\u9875 \u203A</em></button>
        <button class="nv" data-nav data-act="unlock-video"><b>\u6253\u5F00\u5BA3\u4F20\u89C6\u9891</b><em>\u70B9\u8D5E \xB7 \u6295\u5E01 \xB7 \u6536\u85CF \u203A</em></button>
        <button class="nv primary" data-nav data-act="unlock-check"><b>\u91CD\u65B0\u6821\u9A8C</b><em>\u5B8C\u6210\u540E\u8FD4\u56DE\u70B9\u51FB \u203A</em></button>
        <button class="btn" data-nav data-act="unlock-login">\u540C\u6B65 B\u7AD9\u8EAB\u4EFD</button>
      </section>
      <section class="online-squad">
        <div class="sech"><span>\u89E3\u9501\u6761\u4EF6</span><span>TOY \u5B98\u65B9\u6821\u9A8C</span></div>
        <div class="toy-unlock-checks" data-unlock-checks></div>
        <p>\u4E0D\u66FF\u4F60\u81EA\u52A8\u5173\u6CE8\u3001\u70B9\u8D5E\u6216\u6295\u5E01\uFF1B\u8BF7\u5728 B\u7AD9\u9875\u9762\u4EB2\u81EA\u5B8C\u6210\u3002\u89E3\u9501\u9002\u7528\u4E8E\u5F53\u524D B\u7AD9\u8D26\u53F7\uFF0C\u672C\u6B21\u6821\u9A8C\u7ED3\u679C\u4E0D\u4F1A\u4ECE\u5176\u4ED6\u8D26\u53F7\u7EE7\u627F\u3002</p>
      </section>
    </div>`);
  page.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (button && !button.disabled) menus._act(button.dataset.act);
  });
  const render = () => {
    const state = access.state;
    page.querySelector("[data-unlock-status]").textContent = state.message;
    const list = page.querySelector("[data-unlock-checks]");
    list.replaceChildren();
    for (const [key, text] of [["following", "\u5DF2\u5173\u6CE8\u4F5C\u8005"], ["liked", "\u5BA3\u4F20\u89C6\u9891\u5DF2\u70B9\u8D5E"], ["coined", "\u5BA3\u4F20\u89C6\u9891\u5DF2\u6295\u5E01"], ["favorited", "\u5BA3\u4F20\u89C6\u9891\u5DF2\u6536\u85CF"]]) {
      const row = document.createElement("p");
      row.textContent = `${state[key] ? "\u2713" : "\u25CB"} ${text}`;
      row.className = state[key] ? "complete" : "";
      list.append(row);
    }
    page.querySelector('[data-act="unlock-check"]').disabled = state.status === "checking";
    if (menus.page === "gunsmith") menus._gsRender(false);
  };
  function open() {
    returnPage = menus.page === "gunsmith" ? "gunsmith" : "main";
    menus.go("toy-unlock");
    render();
    void access.check();
  }
  const act = menus._act;
  menus._act = function(action, direction) {
    if (action === "unlock-back") return this.go(returnPage);
    if (action === "unlock-author") return void access.navigate("author");
    if (action === "unlock-video") return void access.navigate("video");
    if (action === "unlock-check") return void access.check({ refresh: true });
    if (action === "unlock-login") return void authorize({ explicit: true }).then(() => access.check({ refresh: true }));
    return act.call(this, action, direction);
  };
  const back = menus.back;
  menus.back = function() {
    return this.page === "toy-unlock" ? this.go(returnPage) : back.call(this);
  };
  const equip = menus._gsEquip;
  menus._gsEquip = function(...args) {
    if (!access.canUse(this.gs.w)) return open();
    return equip.apply(this, args);
  };
  const renderGun = menus._gsRender;
  menus._gsRender = function(...args) {
    const result = renderGun.apply(this, args);
    if (!access.canUse(this.gs.w)) {
      const button = this.pages.gunsmith.querySelector("#gs-equip");
      button.disabled = false;
      button.textContent = "\u5173\u6CE8 \uFF0B \u4E09\u8FDE\u89E3\u9501";
    }
    return result;
  };
  const arsenal = engine.ctx.arsenal, reset = arsenal.reset;
  arsenal.reset = function(primary, ...args) {
    if (!access.canUse(primary)) {
      primary = "ar";
      engine.ctx.settings.primary = "ar";
    }
    return reset.call(this, primary, ...args);
  };
  progression.setWeaponPolicy((weapon) => access.canUse(weapon));
  access.addEventListener("change", () => {
    progression.refresh();
    render();
  });
  if (!access.canUse(engine.ctx.settings.primary)) engine.ctx.settings.primary = "ar";
  if (menus.page === "main") menus._refreshMain();
  render();
  return { open };
}
export {
  ToyWeaponAccess,
  WEAPON_CAMPAIGN,
  installWeaponGate
};
