// Test environment setup.
//
// Node 22+ ships a built-in global `localStorage` (the Web Storage API) that only
// works when the process is started with `--localstorage-file <path>`. Without it,
// the global exists but its methods are missing, so `localStorage.getItem(...)`
// throws "is not a function". In vitest's jsdom environment this broken global
// shadows jsdom's own working `localStorage`.
//
// We install a clean in-memory implementation whenever the active global looks
// broken, so storage-backed tests behave identically across Node versions and
// across the `node` / `jsdom` test environments.

class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  key(i) {
    return Array.from(this.#map.keys())[i] ?? null;
  }
  getItem(k) {
    const key = String(k);
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(k, v) {
    this.#map.set(String(k), String(v));
  }
  removeItem(k) {
    this.#map.delete(String(k));
  }
  clear() {
    this.#map.clear();
  }
}

function storageIsBroken(candidate) {
  return !candidate || typeof candidate.getItem !== "function";
}

if (storageIsBroken(globalThis.localStorage)) {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
  if (typeof globalThis.window !== "undefined") {
    Object.defineProperty(globalThis.window, "localStorage", {
      value: store,
      configurable: true,
      writable: true,
    });
  }
}
