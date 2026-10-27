/**
 * KeyPass 后台服务脚本 (Manifest V3 Service Worker)
 */

importScripts('./lib/scrypt.js', './lib/crypto.js', './lib/domain.js');

const STORAGE_KEY = 'keypass_vault';
const AUTO_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟无操作自动锁定

let isUnlocked = false;
let memoryPassword = null;
let memoryPayload = null;
let lastActiveTime = Date.now();

function touchActive() {
  lastActiveTime = Date.now();
}

function lockMemory() {
  isUnlocked = false;
  memoryPassword = null;
  memoryPayload = null;
  clearSessionPassword();
}

async function getSessionPassword() {
  if (chrome.storage && chrome.storage.session) {
    return new Promise((resolve) => {
      chrome.storage.session.get(['sessionPassword', 'lastActive'], (res) => {
        if (!res || !res.sessionPassword) return resolve(null);
        if (Date.now() - (res.lastActive || 0) > AUTO_LOCK_TIMEOUT_MS) {
          chrome.storage.session.remove(['sessionPassword', 'lastActive']);
          return resolve(null);
        }
        resolve(res.sessionPassword);
      });
    });
  }
  return null;
}

async function setSessionPassword(pass) {
  if (chrome.storage && chrome.storage.session) {
    return new Promise((resolve) => {
      chrome.storage.session.set({ sessionPassword: pass, lastActive: Date.now() }, () => resolve());
    });
  }
}

async function clearSessionPassword() {
  if (chrome.storage && chrome.storage.session) {
    return new Promise((resolve) => {
      chrome.storage.session.remove(['sessionPassword', 'lastActive'], () => resolve());
    });
  }
}

async function ensureSessionUnlocked() {
  touchActive();
  if (isUnlocked && memoryPayload) return true;
  const sessionPass = await getSessionPassword();
  if (!sessionPass) return false;
  const stored = await getStorageVault();
  if (!stored) return false;
  try {
    const decrypted = await KeyPassCrypto.decryptVault(stored, sessionPass);
    isUnlocked = true;
    memoryPassword = sessionPass;
    memoryPayload = {
      sites: Array.isArray(decrypted.sites) ? decrypted.sites : [],
    };
    return true;
  } catch {
    await clearSessionPassword();
    return false;
  }
}

// 周期性检查空闲锁定
setInterval(() => {
  if (isUnlocked && Date.now() - lastActiveTime > AUTO_LOCK_TIMEOUT_MS) {
    lockMemory();
  }
}, 60 * 1000);

function getStorageVault() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

function setStorageVault(encryptedData) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: encryptedData }, () => {
      resolve();
    });
  });
}

async function persistMemoryVault() {
  if (!isUnlocked || !memoryPassword || !memoryPayload) {
    throw new Error('未解锁无法保存');
  }
  const encrypted = await KeyPassCrypto.encryptVault(memoryPayload, memoryPassword);
  await setStorageVault(encrypted);
}

function sanitizeText(val, max = 300) {
  return String(val || '').trim().slice(0, max);
}

function generateUuid() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

// 统一消息处理入口
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  touchActive();
  const action = message && message.action;

  (async () => {
    try {
      await ensureSessionUnlocked();

      if (action === 'GET_STATUS') {
        const stored = await getStorageVault();
        sendResponse({
          exists: Boolean(stored),
          unlocked: isUnlocked,
          siteCount: isUnlocked && memoryPayload ? memoryPayload.sites.length : 0,
        });
        return;
      }

      if (action === 'CREATE_VAULT') {
        const password = String(message.password || '');
        if (password.length < 8) {
          sendResponse({ ok: false, error: '主密码至少需要 8 位' });
          return;
        }
        const initialPayload = { sites: [] };
        const encrypted = await KeyPassCrypto.encryptVault(initialPayload, password);
        await setStorageVault(encrypted);

        isUnlocked = true;
        memoryPassword = password;
        memoryPayload = initialPayload;
        await setSessionPassword(password);
        sendResponse({ ok: true });
        return;
      }

      if (action === 'UNLOCK') {
        const password = String(message.password || '');
        const stored = await getStorageVault();
        if (!stored) {
          sendResponse({ ok: false, error: '密码库尚未创建' });
          return;
        }

        try {
          const decrypted = await KeyPassCrypto.decryptVault(stored, password);
          isUnlocked = true;
          memoryPassword = password;
          memoryPayload = {
            sites: Array.isArray(decrypted.sites) ? decrypted.sites : [],
          };
          await setSessionPassword(password);
          sendResponse({ ok: true, sites: memoryPayload.sites });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || '主密码不正确' });
        }
        return;
      }

      // 导入密码库：无论当前是否处于解锁状态均可直接导入，密码以导入表单中输入的主密码为准
      if (action === 'IMPORT_VAULT') {
        const { fileContent, password } = message;
        try {
          const decrypted = await KeyPassCrypto.decryptVault(fileContent, password);
          isUnlocked = true;
          memoryPassword = password;
          memoryPayload = {
            sites: Array.isArray(decrypted.sites) ? decrypted.sites : [],
          };
          // 重新加密以确保格式统一
          await persistMemoryVault();
          await setSessionPassword(password);
          sendResponse({ ok: true, sites: memoryPayload.sites });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || '导入文件解密失败，请检查主密码' });
        }
        return;
      }

      if (action === 'LOCK') {
        lockMemory();
        sendResponse({ ok: true });
        return;
      }

      // 针对页面内容脚本请求当前网页匹配账号
      if (action === 'GET_MATCHING_ACCOUNTS') {
        if (!isUnlocked || !memoryPayload) {
          sendResponse({ unlocked: false, matched: [] });
          return;
        }
        const url = message.url || (sender.tab && sender.tab.url) || '';
        const matched = KeyPassDomain.rankMatchingSites(memoryPayload.sites, url);
        sendResponse({ unlocked: true, matched });
        return;
      }

      // 以下接口需要处于解锁状态
      if (!isUnlocked || !memoryPayload) {
        sendResponse({ ok: false, error: '密码库已锁定，请先解锁' });
        return;
      }

      if (action === 'GET_ALL_SITES') {
        const sites = memoryPayload.sites
          .slice()
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        sendResponse({ ok: true, sites });
        return;
      }

      if (action === 'SAVE_SITE') {
        const { site } = message;
        if (!site) {
          sendResponse({ ok: false, error: '站点数据为空' });
          return;
        }

        const now = new Date().toISOString();
        if (site.id) {
          // 编辑网站
          const existing = memoryPayload.sites.find((s) => s.id === site.id);
          if (!existing) {
            sendResponse({ ok: false, error: '网站未找到' });
            return;
          }
          existing.siteName = sanitizeText(site.siteName, 200);
          existing.url = sanitizeText(site.url, 2000);
          existing.updatedAt = now;
        } else {
          // 新增网站
          const newSite = {
            id: generateUuid(),
            siteName: sanitizeText(site.siteName, 200),
            url: sanitizeText(site.url, 2000),
            createdAt: now,
            updatedAt: now,
            accounts: [],
          };
          if (site.username || site.password || site.accountName) {
            newSite.accounts.push({
              id: generateUuid(),
              accountName: sanitizeText(site.accountName, 200),
              username: sanitizeText(site.username, 300),
              password: String(site.password || '').slice(0, 500),
              createdAt: now,
              updatedAt: now,
            });
          }
          memoryPayload.sites.push(newSite);
        }

        await persistMemoryVault();
        sendResponse({ ok: true, sites: memoryPayload.sites });
        return;
      }

      if (action === 'DELETE_SITE') {
        const { siteId } = message;
        memoryPayload.sites = memoryPayload.sites.filter((s) => s.id !== siteId);
        await persistMemoryVault();
        sendResponse({ ok: true, sites: memoryPayload.sites });
        return;
      }

      if (action === 'SAVE_ACCOUNT') {
        const { siteId, account } = message;
        const site = memoryPayload.sites.find((s) => s.id === siteId);
        if (!site) {
          sendResponse({ ok: false, error: '网站不存在' });
          return;
        }
        if (!Array.isArray(site.accounts)) site.accounts = [];

        const now = new Date().toISOString();
        if (account.id) {
          const acc = site.accounts.find((a) => a.id === account.id);
          if (!acc) {
            sendResponse({ ok: false, error: '账号不存在' });
            return;
          }
          acc.accountName = sanitizeText(account.accountName, 200);
          acc.username = sanitizeText(account.username, 300);
          acc.password = String(account.password || '').slice(0, 500);
          acc.updatedAt = now;
        } else {
          site.accounts.push({
            id: generateUuid(),
            accountName: sanitizeText(account.accountName, 200),
            username: sanitizeText(account.username, 300),
            password: String(account.password || '').slice(0, 500),
            createdAt: now,
            updatedAt: now,
          });
        }
        site.updatedAt = now;
        await persistMemoryVault();
        sendResponse({ ok: true, sites: memoryPayload.sites });
        return;
      }

      if (action === 'DELETE_ACCOUNT') {
        const { siteId, accountId } = message;
        const site = memoryPayload.sites.find((s) => s.id === siteId);
        if (!site) {
          sendResponse({ ok: false, error: '网站不存在' });
          return;
        }
        site.accounts = (site.accounts || []).filter((a) => a.id !== accountId);
        site.updatedAt = new Date().toISOString();
        await persistMemoryVault();
        sendResponse({ ok: true, sites: memoryPayload.sites });
        return;
      }

      if (action === 'CHANGE_PASSWORD') {
        const { currentPassword, newPassword } = message;
        if (currentPassword !== memoryPassword) {
          sendResponse({ ok: false, error: '当前主密码不正确' });
          return;
        }
        if (String(newPassword || '').length < 8) {
          sendResponse({ ok: false, error: '新主密码至少需要 8 位' });
          return;
        }
        memoryPassword = newPassword;
        await persistMemoryVault();
        sendResponse({ ok: true });
        return;
      }

      if (action === 'EXPORT_VAULT') {
        const stored = await getStorageVault();
        sendResponse({ ok: true, data: stored });
        return;
      }

      if (action === 'FILL_ACTIVE_TAB') {
        const { username, password } = message;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs || !tabs[0] || !tabs[0].id) {
            sendResponse({ ok: false, error: '未找到当前活动标签页' });
            return;
          }
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: 'FILL_CREDENTIALS', username, password },
            (resp) => {
              sendResponse({ ok: true, resp });
            }
          );
        });
        return;
      }

      sendResponse({ ok: false, error: '未知指令' });
    } catch (err) {
      console.error('KeyPass 后台错误:', err);
      sendResponse({ ok: false, error: err.message || '系统错误' });
    }
  })();

  return true; // 保持异步消息通道打开
});
