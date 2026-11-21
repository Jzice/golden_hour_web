import { AdaptiveQuality } from "./performance-policy.js";
import { contextDiagnostics } from "./webgl-context.js";
const report = document.createElement("output");
report.id = "gh-performance";
report.hidden = true;
document.body.append(report);
async function install() {
  while (!window.GH?.ready) await new Promise((r) => setTimeout(r, 100));
  const { GH } = window;
  const d = GH.debug, gfx = d.gfx, renderer = gfx.renderer;
  const gl = renderer.getContext();
  const webglVersion = gl.getParameter(gl.VERSION);
  const startup = document.createElement("output");
  startup.id = "gh-startup";
  startup.hidden = true;
  const startupState = {
    readyMs: Math.round(performance.now()),
    stages: d.boot,
    armouryMs: d.ctx.hud.studio?.bakeMs,
    swatchesMs: d.ctx.hud.warmMs,
    cache: globalThis.GHBoot?.stats,
    transferredBytes: performance.getEntriesByType("resource").reduce((sum, item) => sum + item.transferSize, 0)
  };
  startup.textContent = JSON.stringify(startupState);
  document.body.append(startup);
  let device = contextDiagnostics(renderer.domElement);
  let gpu = device.renderer || "\u6D4F\u89C8\u5668\u672A\u516C\u5F00\u663E\u5361\u578B\u53F7";
  let software = device.software;
  const policy = new AdaptiveQuality(performance.now());
  const samples = new Float32Array(600);
  let used = 0, index = 0, last = 0, lastMode = "", renderMs = 0;
  function reset() {
    used = index = 0;
    last = 0;
  }
  const originalQuality = gfx.setQuality.bind(gfx);
  const originalScale = gfx.setRenderScale.bind(gfx);
  function apply({ quality, scale }) {
    if (quality !== void 0) {
      if (quality !== gfx.quality) originalQuality(quality);
    } else if (scale !== void 0) {
      originalScale(scale);
    }
    reset();
  }
  gfx.setQuality = (value) => {
    const thin = software || globalThis.GHBoot?.policy.mobile || navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4;
    const target = value === "auto" ? thin ? "low" : "medium" : value;
    apply({ quality: target });
    policy.reset(performance.now());
  };
  gfx.setRenderScale = (value) => {
    originalScale(value);
    reset();
    policy.reset(performance.now());
  };
  if (globalThis.GHBoot?.policy.mobile) d.ctx.settings.quality = "auto";
  gfx.setQuality(d.ctx.settings.quality);
  const render = gfx.render;
  gfx.render = function(dt) {
    if (gl.isContextLost()) {
      renderMs = 0;
      reset();
      return;
    }
    const now = performance.now(), mode = GH.G.state;
    if (mode !== lastMode || document.hidden) {
      reset();
      lastMode = mode;
    }
    if (last && !document.hidden) {
      samples[index++ % samples.length] = now - last;
      used = Math.min(used + 1, samples.length);
    }
    last = now;
    const start = performance.now();
    render.call(this, dt);
    renderMs = performance.now() - start;
  };
  const map = d.ctx.hud.map, updateMap = map.update;
  let mapTime = 0;
  map.update = function(dt, ...args) {
    mapTime += dt;
    if (mapTime < 0.1) return;
    updateMap.call(this, mapTime, ...args);
    mapTime = 0;
  };
  const physics = d.physics, updatePhysics = physics.update;
  let physicsTime = 0;
  physics.update = function(dt) {
    if (gfx.quality === "low" && document.body.classList.contains("online-session")) {
      physicsTime += dt;
      if (physicsTime < 1 / 30) return;
      dt = Math.min(physicsTime, 1 / 15);
    }
    physicsTime = 0;
    updatePhysics.call(this, dt);
  };
  setInterval(() => {
    device = contextDiagnostics(renderer.domElement);
    gpu = device.renderer || "\u6D4F\u89C8\u5668\u672A\u516C\u5F00\u663E\u5361\u578B\u53F7";
    software = device.software;
    startup.textContent = JSON.stringify(startupState);
    const values = Array.from(samples.subarray(0, used)).sort((a, b) => a - b);
    const mean = used ? values.reduce((a, b) => a + b, 0) / used : 0;
    const p95 = values[Math.floor(values.length * 0.95)] || 0;
    const state = {
      fps: mean ? Math.round(1e3 / mean) : 0,
      frameMs: +mean.toFixed(2),
      p95Ms: +p95.toFixed(2),
      samples: used,
      renderSubmitMs: +renderMs.toFixed(2),
      gpu,
      software,
      context: device,
      webgl: webglVersion,
      automatic: d.ctx.settings.quality === "auto",
      quality: gfx.quality,
      scale: gfx.q.scale,
      motionBlur: gfx.motionBlur,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length || 0,
      heapBytes: performance.memory?.usedJSHeapSize,
      physicsBodies: physics.bodies.length,
      actors: d.ctx.match.actors.length,
      mode: GH.G.state,
      network: d.network
    };
    report.textContent = JSON.stringify(state);
    globalThis.GHDiagnostics?.sample({
      ...state,
      contextLosses: device.lossCount,
      queuedCommands: d.network?.queuedCommands || 0,
      inputDropped: d.network?.inputDropped || 0
    });
    const panel = d.ctx.hud.menus.pages.settings.querySelector(
      '.st-panel[data-tab="graphics"] .st-side'
    );
    if (panel && d.ctx.hud.menus.page === "settings") {
      let status = panel.querySelector(".gh-device");
      if (!status) {
        status = document.createElement("p");
        status.className = "gh-device";
        panel.append(status);
      }
      if (globalThis.GHDiagnostics && !panel.querySelector(".gh-copy-diagnostics")) {
        const copy = document.createElement("button");
        copy.className = "btn gh-copy-diagnostics";
        copy.textContent = "\u590D\u5236\u6545\u969C\u8BCA\u65AD";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(globalThis.GHDiagnostics.report(), null, 2));
            copy.textContent = "\u5DF2\u590D\u5236\u8BCA\u65AD\uFF0C\u53EF\u968F\u95EE\u9898\u53CD\u9988";
          } catch {
            copy.textContent = "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5141\u8BB8\u526A\u8D34\u677F\u8BBF\u95EE\u540E\u91CD\u8BD5";
          }
        });
        panel.append(copy);
      }
      const acceleration = software === true ? "\u8F6F\u4EF6\u6E32\u67D3" : software === false ? "\u663E\u5361\u52A0\u901F" : "\u6E32\u67D3\u5668\u7C7B\u578B\u672A\u516C\u5F00";
      const contextState = device.status === "failed" ? " \xB7 \u663E\u5361\u8D44\u6E90\u6062\u590D\u5931\u8D25" : device.status === "lost" || device.status === "restoring" ? " \xB7 \u663E\u5361\u4E0A\u4E0B\u6587\u6062\u590D\u4E2D" : device.restoreCount ? " \xB7 \u663E\u5361\u4E0A\u4E0B\u6587\u5DF2\u6062\u590D" : "";
      status.textContent = `${acceleration}${contextState} \xB7 ${state.fps} FPS \xB7 \u7279\u6548 ${state.automatic ? "\u81EA\u52A8 / " : ""}${{ low: "\u4F4E", medium: "\u4E2D", high: "\u9AD8", ultra: "\u6781\u9AD8" }[state.quality]} \xB7 \u6E32\u67D3\u5206\u8FA8\u7387 ${Math.round(state.scale * 100)}% \xB7 ${state.buffer.join(" \xD7 ")}
${gpu}
WebGL \u7B56\u7565\uFF1A${device.strategy || "\u672A\u516C\u5F00"} \xB7 ${device.powerPreference || "\u6D4F\u89C8\u5668\u9ED8\u8BA4"}
\u672C\u6B21\u52A0\u8F7D ${(startupState.readyMs / 1e3).toFixed(1)} \u79D2${startupState.cache?.materials === "hit" ? " \xB7 \u672C\u5730\u6750\u8D28\u7F13\u5B58" : ""}${startupState.cache?.armoury === "prebaked" ? " \xB7 \u9884\u751F\u6210\u6B66\u5668\u56FE\u50CF" : ""}`;
      status.style.overflowWrap = "anywhere";
    }
    const next = policy.observe({
      now: performance.now(),
      automatic: state.automatic,
      playing: state.mode === "playing",
      hidden: document.hidden,
      count: used,
      mean,
      p95,
      quality: state.quality,
      scale: state.scale
    });
    if (next) apply(next);
    reset();
  }, 2e3);
}
install().catch((error) => console.error("Performance controller:", error));
