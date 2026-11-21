function installVoice({ peer, onState = () => {
} } = {}) {
  const calls = /* @__PURE__ */ new Map();
  const sinks = /* @__PURE__ */ new Map();
  let local = null;
  let enabled = false;
  const container = document.createElement("div");
  container.className = "gh-voice-sinks";
  container.setAttribute("aria-hidden", "true");
  document.body.append(container);
  const attach = (peerId, stream) => {
    let element = sinks.get(peerId);
    if (!element) {
      element = document.createElement("audio");
      element.autoplay = true;
      element.setAttribute("playsinline", "");
      container.append(element);
      sinks.set(peerId, element);
    }
    element.srcObject = stream;
    element.play?.().catch(() => {
    });
  };
  peer?.on?.("call", (call) => {
    call.answer(local || new MediaStream());
    call.on("stream", (stream) => attach(call.peer, stream));
  });
  async function enable() {
    if (enabled) return true;
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\uFF0C\u8BF7\u4F7F\u7528\u6700\u65B0\u7248\u6D4F\u89C8\u5668\u3002");
    local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    enabled = true;
    onState({ enabled: true, peers: calls.size });
    return true;
  }
  function disable() {
    enabled = false;
    for (const track of local?.getTracks() || []) track.stop();
    local = null;
    for (const call of calls.values()) {
      try {
        call.close();
      } catch {
      }
    }
    calls.clear();
    for (const element of sinks.values()) {
      element.srcObject = null;
      element.remove();
    }
    sinks.clear();
    onState({ enabled: false, peers: 0 });
  }
  function sync(peerIds) {
    const wanted = new Set((peerIds || []).filter(Boolean));
    for (const [id, call] of calls) {
      if (wanted.has(id)) continue;
      try {
        call.close();
      } catch {
      }
      calls.delete(id);
    }
    if (!enabled || !local) {
      onState({ enabled, peers: calls.size });
      return;
    }
    for (const id of wanted) {
      if (calls.has(id)) continue;
      try {
        const call = peer.call(id, local);
        calls.set(id, call);
        call.on("stream", (stream) => attach(id, stream));
        call.on("close", () => calls.delete(id));
        call.on("error", () => calls.delete(id));
      } catch {
      }
    }
    onState({ enabled, peers: calls.size });
  }
  return {
    enable,
    disable,
    async toggle() {
      if (enabled) {
        disable();
        return false;
      }
      await enable();
      return true;
    },
    sync,
    get enabled() {
      return enabled;
    },
    get peerCount() {
      return calls.size;
    }
  };
}
export {
  installVoice
};
