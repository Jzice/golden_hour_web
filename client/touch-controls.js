import { TouchInput, stickVector } from "./touch-input.js";
import "./input-devices.js";
import { startupPolicy } from "./performance-policy.js";
import { defaultLayout, normalizeLayout, controlRect, readLayout, saveLayout, canStartLook, touchLookDelta, LAYOUT_KEY } from "./touch-layout.js";
const heldActions = {
  fire: "Mouse0",
  jump: "Space",
  reload: "KeyR",
  grenade: "KeyG",
  melee: "KeyV",
  upgrade: "KeyB",
  dive: "KeyX",
  inspect: "KeyT"
};
const toggleActions = { aim: "Mouse1", sprint: "ShiftLeft", score: "Tab" };
const actions = [
  ["fire", "\u5F00\u706B"],
  ["aim", "\u7784\u51C6"],
  ["jump", "\u8DF3\u8DC3"],
  ["crouch", "\u8E72\u4E0B"],
  ["reload", "\u6362\u5F39"],
  ["swap", "\u5207\u67AA"],
  ["sprint", "\u51B2\u523A"],
  ["grenade", "\u624B\u96F7", true],
  ["melee", "\u8FD1\u6218"],
  ["upgrade", "\u519B\u72AC", true],
  ["dive", "\u98DE\u6251", true]
];
class TouchControls {
  constructor() {
    this.coarse = matchMedia("(pointer: coarse)");
    this.handheld = startupPolicy({
      coarse: this.coarse.matches,
      mobile: navigator.userAgentData?.mobile,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    }).mobile;
    this.enabled = this.handheld;
    this.usedTouch = false;
    this.pointers = /* @__PURE__ */ new Map();
    this.owners = /* @__PURE__ */ new Map();
    this.vector = {};
    this.lookVector = {};
    this.lookOwner = null;
    try {
      this.storage = globalThis.localStorage;
    } catch {
      this.storage = null;
    }
    this.layout = readLayout(this.storage, Math.max(innerWidth, innerHeight), Math.min(innerWidth, innerHeight));
    try {
      this.customLayout = JSON.parse(this.storage?.getItem(LAYOUT_KEY))?.version === 1;
    } catch {
      this.customLayout = false;
    }
    this.buttons = /* @__PURE__ */ new Map();
    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "\u89E6\u5C4F\u6218\u6597\u64CD\u4F5C");
    this.look = document.createElement("div");
    this.look.id = "touch-look";
    this.look.setAttribute("aria-label", "\u62D6\u52A8\u8C03\u6574\u89C6\u89D2");
    this.stick = document.createElement("div");
    this.stick.id = "touch-stick";
    this.stick.setAttribute("aria-label", "\u79FB\u52A8\u6447\u6746");
    this.stick.innerHTML = '<span class="touch-stick-knob"></span>';
    const group = document.createElement("div");
    group.className = "touch-actions";
    for (const [action, label, offline] of actions) {
      const button = this.button(action, label);
      if (offline) button.dataset.offline = "";
      group.append(button);
    }
    this.root.append(this.look, this.stick, group);
    this.utility = document.createElement("div");
    this.utility.className = "touch-utility";
    for (const [action, label] of [["score", "\u6218\u7EE9"], ["pause", "\u6682\u505C"], ["inspect", "\u68C0\u89C6"], ["fullscreen", "\u5168\u5C4F"]])
      this.utility.append(this.button(action, label));
    this.rotate = document.createElement("div");
    this.rotate.id = "touch-rotate";
    this.rotate.hidden = true;
    this.rotate.setAttribute("role", "status");
    this.rotate.innerHTML = '<div class="touch-rotate-icon" aria-hidden="true">\u21BB</div><div class="touch-rotate-title">\u8BF7\u6A2A\u5C4F\u6E38\u73A9</div><div class="touch-rotate-note">\u65CB\u8F6C\u624B\u673A\u6216\u5E73\u677F\uFF0C\u4F7F\u7528\u5DE6\u4FA7\u6447\u6746\u79FB\u52A8\u3001\u53F3\u4FA7\u62D6\u52A8\u7784\u51C6\u3002\u82E5\u65E0\u6CD5\u65CB\u8F6C\uFF0C\u8BF7\u5173\u95ED\u8BBE\u5907\u7684\u65B9\u5411\u9501\u5B9A\u3002</div><button class="btn">\u8FD4\u56DE\u4E3B\u83DC\u5355</button>';
    this.rotate.querySelector("button").addEventListener("click", () => {
      if (this.bind()) this.gh.debug.ctx.hud.menus.cb.onQuit();
    });
    this.safeBounds = document.createElement("div");
    this.safeBounds.className = "touch-safe-bounds";
    this.safeBounds.setAttribute("aria-hidden", "true");
    document.body.append(this.safeBounds, this.root, this.utility, this.rotate);
    this.buttons.get("fullscreen").hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    this.root.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.utility.addEventListener("pointerdown", (event) => this.pointerDown(event));
    addEventListener("pointermove", (event) => this.pointerMove(event), { passive: false });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      addEventListener(type, (event) => this.pointerEnd(event));
    addEventListener("pointerdown", (event) => {
      if (!this.usedTouch && (event.pointerType === "touch" || event.pointerType === "pen")) {
        this.usedTouch = true;
        this.setDevice();
      }
    }, { capture: true });
    for (const element of [this.root, this.utility]) {
      element.addEventListener("contextmenu", (event) => event.preventDefault());
      element.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (event.detail === 0 && button && !button.disabled) {
          event.preventDefault();
          this.tap(button.dataset.action);
        }
      });
    }
    this.coarse.addEventListener("change", () => this.setDevice());
    addEventListener("resize", () => this.resize());
    globalThis.visualViewport?.addEventListener("resize", () => this.resize());
    addEventListener("orientationchange", () => this.resize());
    addEventListener("blur", () => this.suspend());
    addEventListener("pagehide", () => this.suspend());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.suspend();
    });
    this.setDevice();
  }
  button(action, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "touch-button";
    button.dataset.action = action;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    if (toggleActions[action] || action === "crouch" || action === "fire")
      button.setAttribute("aria-pressed", "false");
    this.buttons.set(action, button);
    return button;
  }
  setDevice() {
    const enabled = globalThis.GHInput ? globalThis.GHInput.effective === "touch" : this.coarse.matches || this.handheld || this.usedTouch;
    if (!enabled && this.enabled) this.deactivate();
    this.enabled = enabled;
    document.body.classList.toggle("touch-device", enabled || this.handheld);
    this.resize();
  }
  resize() {
    const portrait = this.enabled && innerHeight > innerWidth;
    if (portrait && !this.portrait) this.suspend();
    else if (this.pointers.size) this.reset();
    this.portrait = portrait;
    document.body.classList.toggle("touch-portrait", portrait);
    const { width, height } = this.viewport();
    if (!this.customLayout) this.layout = defaultLayout(Math.max(width, height), Math.min(width, height));
    this.applyLayout();
    this.update();
  }
  viewport() {
    const rect = this.safeBounds.getBoundingClientRect();
    return rect.width && rect.height ? rect : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  setLayout(value) {
    const { width, height } = this.viewport();
    this.reset();
    this.layout = normalizeLayout(value, width, height);
    this.customLayout = true;
    this.applyLayout();
    return saveLayout(this.storage, this.layout);
  }
  applyLayout() {
    const { width, height } = this.viewport();
    for (const [id, item] of Object.entries(this.layout.controls)) {
      const element = id === "stick" ? this.stick : this.buttons.get(id);
      if (!element) continue;
      const utility = this.utility.contains(element);
      if (utility && !this.layoutPlaying) {
        for (const property of ["left", "top", "width", "height", "--touch-opacity"]) element.style.removeProperty(property);
        continue;
      }
      const rect = controlRect(item, width, height);
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = element.style.height = `${rect.size}px`;
      element.style.setProperty("--touch-opacity", item.opacity);
    }
  }
  bind() {
    const gh = globalThis.GH;
    if (!gh?.ready) return false;
    if (!this.state) {
      this.gh = gh;
      this.state = new TouchInput(gh.debug.input);
    }
    return true;
  }
  activate() {
    if (!this.enabled || this.portrait || document.hidden || !this.bind()) return false;
    this.reset();
    this.state.input.touchActive = true;
    this.state.input.onLockChange?.(true);
    this.update();
    this.gh.debug.ctx.hud.hint("\u5DE6\u4FA7\u6447\u6746\u79FB\u52A8 \xB7 \u53F3\u4FA7\u62D6\u52A8\u7784\u51C6 \xB7 \u6309\u4F4F\u5F00\u706B\u53EF\u540C\u65F6\u8C03\u6574\u89C6\u89D2", 5);
    return true;
  }
  deactivate() {
    this.reset();
    if (this.state) this.state.input.touchActive = false;
  }
  suspend() {
    if (!this.enabled) return;
    this.deactivate();
    if (this.bind() && this.gh.G.state === "playing") this.state.input.onLockChange?.(false);
    this.update();
  }
  reset() {
    this.state?.reset();
    const pointers = [...this.pointers.values()];
    this.pointers.clear();
    this.owners.clear();
    this.lookOwner = null;
    for (const pointer of pointers)
      if (pointer.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
    this.stick.style.setProperty("--stick-x", "0px");
    this.stick.style.setProperty("--stick-y", "0px");
    for (const button of this.buttons.values())
      if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", "false");
  }
  update() {
    if (!this.bind()) {
      this.rotate.hidden = true;
      this.utility.hidden = !this.enabled;
      for (const action of ["score", "pause", "inspect"]) this.buttons.get(action).hidden = true;
      return;
    }
    const { G, debug } = this.gh;
    const playing = G.state === "playing";
    const paused = G.state === "paused";
    const rotationHidden = !this.portrait || !(playing || paused && debug.ctx.hud.menus.page === "pause");
    if (this.rotate.hidden !== rotationHidden) this.rotate.hidden = rotationHidden;
    const alive = debug.player.alive;
    const online = document.body.classList.contains("online-session");
    const interactive = this.enabled && !this.portrait && !document.hidden && playing && alive && debug.ctx.match.state !== "countdown" && debug.ctx.match.state !== "over";
    if (!interactive && this.interactive || this.enabled && this.online !== void 0 && this.online !== online) this.reset();
    this.interactive = interactive;
    this.online = online;
    if (globalThis.GHInput?.effective !== "gamepad")
      this.state.input.touchActive = this.enabled && !this.portrait && !document.hidden && playing;
    const board = this.state.input.keys.has("Tab") || this.state.input.touchKeys.has("Tab");
    const view = this.view;
    if (view && view.state === G.state && view.phase === debug.ctx.match.state && view.alive === alive && view.online === online && view.board === board && view.portrait === this.portrait && view.enabled === this.enabled && view.hidden === document.hidden && view.revision === this.state.revision && view.stance === debug.player.stance && view.mode === debug.player.mode) return;
    this.view = {
      state: G.state,
      phase: debug.ctx.match.state,
      alive,
      online,
      board,
      portrait: this.portrait,
      enabled: this.enabled,
      hidden: document.hidden,
      revision: this.state.revision,
      stance: debug.player.stance,
      mode: debug.player.mode
    };
    this.root.hidden = !this.enabled || this.portrait || !playing || board;
    this.utility.hidden = !this.enabled || this.portrait;
    this.buttons.get("score").hidden = !playing;
    this.buttons.get("pause").hidden = !playing && !paused;
    this.buttons.get("inspect").hidden = !interactive;
    const pauseLabel = paused ? "\u7EE7\u7EED" : "\u6682\u505C";
    if (this.buttons.get("pause").textContent !== pauseLabel) {
      this.buttons.get("pause").textContent = pauseLabel;
      this.buttons.get("pause").setAttribute("aria-label", pauseLabel);
    }
    document.body.classList.toggle("touch-playing", this.enabled && playing);
    if (this.layoutPlaying !== playing) {
      this.layoutPlaying = playing;
      this.applyLayout();
    }
    document.body.classList.toggle("touch-dead", this.enabled && playing && !alive);
    for (const [action, button] of this.buttons) {
      if (action in heldActions || action === "crouch" || action === "swap" || action === "aim" || action === "sprint")
        button.disabled = !interactive;
      if (button.hasAttribute("data-offline")) button.hidden = online;
      if (button.hasAttribute("aria-pressed")) {
        const code = heldActions[action] || toggleActions[action];
        const pressed = action === "crouch" ? online ? this.state.input.touchKeys.has("KeyC") : debug.player.stance === "crouch" || debug.player.mode === "slide" : this.state.input.touchKeys.has(code);
        const value = String(pressed);
        if (button.getAttribute("aria-pressed") !== value) button.setAttribute("aria-pressed", value);
      }
    }
  }
  pointerDown(event) {
    if (!this.enabled || this.portrait || event.pointerType === "mouse" && event.button !== 0) return;
    const button = event.target.closest("button[data-action]");
    if (button?.disabled) return;
    event.preventDefault();
    const action = button?.dataset.action;
    if (action && !(action in heldActions) && !(this.online && action === "crouch")) {
      this.tap(action);
      return;
    }
    if (!this.interactive || this.owners.has(button || event.target)) return;
    let kind, element, code;
    if (event.target === this.stick || this.stick.contains(event.target)) {
      kind = "stick";
      element = this.stick;
    } else if (event.target === this.look || action === "fire") {
      if (!action && !canStartLook(event.clientX, this.viewport(), this.lookOwner !== null)) return;
      kind = action === "fire" && !this.layout.fireLook ? "button" : "look";
      element = button || this.look;
      code = heldActions[action];
    } else if (action === "crouch" && this.online) {
      kind = "button";
      element = button;
      code = "KeyC";
    } else if (action in heldActions) {
      kind = "button";
      element = button;
      code = heldActions[action];
    } else return;
    if (element.hasAttribute("data-offline") && this.online) return;
    const pointer = { id: event.pointerId, element, kind, code, x: event.clientX, y: event.clientY };
    if (kind === "stick") pointer.rect = element.getBoundingClientRect();
    this.pointers.set(event.pointerId, pointer);
    this.owners.set(element, event.pointerId);
    if (kind === "look" && this.lookOwner === null) this.lookOwner = event.pointerId;
    element.setPointerCapture(event.pointerId);
    if (code) this.state.press(code);
    if (kind === "stick") this.moveStick(pointer, event);
    this.update();
  }
  pointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    if (pointer.kind === "stick") this.moveStick(pointer, event);
    if (pointer.kind === "look") {
      if (this.lookOwner === null) this.lookOwner = event.pointerId;
      if (this.lookOwner === event.pointerId) {
        const { player, ctx } = this.gh.debug;
        const delta = touchLookDelta(
          event.clientX - pointer.x,
          event.clientY - pointer.y,
          this.layout.sensitivity,
          player.adsK,
          this.lookVector
        );
        const mouseScale = ctx.settings.sens * (1 + (ctx.settings.adsSens - 1) * player.adsK);
        const compensation = Number.isFinite(mouseScale) && mouseScale > 0 ? mouseScale : 1;
        this.state.look(delta.x / compensation, delta.y / compensation);
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }
  }
  moveStick(pointer, event) {
    const rect = pointer.rect;
    const radius = Math.max(0, Math.min(rect.width, rect.height) / 2 - 22);
    const v = stickVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, radius, this.vector);
    this.state.move(v.forward, v.right);
    this.stick.style.setProperty("--stick-x", `${v.x}px`);
    this.stick.style.setProperty("--stick-y", `${v.y}px`);
  }
  pointerEnd(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
    this.owners.delete(pointer.element);
    if (this.lookOwner === event.pointerId) this.lookOwner = null;
    if (pointer.code) this.state.release(pointer.code);
    if (pointer.kind === "stick") {
      this.state.move(0, 0);
      this.stick.style.setProperty("--stick-x", "0px");
      this.stick.style.setProperty("--stick-y", "0px");
    }
    if (pointer.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
    this.update();
  }
  tap(action) {
    if (action === "fullscreen") return this.fullscreen();
    if (!this.bind()) return;
    if (action === "pause") {
      if (this.gh.G.state === "paused") this.gh.debug.ctx.hud.menus.cb.onResume();
      else this.suspend();
      return;
    }
    if (action === "score") {
      if (this.gh.G.state !== "playing") return;
      const opening = !this.state.input.touchKeys.has("Tab");
      this.reset();
      if (opening) this.state.press("Tab");
    } else if (this.interactive) {
      if (toggleActions[action]) this.state.toggle(toggleActions[action]);
      else if (action === "crouch") {
        if (this.online) this.state.pulse("KeyC");
        else {
          const crouched = this.gh.debug.player.stance === "crouch" || this.gh.debug.player.mode === "slide";
          if (crouched) this.state.release("KeyC");
          else this.state.press("KeyC");
          this.state.pulse("KeyC");
        }
      } else if (action === "swap") this.state.pulse(this.gh.debug.ctx.arsenal.cur === 0 ? "Digit2" : "Digit1");
      else if (heldActions[action]) this.state.pulse(heldActions[action]);
    }
    this.update();
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit.call(document);
      } else {
        const enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (enter) await enter.call(document.documentElement);
      }
    } catch {
      if (this.bind()) this.gh.debug.ctx.hud.hint("\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u5168\u5C4F\uFF0C\u8BF7\u901A\u8FC7\u6D4F\u89C8\u5668\u83DC\u5355\u6536\u8D77\u5DE5\u5177\u680F\u3002", 4);
    }
  }
}
if (typeof document !== "undefined") globalThis.GHTouch = new TouchControls();
export {
  TouchControls
};
