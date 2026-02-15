import { PBKDF2_ITERATIONS } from "./constants.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function generateSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export function toBase64(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const chunks = [];
  for (let i = 0; i < arr.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, arr.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

export function fromBase64(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function generatePepper() {
  const pepper = new Uint8Array(32);
  crypto.getRandomValues(pepper);
  return pepper;
}

export async function deriveAesKey(pin, saltBytes, pepperBytes) {
  const combinedSalt = pepperBytes
    ? new Uint8Array([...saltBytes, ...pepperBytes])
    : saltBytes;
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: combinedSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(key, payload) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    iv: toBase64(iv),
    cipher: toBase64(cipher)
  };
}

export async function decryptJson(key, blob) {
  const iv = fromBase64(blob.iv);
  const cipher = fromBase64(blob.cipher);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return JSON.parse(decoder.decode(plaintext));
}
