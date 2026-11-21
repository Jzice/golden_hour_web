import { RTCTransport, PeerTransport, LoopbackTransport } from "./webrtc.js";
const PHASES = ["lobby", "countdown", "live", "over"];
const WEAPONS = ["ar", "smg", "shotgun", "pistol"];
const INPUT_BYTES = 25;
const INPUT_MAGIC = 18248;
const MAX_RELIABLE_COMMANDS = 128;
const MAX_RELIABLE_BYTES = 65536;
const MOTION_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "yaw", "pitch"];
const COUNTER_FIELDS = [
  "hp",
  "ammo",
  "reserve",
  "kills",
  "deaths",
  "score",
  "respawn",
  "reload"
];
async function deadline(operation, timeout, message, signal) {
  if (signal?.aborted) throw Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002");
  let timer, abort;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), timeout);
        if (signal) {
          abort = () => reject(Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
function encodeInput(input, bytes = new Uint8Array(INPUT_BYTES)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(0, INPUT_MAGIC, true);
  view.setUint8(2, 1);
  view.setUint8(3, 1);
  view.setUint32(4, input.seq >>> 0, true);
  view.setFloat32(8, input.forward ?? 0, true);
  view.setFloat32(12, input.right ?? 0, true);
  view.setFloat32(16, input.yaw ?? 0, true);
  view.setFloat32(20, input.pitch ?? 0, true);
  view.setUint8(24, input.buttons || 0);
  return bytes;
}
function decodeSnapshot(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (bytes.byteLength < 24) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== 18248 || v.getUint8(2) !== 1 || v.getUint8(3) !== 2)
    return null;
  const count = v.getUint8(13);
  if (count > 10 || bytes.byteLength !== 24 + 64 * count || v.getUint8(12) > 3)
    return null;
  const out = {
    tick: v.getUint32(4, true),
    time: v.getUint32(8, true),
    phase: PHASES[v.getUint8(12)],
    scores: [v.getUint16(14, true), v.getUint16(16, true)],
    remaining: v.getUint32(18, true),
    winner: v.getInt8(22),
    players: []
  };
  for (let i = 0; i < count; i++) {
    const o = 24 + i * 64, flags = v.getUint8(o + 57);
    const p = { id: v.getUint32(o, true), ack: v.getUint32(o + 4, true) };
    for (let j = 0; j < MOTION_FIELDS.length; j++) {
      const key = MOTION_FIELDS[j];
      p[key] = v.getFloat32(o + 8 + j * 4, true);
      if (!Number.isFinite(p[key])) return null;
    }
    for (let j = 0; j < COUNTER_FIELDS.length; j++)
      p[COUNTER_FIELDS[j]] = v.getUint16(o + 40 + j * 2, true);
    p.team = v.getUint8(o + 56);
    p.alive = !!(flags & 1);
    p.crouch = !!(flags & 2);
    p.ground = !!(flags & 4);
    p.connected = !!(flags & 8);
    p.protected = !!(flags & 16);
    p.jumpHeld = !!(flags & 32);
    p.bot = !!(flags & 64);
    p.sliding = !!(flags & 128);
    p.weapon = WEAPONS[v.getUint8(o + 58)];
    p.slideCooldown = v.getUint8(o + 59) / 100;
    p.cooldown = v.getUint16(o + 60, true);
    p.slideTime = v.getUint16(o + 62, true) / 1e3;
    if (p.team > 1 || !p.weapon) return null;
    out.players.push(p);
  }
  return out;
}
class Connection extends EventTarget {
  constructor({ connectTimeoutMs = 12e3, leaveTimeoutMs = 500, writeTimeoutMs = 5e3, snapshotTimeoutMs = 5e3 } = {}) {
    super();
    this.connectTimeoutMs = connectTimeoutMs;
    this.leaveTimeoutMs = leaveTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.generation = 0;
    this.intentional = true;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.retry = 0;
    this.latestTick = 0;
    this.inputBytes = new Uint8Array(INPUT_BYTES);
    this.metrics = {
      inputPackets: 0,
      inputBytes: 0,
      inputDropped: 0,
      snapshots: 0,
      snapshotBytes: 0,
      ack: 0,
      rttMs: 0,
      queuedCommands: 0,
      queuedBytes: 0,
      snapshotAgeMs: 0,
      snapshotGaps: 0
    };
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  checkSupport() {
    if (typeof globalThis.WebTransport !== "function" && typeof globalThis.RTCPeerConnection !== "function")
      throw Error(
        "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 WebTransport \u6216 WebRTC\uFF0C\u8BF7\u66F4\u65B0\u6D4F\u89C8\u5668\u540E\u91CD\u8BD5\u3002"
      );
    if (!globalThis.isSecureContext)
      throw Error("\u8054\u673A\u9700\u8981 HTTPS\u3002\u5F00\u53D1\u65F6\u8BF7\u4F7F\u7528\u672C\u673A localhost \u5730\u5740\u3002");
  }
  async connect(hello, config) {
    this.checkSupport();
    if (config.transport === "peer" || config.transport === "loopback") {
      await this.connectAttempt(hello, config, config.transport);
      return;
    }
    const rtc = config.rtc && typeof globalThis.RTCPeerConnection === "function";
    const kind = config.preferredTransport === "webrtc" || typeof globalThis.WebTransport !== "function" ? "webrtc" : "webtransport";
    if (kind === "webrtc" && !rtc) throw Error("\u670D\u52A1\u5668\u6216\u6D4F\u89C8\u5668\u672A\u63D0\u4F9B WebRTC \u8FDE\u63A5\u652F\u6301\u3002");
    const attempt = this.generation + 1;
    try {
      await this.connectAttempt(hello, config, kind);
    } catch (error) {
      if (this.generation !== attempt + 1 || kind !== "webtransport" || !rtc || error.application || this.intentional) throw error;
      this.emit("status", "\u6B63\u5728\u5207\u6362\u5907\u7528\u8FDE\u63A5\u2026");
      await this.connectAttempt(this.hello?.resume ? this.hello : hello, config, "webrtc");
    }
  }
  async connectAttempt(hello, config, kind) {
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.intentional = false;
    this.hello = { ...hello };
    this.config = config;
    const generation = ++this.generation;
    this.emit("status", "\u6B63\u5728\u8FDE\u63A5\u670D\u52A1\u5668\u2026");
    const options = {};
    if (config.certificateHash) {
      options.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: Uint8Array.from(
            atob(config.certificateHash),
            (c) => c.charCodeAt(0)
          )
        }
      ];
    }
    let wt;
    const current = () => {
      if (generation !== this.generation) throw Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002");
    };
    try {
      wt = kind === "peer" ? new PeerTransport(config) : kind === "loopback" ? new LoopbackTransport(config.link) : kind === "webrtc" ? new RTCTransport(config.rtc) : new WebTransport(config.url, options);
      this.transport = wt;
      wt.closed.catch(() => {
      });
      await deadline(async () => {
        await wt.ready;
        current();
        this.emit("status", "\u6B63\u5728\u5EFA\u7ACB\u5BF9\u6218\u8FDE\u63A5\u2026");
        const stream = await wt.createBidirectionalStream();
        current();
        this.writer = stream.writable.getWriter();
        const outgoing = wt.datagrams.writable ?? wt.datagrams.createWritable?.();
        if (!outgoing?.getWriter)
          throw Error("\u5F53\u524D\u6D4F\u89C8\u5668\u7F3A\u5C11 WebTransport \u6570\u636E\u62A5\u652F\u6301\uFF0C\u8BF7\u66F4\u65B0\u6D4F\u89C8\u5668\u540E\u91CD\u8BD5\u3002");
        this.datagrams = outgoing.getWriter();
        this.inputBytes = new Uint8Array(INPUT_BYTES);
        this.inputFlight = null;
        this.sendChain = Promise.resolve();
        this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
        const accepted = new Promise((resolve, reject) => {
          this.handshake = { generation, resolve, reject };
        });
        accepted.catch(() => {
        });
        this.readEvents(stream.readable, generation);
        this.readSnapshots(wt.datagrams.readable, generation);
        this.emit("status", "\u6B63\u5728\u52A0\u5165\u623F\u95F4\u2026");
        await this.send({ ...hello, type: "hello" });
        await accepted;
        current();
      }, this.connectTimeoutMs, "\u8FDE\u63A5\u8D85\u65F6\uFF1A\u8BF7\u91CD\u8BD5\uFF0C\u5E76\u68C0\u67E5\u670D\u52A1\u5668 UDP \u7AEF\u53E3\u4E0E\u8BC1\u4E66\u914D\u7F6E\u3002");
      this.handshake = null;
      this.retry = 0;
      this.metrics.transport = kind;
      this.lastSnapshotAt = performance.now();
      this.watchdog = setInterval(() => {
        if (generation !== this.generation || this.intentional) return;
        this.metrics.snapshotAgeMs = Math.round(performance.now() - this.lastSnapshotAt);
        if (this.metrics.snapshotAgeMs > this.snapshotTimeoutMs) this.fail(generation);
      }, Math.min(1e3, this.snapshotTimeoutMs));
      this.watchdog.unref?.();
      this.emit("status", "\u5DF2\u8FDE\u63A5");
      wt.closed.then(
        () => this.closed(generation),
        () => this.closed(generation)
      );
    } catch (error) {
      if (generation === this.generation) {
        this.generation++;
        clearInterval(this.watchdog);
        this.sendQueue.abort.abort();
        this.handshake?.reject(error);
        this.handshake = null;
        this.writer = null;
        this.datagrams = null;
        this.transport = null;
        this.sendChain = Promise.resolve();
      }
      try {
        wt?.close();
      } catch {
      }
      throw error;
    }
  }
  send(message) {
    if (!this.writer) return Promise.reject(Error("\u5C1A\u672A\u8FDE\u63A5\u670D\u52A1\u5668"));
    const writer = this.writer, generation = this.generation, queue = this.sendQueue;
    if (queue.count >= MAX_RELIABLE_COMMANDS) {
      this.fail(generation);
      return Promise.reject(Error("\u53D1\u9001\u961F\u5217\u5DF2\u6EE1\uFF0C\u6B63\u5728\u6062\u590D\u8FDE\u63A5\u3002"));
    }
    const data = new TextEncoder().encode(JSON.stringify(message) + "\n");
    if (data.byteLength > 16384 || queue.bytes + data.byteLength > MAX_RELIABLE_BYTES) {
      this.fail(generation);
      return Promise.reject(Error("\u53D1\u9001\u961F\u5217\u5DF2\u6EE1\uFF0C\u6B63\u5728\u6062\u590D\u8FDE\u63A5\u3002"));
    }
    queue.count++;
    queue.bytes += data.byteLength;
    this.metrics.queuedCommands = queue.count;
    this.metrics.queuedBytes = queue.bytes;
    const next = this.sendChain.then(() => {
      if (generation !== this.generation || writer !== this.writer)
        throw Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88\u3002");
      return deadline(() => writer.write(data), this.writeTimeoutMs, "\u53D1\u9001\u8D85\u65F6\uFF0C\u6B63\u5728\u6062\u590D\u8FDE\u63A5\u3002", queue.abort.signal);
    });
    const release = () => {
      queue.count--;
      queue.bytes -= data.byteLength;
      if (queue === this.sendQueue) {
        this.metrics.queuedCommands = queue.count;
        this.metrics.queuedBytes = queue.bytes;
      }
    };
    next.then(release, () => {
      release();
      if (generation === this.generation && writer === this.writer)
        this.fail(generation);
    });
    this.sendChain = next.catch(() => {
    });
    return next;
  }
  async input(input) {
    if (!this.datagrams) return;
    if (this.inputFlight) {
      this.metrics.inputDropped++;
      return;
    }
    const flight = { writer: this.datagrams, generation: this.generation };
    this.inputFlight = flight;
    try {
      const bytes = encodeInput(input, this.inputBytes);
      const sent = await deadline(
        () => flight.writer.write(bytes),
        this.writeTimeoutMs,
        "\u8F93\u5165\u53D1\u9001\u8D85\u65F6\u3002",
        this.sendQueue.abort.signal
      );
      if (flight.generation === this.generation) {
        if (sent === false) this.metrics.inputDropped++;
        else {
          this.metrics.inputPackets++;
          this.metrics.inputBytes += INPUT_BYTES;
        }
      }
    } catch {
      if (flight.generation === this.generation && flight.writer === this.datagrams)
        this.fail(flight.generation);
    } finally {
      if (this.inputFlight === flight) this.inputFlight = null;
    }
  }
  async readEvents(readable, generation) {
    const reader = readable.getReader(), decoder = new TextDecoder();
    let buffer = "";
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw Error("\u53EF\u9760\u6D41\u6D88\u606F\u8FC7\u5927");
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "pong" && Number.isFinite(e.nonce))
            this.metrics.rttMs = Math.round(performance.now() - e.nonce);
          if (e.type === "welcome") {
            this.hello = {
              ...this.hello,
              create: false,
              quick: false,
              room: e.room,
              resume: e.resume,
              // 保留身份，断线重连时用同一个 id 回到原席位。
              id: e.id
            };
            this.id = e.id;
            this.latestTick = 0;
            this.handshake?.resolve();
          }
          if (e.type === "error" && this.handshake?.generation === generation) {
            const error = Error(e.message);
            error.application = true;
            this.handshake.reject(error);
          }
          if (e.type === "left") this.leftResolve?.();
          this.emit("event", e);
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.handshake?.reject(error);
        this.emit("error", error.message);
      }
    } finally {
      if (this.handshake?.generation === generation)
        this.handshake.reject(Error("\u670D\u52A1\u5668\u5728\u52A0\u5165\u623F\u95F4\u524D\u5173\u95ED\u4E86\u8FDE\u63A5\u3002"));
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation);
    }
  }
  async readSnapshots(readable, generation) {
    const reader = readable.getReader();
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        const snapshot = decodeSnapshot(value);
        if (snapshot && snapshot.tick > this.latestTick) {
          if (this.latestTick) this.metrics.snapshotGaps += Math.max(0, Math.floor((snapshot.tick - this.latestTick) / 2) - 1);
          this.lastSnapshotAt = performance.now();
          this.metrics.snapshotAgeMs = 0;
          this.metrics.snapshots++;
          this.metrics.snapshotBytes += value.byteLength;
          this.metrics.ack = snapshot.players.find((p) => p.id === this.id)?.ack || 0;
          this.latestTick = snapshot.tick;
          this.emit("snapshot", snapshot);
        }
      }
    } catch {
    } finally {
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation);
    }
  }
  fail(generation) {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    const transport = this.transport;
    if (this.handshake?.generation === generation)
      this.handshake.reject(Error("\u8FDE\u63A5\u901A\u9053\u5DF2\u4E2D\u65AD\u3002"));
    else this.closed(generation);
    try {
      transport?.close();
    } catch {
    }
  }
  closed(generation) {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    this.failedGeneration = generation;
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.writer = null;
    this.datagrams = null;
    this.inputFlight = null;
    this.emit("status", "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u6B63\u5728\u6062\u590D");
    if (!this.hello?.resume) {
      this.emit("error", "\u8FDE\u63A5\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u52A0\u5165\u3002");
      return;
    }
    this.reconnect(generation);
  }
  async reconnect(generation) {
    if (this.retry >= 4) {
      this.emit("error", "\u6062\u590D\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u52A0\u5165\u623F\u95F4\u3002");
      return;
    }
    const delay = Math.min(4e3, 500 * 2 ** this.retry++);
    await new Promise((r) => setTimeout(r, delay));
    if (this.intentional || generation !== this.generation) return;
    try {
      await this.connect(this.hello, this.config);
    } catch (error) {
      this.emit("status", error.message);
      this.reconnect(this.generation);
    }
  }
  async leave() {
    this.intentional = true;
    clearInterval(this.watchdog);
    if (this.writer) {
      const accepted = new Promise((resolve) => {
        this.leftResolve = resolve;
      });
      try {
        await deadline(async () => {
          await this.send({ type: "leave" });
          await accepted;
        }, this.leaveTimeoutMs, "\u9000\u51FA\u623F\u95F4\u8D85\u65F6\u3002");
      } catch {
      }
    }
    this.leftResolve = null;
    this.generation++;
    this.sendQueue.abort.abort();
    try {
      this.transport?.close();
    } catch {
    }
    this.transport = null;
    this.writer = null;
    this.datagrams = null;
    this.id = null;
    this.hello = null;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.metrics.queuedCommands = this.metrics.queuedBytes = 0;
    this.metrics.transport = null;
  }
}
export {
  Connection,
  WEAPONS,
  decodeSnapshot,
  encodeInput
};
