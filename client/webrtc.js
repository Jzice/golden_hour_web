import { rtcSignalingURL } from "./api-config.js";
class RTCTransport {
  constructor(config) {
    this.abort = new AbortController();
    this.closed = new Promise((resolve) => {
      this.finish = resolve;
    });
    this.pc = new RTCPeerConnection({ iceServers: config.iceServers || [] });
    try {
      this.reliable = this.pc.createDataChannel("reliable", { ordered: true, protocol: "gh-pvp-v1" });
      this.state = this.pc.createDataChannel("state", { ordered: false, maxRetransmits: 0, protocol: "gh-pvp-v1" });
    } catch (error) {
      this.pc.close();
      throw error;
    }
    this.reliable.binaryType = this.state.binaryType = "arraybuffer";
    let events, snapshots;
    this.stream = { readable: new ReadableStream({ start(controller) {
      events = controller;
    } }, { highWaterMark: 128 }) };
    this.datagrams = { readable: new ReadableStream({ start(controller) {
      snapshots = controller;
    } }, { highWaterMark: 1 }) };
    this.controllers = [events, snapshots];
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    this.reliable.addEventListener("message", ({ data }) => {
      if (this.abort.signal.aborted) return;
      const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
      if (bytes.byteLength > 16384 || events.desiredSize <= 0) {
        this.close();
        return;
      }
      events.enqueue(bytes);
    });
    this.state.addEventListener("message", ({ data }) => {
      if (this.abort.signal.aborted || !(data instanceof ArrayBuffer) || data.byteLength > 1200) return;
      if (snapshots.desiredSize > 0) snapshots.enqueue(new Uint8Array(data));
    });
    const writer = (channel, text) => ({
      write: async (bytes) => {
        if (channel.readyState !== "open") throw Error("WebRTC \u8FDE\u63A5\u5DF2\u5173\u95ED\u3002");
        if (channel.bufferedAmount + bytes.byteLength > (text ? 65536 : 8192)) {
          if (!text) return false;
          throw Error("WebRTC \u53D1\u9001\u961F\u5217\u5DF2\u6EE1\u3002");
        }
        channel.send(text ? decoder.decode(bytes) : bytes);
        return true;
      }
    });
    this.stream.writable = { getWriter: () => writer(this.reliable, true) };
    this.datagrams.writable = { getWriter: () => writer(this.state, false) };
    for (const channel of [this.reliable, this.state]) {
      channel.addEventListener("close", () => this.close());
      channel.addEventListener("error", () => this.close());
    }
    this.pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(this.pc.connectionState)) this.close();
    });
    this.pc.addEventListener("iceconnectionstatechange", () => {
      if (this.pc.iceConnectionState === "disconnected") {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc.iceConnectionState === "disconnected") this.close();
        }, 3e3);
      }
    });
    this.ready = this.connect(config).catch((error) => {
      this.close();
      throw error;
    });
    this.ready.catch(() => {
    });
  }
  async until(target, event, test) {
    if (this.abort.signal.aborted) throw Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002");
    if (test()) return;
    await new Promise((resolve, reject) => {
      const done = () => {
        if (test()) {
          cleanup();
          resolve();
        }
      };
      const aborted = () => {
        cleanup();
        reject(Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002"));
      };
      const cleanup = () => {
        target.removeEventListener(event, done);
        this.abort.signal.removeEventListener("abort", aborted);
      };
      target.addEventListener(event, done);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      done();
    });
  }
  async connect(config) {
    const url = rtcSignalingURL(config, location.href);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.until(this.pc, "icegatheringstatechange", () => this.pc.iceGatheringState === "complete");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.pc.localDescription),
      signal: this.abort.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    });
    if (!response.ok) throw Error("WebRTC \u670D\u52A1\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    await this.pc.setRemoteDescription(await response.json());
    await Promise.all([this.reliable, this.state].map((channel) => this.until(channel, "open", () => channel.readyState === "open")));
  }
  createBidirectionalStream() {
    return Promise.resolve(this.stream);
  }
  close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    clearTimeout(this.disconnectTimer);
    for (const controller of this.controllers) {
      try {
        controller.close();
      } catch {
      }
    }
    try {
      this.pc.close();
    } finally {
      this.finish();
    }
  }
}
const FRAME_TEXT = 1;
const FRAME_BINARY = 2;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
function textFrame(text) {
  const body = textEncoder.encode(text);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = FRAME_TEXT;
  frame.set(body, 1);
  return frame;
}
function binaryFrame(bytes) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = FRAME_BINARY;
  frame.set(body, 1);
  return frame;
}
class PeerChannel {
  constructor({ peer, hostId, connection, metadata }) {
    if (!connection && !hostId) throw Error("\u7F3A\u5C11\u623F\u95F4\u4E3B\u673A\u5730\u5740\uFF0C\u65E0\u6CD5\u5EFA\u7ACB P2P \u8FDE\u63A5\u3002");
    const conn = connection || peer.connect(hostId, {
      metadata,
      reliable: true,
      serialization: "binary"
    });
    this.conn = conn;
    this.frames = [];
    this.closes = [];
    this.open = new Promise((resolve, reject) => {
      conn.on("open", () => resolve());
      conn.on("error", (error) => reject(error));
    });
    conn.on("data", (data) => {
      let frame = null;
      if (data instanceof Uint8Array) frame = data;
      else if (data instanceof ArrayBuffer) frame = new Uint8Array(data);
      else if (typeof data === "string") frame = textFrame(data);
      if (!frame || !frame.length) return;
      for (const callback of [...this.frames]) {
        try {
          callback(frame);
        } catch {
        }
      }
    });
    conn.on("close", () => {
      for (const callback of [...this.closes]) {
        try {
          callback();
        } catch {
        }
      }
    });
  }
  onFrame(callback) {
    this.frames.push(callback);
  }
  onClose(callback) {
    this.closes.push(callback);
  }
  send(frame) {
    if (!this.conn.open) throw Error("P2P \u8FDE\u63A5\u5DF2\u5173\u95ED\u3002");
    this.conn.send(frame);
  }
  get buffered() {
    return typeof this.conn.bufferedAmount === "number" ? this.conn.bufferedAmount : 0;
  }
}
class LoopbackChannel {
  constructor(link) {
    this.link = link;
    this.frames = [];
    this.closes = [];
    this.open = Promise.resolve();
    this.dispose = link.onFrame((frame) => {
      for (const callback of [...this.frames]) {
        try {
          callback(frame);
        } catch {
        }
      }
    });
    link.onClose(() => {
      for (const callback of [...this.closes]) {
        try {
          callback();
        } catch {
        }
      }
    });
  }
  onFrame(callback) {
    this.frames.push(callback);
  }
  onClose(callback) {
    this.closes.push(callback);
  }
  send(frame) {
    this.link.send(frame);
  }
  get buffered() {
    return 0;
  }
}
class ChannelTransport {
  constructor(channel) {
    this.abort = new AbortController();
    this.closed = new Promise((resolve) => {
      this.finish = resolve;
    });
    let events, snapshots;
    this.stream = {
      readable: new ReadableStream({ start(controller) {
        events = controller;
      } }, { highWaterMark: 64 })
    };
    this.datagrams = {
      readable: new ReadableStream({ start(controller) {
        snapshots = controller;
      } }, { highWaterMark: 8 })
    };
    this.controllers = [events, snapshots];
    this.channel = channel;
    channel.onFrame((frame) => {
      if (this.abort.signal.aborted) return;
      const kind = frame[0];
      const body = frame.subarray(1);
      try {
        if (kind === FRAME_TEXT) {
          if (events.desiredSize <= 0) {
            this.close();
            return;
          }
          events.enqueue(body.slice());
        } else if (kind === FRAME_BINARY) {
          if (snapshots.desiredSize > 0) snapshots.enqueue(body.slice());
        }
      } catch {
      }
    });
    channel.onClose(() => this.close());
    this.stream.writable = { getWriter: () => this.writer(FRAME_TEXT) };
    this.datagrams.writable = { getWriter: () => this.writer(FRAME_BINARY) };
    this.ready = channel.open.catch((error) => {
      this.close();
      throw error;
    });
    this.ready.catch(() => {
    });
  }
  writer(kind) {
    const channel = this.channel;
    return {
      write: async (bytes) => {
        if (this.abort.signal.aborted) throw Error("\u8FDE\u63A5\u5DF2\u5173\u95ED\u3002");
        const frame = kind === FRAME_TEXT ? textFrame(textDecoder.decode(bytes)) : binaryFrame(bytes);
        if (channel.buffered + frame.length > (kind === FRAME_TEXT ? 65536 : 8192)) {
          if (kind !== FRAME_TEXT) return false;
          throw Error("\u53D1\u9001\u961F\u5217\u5DF2\u6EE1\uFF0C\u6B63\u5728\u6062\u590D\u8FDE\u63A5\u3002");
        }
        channel.send(frame);
        return true;
      }
    };
  }
  createBidirectionalStream() {
    return Promise.resolve(this.stream);
  }
  close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    for (const controller of this.controllers) {
      try {
        controller.close();
      } catch {
      }
    }
    try {
      this.channel.dispose?.();
    } catch {
    }
    try {
      this.channel.conn?.close();
    } catch {
    }
    this.finish();
  }
}
class PeerTransport extends ChannelTransport {
  constructor(config) {
    super(new PeerChannel(config));
  }
}
class LoopbackTransport extends ChannelTransport {
  constructor(link) {
    super(new LoopbackChannel(link));
  }
}
export {
  LoopbackTransport,
  PeerTransport,
  RTCTransport,
  binaryFrame,
  textFrame
};
