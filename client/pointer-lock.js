function requestPointerLock(canvas, { signal, timeoutMs = 2e3 } = {}) {
  const doc = canvas.ownerDocument;
  return new Promise((resolve, reject) => {
    let timer;
    function finish(error) {
      clearTimeout(timer);
      doc.removeEventListener("pointerlockchange", changed);
      doc.removeEventListener("pointerlockerror", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    }
    function changed() {
      if (doc.pointerLockElement === canvas) finish();
    }
    function failed() {
      finish(Error("\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u9501\u5B9A\u9F20\u6807\uFF0C\u8BF7\u70B9\u51FB\u7EE7\u7EED\u91CD\u8BD5\u3002"));
    }
    function aborted() {
      finish(new DOMException("Pointer lock cancelled", "AbortError"));
    }
    if (signal?.aborted) return aborted();
    if (doc.pointerLockElement === canvas) return finish();
    doc.addEventListener("pointerlockchange", changed);
    doc.addEventListener("pointerlockerror", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(failed, timeoutMs);
    try {
      const result = canvas.requestPointerLock();
      Promise.resolve(result).then(changed, finish);
    } catch (error) {
      finish(error);
    }
  });
}
export {
  requestPointerLock
};
