import { CONTROL_DEFS, defaultLayout, normalizeLayout, controlRect, overlappingControls } from "./touch-layout.js";
function installTouchSettings({ menus, controls }) {
  if (!controls) return;
  const settings = document.createElement("section");
  settings.className = "touch-settings";
  settings.innerHTML = `<h4>\u79FB\u52A8\u7AEF\u89E6\u5C4F\u64CD\u4F5C</h4>
    <p>\u5DE6\u4FA7\u6447\u6746\u79FB\u52A8\uFF0C\u53F3\u534A\u5C4F\u7A7A\u767D\u5904\u6ED1\u52A8\u8F6C\u5411\u3002\u53EF\u6309\u81EA\u5DF1\u7684\u63E1\u6301\u65B9\u5F0F\u5B89\u6392\u6309\u952E\u3002</p>
    <label class="touch-setting">\u8F6C\u5411\u7075\u654F\u5EA6 <input aria-label="\u89E6\u5C4F\u8F6C\u5411\u7075\u654F\u5EA6" type="range" min="0.25" max="3" step="0.05" data-touch-sensitivity><output></output></label>
    <label class="touch-setting"><input type="checkbox" data-touch-fire-look> \u5F00\u706B\u952E\u652F\u6301\u62D6\u52A8\u7784\u51C6</label>
    <button class="btn" data-nav data-touch-edit>\u81EA\u5B9A\u4E49\u6447\u6746\u4E0E\u6309\u952E\u5E03\u5C40 \u203A</button>
    <p class="touch-settings-status" role="status">\u5E03\u5C40\u4FDD\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\uFF0C\u5355\u4EBA\u4E0E\u8054\u673A\u5171\u7528\u3002</p>`;
  menus.pages.settings.querySelector('.st-panel[data-tab="controls"]').append(settings);
  const page = menus._page("touch-layout", `
    <header class="topbar"><button class="backb" data-nav data-touch-cancel>\u2039 \u8FD4\u56DE\u8BBE\u7F6E</button><h2>\u89E6\u5C4F\u5E03\u5C40</h2></header>
    <div class="touch-layout-content">
      <div class="touch-layout-preview">
        <p>\u62D6\u52A8\u6447\u6746\u6216\u6309\u952E\u8C03\u6574\u4F4D\u7F6E\uFF1B\u9009\u4E2D\u540E\u53EF\u8C03\u6574\u5927\u5C0F\u4E0E\u900F\u660E\u5EA6\u3002\u53F3\u534A\u5C4F\u4E3A\u8F6C\u5411\u533A\u57DF\u3002</p>
        <div class="touch-layout-screen" aria-label="\u89E6\u5C4F\u5E03\u5C40\u9884\u89C8">
          <span class="touch-layout-zone">\u53F3\u534A\u5C4F \xB7 \u6ED1\u52A8\u8F6C\u5411</span><span class="touch-layout-cross" aria-hidden="true">\uFF0B</span>
        </div>
      </div>
      <section class="touch-layout-options">
        <label class="touch-setting">\u9009\u4E2D\u63A7\u4EF6<select aria-label="\u9009\u4E2D\u63A7\u4EF6" data-touch-select>${CONTROL_DEFS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>
        <label class="touch-setting">\u5927\u5C0F<input aria-label="\u63A7\u4EF6\u5927\u5C0F" type="range" min="44" max="120" step="2" data-touch-prop="size"><output></output></label>
        <label class="touch-setting">\u900F\u660E\u5EA6<input aria-label="\u63A7\u4EF6\u900F\u660E\u5EA6" type="range" min="0.25" max="1" step="0.05" data-touch-prop="opacity"><output></output></label>
        <label class="touch-setting">\u6C34\u5E73\u4F4D\u7F6E<input aria-label="\u63A7\u4EF6\u6C34\u5E73\u4F4D\u7F6E" type="range" min="0" max="1" step="0.01" data-touch-prop="x"><output></output></label>
        <label class="touch-setting">\u5782\u76F4\u4F4D\u7F6E<input aria-label="\u63A7\u4EF6\u5782\u76F4\u4F4D\u7F6E" type="range" min="0" max="1" step="0.01" data-touch-prop="y"><output></output></label>
        <p class="touch-layout-status" role="status">\u9884\u89C8\u5305\u542B\u5168\u90E8\u6309\u952E\uFF0C\u8054\u673A\u4E2D\u4EC5\u663E\u793A\u5DF2\u652F\u6301\u7684\u52A8\u4F5C\u3002</p>
        <div class="touch-layout-actions"><button class="btn" data-nav data-touch-reset>\u6062\u590D\u9ED8\u8BA4</button><button class="btn" data-nav data-touch-cancel>\u53D6\u6D88</button><button class="btn primary" data-nav data-touch-save>\u4FDD\u5B58\u5E03\u5C40</button></div>
      </section>
    </div>`);
  const screen = page.querySelector(".touch-layout-screen");
  const select = page.querySelector("[data-touch-select]");
  const keys = /* @__PURE__ */ new Map();
  let draft, selected = "stick", drag;
  const previewViewport = () => {
    const { width, height } = controls.viewport();
    return { width: Math.max(width, height), height: Math.min(width, height) };
  };
  for (const [id, label] of CONTROL_DEFS) {
    const key = document.createElement("button");
    key.className = "touch-layout-key";
    key.dataset.control = id;
    key.textContent = label;
    key.setAttribute("aria-label", `\u8C03\u6574${label}\u4F4D\u7F6E`);
    key.setAttribute("aria-pressed", "false");
    screen.append(key);
    keys.set(id, key);
  }
  function syncSettings() {
    const layout = controls.layout;
    settings.querySelector("[data-touch-sensitivity]").value = layout.sensitivity;
    settings.querySelector("output").value = layout.sensitivity.toFixed(2) + "\xD7";
    settings.querySelector("[data-touch-fire-look]").checked = layout.fireLook;
  }
  function render() {
    if (!draft) return;
    const viewport = previewViewport();
    screen.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    const scale = screen.getBoundingClientRect().width / viewport.width;
    for (const [id, key] of keys) {
      const item = draft.controls[id], rect = controlRect(item, viewport.width, viewport.height);
      key.style.left = `${rect.left * scale}px`;
      key.style.top = `${rect.top * scale}px`;
      key.style.width = key.style.height = `${rect.size * scale}px`;
      key.style.setProperty("--control-opacity", item.opacity);
      key.setAttribute("aria-pressed", String(id === selected));
    }
    select.value = selected;
    const overlaps = overlappingControls(draft, selected, viewport.width, viewport.height);
    page.querySelector(".touch-layout-status").textContent = overlaps.length ? `\u5F53\u524D\u63A7\u4EF6\u4E0E${overlaps.join("\u3001")}\u91CD\u53E0\uFF0C\u53EF\u80FD\u8BEF\u89E6\uFF1B\u53EF\u7EE7\u7EED\u62D6\u52A8\u8C03\u6574\u3002` : "\u9884\u89C8\u5305\u542B\u5168\u90E8\u6309\u952E\uFF0C\u8054\u673A\u4E2D\u4EC5\u663E\u793A\u5DF2\u652F\u6301\u7684\u52A8\u4F5C\u3002";
    for (const input of page.querySelectorAll("[data-touch-prop]")) {
      const prop = input.dataset.touchProp, value = draft.controls[selected][prop];
      if (prop === "size") {
        input.min = selected === "stick" ? 80 : 44;
        input.max = selected === "stick" ? 180 : 120;
      }
      input.value = value;
      input.nextElementSibling.value = prop === "size" ? `${Math.round(value)}px` : `${Math.round(value * 100)}%`;
    }
  }
  function endDrag(event) {
    if (!drag || event && event.pointerId !== drag.id) return;
    const previous = drag;
    drag = null;
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id);
  }
  function open() {
    controls.suspend();
    draft = normalizeLayout(controls.layout, previewViewport().width, previewViewport().height);
    menus.go("touch-layout");
    render();
    select.focus({ preventScroll: true });
  }
  settings.querySelector("[data-touch-edit]").addEventListener("click", open);
  settings.addEventListener("input", (event) => {
    const layout = normalizeLayout(controls.layout);
    if (event.target.hasAttribute("data-touch-sensitivity")) layout.sensitivity = Number(event.target.value);
    else if (event.target.hasAttribute("data-touch-fire-look")) layout.fireLook = event.target.checked;
    else return;
    const saved = controls.setLayout(layout);
    settings.querySelector(".touch-settings-status").textContent = saved ? "\u89E6\u5C4F\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002" : "\u8BBE\u7F6E\u5DF2\u751F\u6548\uFF1B\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u4E0B\u6B21\u6253\u5F00\u9700\u91CD\u65B0\u8BBE\u7F6E\u3002";
    syncSettings();
  });
  select.addEventListener("change", () => {
    selected = select.value;
    render();
  });
  page.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    menus.back();
  });
  page.addEventListener("input", (event) => {
    const prop = event.target.dataset.touchProp;
    if (!prop || !draft) return;
    draft.controls[selected][prop] = Number(event.target.value);
    render();
  });
  screen.addEventListener("pointerdown", (event) => {
    const element = event.target.closest("[data-control]");
    if (!element || drag || event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    selected = element.dataset.control;
    const bounds = screen.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      element,
      bounds,
      x: event.clientX,
      y: event.clientY,
      cx: (rect.left + rect.width / 2 - bounds.left) / bounds.width,
      cy: (rect.top + rect.height / 2 - bounds.top) / bounds.height
    };
    element.setPointerCapture(event.pointerId);
    render();
  });
  screen.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const item = draft.controls[selected];
    item.x = Math.max(0, Math.min(1, drag.cx + (event.clientX - drag.x) / drag.bounds.width));
    item.y = Math.max(0, Math.min(1, drag.cy + (event.clientY - drag.y) / drag.bounds.height));
    render();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) screen.addEventListener(type, endDrag);
  page.addEventListener("click", (event) => {
    if (event.target.closest("[data-touch-cancel]")) return menus.back();
    if (event.target.closest("[data-touch-reset]")) {
      endDrag();
      const { sensitivity, fireLook } = draft;
      draft = { ...defaultLayout(previewViewport().width, previewViewport().height), sensitivity, fireLook };
      render();
    }
    if (event.target.closest("[data-touch-save]")) {
      const saved = controls.setLayout(draft);
      settings.querySelector(".touch-settings-status").textContent = saved ? "\u5E03\u5C40\u5DF2\u4FDD\u5B58\uFF0C\u5355\u4EBA\u4E0E\u8054\u673A\u5171\u7528\u3002" : "\u5E03\u5C40\u5DF2\u751F\u6548\uFF1B\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u4E0B\u6B21\u6253\u5F00\u9700\u91CD\u65B0\u8BBE\u7F6E\u3002";
      menus.back();
    }
    const control = event.target.closest("[data-control]");
    if (control) {
      selected = control.dataset.control;
      render();
    }
  });
  const back = menus.back;
  menus.back = function(...args) {
    if (this.page === "touch-layout") {
      endDrag();
      draft = null;
      this.go("settings");
      this._tab("controls");
      syncSettings();
      return;
    }
    return back.apply(this, args);
  };
  const go = menus.go;
  menus.go = function(name, ...args) {
    if (this.page === "touch-layout" && name !== "touch-layout") {
      endDrag();
      draft = null;
    }
    document.body.classList.toggle("touch-editing", name === "touch-layout");
    return go.call(this, name, ...args);
  };
  addEventListener("blur", () => endDrag());
  addEventListener("resize", () => {
    endDrag();
    render();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endDrag();
  });
  new ResizeObserver(() => {
    endDrag();
    render();
  }).observe(screen);
  syncSettings();
}
export {
  installTouchSettings
};
