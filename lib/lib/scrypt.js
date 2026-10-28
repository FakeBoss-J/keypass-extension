/**
 * KeyPass 轻量纯 JavaScript scrypt 算法实现 (RFC 7914)
 * 完全兼容 Node.js 与现代浏览器 Web Crypto API
 */

function R(a, b) {
  return (a << b) | (a >>> (32 - b));
}

function salsa20_8(B, out) {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) x[i] = B[i];

  for (let i = 0; i < 4; i++) {
    // 列混淆轮
    x[ 4] ^= R(x[ 0] + x[12] | 0,  7);  x[ 8] ^= R(x[ 4] + x[ 0] | 0,  9);
    x[12] ^= R(x[ 8] + x[ 4] | 0, 13);  x[ 0] ^= R(x[12] + x[ 8] | 0, 18);
    x[ 9] ^= R(x[ 5] + x[ 1] | 0,  7);  x[13] ^= R(x[ 9] + x[ 5] | 0,  9);
    x[ 1] ^= R(x[13] + x[ 9] | 0, 13);  x[ 5] ^= R(x[ 1] + x[13] | 0, 18);
    x[14] ^= R(x[10] + x[ 6] | 0,  7);  x[ 2] ^= R(x[14] + x[10] | 0,  9);
    x[ 6] ^= R(x[ 2] + x[14] | 0, 13);  x[10] ^= R(x[ 6] + x[ 2] | 0, 18);
    x[ 3] ^= R(x[15] + x[11] | 0,  7);  x[ 7] ^= R(x[ 3] + x[15] | 0,  9);
    x[11] ^= R(x[ 7] + x[ 3] | 0, 13);  x[15] ^= R(x[11] + x[ 7] | 0, 18);

    // 行混淆轮
    x[ 1] ^= R(x[ 0] + x[ 3] | 0,  7);  x[ 2] ^= R(x[ 1] + x[ 0] | 0,  9);
    x[ 3] ^= R(x[ 2] + x[ 1] | 0, 13);  x[ 0] ^= R(x[ 3] + x[ 2] | 0, 18);
    x[ 6] ^= R(x[ 5] + x[ 4] | 0,  7);  x[ 7] ^= R(x[ 6] + x[ 5] | 0,  9);
    x[ 4] ^= R(x[ 7] + x[ 6] | 0, 13);  x[ 5] ^= R(x[ 4] + x[ 7] | 0, 18);
    x[11] ^= R(x[10] + x[ 9] | 0,  7);  x[ 8] ^= R(x[11] + x[10] | 0,  9);
    x[ 9] ^= R(x[ 8] + x[11] | 0, 13);  x[10] ^= R(x[ 9] + x[ 8] | 0, 18);
    x[12] ^= R(x[15] + x[14] | 0,  7);  x[13] ^= R(x[12] + x[15] | 0,  9);
    x[14] ^= R(x[13] + x[12] | 0, 13);  x[15] ^= R(x[14] + x[13] | 0, 18);
  }

  for (let i = 0; i < 16; i++) {
    out[i] = (x[i] + B[i]) | 0;
  }
}

function blockMix(r, Bin, Bout) {
  const X = new Uint32Array(16);
  const blockWords = 16;
  const totalWords = 2 * r * blockWords;

  const lastOffset = (2 * r - 1) * blockWords;
  for (let i = 0; i < 16; i++) X[i] = Bin[lastOffset + i];

  const Y = new Uint32Array(totalWords);
  const T = new Uint32Array(16);

  for (let i = 0; i < 2 * r; i++) {
    const inOffset = i * blockWords;
    for (let j = 0; j < 16; j++) {
      T[j] = Bin[inOffset + j] ^ X[j];
    }
    salsa20_8(T, X);
    const outOffset = i * blockWords;
    for (let j = 0; j < 16; j++) {
      Y[outOffset + j] = X[j];
    }
  }

  for (let i = 0; i < r; i++) {
    const srcEven = (2 * i) * blockWords;
    const dstEven = i * blockWords;
    for (let j = 0; j < 16; j++) Bout[dstEven + j] = Y[srcEven + j];

    const srcOdd = (2 * i + 1) * blockWords;
    const dstOdd = (i + r) * blockWords;
    for (let j = 0; j < 16; j++) Bout[dstOdd + j] = Y[srcOdd + j];
  }
}

function roMix(N, r, B) {
  const blockWords = 32 * r;
  const V = new Uint32Array(N * blockWords);
  const X = new Uint32Array(blockWords);
  const T = new Uint32Array(blockWords);

  for (let i = 0; i < blockWords; i++) X[i] = B[i];

  for (let i = 0; i < N; i++) {
    const vOffset = i * blockWords;
    for (let j = 0; j < blockWords; j++) V[vOffset + j] = X[j];
    blockMix(r, X, T);
    for (let j = 0; j < blockWords; j++) X[j] = T[j];
  }

  const mask = N - 1;
  for (let i = 0; i < N; i++) {
    const lastWord = X[(2 * r - 1) * 16];
    const j = (lastWord >>> 0) & mask;
    const vOffset = j * blockWords;

    for (let k = 0; k < blockWords; k++) {
      T[k] = X[k] ^ V[vOffset + k];
    }
    blockMix(r, T, X);
  }

  for (let i = 0; i < blockWords; i++) B[i] = X[i];
}

async function pbkdf2HmacSha256(passwordBytes, saltBytes, iterations, keylen) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256',
      },
      key,
      keylen * 8
    );
    return new Uint8Array(bits);
  }

  // Node.js fallback
  const nodeCrypto = require('node:crypto');
  return new Uint8Array(nodeCrypto.pbkdf2Sync(passwordBytes, saltBytes, iterations, keylen, 'sha256'));
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error('Unsupported input type for scrypt');
}

/**
 * 标准 scrypt 密钥推导
 */
async function scrypt(password, salt, N = 16384, r = 8, p = 1, keylen = 32) {
  const passBytes = toUint8Array(password);
  const saltBytes = toUint8Array(salt);

  const Bbytes = await pbkdf2HmacSha256(passBytes, saltBytes, 1, p * 128 * r);
  const B = new Uint32Array(Bbytes.buffer, Bbytes.byteOffset, Bbytes.byteLength / 4);
  const blockWords = 32 * r;

  for (let i = 0; i < p; i++) {
    const bSlice = B.subarray(i * blockWords, (i + 1) * blockWords);
    roMix(N, r, bSlice);
  }

  const Bfinal = new Uint8Array(B.buffer, B.byteOffset, B.byteLength);
  return await pbkdf2HmacSha256(passBytes, Bfinal, 1, keylen);
}

(typeof globalThis !== 'undefined' ? globalThis : self).KeyPassScrypt = { scrypt };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scrypt };
}
