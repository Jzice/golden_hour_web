const CDN = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
let pending = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(Error("\u4E8C\u7EF4\u7801\u7EC4\u4EF6\u8F7D\u5165\u5931\u8D25\u3002"));
    document.head.append(script);
  });
}
function loadQrLibrary() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  if (pending) return pending;
  pending = (async () => {
    const sources = [];
    try {
      sources.push(new URL("../vendor/qrcode.js", import.meta.url).href);
    } catch {
    }
    sources.push(CDN);
    let lastError = null;
    for (const src of sources) {
      try {
        await loadScript(src);
        if (globalThis.qrcode) return globalThis.qrcode;
        lastError = Error("\u4E8C\u7EF4\u7801\u7EC4\u4EF6\u8F7D\u5165\u5931\u8D25\u3002");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || Error("\u4E8C\u7EF4\u7801\u7EC4\u4EF6\u8F7D\u5165\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
async function renderQrCode(target, text, options = {}) {
  if (!target || !text) return null;
  const qrcode = await loadQrLibrary();
  const qr = qrcode(options.typeNumber || 0, options.level || "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = options.margin ?? 2;
  const size = count + margin * 2;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "\u623F\u95F4\u9080\u8BF7\u4E8C\u7EF4\u7801");
  svg.setAttribute("class", "gh-qr");
  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#14110E");
  svg.append(background);
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("fill", "#E0B964");
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      d += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  path.setAttribute("d", d);
  svg.append(path);
  target.replaceChildren(svg);
  return svg;
}
export {
  loadQrLibrary,
  renderQrCode
};
