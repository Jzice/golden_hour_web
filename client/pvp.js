import { Connection } from "./net.js";
import { Engine } from "./engine.js";
import { loadApiConfig } from "./api-config.js";
import { RoomDirectory, joinHello, rememberRoom, forgetRoom } from "./lobby.js";
import { World } from "./simulation.js";
import { Room } from "../host/room.js";
import { createPeer, parseRoomCode, roomPeerId, signalingOptions } from "./peer.js";
import { installVoice } from "./voice.js";
import { installEmotes } from "./emote.js";
import { renderQrCode } from "./qr.js";
import { ToyAccount } from "./toy-account.js";
import { OnlineKills } from "./online-kills.js";
import { MatchReportGate } from "./online-results.js";
import { installToyMenus } from "./toy-menu.js";
import { installTrainingKills } from "./training-kills.js";
import { installTouchSettings } from "./touch-settings.js";
import { installInputSettings } from "./input-settings.js";
import { installNativeProgress } from "./native-progress.js";
import { ToyWeaponAccess, installWeaponGate } from "./toy-weapons.js";
const net = new Connection();
const engine = new Engine(net);
const account = new ToyAccount();
const onlineKills = new OnlineKills(account);
const reportGate = new MatchReportGate();
const emotes = installEmotes({ send: (message) => net.send(message) });
const query = new URLSearchParams(location.search);
const p2pEnabled = document.documentElement.dataset.peer === "1" || query.has("room") || query.has("peer");
const multiplayerEnabled = p2pEnabled || document.documentElement.dataset.apiOrigin !== "";
let roomRef = null;
let peerRef = null;
let peerOwned = false;
let voice = null;
let lastInvite = "";
let lastRosterAt = 0;
let joinGeneration = 0;
let room = null, busy = false, returnPage = null;
await engine.ready();
const { ctx } = engine;
engine.debug.network = net.metrics;
const menus = ctx.hud.menus;
installTouchSettings({ menus, controls: globalThis.GHTouch });
installInputSettings({ menus, devices: globalThis.GHInput, controls: globalThis.GHTouch });
const $ = (id) => document.getElementById(id);
const visible = (id, value) => {
  $(id).hidden = !value;
};
const label = (id, value) => {
  $(id).textContent = value;
};
const inMatch = () => room && ["live", "countdown"].includes(room.phase);
const current = () => room?.players.find((p) => p.id === net.id);
const difficultyLabel = (value) => ({ recruit: "\u65B0\u5175", regular: "\u666E\u901A", hardened: "\u5F3A\u5316", veteran: "\u8001\u5175" })[value] || "\u666E\u901A";
const deploy = menus.pages.main.querySelector('[data-act="deploy"]');
deploy.dataset.act = "online";
deploy.querySelector("b").textContent = "\u8054\u673A\u5BF9\u6218";
const training = document.createElement("button");
training.className = "nv";
training.dataset.nav = "";
training.dataset.act = "deploy";
training.innerHTML = "<b>\u5355\u4EBA\u8BAD\u7EC3</b><em>\u79BB\u7EBF \xB7 \u4EBA\u673A\u4F5C\u6218</em>";
deploy.after(training);
if (!multiplayerEnabled) {
  training.classList.add("primary");
  deploy.remove();
}
const page = menus._page(
  "online",
  `
  <header class="topbar"><button class="backb" data-nav data-act="online-back">\u2039 <span>\u8FD4\u56DE</span></button><h2>\u8054\u673A\u4F5C\u6218</h2><span class="online-mode">\u66AE\u8272\u9152\u5E97 \xB7 \u56E2\u961F\u6B7B\u6597 \xB7 \u5148\u5230 40 \u5206</span></header>
  <div class="online-layout">
    <div class="online-commands">
      <div class="sech"><span id="online-section">\u516C\u5171\u623F\u95F4\u5927\u5385</span><span id="online-members">5 \u5BF9 5</span></div>
      <div id="online-connect">
        <div class="row online-field"><span>\u5E72\u5458\u547C\u53F7</span><strong id="online-name" data-toy-name>\u533F\u540D\u5E72\u5458</strong></div>
        <button class="nv primary" id="online-quick" data-nav data-act="online-quick"><b>\u5FEB\u901F\u52A0\u5165</b><em>\u7ACB\u5373\u8FDB\u5165\u6218\u573A \u203A</em></button>
        <p class="online-connect-hint">\u4F18\u5148\u52A0\u5165\u6B63\u5728\u8FDB\u884C\u7684\u516C\u5F00\u5BF9\u5C40\uFF1B\u6CA1\u6709\u7A7A\u4F4D\u65F6\u81EA\u52A8\u521B\u5EFA\uFF0C\u8865\u9F50\u4EBA\u673A\u540E\u7ACB\u5373\u5F00\u6218\u3002</p>
        <button class="nv" id="online-create" data-nav data-act="online-create"><b>\u521B\u5EFA\u623F\u95F4</b><em>\u516C\u5F00\u5927\u5385 \xB7 \u81EA\u52A8\u5F00\u6218 \u203A</em></button>
        <div class="row online-field online-code">
          <span>\u623F\u95F4\u7801</span>
          <input id="online-code" type="text" inputmode="latin" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="8 \u4F4D\u623F\u95F4\u7801" />
          <button class="btn" id="online-join" data-nav data-act="online-join">\u52A0\u5165</button>
        </div>
      </div>
      <div id="online-room" hidden>
        <div class="online-share">
          <div class="online-share-main">
            <span class="online-share-label">\u623F\u95F4\u7801</span>
            <b id="online-room-code" class="online-share-code">--------</b>
            <button class="btn" id="online-copy-code" data-nav data-act="online-copy-code">\u590D\u5236\u623F\u95F4\u7801</button>
            <button class="btn" id="online-copy-link" data-nav data-act="online-copy-link">\u590D\u5236\u9080\u8BF7\u94FE\u63A5</button>
          </div>
          <div class="online-share-qr" id="online-qr"></div>
        </div>
        <div class="online-tools">
          <button class="btn" id="online-voice" data-nav data-act="online-voice">\u8BED\u97F3\uFF1A\u5173</button>
          <div id="online-emotes" class="online-emotes"></div>
        </div>
        <button class="nv primary" id="online-next" data-nav data-act="online-next" hidden><b>\u518D\u6765\u4E00\u5C40</b><em>\u5F53\u524D\u623F\u95F4\u7ACB\u5373\u5F00\u6218 \u203A</em></button>
        <button class="nv" id="online-resume" data-nav data-act="online-resume" hidden><b>\u8FD4\u56DE\u6218\u573A</b><em>\u203A</em></button>
      </div>
      <button class="nv" data-nav data-act="online-gunsmith"><b>\u67AA\u5320</b><em id="online-loadout">\u4F7F\u7528\u5F53\u524D\u88C5\u5907 \u203A</em></button>
      <button class="nv" id="online-leave" data-nav data-act="online-leave" hidden><b>\u9000\u51FA\u623F\u95F4</b><em>\u8FD4\u56DE\u4E3B\u83DC\u5355</em></button>
      <p id="online-status" role="status">\u5FEB\u901F\u52A0\u5165\u6216\u5728\u5927\u5385\u9009\u62E9\u623F\u95F4\uFF0C\u7A7A\u4F4D\u81EA\u52A8\u8865\u9F50\u4EBA\u673A\u3002</p>
      <p id="online-error" role="alert" hidden></p>
      <p id="online-trust" hidden>\u8DE8\u7AD9\u8FDE\u63A5\u672A\u5B8C\u6210\uFF0C\u53EF\u80FD\u4E0E\u7F51\u7EDC\u3001\u670D\u52A1\u5668\u3001\u8DE8\u57DF\u8BBE\u7F6E\u6216\u8BC1\u4E66\u4FE1\u4EFB\u6709\u5173\uFF1B\u8FD9\u4E0D\u4EE3\u8868\u5DF2\u786E\u8BA4\u662F\u8BC1\u4E66\u9519\u8BEF\u3002<a id="online-trust-link" target="_blank" rel="noopener noreferrer" data-nav>\u6253\u5F00\u670D\u52A1\u5668\u9875\u9762 / \u4FE1\u4EFB\u8BC1\u4E66 \u2197</a>\u3002\u5982\u6D4F\u89C8\u5668\u663E\u793A\u8BC1\u4E66\u63D0\u793A\uFF0C\u8BF7\u6838\u5BF9\u670D\u52A1\u5668\u5730\u5740\u5E76\u624B\u52A8\u786E\u8BA4\uFF0C\u7136\u540E\u56DE\u5230\u6E38\u620F\u518D\u6B21\u70B9\u51FB\u521B\u5EFA\u6216\u52A0\u5165\u3002\u6362\u8BC1\u540E\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u786E\u8BA4\uFF1B\u6E38\u620F\u65E0\u6CD5\u7ED5\u8FC7\u6D4F\u89C8\u5668\u8BC1\u4E66\u6821\u9A8C\u3002</p>
    </div>
    <div class="online-squad">
      <div id="online-hall">
        <div class="kicker">PUBLIC ROOMS \xB7 \u516C\u5F00\u6218\u573A</div>
        <div class="sech online-hall-heading"><span>\u5B9E\u65F6\u623F\u95F4\u5217\u8868</span><button class="btn" id="online-refresh" data-nav data-act="online-refresh">\u5237\u65B0\u8FDE\u63A5</button></div>
        <p id="online-directory-status" role="status">\u6B63\u5728\u83B7\u53D6\u516C\u5F00\u623F\u95F4\u2026</p>
        <p id="online-directory-trust" hidden>\u5217\u8868\u4E0D\u53EF\u7528\u4E0D\u4EE3\u8868\u5DF2\u786E\u8BA4\u662F\u8BC1\u4E66\u9519\u8BEF\u3002<a id="online-directory-trust-link" target="_blank" rel="noopener noreferrer" data-nav>\u6253\u5F00\u670D\u52A1\u5668\u9875\u9762 / \u68C0\u67E5\u8BC1\u4E66 \u2197</a>\u3002\u5982\u6D4F\u89C8\u5668\u63D0\u793A\u8BC1\u4E66\u95EE\u9898\uFF0C\u8BF7\u6838\u5BF9\u5730\u5740\u5E76\u624B\u52A8\u786E\u8BA4\uFF0C\u518D\u5237\u65B0\u8FDE\u63A5\u3002\u4F60\u53EF\u4EE5\u5237\u65B0\u8FDE\u63A5\u6216\u5C1D\u8BD5\u5FEB\u901F\u52A0\u5165\u3002</p>
        <div id="online-list" class="online-room-list" aria-label="\u516C\u5F00\u623F\u95F4"></div>
        <div id="online-recent" class="online-recent" hidden>
          <div class="kicker">LOCAL HISTORY \xB7 \u672C\u5730\u8BB0\u5F55\uFF08\u975E\u5728\u7EBF\u623F\u95F4\uFF09</div>
          <p class="online-recent-hint">\u4EE5\u4E0B\u662F\u672C\u673A\u6700\u8FD1\u52A0\u5165\u8FC7\u7684\u623F\u95F4\uFF0C\u4E0D\u662F\u670D\u52A1\u5668\u4E0A\u7684\u516C\u5F00\u5BF9\u5C40\u3002\u7070\u663E\u8868\u793A\u5F53\u524D\u65E0\u6CD5\u8FDE\u63A5\uFF0C\u53EF\u80FD\u5DF2\u5931\u6548\u3002</p>
          <div id="online-recent-list" class="online-room-list" aria-label="\u6700\u8FD1\u52A0\u5165\u7684\u623F\u95F4"></div>
        </div>
        <p class="online-fill">5 \u5BF9 5 \xB7 \u5148\u5230 40 \u5206 \xB7 \u771F\u4EBA\u52A0\u5165\u63A5\u66FF\u4EBA\u673A\u3002\u5927\u5385\u9009\u623F\uFF0C\u52A0\u5165\u5373\u53EF\u5F00\u6218\u3002\u53EF\u524D\u5F80\u67AA\u5320\u914D\u7F6E\u6B66\u5668\u3002</p>
      </div>
      <div id="online-roster" hidden><div class="sech"><span id="online-phase">\u7F16\u961F\u51C6\u5907</span><span>\u771F\u4EBA\u4F18\u5148 \xB7 \u81EA\u52A8\u8865\u4F4D</span></div><h3 id="online-result" hidden></h3><div class="tbl" id="online-teams"></div><div class="online-team-actions"><button class="btn" id="online-team-a" data-nav data-act="online-team-a">\u52A0\u5165\u5148\u950B</button><button class="btn" id="online-team-b" data-nav data-act="online-team-b">\u52A0\u5165\u4F59\u70EC</button></div><p class="online-fill">\u4EBA\u673A\u81EA\u52A8\u5C31\u7EEA \xB7 \u771F\u4EBA\u52A0\u5165\u65F6\u66FF\u6362\u4EBA\u673A \xB7 \u65AD\u7EBF\u540E\u7531\u4EBA\u673A\u6682\u65F6\u4EE3\u6253</p></div>
    </div>
  </div>
  <footer class="legend"><span><kbd>\u2191</kbd><kbd>\u2193</kbd> \u5BFC\u822A</span><span><kbd>ENTER</kbd> \u9009\u62E9</span><span><kbd>ESC</kbd> \u8FD4\u56DE</span></footer>`
);
const directory = new RoomDirectory({ onChange: renderDirectory });
function syncDirectory() {
  directory.setActive(multiplayerEnabled && menus.page === "online" && !menus.root.classList.contains("hidden") && !room && !busy && !document.hidden);
}
document.addEventListener("visibilitychange", syncDirectory);
page.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-act]");
  if (button) menus._act(button.dataset.act);
});
const originalGo = menus.go;
menus.go = function(name, force) {
  if (!multiplayerEnabled && name === "online") return;
  originalGo.call(this, name, force);
  if (name === "online") {
    this.root.dataset.bg = room ? "dim" : "menu";
    const first = page.querySelector("[data-nav]:not([hidden]):not(:disabled)");
    first?.focus({ preventScroll: true });
    updateLoadout();
  }
  syncDirectory();
};
const originalHide = menus._hide;
menus._hide = function(...args) {
  originalHide.apply(this, args);
  syncDirectory();
};
const originalBack = menus.back;
menus.back = function() {
  if (this.page === "gunsmith" && this.gs.mode === "camo")
    return originalBack.call(this);
  if (returnPage && ["gunsmith", "settings"].includes(this.page)) {
    const target = returnPage;
    returnPage = null;
    this.go(target);
    updateLoadout();
    return;
  }
  if (this.page === "online") {
    if (busy) {
      void leave();
      return;
    }
    this.go(inMatch() ? "pause" : "main");
    return;
  }
  return originalBack.call(this);
};
const originalAct = menus._act;
menus._act = function(action, direction) {
  if (!multiplayerEnabled && (action === "online" || action?.startsWith("online-"))) return;
  if (action?.startsWith("online-recent-forget:")) {
    this.cb.sound("click");
    forgetRoom(action.slice("online-recent-forget:".length));
    directory.retry();
    return;
  }
  if (action?.startsWith("online-room:")) {
    this.cb.sound("click");
    join("listed", action.slice("online-room:".length));
    return;
  }
  if (actions[action]) {
    this.cb.sound("click");
    actions[action]();
    return;
  }
  return originalAct.call(this, action, direction);
};
const originalResume = menus.cb.onResume, originalQuit = menus.cb.onQuit, originalAgain = menus.cb.onAgain;
menus.cb.onResume = () => engine.active ? resume() : originalResume();
menus.cb.onQuit = () => engine.active ? leave() : originalQuit();
menus.cb.onAgain = () => {
  if (engine.active) {
    if (room && !inMatch()) void command({ type: "ready", ready: true });
    return;
  }
  originalAgain();
};
const roomButton = document.createElement("button");
roomButton.className = "nv";
roomButton.dataset.nav = "";
roomButton.dataset.act = "online";
roomButton.innerHTML = "<b>\u67E5\u770B\u623F\u95F4</b><em>\u7F16\u961F \xB7 \u5F53\u524D\u5BF9\u5C40</em>";
roomButton.hidden = true;
menus.pages.pause.querySelector(".vnav").append(roomButton);
const dragButton = roomButton.cloneNode(true);
dragButton.dataset.act = "online-drag";
dragButton.innerHTML = "<b>\u62D6\u52A8\u7784\u51C6</b><em>\u5F53\u524D\u7A97\u53E3\u7684\u5907\u7528\u64CD\u4F5C</em>";
menus.pages.pause.querySelector(".vnav").append(dragButton);
const progression = installNativeProgress({ gh: engine.gh, account });
const access = new ToyWeaponAccess(account);
onlineKills.progression = progression;
const toyMenus = installToyMenus({ account, engine, progression, access });
installWeaponGate({ access, engine, progression, authorize: toyMenus.authorize });
const trainingKills = installTrainingKills({ gh: engine.gh, account, isOnline: () => engine.active });
function saveKills() {
  trainingKills.sample();
  void account.flush();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveKills();
});
addEventListener("pagehide", saveKills);
function updateLoadout() {
  const names = {
    ar: "KR-7 CARBINE",
    smg: "VESPER 9",
    shotgun: "M12 BREACHER"
  };
  label("online-loadout", (names[ctx.settings.primary] || names.ar) + " \u203A");
  if (engine.active && engine.primary !== ctx.settings.primary) {
    engine.primary = ctx.settings.primary;
    if (!inMatch()) {
      ctx.arsenal.reset(engine.primary);
      engine.applySpecs();
    }
    if (!inMatch()) command({ type: "equip", weapon: engine.primary });
  }
}
function openRoom() {
  if (engine.active) {
    engine.stopInput();
    engine.dragActive = false;
    engine.input.unlock();
    engine.input.keys.clear();
    engine.gh.G.state = inMatch() ? "paused" : "menu";
  }
  ctx.hud.show(inMatch() ? "pause" : "menu");
  menus.go("online");
  renderRoom();
}
function resume(drag = false) {
  if (!inMatch()) return openRoom();
  engine.lastUpdateAt = null;
  engine.gh.G.state = "playing";
  ctx.hud.show(null);
  if (drag) engine.enableDrag();
  else {
    engine.dragMode = false;
    engine.dragActive = false;
    engine.releaseDrag();
    engine.lock();
  }
}
function status(value) {
  label("online-status", value + (net.writer && net.metrics.transport ? ` \xB7 ${net.metrics.transport === "webrtc" ? "WebRTC" : "WebTransport"}` : ""));
}
function error(value) {
  label("online-error", value);
  visible("online-error", true);
}
async function command(value) {
  try {
    await net.send(value);
  } catch (e) {
    error(e.message);
  }
}
function setJoinBusy() {
  for (const id of ["online-quick", "online-create", "online-refresh"])
    $(id).disabled = busy;
  for (const id of ["online-list", "online-recent-list"])
    for (const button of $(id).querySelectorAll("button"))
      button.disabled = busy || button.dataset.joinable !== "true";
}
const PHASE_TEXT = { lobby: "\u5373\u5C06\u5F00\u6218", countdown: "\u5F00\u6218\u5012\u8BA1\u65F6", live: "\u5BF9\u5C40\u8FDB\u884C\u4E2D", over: "\u7B49\u5F85\u518D\u6218" };
const RECENT_STATUS_TEXT = {
  pending: "\u6B63\u5728\u6821\u9A8C\u8FDE\u63A5\u2026",
  online: "\u53EF\u91CD\u65B0\u8FDE\u63A5",
  stale: "\u65E0\u6CD5\u8FDE\u63A5 \xB7 \u53EF\u80FD\u5DF2\u5931\u6548"
};
function roomEntry(summary) {
  const entry = document.createElement("section");
  entry.className = "online-room-entry" + (summary.recent ? " online-room-recent" : "");
  if (summary.recent && summary.status === "stale") entry.classList.add("is-stale");
  const info = document.createElement("div");
  const host = document.createElement("b");
  host.textContent = summary.hostName + " \u7684\u623F\u95F4";
  const details = document.createElement("span");
  if (summary.recent) {
    details.textContent = `\u672C\u5730\u8BB0\u5F55 \xB7 ${RECENT_STATUS_TEXT[summary.status] || RECENT_STATUS_TEXT.pending}`;
  } else {
    details.textContent = `${PHASE_TEXT[summary.phase] || "\u5373\u5C06\u5F00\u6218"} \xB7 ${difficultyLabel(summary.difficulty)}\u4EBA\u673A \xB7 ${summary.humans} \u771F\u4EBA / ${summary.bots} \u4EBA\u673A \xB7 ${summary.humans}/${summary.capacity} \u5E2D`;
  }
  info.append(host, details);
  const actions2 = document.createElement("div");
  actions2.className = "online-room-actions";
  const joinable = summary.recent ? summary.status !== "stale" : summary.joinable;
  const button = document.createElement("button");
  button.className = "btn";
  button.dataset.nav = "";
  button.dataset.act = "online-room:" + summary.room;
  button.dataset.joinable = String(!!joinable);
  button.disabled = busy || !joinable;
  button.textContent = summary.recent ? "\u91CD\u65B0\u52A0\u5165 \u203A" : summary.joinable ? "\u52A0\u5165\u6218\u573A \u203A" : "\u771F\u4EBA\u5DF2\u6EE1";
  actions2.append(button);
  if (summary.recent) {
    const forget = document.createElement("button");
    forget.className = "btn online-room-forget";
    forget.dataset.nav = "";
    forget.dataset.act = "online-recent-forget:" + summary.room;
    forget.dataset.joinable = "true";
    forget.setAttribute("aria-label", "\u5220\u9664\u8BE5\u672C\u5730\u8BB0\u5F55");
    forget.textContent = "\u5220\u9664";
    actions2.append(forget);
  }
  entry.append(info, actions2);
  return entry;
}
function renderDirectory({ state, rooms, message, trustURL }) {
  const live = rooms.filter((r) => !r.recent);
  const recent = rooms.filter((r) => r.recent);
  label("online-directory-status", state === "loading" ? "\u6B63\u5728\u83B7\u53D6\u516C\u5F00\u623F\u95F4\u2026" : state === "ready" ? live.length ? `${live.length} \u4E2A\u516C\u5F00\u623F\u95F4 \xB7 \u5B9E\u65F6\u66F4\u65B0` : "\u6682\u65E0\u516C\u5F00\u623F\u95F4\u3002\u70B9\u51FB\u5FEB\u901F\u52A0\u5165\uFF0C\u81EA\u52A8\u521B\u5EFA\u5E76\u7ACB\u5373\u5F00\u6218\u3002" : message);
  visible("online-directory-trust", !!trustURL);
  if (trustURL) $("online-directory-trust-link").href = trustURL;
  const lists = [
    { root: $("online-list"), items: live },
    { root: $("online-recent-list"), items: recent }
  ];
  visible("online-recent", recent.length > 0);
  const focused = [...$("online-hall").querySelectorAll("button[data-act]")].find((b) => b === document.activeElement)?.dataset.act;
  for (const { root, items } of lists) {
    root.replaceChildren();
    for (const summary of items) root.append(roomEntry(summary));
  }
  if (focused) {
    const next = [...$("online-hall").querySelectorAll("button[data-act]")].find((button) => button.dataset.act === focused && !button.disabled);
    (next || $("online-quick")).focus({ preventScroll: true });
  }
}
async function join(mode, roomID) {
  if (!multiplayerEnabled || busy || room) return;
  busy = true;
  const generation = ++joinGeneration;
  setJoinBusy();
  syncDirectory();
  visible("online-error", false);
  visible("online-trust", false);
  status("\u6B63\u5728\u8FDE\u63A5\u6218\u573A\u2026");
  try {
    net.checkSupport();
    await toyMenus.authorize();
    if (generation !== joinGeneration) return;
    if (p2pEnabled) await joinPeer(mode, roomID, generation);
    else await joinServer(mode, roomID, generation);
    if (generation !== joinGeneration) return;
    await command({ type: "equip", weapon: ctx.settings.primary });
    if (generation !== joinGeneration) return;
    roomButton.hidden = false;
    menus.pages.pause.querySelector("h1").textContent = "\u6218\u672F\u83DC\u5355";
  } catch (e) {
    if (generation !== joinGeneration) return;
    error(e.message);
    if (e.trustURL) {
      $("online-trust-link").href = e.trustURL;
      visible("online-trust", true);
    }
    status("\u8FDE\u63A5\u672A\u5B8C\u6210");
    await net.leave();
    if (generation !== joinGeneration) return;
    engine.exit();
    room = null;
    renderRoom();
    openRoom();
  } finally {
    if (generation === joinGeneration) {
      busy = false;
      setJoinBusy();
      syncDirectory();
    }
  }
}
function buildWorld() {
  return new World(
    engine.debug.world.cols.filter((c) => !c.off).map((c) => ({
      min: [c.x0, c.y0, c.z0],
      max: [c.x1, c.y1, c.z1],
      noMove: !!c.noMove,
      noRay: !!c.noRay,
      pane: !!c.pane
    }))
  );
}
function weaponSpecs() {
  return (engine.ctx?.arsenal?.slots || []).map((slot) => ({
    id: slot.def.id,
    mag: slot.def.mag,
    reserve: slot.def.reserve,
    interval: slot.def.rpm ? 60 / slot.def.rpm : 0.1,
    pellets: slot.def.pellets || 1
  }));
}
async function joinServer(mode, roomID, generation) {
  const config = await loadApiConfig(
    document.documentElement.dataset.apiOrigin,
    location.href
  );
  if (generation !== joinGeneration) return;
  if (query.get("transport") === "webrtc") config.preferredTransport = "webrtc";
  await engine.enter(ctx.settings.primary);
  if (generation !== joinGeneration) return;
  const hello = joinHello(mode, account.playerName, roomID);
  if (mode !== "listed") hello.difficulty = ctx.settings.difficulty;
  await net.connect(hello, config);
}
async function joinPeer(mode, roomID, generation) {
  const name = account.playerName;
  let code = parseRoomCode(roomID || query.get("room") || "");
  if (mode === "quick" && !code) {
    const candidate = (directory.rooms || []).find((r) => r.joinable && !r.recent);
    if (candidate) code = candidate.room;
  }
  const hello = {
    type: "hello",
    name,
    weapons: weaponSpecs(),
    difficulty: ctx.settings.difficulty
  };
  let config;
  if (mode === "create" || !code) {
    status("\u6B63\u5728\u521B\u5EFA\u623F\u95F4\u2026");
    const room2 = await Room.create({ world: buildWorld(), weapons: weaponSpecs() });
    if (generation !== joinGeneration) {
      room2.destroy();
      return;
    }
    roomRef = room2;
    peerRef = room2.peer;
    peerOwned = false;
    code = room2.code;
    hello.room = code;
    config = { transport: "loopback", link: room2.localEndpoint() };
  } else {
    status("\u6B63\u5728\u8FDE\u63A5\u623F\u95F4\u4E3B\u673A\u2026");
    const taken = directory.take(code);
    const peer = taken?.peer || await createPeer(void 0, signalingOptions());
    if (generation !== joinGeneration) return;
    peerRef = peer;
    peerOwned = true;
    hello.room = code;
    config = {
      transport: "peer",
      peer,
      connection: taken?.connection,
      hostId: roomPeerId(code)
    };
  }
  rememberRoom(code, name);
  await engine.enter(ctx.settings.primary);
  if (generation !== joinGeneration) return;
  await net.connect(hello, config);
  if (generation !== joinGeneration) return;
  voice = installVoice({ peer: peerRef, onState: renderVoice });
  emotes.bar($("online-emotes"));
}
function inviteLink() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", room?.room || "");
  url.searchParams.set("peer", "1");
  return url.href;
}
async function copyText(text, message) {
  if (!text) {
    status("\u6CA1\u6709\u53EF\u590D\u5236\u7684\u5185\u5BB9\u3002");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    status(message);
  } catch {
    status("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u6587\u672C\u3002");
  }
}
function renderVoice(state) {
  const button = $("online-voice");
  if (!button) return;
  button.textContent = state?.enabled ? `\u8BED\u97F3\uFF1A\u5F00 (${state.peers || 0})` : "\u8BED\u97F3\uFF1A\u5173";
  button.classList.toggle("active", !!state?.enabled);
}
async function toggleVoice() {
  if (!voice) {
    status("\u8BED\u97F3\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u5148\u52A0\u5165\u623F\u95F4\u3002");
    return;
  }
  try {
    const on = await voice.toggle();
    renderVoice({ enabled: on, peers: voice.peerCount });
    status(on ? "\u9EA6\u514B\u98CE\u5DF2\u5F00\u542F\u3002" : "\u9EA6\u514B\u98CE\u5DF2\u5173\u95ED\u3002");
  } catch (e) {
    error(e.message || "\u65E0\u6CD5\u5F00\u542F\u9EA6\u514B\u98CE\u3002");
  }
}
async function leave() {
  const generation = ++joinGeneration;
  busy = true;
  setJoinBusy();
  syncDirectory();
  await net.leave();
  if (generation !== joinGeneration) return;
  onlineKills.reset();
  void account.flush();
  engine.exit();
  voice?.disable();
  voice = null;
  if (roomRef) {
    roomRef.destroy();
    roomRef = null;
  }
  if (peerOwned && peerRef) {
    try {
      peerRef.destroy();
    } catch {
    }
  }
  peerRef = null;
  peerOwned = false;
  toyMenus.render();
  room = null;
  busy = false;
  setJoinBusy();
  returnPage = null;
  reportGate.reset();
  roomButton.hidden = dragButton.hidden = true;
  menus.pages.pause.querySelector("h1").textContent = "\u5DF2\u6682\u505C";
  visible("online-error", false);
  visible("online-trust", false);
  renderRoom();
  menus.go("main");
  status("\u5DF2\u9000\u51FA\u623F\u95F4\u3002\u7A7A\u4F4D\u7531\u4EBA\u673A\u63A5\u66FF\u3002");
}
const actions = {
  online: async () => {
    await toyMenus.authorize();
    openRoom();
  },
  deploy: async () => {
    await toyMenus.authorize();
    if (room) await leave();
    originalAct.call(menus, "deploy", 1);
  },
  "online-back": () => menus.back(),
  "online-quick": () => join("quick"),
  "online-create": () => join("create"),
  "online-join": () => join("listed", $("online-code").value),
  "online-copy-code": () => copyText(room?.room || "", "\u623F\u95F4\u7801\u5DF2\u590D\u5236\u3002"),
  "online-copy-link": () => copyText(inviteLink(), "\u9080\u8BF7\u94FE\u63A5\u5DF2\u590D\u5236\u3002"),
  "online-voice": () => toggleVoice(),
  "online-refresh": () => directory.retry(),
  "online-next": () => command({ type: "ready", ready: true }),
  "online-team-a": () => command({ type: "team", team: 0 }),
  "online-team-b": () => command({ type: "team", team: 1 }),
  "online-leave": leave,
  "online-resume": () => resume(),
  "online-drag": () => resume(true),
  "online-gunsmith": () => {
    returnPage = "online";
    menus.go("gunsmith");
  }
};
function renderRoom() {
  const difficulty = difficultyLabel(room?.difficulty || ctx.settings.difficulty);
  page.querySelector(".online-mode").textContent = `\u66AE\u8272\u9152\u5E97 \xB7 \u56E2\u961F\u6B7B\u6597 \xB7 ${difficulty}\u4EBA\u673A \xB7 \u5148\u5230 40 \u5206`;
  visible("online-connect", !room);
  visible("online-hall", !room);
  syncDirectory();
  for (const id of ["online-room", "online-roster", "online-leave"])
    visible(id, !!room);
  if (room) {
    label("online-room-code", room.room || "--------");
    const link = inviteLink();
    if (link !== lastInvite) {
      lastInvite = link;
      renderQrCode($("online-qr"), link).catch(() => {
      });
    }
  }
  if (!room) {
    label("online-section", "\u516C\u5171\u623F\u95F4\u5927\u5385");
    label("online-members", "5 \u5BF9 5");
    return;
  }
  const me = current(), active = inMatch();
  if (menus.page === "online") menus.root.dataset.bg = "dim";
  const humans = room.players.filter((p) => !p.bot).length;
  label("online-section", "\u516C\u5F00\u6218\u573A");
  label("online-members", `${humans} \u771F\u4EBA / ${10 - humans} \u4EBA\u673A`);
  label(
    "online-phase",
    active ? "\u5BF9\u5C40\u8FDB\u884C\u4E2D" : room.phase === "over" ? "\u5BF9\u5C40\u6218\u7EE9" : "\u7F16\u961F\u51C6\u5907"
  );
  const table = $("online-teams");
  table.replaceChildren();
  for (let team = 0; team < 2; team++) {
    const section = document.createElement("section");
    section.className = "t" + team;
    const heading = document.createElement("div");
    heading.className = "th";
    const title = document.createElement("b");
    title.textContent = team ? "\u4F59\u70EC" : "\u5148\u950B";
    const score = document.createElement("em");
    score.textContent = active || room.phase === "over" ? room.scores[team] : "5 / 5";
    heading.append(title, score);
    section.append(heading);
    for (const [index, p] of room.players.filter((p2) => p2.team === team).entries()) {
      const row = document.createElement("div");
      row.className = "rw online-member" + (p.id === net.id ? " me" : "");
      const n = document.createElement("span");
      n.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.textContent = p.name + (p.id === net.id ? "\uFF08\u4F60\uFF09" : "");
      const state = document.createElement("span");
      state.textContent = active || room.phase === "over" ? p.kills + " / " + p.deaths : p.bot ? "\u4EBA\u673A \xB7 \u5C31\u7EEA" : !p.connected ? "\u4EBA\u673A\u4EE3\u6253" : "\u5728\u7EBF";
      const role = document.createElement("small");
      role.textContent = p.id === room.host ? "\u623F\u4E3B" : p.bot ? "\u81EA\u52A8\u8865\u4F4D" : "\u771F\u4EBA\u5E72\u5458";
      name.append(role);
      row.append(n, name, state);
      section.append(row);
    }
    table.append(section);
  }
  visible("online-next", !active);
  visible("online-resume", active);
  for (const id of ["online-team-a", "online-team-b"]) $(id).disabled = active;
  visible("online-result", room.phase === "over");
  if (room.phase === "over")
    label(
      "online-result",
      room.winner < 0 ? "\u5E73\u5C40" : room.winner === me?.team ? "\u4EFB\u52A1\u5B8C\u6210 \xB7 \u80DC\u5229" : "\u4EFB\u52A1\u7ED3\u675F \xB7 \u518D\u6218"
    );
  status(
    active ? "\u6218\u573A\u6301\u7EED\u8FD0\u884C\uFF0C\u7A7A\u4F4D\u7531\u4EBA\u673A\u8865\u9F50\u3002" : "\u70B9\u51FB\u518D\u6765\u4E00\u5C40\uFF0C\u7559\u5728\u5F53\u524D\u623F\u95F4\u7ACB\u5373\u5F00\u6218\u3002"
  );
}
net.addEventListener("status", ({ detail }) => {
  status(detail);
  if (detail.includes("\u4E2D\u65AD") && inMatch()) engine.pause();
});
net.addEventListener("error", ({ detail }) => error(detail));
net.addEventListener("event", ({ detail: e }) => {
  engine.event(e);
  const settlement = onlineKills.event(e, net.id);
  if (e.type === "error") return error(e.message);
  if (e.type === "emote") {
    emotes.show(e);
    return;
  }
  if (e.type === "welcome") visible("online-error", false);
  if (e.type === "room") {
    room = e;
    engine.setRoom(e);
    renderRoom();
    voice?.sync(
      (room.players || []).filter((p) => !p.bot && p.peerId).map((p) => p.peerId)
    );
    const me = room.players.find((player) => player.id === net.id);
    if (engine.active && me && reportGate.claim(room)) {
      const match = ctx.match;
      match.scores = room.scores;
      match.scoreLimit = room.scoreLimit || 40;
      match.state = "over";
      for (const player of room.players) {
        const actor = engine.actor(player.id);
        if (!actor) continue;
        Object.assign(actor, {
          name: player.name,
          team: player.team,
          kills: player.kills,
          deaths: player.deaths,
          score: player.score
        });
      }
      engine.gh.G.state = "over";
      const outcome = room.winner < 0 ? -1 : room.winner === me.team ? 0 : 1;
      ctx.hud.matchEnd(outcome, match, settlement?.award);
    }
  }
});
net.addEventListener("snapshot", ({ detail: s }) => {
  engine.snapshot(s);
  if (room) {
    room.scores = s.scores;
    for (const p of s.players) {
      const member = room.players.find((q) => q.id === p.id);
      if (member) {
        member.kills = p.kills;
        member.deaths = p.deaths;
        member.score = p.score;
      }
    }
    if (performance.now() - lastRosterAt > 500) {
      lastRosterAt = performance.now();
      if (menus.page === "online") renderRoom();
      if (menus.page === "pause") menus._refreshPause();
    }
  }
});
engine.addEventListener("lockerror", () => {
  dragButton.hidden = false;
  if (!inMatch()) return;
  menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "\u70B9\u51FB\u540E\u9501\u5B9A\u9F20\u6807 \u203A";
  ctx.hud.hint("\u70B9\u51FB\u300C\u7EE7\u7EED\u300D\u9501\u5B9A\u9F20\u6807\u5E76\u8FD4\u56DE\u6218\u573A\uFF1B\u53D7\u9650\u7A97\u53E3\u53EF\u9009\u62E9\u300C\u62D6\u52A8\u7784\u51C6\u300D\u3002", 7);
});
engine.addEventListener("lock", ({ detail: locked }) => {
  if (locked) menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "\u203A";
  if (!locked && inMatch() && engine.gh.G.state === "playing") engine.pause();
});
if (multiplayerEnabled) setInterval(() => {
  if (net.writer) command({ type: "ping", nonce: performance.now() });
}, 1500);
if (multiplayerEnabled && query.has("pvp")) openRoom();
if (p2pEnabled && query.get("room")) {
  const code = parseRoomCode(query.get("room"));
  if (code) {
    $("online-code").value = code;
    openRoom();
    join("listed", code);
  }
}
