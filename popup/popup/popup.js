/**
 * KeyPass 弹窗脚本
 */

const els = {
  lockedView: document.getElementById('locked-view'),
  unlockedView: document.getElementById('unlocked-view'),
  authTitle: document.getElementById('auth-title'),
  authForm: document.getElementById('auth-form'),
  masterPassword: document.getElementById('master-password'),
  masterConfirm: document.getElementById('master-confirm'),
  confirmWrap: document.getElementById('confirm-wrap'),
  authError: document.getElementById('auth-error'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  lockBtn: document.getElementById('lock-btn'),
  openManagerBtn: document.getElementById('open-manager-btn'),
  currentDomainBadge: document.getElementById('current-domain-badge'),
  matchedList: document.getElementById('matched-list'),
  noMatchBox: document.getElementById('no-match-box'),
  quickAddBtn: document.getElementById('quick-add-btn'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  toast: document.getElementById('toast'),
};

let currentTab = null;
let allSitesCache = [];
let toastTimer = null;

function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 1800);
}

function sendMsg(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (res) => {
      resolve(res || {});
    });
  });
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label}已复制`);
  } catch {
    showToast('复制失败');
  }
}

async function fillCredentials(username, password) {
  const res = await sendMsg('FILL_ACTIVE_TAB', { username, password });
  if (res.ok) {
    showToast('已填入账号密码');
  } else {
    showToast(res.error || '填入失败');
  }
}

function renderMatched(matchedSites) {
  els.matchedList.innerHTML = '';
  const accounts = [];

  for (const site of matchedSites) {
    for (const acc of site.accounts || []) {
      accounts.push({ site, account: acc });
    }
  }

  if (accounts.length === 0) {
    els.noMatchBox.classList.remove('hidden');
    return;
  }

  els.noMatchBox.classList.add('hidden');

  for (const item of accounts) {
    const card = document.createElement('div');
    card.className = 'account-card';

    const header = document.createElement('div');
    header.className = 'account-header';

    const name = document.createElement('span');
    name.className = 'account-name';
    name.textContent = item.account.accountName || item.site.siteName || '默认账号';

    const user = document.createElement('span');
    user.className = 'account-user';
    user.textContent = item.account.username || '（未设置用户名）';

    header.appendChild(name);
    header.appendChild(user);

    const actions = document.createElement('div');
    actions.className = 'account-actions';

    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'btn-fill';
    fillBtn.textContent = '一键填入';
    fillBtn.addEventListener('click', () => {
      fillCredentials(item.account.username, item.account.password);
    });

    const copyUserBtn = document.createElement('button');
    copyUserBtn.type = 'button';
    copyUserBtn.className = 'btn-copy';
    copyUserBtn.textContent = '复制账号';
    copyUserBtn.addEventListener('click', () => {
      copyText(item.account.username, '账号');
    });

    const copyPassBtn = document.createElement('button');
    copyPassBtn.type = 'button';
    copyPassBtn.className = 'btn-copy';
    copyPassBtn.textContent = '复制密码';
    copyPassBtn.addEventListener('click', () => {
      copyText(item.account.password, '密码');
    });

    actions.appendChild(fillBtn);
    actions.appendChild(copyUserBtn);
    actions.appendChild(copyPassBtn);

    card.appendChild(header);
    card.appendChild(actions);
    els.matchedList.appendChild(card);
  }
}

async function loadUnlockedView() {
  els.lockedView.classList.add('hidden');
  els.unlockedView.classList.remove('hidden');
  els.lockBtn.classList.remove('hidden');

  // 查询当前活动标签页
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs && tabs[0] ? tabs[0] : null;

  const currentUrl = currentTab ? currentTab.url : '';
  const domain = KeyPassDomain.extractHostname(currentUrl);
  els.currentDomainBadge.textContent = domain || '未知网页';

  // 获取匹配账号
  const res = await sendMsg('GET_MATCHING_ACCOUNTS', { url: currentUrl });
  if (res.unlocked) {
    renderMatched(res.matched || []);
  }

  // 获取所有站点以支持快速搜索
  const allRes = await sendMsg('GET_ALL_SITES');
  if (allRes.ok) {
    allSitesCache = allRes.sites || [];
  }
}

function showLockedView(isNew) {
  els.lockedView.classList.remove('hidden');
  els.unlockedView.classList.add('hidden');
  els.lockBtn.classList.add('hidden');
  els.authError.classList.add('hidden');
  els.masterPassword.value = '';
  els.masterConfirm.value = '';

  if (isNew) {
    els.authTitle.textContent = '设置主密码';
    els.confirmWrap.classList.remove('hidden');
    els.authSubmitBtn.textContent = '创建密码库';
  } else {
    els.authTitle.textContent = '解锁密码库';
    els.confirmWrap.classList.add('hidden');
    els.authSubmitBtn.textContent = '解锁';
  }
  els.masterPassword.focus();
}

async function init() {
  const status = await sendMsg('GET_STATUS');
  if (!status.exists) {
    showLockedView(true);
  } else if (!status.unlocked) {
    showLockedView(false);
  } else {
    await loadUnlockedView();
  }
}

// 绑定认证表单
els.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.authError.classList.add('hidden');
  const password = els.masterPassword.value;

  if (password.length < 8) {
    els.authError.textContent = '主密码至少需要 8 位';
    els.authError.classList.remove('hidden');
    return;
  }

  const isNew = !els.confirmWrap.classList.contains('hidden');
  if (isNew) {
    const confirm = els.masterConfirm.value;
    if (password !== confirm) {
      els.authError.textContent = '两次输入的主密码不一致';
      els.authError.classList.remove('hidden');
      return;
    }
    const res = await sendMsg('CREATE_VAULT', { password });
    if (res.ok) {
      await loadUnlockedView();
    } else {
      els.authError.textContent = res.error || '创建密码库失败';
      els.authError.classList.remove('hidden');
    }
  } else {
    const res = await sendMsg('UNLOCK', { password });
    if (res.ok) {
      await loadUnlockedView();
    } else {
      els.authError.textContent = res.error || '主密码不正确';
      els.authError.classList.remove('hidden');
    }
  }
});

// 锁定按钮
els.lockBtn.addEventListener('click', async () => {
  await sendMsg('LOCK');
  showLockedView(false);
});

// 打开全屏管理中心
els.openManagerBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
});

// 快捷为此网站新增账号
els.quickAddBtn.addEventListener('click', () => {
  const currentUrl = currentTab ? currentTab.url : '';
  const domain = KeyPassDomain.extractHostname(currentUrl);
  const managerUrl = chrome.runtime.getURL(`manager/manager.html?add=1&url=${encodeURIComponent(currentUrl)}&name=${encodeURIComponent(domain)}`);
  chrome.tabs.create({ url: managerUrl });
});

// 快速全局搜索
els.searchInput.addEventListener('input', () => {
  const query = els.searchInput.value.trim().toLowerCase();
  if (!query) {
    els.searchResults.classList.add('hidden');
    els.searchResults.innerHTML = '';
    return;
  }

  const matches = [];
  for (const site of allSitesCache) {
    const siteMatches = (site.siteName && site.siteName.toLowerCase().includes(query)) ||
                        (site.url && site.url.toLowerCase().includes(query));

    for (const acc of site.accounts || []) {
      const userMatches = (acc.username && acc.username.toLowerCase().includes(query)) ||
                          (acc.accountName && acc.accountName.toLowerCase().includes(query));
      if (siteMatches || userMatches) {
        matches.push({ site, account: acc });
      }
    }
  }

  els.searchResults.innerHTML = '';
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-item';
    empty.textContent = '未找到匹配结果';
    els.searchResults.appendChild(empty);
  } else {
    for (const item of matches.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'search-item';

      const info = document.createElement('div');
      info.className = 'search-item-info';

      const title = document.createElement('span');
      title.className = 'search-item-site';
      title.textContent = `${item.site.siteName || '网站'} - ${item.account.accountName || '账号'}`;

      const user = document.createElement('span');
      user.className = 'search-item-user';
      user.textContent = item.account.username || '（无用户名）';

      info.appendChild(title);
      info.appendChild(user);

      const fillBtn = document.createElement('button');
      fillBtn.type = 'button';
      fillBtn.className = 'btn-copy';
      fillBtn.textContent = '填入';
      fillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fillCredentials(item.account.username, item.account.password);
      });

      row.appendChild(info);
      row.appendChild(fillBtn);
      row.addEventListener('click', () => {
        copyText(item.account.password, '密码');
      });

      els.searchResults.appendChild(row);
    }
  }
  els.searchResults.classList.remove('hidden');
});

init();
