const DB_NAME = "mcr_forms_db";
const DB_VERSION = 1;

export const STORES = {
  phi: "phi",
  staff: "staff",
  meta: "meta",
  assets: "assets"
};

let cachedDb = null;

function openDb() {
  if (cachedDb) return Promise.resolve(cachedDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.phi)) db.createObjectStore(STORES.phi);
      if (!db.objectStoreNames.contains(STORES.staff)) db.createObjectStore(STORES.staff);
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta);
      if (!db.objectStoreNames.contains(STORES.assets)) db.createObjectStore(STORES.assets);
    };
    req.onsuccess = () => {
      cachedDb = req.result;
      cachedDb.onclose = () => { cachedDb = null; };
      resolve(cachedDb);
    };
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let output;
    try {
      output = fn(store, transaction);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(output);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function get(store, key) {
  return tx(store, "readonly", (s) => {
    const req = s.get(key);
    req.onsuccess = () => {};
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function set(store, key, value) {
  return tx(store, "readwrite", (s) => s.put(value, key));
}

export async function del(store, key) {
  return tx(store, "readwrite", (s) => s.delete(key));
}

export async function keys(store) {
  return tx(store, "readonly", (s) => {
    const req = s.getAllKeys();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function clearStore(store) {
  return tx(store, "readwrite", (s) => s.clear());
}

export async function getStaffInfo() {
  return (await get(STORES.staff, "profile")) || { firstName: "", lastName: "", role: "" };
}

export async function setStaffInfo(staff) {
  return set(STORES.staff, "profile", staff);
}

export async function getDefaultDirHandle() {
  return get(STORES.staff, "defaultDirHandle");
}

export async function setDefaultDirHandle(handle) {
  return set(STORES.staff, "defaultDirHandle", handle);
}

export async function getSessionBlob() {
  return get(STORES.phi, "sessionBlob");
}

export async function setSessionBlob(blob) {
  return set(STORES.phi, "sessionBlob", blob);
}

export async function getSalt() {
  return get(STORES.meta, "pinSalt");
}

export async function setSalt(salt) {
  return set(STORES.meta, "pinSalt", salt);
}

export async function deleteSalt() {
  return del(STORES.meta, "pinSalt");
}

export async function setAssetMirror(path, bytes) {
  return set(STORES.assets, path, bytes);
}

export async function hasAssetMirror(path) {
  const value = await get(STORES.assets, path);
  return Boolean(value);
}

function randomBytes(size) {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return arr;
}

export async function overwriteAndDelete(store, key) {
  const existing = await get(store, key);
  if (existing == null) return;

  const size = typeof existing === "string" ? Math.max(32, existing.length) : 2048;
  await set(store, key, randomBytes(size));
  await del(store, key);
}
