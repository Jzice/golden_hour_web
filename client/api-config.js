const approvedRTCOrigins = /* @__PURE__ */ new WeakMap();
function apiOrigin(value, pageURL) {
  if (value === "") throw Error("\u8054\u673A\u529F\u80FD\u6682\u672A\u5F00\u653E\uFF0C\u8BF7\u4F7F\u7528\u5355\u4EBA\u8BAD\u7EC3\u3002");
  const page = new URL(pageURL);
  if (!value) return page.origin;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("API \u5730\u5740\u5FC5\u987B\u662F\u5B8C\u6574\u7684 Origin\uFF0C\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u6216\u767B\u5F55\u4FE1\u606F\u3002");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw Error("API \u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF08localhost \u5F00\u53D1\u9664\u5916\uFF09\u3002");
  return url.origin;
}
function rtcSignalingURL(config, pageURL) {
  const origin = approvedRTCOrigins.get(config) || new URL(pageURL).origin;
  const url = new URL(config.url, origin + "/");
  if (url.origin !== origin || url.username || url.password)
    throw Error("WebRTC \u4FE1\u4EE4\u5FC5\u987B\u4F7F\u7528\u6279\u51C6\u7684\u6E38\u620F\u670D\u52A1\u5668\u3002");
  return url;
}
async function loadApiConfig(origin, pageURL, request = globalThis.fetch) {
  const approved = apiOrigin(origin, pageURL);
  try {
    const response = await request(new URL("/api/config", approved), {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) throw Error("\u8054\u673A\u670D\u52A1\u672A\u542F\u52A8\u6216\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    const config = await response.json();
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw Error("\u8054\u673A\u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    if (config.rtc && typeof config.rtc === "object") {
      approvedRTCOrigins.set(config.rtc, approved);
      rtcSignalingURL(config.rtc, pageURL);
    }
    return config;
  } catch (cause) {
    const error = new Error(cause.message || "\u8054\u673A\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002", { cause });
    if (approved !== new URL(pageURL).origin && approved.startsWith("https:"))
      error.trustURL = new URL("/api/health", approved).href;
    throw error;
  }
}
export {
  apiOrigin,
  loadApiConfig,
  rtcSignalingURL
};
