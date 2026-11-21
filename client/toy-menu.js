function installToyMenus({ account, engine, progression, access }) {
  const { ctx } = engine;
  const menus = ctx.hud.menus;
  let returnPage = "main", attempted = false, authorizing = false, rankBusy = false;
  const profile = document.createElement("div");
  profile.className = "toy-profile";
  profile.innerHTML = `<span data-toy-save-state role="status">\u672C\u5730\u8BD5\u73A9</span><button class="btn" data-nav data-act="toy-profile-action">\u540C\u6B65 B\u7AD9\u8EAB\u4EFD</button>`;
  const career = document.createElement("div");
  career.className = "toy-career";
  const main = menus.pages.main;
  main.append(career);
  career.append(main.querySelector("#pcard"), main.querySelector("#mastery"));
  for (const name of ["main", "pause"]) {
    if (!account.isToy) continue;
    const button = document.createElement("button");
    button.className = "nv";
    button.dataset.nav = "";
    button.dataset.act = "toy-ranks";
    button.innerHTML = "<b>\u51FB\u6740\u6392\u884C\u699C</b><em>Toy \xB7 \u8DE8\u5C40\u7D2F\u8BA1 \u203A</em>";
    menus.pages[name].querySelector(".vnav").append(button);
  }
  const page = menus._page("toy-ranks", `
    <header class="topbar"><button class="backb" data-nav data-act="toy-back">\u2039 <span>\u8FD4\u56DE</span></button><h2>\u7D2F\u8BA1\u51FB\u6740\u6392\u884C\u699C</h2></header>
    <div class="online-layout toy-rank-layout">
      <section class="online-commands">
        <div class="sech"><span>TOY \u5E72\u5458\u6863\u6848</span><span>\u4E2A\u4EBA\u4E91\u5B58\u6863</span></div>
        <h3 data-toy-name>\u533F\u540D\u5E72\u5458</h3>
        <p data-toy-summary>\u533F\u540D\u8BD5\u73A9 \xB7 \u4E0D\u8BA1\u5165\u6392\u884C\u699C</p>
        <div class="toy-kill-stats"><span>\u7D2F\u8BA1\u51FB\u6740<strong data-toy-total>0</strong></span><span>\u8054\u673A<strong data-toy-online>0</strong></span><span>\u5355\u4EBA\u8BAD\u7EC3<strong data-toy-training>0</strong></span></div>
        <p id="toy-account-status" role="status"></p>
        <button class="nv" data-nav data-act="toy-authorize"><b>\u540C\u6B65 B\u7AD9\u8EAB\u4EFD</b><em>\u81EA\u52A8\u4F7F\u7528 SDK \u6635\u79F0</em></button>
        <button class="nv" data-nav data-act="toy-sync"><b>\u540C\u6B65\u6210\u7EE9</b><em>\u4E91\u6863 \xB7 \u6392\u884C\u699C</em></button>
        <button class="nv" data-nav data-act="toy-import-progress" hidden><b>\u5BFC\u5165\u8FD9\u53F0\u8BBE\u5907\u7684\u65E7\u8FDB\u5EA6</b><em>\u5408\u5E76\u5230\u5F53\u524D B\u7AD9\u8D26\u53F7 \xB7 \u4E0D\u91CD\u590D\u7D2F\u52A0</em></button>
        <p>\u7B49\u7EA7\u3001\u603B\u7ECF\u9A8C\u3001\u573A\u6B21\u3001\u80DC\u573A\u3001\u51FB\u6740\u3001\u5404\u67AA\u7CBE\u901A\u548C\u67AA\u5320\u914D\u7F6E\u5171\u7528\u6210\u957F\u4E91\u6863\u3002\u65E7\u672C\u5730\u8FDB\u5EA6\u5C1A\u672A\u7ED1\u5B9A\u8D26\u53F7\uFF0C\u53EF\u5728\u8FD9\u91CC\u9009\u62E9\u5BFC\u5165\u3002</p>
        <p>\u533F\u540D\u8BD5\u73A9\u7684\u51FB\u6740\u4E0D\u8BA1\u699C\u3001\u4E0D\u56DE\u586B\u3002\u767B\u5F55\u540E\uFF0C\u5355\u4EBA\u4E0E\u8054\u673A\u5171\u4EAB\u7D2F\u8BA1\u51FB\u6740\u699C\uFF1B\u4E91\u6863\u4E0E\u699C\u5355\u53EA\u5728\u7ED3\u7B97\u3001\u79BB\u5F00\u6216\u9875\u9762\u9690\u85CF\u7B49\u8282\u70B9\u540C\u6B65\u3002</p>
      </section>
      <section class="online-squad">
        <div class="sech online-hall-heading"><span>\u603B\u699C \xB7 \u6309\u7D2F\u8BA1\u51FB\u6740\u6392\u5E8F</span><button class="btn" data-nav data-act="toy-refresh">\u5237\u65B0\u699C\u5355</button></div>
        <p id="toy-my-rank">\u6388\u6743\u540E\u53EF\u67E5\u770B\u81EA\u5DF1\u7684\u6392\u540D\u3002</p>
        <p id="toy-rank-status" role="status">\u8FDB\u5165\u65F6\u8BFB\u53D6\u4E00\u6B21\uFF0C\u4E4B\u540E\u53EF\u624B\u52A8\u5237\u65B0\u3002</p>
        <table class="toy-rank-table"><thead><tr><th scope="col">\u540D\u6B21</th><th scope="col">\u5E72\u5458</th><th scope="col">\u7D2F\u8BA1\u51FB\u6740</th></tr></thead><tbody id="toy-rank-list"></tbody></table>
      </section>
    </div>
    <footer class="legend"><span><kbd>\u2191</kbd><kbd>\u2193</kbd> \u5BFC\u822A</span><span><kbd>ENTER</kbd> \u9009\u62E9</span><span><kbd>ESC</kbd> \u8FD4\u56DE</span></footer>`);
  page.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (button) menus._act(button.dataset.act);
  });
  const setText = (selector, value) => {
    for (const element of menus.root.querySelectorAll(selector)) element.textContent = value;
  };
  function render() {
    const state = account.state;
    const name = account.playerName;
    engine.player.name = name;
    setText("[data-toy-name]", name);
    setText("[data-toy-summary]", state.authenticated ? `Toy \u8EAB\u4EFD \xB7 \u7D2F\u8BA1 ${state.total} \u51FB\u6740` : "\u533F\u540D\u8BD5\u73A9 \xB7 \u4E0D\u8BA1\u5165\u6392\u884C\u699C");
    for (const mode of ["total", "online", "training"]) setText(`[data-toy-${mode}]`, String(state[mode] || 0));
    setText("#toy-account-status", state.message || (state.authenticated ? "\u5DF2\u8BFB\u53D6 Toy \u8EAB\u4EFD\u3002" : "\u5F00\u59CB\u6E38\u73A9\u65F6\u5C1D\u8BD5\u8BFB\u53D6 Toy \u6635\u79F0\uFF1B\u4E0D\u6388\u6743\u4E5F\u53EF\u533F\u540D\u8BD5\u73A9\u3002"));
    for (const button2 of menus.root.querySelectorAll('[data-act="toy-authorize"]')) button2.disabled = authorizing || engine.active;
    for (const button2 of menus.root.querySelectorAll('[data-act="toy-sync"]')) button2.disabled = !state.authenticated || state.sync === "syncing";
    setText("#pcard .pc-k", (account.isToy ? "TOY \u5E72\u5458 \xB7 " : "\u5E72\u5458\u6863\u6848 \xB7 ") + name);
    const card = menus.pages.main.querySelector("#pcard");
    if (card && profile.parentNode !== card) card.append(profile);
    const labels = { loading: "\u6B63\u5728\u6062\u590D\u4E91\u6863\u2026", pending: "\u6210\u957F\u8FDB\u5EA6\u5F85\u540C\u6B65", synced: "\u6210\u957F\u4E91\u6863\u5DF2\u540C\u6B65", readonly: "\u5F53\u524D\u73AF\u5883\u53EA\u8BFB", error: "\u4E91\u6863\u540C\u6B65\u5931\u8D25" };
    setText("[data-toy-save-state]", state.authenticated ? state.sync === "error" ? "\u4E91\u6863\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" : labels[state.progressSync] || "\u6B63\u5728\u8BFB\u53D6\u6210\u957F\u4E91\u6863\u2026" : "\u672C\u5730\u8BD5\u73A9 \xB7 \u672A\u540C\u6B65\u4E91\u6863");
    const button = profile.querySelector("button");
    button.hidden = !account.isToy;
    button.textContent = state.authenticated ? "\u540C\u6B65\u4E91\u6863" : "\u540C\u6B65 B\u7AD9\u8EAB\u4EFD";
    button.disabled = authorizing || state.sync === "syncing" || engine.active;
    page.querySelector('[data-act="toy-import-progress"]').hidden = !state.authenticated || state.status !== "ready" || !progression?.hasLegacy;
  }
  async function authorize({ explicit = false } = {}) {
    if (!account.isToy) return account.state;
    if (engine.active || authorizing || !explicit && (attempted || account.state.authenticated)) return account.state;
    attempted = true;
    authorizing = true;
    render();
    try {
      await account.prepare();
      const result = await account.authorize();
      await access?.check();
      return result;
    } finally {
      authorizing = false;
      render();
    }
  }
  async function ranks(refresh = false) {
    if (rankBusy) return;
    rankBusy = true;
    const status = page.querySelector("#toy-rank-status");
    status.textContent = "\u6B63\u5728\u8BFB\u53D6 Toy \u6392\u884C\u699C\u2026";
    page.querySelector('[data-act="toy-refresh"]').disabled = true;
    try {
      const result = await account.ranks({ refresh });
      const body = page.querySelector("#toy-rank-list");
      body.replaceChildren();
      for (const item of result.list) {
        const row = document.createElement("tr");
        for (const value of [item.rank, item.nickname, item.score]) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        body.append(row);
      }
      status.textContent = result.list.length ? "\u524D 20 \u540D \xB7 \u7ED3\u7B97\u540C\u6B65\u540E\u53EF\u624B\u52A8\u5237\u65B0\u3002" : "\u6682\u65F6\u65E0\u4EBA\u4E0A\u699C\u3002\u6388\u6743\u5E76\u5B8C\u6210\u51FB\u6740\u540E\uFF0C\u7ED3\u7B97\u65F6\u4E0A\u4F20\u3002";
      page.querySelector("#toy-my-rank").textContent = result.mine ? result.mine.ranked ? `\u6211\u7684\u6392\u540D\uFF1A\u7B2C ${result.mine.rank} \u540D \xB7 ${result.mine.score} \u51FB\u6740` : "\u4F60\u5C1A\u672A\u4E0A\u699C\u3002" : "\u533F\u540D\u53EF\u67E5\u770B\u603B\u699C\uFF0C\u6388\u6743\u540E\u53EF\u67E5\u770B\u81EA\u5DF1\u7684\u6392\u540D\u3002";
    } catch (error) {
      status.textContent = error.message || "\u6392\u884C\u699C\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u624B\u52A8\u5237\u65B0\u3002";
    } finally {
      rankBusy = false;
      page.querySelector('[data-act="toy-refresh"]').disabled = false;
    }
  }
  const originalAct = menus._act;
  menus._act = function(action, direction) {
    if (action === "toy-profile-action") return void (account.state.status === "ready" ? account.flush() : authorize({ explicit: true }));
    if (action === "toy-import-progress") return void progression?.importLegacy().then(render);
    if (action === "toy-authorize") {
      this.cb.sound("click");
      void authorize({ explicit: true }).then(() => menus.page === "toy-ranks" && ranks(true));
      return;
    }
    if (action === "toy-ranks") {
      if (!account.isToy) return;
      this.cb.sound("click");
      returnPage = ["pause", "end"].includes(this.page) ? this.page : "main";
      this.go("toy-ranks");
      void ranks();
      return;
    }
    if (action === "toy-back") return this.go(returnPage);
    if (action === "toy-refresh") return void ranks(true);
    if (action === "toy-sync") return void account.flush().then(render);
    return originalAct.call(this, action, direction);
  };
  const originalBack = menus.back;
  menus.back = function() {
    if (this.page === "toy-ranks") return this.go(returnPage);
    return originalBack.call(this);
  };
  const originalRefresh = menus._refreshMain;
  menus._refreshMain = function(...args) {
    const result = originalRefresh.apply(this, args);
    render();
    return result;
  };
  account.addEventListener("change", render);
  void account.prepare().then(render);
  render();
  return { authorize, render };
}
export {
  installToyMenus
};
