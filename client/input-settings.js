const names = { keyboard: "\u9F20\u6807\u952E\u76D8", touch: "\u5C4F\u5E55\u89E6\u6478", gamepad: "\u624B\u67C4" };
function installInputSettings({ menus, devices, controls }) {
  if (!devices) return;
  const section = document.createElement("section");
  section.className = "input-device-settings";
  section.innerHTML = `<h4>\u8F93\u5165\u8BBE\u5907</h4>
    <label class="touch-setting">\u64CD\u4F5C\u65B9\u5F0F<select data-input-mode aria-label="\u64CD\u4F5C\u65B9\u5F0F">
      <option value="auto">\u81EA\u52A8\u8BC6\u522B</option><option value="keyboard">\u9F20\u6807\u952E\u76D8</option><option value="touch">\u5C4F\u5E55\u89E6\u6478</option><option value="gamepad">\u624B\u67C4</option>
    </select></label>
    <p data-input-status role="status"></p>
    <div data-gamepad-settings hidden>
      <p data-gamepad-status role="status"></p>
      <label class="touch-setting">\u8F6C\u5411\u7075\u654F\u5EA6<input type="range" min="0.25" max="3" step="0.05" data-pad-setting="sensitivity" aria-label="\u624B\u67C4\u8F6C\u5411\u7075\u654F\u5EA6"><output></output></label>
      <label class="touch-setting">\u6447\u6746\u6B7B\u533A<input type="range" min="0.08" max="0.35" step="0.01" data-pad-setting="deadzone" aria-label="\u624B\u67C4\u6447\u6746\u6B7B\u533A"><output></output></label>
      <label class="touch-setting"><input type="checkbox" data-pad-setting="invertY"> \u53CD\u8F6C\u624B\u67C4\u7EB5\u5411\u89C6\u89D2</label>
      <p class="gamepad-bindings">\u5DE6\u6447\u6746\u79FB\u52A8 \xB7 \u53F3\u6447\u6746\u8F6C\u5411 \xB7 LT/L2 \u7784\u51C6 \xB7 RT/R2 \u5F00\u706B<br>A/\xD7 \u8DF3\u8DC3 \xB7 B/\u25CB \u8E72\u4E0B\uFF0F\u51B2\u523A\u65F6\u6ED1\u94F2 \xB7 X/\u25A1 \u6362\u5F39 \xB7 Y/\u25B3 \u5207\u67AA<br>\u5DE6\u6447\u6746\u6309\u4E0B\u5207\u6362\u51B2\u523A \xB7 RB/R1 \u6216\u53F3\u6447\u6746\u6309\u4E0B\u8FD1\u6218<br>Start/Options \u6682\u505C\uFF0F\u7EE7\u7EED \xB7 View/Share \u6218\u7EE9<br>\u83DC\u5355\uFF1A\u5DE6\u6447\u6746\uFF0F\u65B9\u5411\u952E\u5BFC\u822A\uFF0CA/\xD7 \u786E\u8BA4\uFF0CB/\u25CB \u8FD4\u56DE\uFF0CLB/RB \u5207\u6362\u9009\u9879\u5361\u3002<br>\u5355\u4EBA\u8BAD\u7EC3\uFF1ALB/L1 \u624B\u96F7\uFF0C\u65B9\u5411\u952E\u2193\u98DE\u6251\u3002\u8054\u673A\u6682\u4E0D\u652F\u6301\u8FD9\u4E24\u9879\u3002</p>
    </div>
    <p data-input-saved role="status">\u9009\u62E9\u4FDD\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\uFF0C\u5355\u4EBA\u4E0E\u8054\u673A\u5171\u7528\u3002</p>`;
  menus.pages.settings.querySelector('.st-panel[data-tab="controls"]').prepend(section);
  const mode = section.querySelector("[data-input-mode]");
  const render = () => {
    mode.value = devices.preferences.mode;
    section.querySelector("[data-input-status]").textContent = devices.preferences.mode === "auto" ? "\u5F53\u524D\u8BC6\u522B\uFF1A" + names[devices.effective] + "\u3002\u8BC6\u522B\u4E0D\u51C6\u65F6\u53EF\u624B\u52A8\u9009\u62E9\u3002" : "\u5F53\u524D\u4F7F\u7528\uFF1A" + names[devices.effective] + "\u3002\u624B\u52A8\u9009\u62E9\u4F18\u5148\uFF0C\u4E0D\u4F1A\u88AB\u81EA\u52A8\u8BC6\u522B\u8986\u76D6\u3002";
    section.querySelector("[data-gamepad-settings]").hidden = devices.effective !== "gamepad";
    section.querySelector("[data-gamepad-status]").textContent = devices.padStatus;
    for (const input of section.querySelectorAll("[data-pad-setting]")) {
      const value = devices.preferences[input.dataset.padSetting];
      if (input.type === "checkbox") input.checked = value;
      else {
        input.value = value;
        input.nextElementSibling.textContent = input.dataset.padSetting === "deadzone" ? Math.round(value * 100) + "%" : value.toFixed(2) + "\xD7";
      }
    }
    const touchSettings = menus.pages.settings.querySelector(".touch-settings");
    if (touchSettings) touchSettings.hidden = devices.effective !== "touch";
  };
  section.addEventListener("change", (event) => {
    const target = event.target;
    const value = target === mode ? { mode: mode.value } : target.dataset.padSetting ? { [target.dataset.padSetting]: target.type === "checkbox" ? target.checked : Number(target.value) } : null;
    if (!value) return;
    const saved = devices.save(value);
    controls?.setDevice();
    section.querySelector("[data-input-saved]").textContent = saved ? "\u64CD\u4F5C\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u5355\u4EBA\u4E0E\u8054\u673A\u5171\u7528\u3002" : "\u8BBE\u7F6E\u5DF2\u751F\u6548\uFF1B\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u4E0B\u6B21\u6253\u5F00\u9700\u91CD\u65B0\u8BBE\u7F6E\u3002";
    render();
  });
  devices.addEventListener("change", render);
  render();
}
export {
  installInputSettings
};
