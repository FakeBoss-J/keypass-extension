/**
 * KeyPass 加密解密核心模块
 * 采用 scrypt 密钥派生与 AES-256-GCM 算法
 * 与现有桌面端 vault.kps 格式 100% 互通
 */

function getScryptFunction() {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  if (root.KeyPassScrypt && typeof root.KeyPassScrypt.scrypt === 'function') {
    return root.KeyPassScrypt.scrypt;
  }
  if (typeof require !== 'undefined') {
    try {
      const mod = require('./scrypt.js');
      if (mod && typeof mod.scrypt === 'function') return mod.scrypt;
    } catch {}
  }
  throw new Error('未加载 scrypt 加密模块');
}

const KDF_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

function getRandomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  const nodeCrypto = require('node:crypto');
  return new Uint8Array(nodeCrypto.randomBytes(length));
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password, salt) {
  const scryptFn = getScryptFunction();
  return await scryptFn(password, salt, KDF_PARAMS.N, KDF_PARAMS.r, KDF_PARAMS.p, KDF_PARAMS.keylen);
}

/**
 * 加密完整密码库
 */
async function encryptVault(payload, password) {
  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12);
  const rawKey = await deriveKey(password, salt);

  const textEncoder = new TextEncoder();
  const plaintext = textEncoder.encode(JSON.stringify(payload));

  let dataBytes;
  let tagBytes;

  if (globalThis.crypto && globalThis.crypto.subtle) {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const encrypted = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      cryptoKey,
      plaintext
    );
    const encBytes = new Uint8Array(encrypted);
    // Web Crypto 的 AES-GCM 输出包含末尾 16 字节的验证标签
    dataBytes = encBytes.subarray(0, encBytes.length - 16);
    tagBytes = encBytes.subarray(encBytes.length - 16);
  } else {
    const nodeCrypto = require('node:crypto');
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(rawKey), Buffer.from(iv));
    const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    dataBytes = new Uint8Array(enc);
    tagBytes = new Uint8Array(cipher.getAuthTag());
  }

  return {
    version: 1,
    kdf: 'scrypt',
    kdfParams: {
      N: KDF_PARAMS.N,
      r: KDF_PARAMS.r,
      p: KDF_PARAMS.p,
      keylen: KDF_PARAMS.keylen,
    },
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tagBytes),
    data: bytesToBase64(dataBytes),
  };
}

/**
 * 解密完整密码库
 */
async function decryptVault(fileContent, password) {
  let file = fileContent;
  if (typeof file === 'string') {
    try {
      file = JSON.parse(file);
    } catch {
      throw Object.assign(new Error('密码库格式无效'), { code: 'vault-corrupt' });
    }
  }

  if (!file || typeof file !== 'object') {
    throw Object.assign(new Error('密码库内容无效'), { code: 'vault-corrupt' });
  }

  let salt, iv, tag, data;
  try {
    salt = base64ToBytes(file.salt || '');
    iv = base64ToBytes(file.iv || '');
    tag = base64ToBytes(file.tag || '');
    data = base64ToBytes(file.data || '');
  } catch {
    throw Object.assign(new Error('密码库编码损坏'), { code: 'vault-corrupt' });
  }

  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || data.length === 0) {
    throw Object.assign(new Error('密码库字段长度异常'), { code: 'vault-corrupt' });
  }

  const rawKey = await deriveKey(password, salt);

  try {
    let decryptedBytes;
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // Web Crypto API 解密时需拼接密文与认证标签
      const combined = new Uint8Array(data.length + tag.length);
      combined.set(data, 0);
      combined.set(tag, data.length);

      const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        cryptoKey,
        combined
      );
      decryptedBytes = new Uint8Array(decryptedBuffer);
    } else {
      const nodeCrypto = require('node:crypto');
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', Buffer.from(rawKey), Buffer.from(iv));
      decipher.setAuthTag(Buffer.from(tag));
      const buf = Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()]);
      decryptedBytes = new Uint8Array(buf);
    }

    const textDecoder = new TextDecoder();
    const jsonStr = textDecoder.decode(decryptedBytes);
    return JSON.parse(jsonStr);
  } catch (err) {
    if (err && err.code === 'vault-corrupt') throw err;
    throw Object.assign(new Error('主密码错误或数据被篡改'), { code: 'bad-password' });
  }
}

const KeyPassCrypto = {
  deriveKey,
  encryptVault,
  decryptVault,
  bytesToBase64,
  base64ToBytes,
};

(typeof globalThis !== 'undefined' ? globalThis : self).KeyPassCrypto = KeyPassCrypto;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyPassCrypto;
}
