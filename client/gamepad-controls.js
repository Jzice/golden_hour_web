import { TouchInput } from "./touch-input.js";
function gamepadStick(x = 0, y = 0, deadzone = 0.18) {
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0 };
  const amount = (Math.min(1, length) - deadzone) / (1 - deadzone);
  return { x: x / length * amount, y: y / length * amount };
}
class GamepadControls {
  constructor({ manager, gh, getPads = () => navigator.getGamepads?.() || [], menu, doc }) {
    Object.assign(this, { manager, gh, getPads, menu, doc });
    this.input = new TouchInput(gh.debug.input);
    this.previous = [];
    this.blocked = /* @__PURE__ */ new Set();
    this.armed = false;
    this.connected = false;
    this.sprinting = false;
  }
  reset() {
    if (this.active || this.manager.effective === "gamepad") this.input.reset();
    this.active = false;
    this.armed = false;
    this.sprinting = false;
    this.lastTime = null;
  }
  suspend() {
    this.reset();
    if (this.manager.effective === "gamepad") this.manager.pause();
  }
  poll(time) {
    let pads;
    try {
      pads = Array.from(this.getPads() || []).filter((pad2) => pad2?.connected !== false && pad2);
    } catch {
      pads = [];
    }
    const pad = pads.find((p) => p.index === this.index && p.mapping === "standard") || pads.find((p) => p.mapping === "standard");
    if (!pad) {
      if (this.connected) {
        this.suspend();
        if (this.manager.preferences.mode === "auto") this.manager.choose(this.manager.handheld ? "touch" : "keyboard");
      }
      this.connected = false;
      this.previous = [];
      this.identity = null;
      this.manager.status(pads.length ? "\u6B64\u624B\u67C4\u672A\u63D0\u4F9B\u6807\u51C6\u6620\u5C04\uFF0C\u8BF7\u4F7F\u7528\u652F\u6301\u6807\u51C6\u624B\u67C4\u7684\u6D4F\u89C8\u5668\u3002" : "\u672A\u68C0\u6D4B\u5230\u624B\u67C4\uFF0C\u8FDE\u63A5\u540E\u6309\u4EFB\u610F\u6309\u952E\u3002\u6D4F\u89C8\u5668\u9700\u652F\u6301 Gamepad API\u3002");
      return;
    }
    this.connected = true;
    this.manager.status("\u5DF2\u8FDE\u63A5\uFF1A" + String(pad.id || "\u6807\u51C6\u624B\u67C4").slice(0, 120));
    const buttons = Array.from({ length: 17 }, (_, i) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value || 0) > 0.5);
    const identity = pad.index + ":" + pad.id;
    if (identity !== this.identity) {
      if (this.identity !== void 0 && this.manager.effective === "gamepad") this.suspend();
      this.reset();
      this.identity = identity;
      this.index = pad.index;
      this.previous = buttons;
    }
    const edge = (index) => buttons[index] && !this.previous[index];
    const preferences = this.manager.preferences;
    const left = gamepadStick(pad.axes[0], pad.axes[1], preferences.deadzone);
    const right = gamepadStick(pad.axes[2], pad.axes[3], preferences.deadzone);
    const meaningful = buttons.some((value, i) => value && !this.previous[i]) || Math.hypot(left.x, left.y) > 0.35 || Math.hypot(right.x, right.y) > 0.35;
    if (meaningful && !this.doc?.hidden) this.manager.choose("gamepad");
    const state = this.gh.G.state;
    const playing = state === "playing";
    const changed = state !== this.lastState;
    if (changed) {
      this.reset();
      this.blocked = new Set(buttons.flatMap((held, i) => held ? [i] : []));
      this.lastState = state;
    }
    for (const i of this.blocked) if (!buttons[i]) this.blocked.delete(i);
    if (this.manager.effective !== "gamepad" || this.doc?.hidden || this.doc?.hasFocus?.() === false) {
      if (this.active) this.reset();
      this.active = false;
      this.previous = buttons;
      return;
    }
    this.active = true;
    if (!playing) {
      const press = (i) => edge(i) && !this.blocked.has(i);
      if (press(1)) this.menu?.("back");
      else if (press(9) && state === "paused") this.gh.debug.ctx.hud.menus.cb.onResume();
      else if (press(0)) this.menu?.("confirm");
      else if (press(4)) this.menu?.("previous-tab");
      else if (press(5)) this.menu?.("next-tab");
      const direction = buttons[12] || left.y < -0.6 ? "up" : buttons[13] || left.y > 0.6 ? "down" : buttons[14] || left.x < -0.6 ? "left" : buttons[15] || left.x > 0.6 ? "right" : null;
      if (direction && (direction !== this.direction || time >= this.repeatAt)) {
        this.menu?.(direction);
        this.repeatAt = time + (direction === this.direction ? 150 : 400);
      }
      this.direction = direction;
    } else {
      const input = this.input.input;
      input.touchActive = true;
      const live = this.gh.debug.player.alive && !["countdown", "over"].includes(this.gh.debug.ctx.match.state);
      if (edge(9) && !this.blocked.has(9)) {
        this.suspend();
        this.previous = buttons;
        return;
      }
      if (!this.armed) {
        this.armed = !buttons.some(Boolean) && !left.x && !left.y && !right.x && !right.y;
      } else if (live) {
        const held = (i) => buttons[i] && !this.blocked.has(i);
        const press = (i) => edge(i) && held(i);
        if (press(10)) this.sprinting = !this.sprinting;
        if (Math.hypot(left.x, left.y) < 0.1 || held(6) || held(7)) this.sprinting = false;
        const wanted = /* @__PURE__ */ new Set();
        for (const [i, code] of [[0, "Space"], [1, "KeyC"], [2, "KeyR"], [5, "KeyV"], [6, "Mouse1"], [7, "Mouse0"], [8, "Tab"], [11, "KeyV"]])
          if (held(i)) wanted.add(code);
        if (this.sprinting) wanted.add("ShiftLeft");
        for (const code of [...input.touchKeys]) if (!wanted.has(code)) this.input.release(code);
        for (const code of wanted) this.input.press(code);
        const online = this.doc?.body?.classList.contains("online-session");
        if (press(3) || press(15)) this.input.pulse(this.gh.debug.ctx.arsenal.cur === 0 ? "Digit2" : "Digit1");
        if (press(12)) this.input.pulse("KeyT");
        if (!online && press(4)) this.input.pulse("KeyG");
        if (!online && press(13)) this.input.pulse("KeyX");
        this.input.move(-left.y || 0, left.x);
        const dt = this.lastTime == null ? 1 / 60 : Math.max(0, Math.min(0.1, (time - this.lastTime) / 1e3));
        const settings = this.gh.debug.ctx.settings;
        const rate = 2.8 * preferences.sensitivity * dt / (22e-4 * (settings.sens || 1));
        this.input.look(
          right.x * Math.abs(right.x) * rate,
          right.y * Math.abs(right.y) * rate * (preferences.invertY ? -1 : 1) * (settings.invertY ? -1 : 1)
        );
      } else {
        this.input.reset();
        this.sprinting = false;
      }
      this.lastTime = time;
    }
    this.previous = buttons;
  }
}
function navigateGamepadMenu(gh, action, doc = document) {
  const menus = gh.debug.ctx.hud.menus;
  if (menus.root.classList.contains("hidden")) return;
  if (action === "back") {
    menus.back();
    return;
  }
  const page = menus.pages[menus.page];
  if (!page) return;
  const visible = (element) => !element.disabled && !element.closest("[hidden]") && element.getClientRects().length;
  const items = [...page.querySelectorAll("button, input, select, a[href], [data-nav]")].filter(visible);
  const current = doc.activeElement, index = items.indexOf(current);
  if (action === "confirm") {
    const target2 = index >= 0 ? current : items[0];
    if (target2?.matches("input[type=checkbox]")) target2.click();
    else if (target2?.matches("button, a, [data-nav]")) target2.click();
    else target2?.focus();
    return;
  }
  if (action.endsWith("tab")) {
    const tabs = [...page.querySelectorAll(".tab")].filter(visible), at = tabs.findIndex((t) => t.classList.contains("on"));
    tabs[(at + (action === "next-tab" ? 1 : tabs.length - 1)) % tabs.length]?.click();
    return;
  }
  if ((action === "left" || action === "right") && current?.matches("input[type=range], select")) {
    const delta2 = action === "right" ? 1 : -1;
    if (current.tagName === "SELECT") current.selectedIndex = Math.max(0, Math.min(current.options.length - 1, current.selectedIndex + delta2));
    else current.value = Math.max(Number(current.min), Math.min(Number(current.max), Number(current.value) + delta2 * Number(current.step || 1)));
    current.dispatchEvent(new Event("input", { bubbles: true }));
    current.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (action === "left" || action === "right") {
    menus._key({ code: action === "left" ? "ArrowLeft" : "ArrowRight", target: doc.body, preventDefault() {
    } });
    return;
  }
  const delta = action === "down" ? 1 : -1;
  const target = items[index < 0 ? 0 : (index + delta + items.length) % items.length];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "nearest" });
}
export {
  GamepadControls,
  gamepadStick,
  navigateGamepadMenu
};
