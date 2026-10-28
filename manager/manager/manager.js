/**
 * KeyPass 全屏管理中心脚本
 */

const state = {
  unlocked: false,
  sites: [],
  selectedSiteId: null,
  editingSiteId: null,
  editingAccountId: null,
  revealedPasswords: new Set(),
};

const els = {
  authView: document.getElementById('auth-view'),
  appView: document.getElementById('app-view'),
  authForm: document.getElementById('auth-form'),
  passwordLabel: document.getElementById('password-label'),
  masterPassword: document.getElementById('master-password'),
  masterConfirm: document.getElementById('master-confirm'),
  confirmWrap: document.getElementById('confirm-wrap'),
  authError: document.getElementById('auth-error'),
  authSubmit: document.getElementById('auth-submit'),
  searchInput: document.getElementById('search-input'),
  siteList: document.getElementById('site-list'),
  listEmpty: document.getElementById('list-empty'),
  sitePanel: document.getElementById('site-panel'),
  detailEmpty: document.getElementById('detail-empty'),
  siteTitle: document.getElementById('site-title'),
  siteLink: document.getElementById('site-link'),
  accountBody: document.getElementById('account-table-body'),
  accountEmpty: document.getElementById('account-empty'),
  openSiteBtn: document.getElementById('open-site-btn'),
  addSiteBtn: document.getElementById('add-site-btn'),
  editSiteBtn: document.getElementById('edit-site-btn'),
  deleteSiteBtn: document.getElementById('delete-site-btn'),
  addAccountBtn: document.getElementById('add-account-btn'),
  importBtn: document.getElementById('import-btn'),
  exportBtn: document.getElementById('export-btn'),
  passwordBtn: document.getElementById('password-btn'),
  lockBtn: document.getElementById('lock-btn'),
  siteModal: document.getElementById('site-modal'),
  siteForm: document.getElementById('site-form'),
  siteModalTitle: document.getElementById('site-modal-title'),
  siteName: document.getElementById('siteName'),
  siteUrl: document.getElementById('siteUrl'),
  siteFirstAccount: document.getElementById('site-first-account'),
  siteAccountName: document.getElementById('siteAccountName'),
  siteUsername: document.getElementById('siteUsername'),
  sitePassword: document.getElementById('sitePassword'),
  siteModalError: document.getElementById('site-modal-error'),
  accountModal: document.getElementById('account-modal'),
  accountForm: document.getElementById('account-form'),
  accountModalTitle: document.getElementById('account-modal-title'),
  accAccountName: document.getElementById('accAccountName'),
  accUsername: document.getElementById('accUsername'),
  accPassword: document.getElementById('accPassword'),
  accountModalError: document.getElementById('account-modal-error'),
  generateBtn: document.getElementById('generate-btn'),
  passwordModal: document.getElementById('password-modal'),
  passwordForm: document.getElementById('password-form'),
  pwdCurrent: document.getElementById('pwdCurrent'),
  pwdNext: document.getElementById('pwdNext'),
  pwdConfirm: document.getElementById('pwdConfirm'),
  passwordModalError: document.getElementById('password-modal-error'),
  importModal: document.getElementById('import-modal'),
  importForm: document.getElementById('import-form'),
  importFile: document.getElementById('importFile'),
  importPassword: document.getElementById('importPassword'),
  importModalError: document.getElementById('import-modal-error'),
  authImportBtn: document.getElementById('auth-import-btn'),
  toast: document.getElementById('toast'),
};

let toastTimer = null;
function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2000);
}

function sendMsg(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (res) => {
      resolve(res || {});
    });
  });
}

function generateRandomPassword(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => chars[x % chars.length]).join('');
}

function renderSites() {
  const query = els.searchInput.value.trim().toLowerCase();
  els.siteList.innerHTML = '';

  const filtered = state.sites.filter((site) => {
    if (!query) return true;
    const siteMatches = (site.siteName && site.siteName.toLowerCase().includes(query)) ||
                        (site.url && site.url.toLowerCase().includes(query));
    if (siteMatches) return true;
    return (site.accounts || []).some((a) =>
      (a.username && a.username.toLowerCase().includes(query)) ||
      (a.accountName && a.accountName.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    els.listEmpty.classList.remove('hidden');
  } else {
    els.listEmpty.classList.add('hidden');
  }

  for (const site of filtered) {
    const item = document.createElement('div');
    item.className = 'site-item' + (site.id === state.selectedSiteId ? ' active' : '');

    const header = document.createElement('div');
    header.className = 'site-item-header';

    const name = document.createElement('span');
    name.className = 'site-item-name';
    name.textContent = site.siteName || '未命名网站';

    const count = document.createElement('span');
    count.className = 'site-item-count';
    const accCount = (site.accounts || []).length;
    count.textContent = `${accCount} 个账号`;

    header.appendChild(name);
    header.appendChild(count);

    const url = document.createElement('span');
    url.className = 'site-item-url';
    url.textContent = site.url || '（未设置网址）';

    item.appendChild(header);
    item.appendChild(url);

    item.addEventListener('click', () => {
      selectSite(site.id);
    });

    els.siteList.appendChild(item);
  }
}

function selectSite(siteId) {
  state.selectedSiteId = siteId;
  const site = state.sites.find((s) => s.id === siteId);

  if (!site) {
    els.sitePanel.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    renderSites();
    return;
  }

  els.detailEmpty.classList.add('hidden');
  els.sitePanel.classList.remove('hidden');
  els.siteTitle.textContent = site.siteName || '未命名网站';

  if (site.url) {
    els.siteLink.textContent = site.url;
    els.siteLink.href = site.url;
    els.siteLink.classList.remove('hidden');
    els.openSiteBtn.classList.remove('hidden');
  } else {
    els.siteLink.textContent = '';
    els.siteLink.classList.add('hidden');
    els.openSiteBtn.classList.add('hidden');
  }

  renderAccounts(site);
  renderSites();
}

function renderAccounts(site) {
  els.accountBody.innerHTML = '';
  const accounts = site.accounts || [];

  if (accounts.length === 0) {
    els.accountEmpty.classList.remove('hidden');
    return;
  }
  els.accountEmpty.classList.add('hidden');

  for (const acc of accounts) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = acc.accountName || '（未命名）';

    const tdUser = document.createElement('td');
    tdUser.textContent = acc.username || '（无）';

    const tdPass = document.createElement('td');
    const isRevealed = state.revealedPasswords.has(acc.id);
    const passDisplay = document.createElement('span');
    passDisplay.textContent = isRevealed ? acc.password : '••••••••';
    passDisplay.style.fontFamily = isRevealed ? 'monospace' : 'inherit';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn-ghost';
    toggleBtn.textContent = isRevealed ? '隐藏' : '显示';
    toggleBtn.style.padding = '2px 6px';
    toggleBtn.style.marginLeft = '8px';
    toggleBtn.addEventListener('click', () => {
      if (state.revealedPasswords.has(acc.id)) {
        state.revealedPasswords.delete(acc.id);
      } else {
        state.revealedPasswords.add(acc.id);
      }
      renderAccounts(site);
    });

    tdPass.appendChild(passDisplay);
    tdPass.appendChild(toggleBtn);

    const tdOps = document.createElement('td');
    tdOps.className = 'ops';

    const copyUserBtn = document.createElement('button');
    copyUserBtn.type = 'button';
    copyUserBtn.className = 'btn-secondary';
    copyUserBtn.textContent = '复制账号';
    copyUserBtn.style.padding = '4px 8px';
    copyUserBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(acc.username || '');
      showToast('账号已复制');
    });

    const copyPassBtn = document.createElement('button');
    copyPassBtn.type = 'button';
    copyPassBtn.className = 'btn-secondary';
    copyPassBtn.textContent = '复制密码';
    copyPassBtn.style.padding = '4px 8px';
    copyPassBtn.style.marginLeft = '4px';
    copyPassBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(acc.password || '');
      showToast('密码已复制');
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-ghost';
    editBtn.textContent = '编辑';
    editBtn.style.padding = '4px 8px';
    editBtn.style.marginLeft = '4px';
    editBtn.addEventListener('click', () => {
      openAccountModal(acc);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger';
    delBtn.textContent = '删除';
    delBtn.style.padding = '4px 8px';
    delBtn.style.marginLeft = '4px';
    delBtn.addEventListener('click', async () => {
      if (confirm(`确定删除账号「${acc.accountName || acc.username}」吗？`)) {
        const res = await sendMsg('DELETE_ACCOUNT', { siteId: site.id, accountId: acc.id });
        if (res.ok) {
          state.sites = res.sites;
          selectSite(site.id);
          showToast('账号已删除');
        }
      }
    });

    tdOps.appendChild(copyUserBtn);
    tdOps.appendChild(copyPassBtn);
    tdOps.appendChild(editBtn);
    tdOps.appendChild(delBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdUser);
    tr.appendChild(tdPass);
    tr.appendChild(tdOps);

    els.accountBody.appendChild(tr);
  }
}

function openSiteModal(site = null, prefill = {}) {
  state.editingSiteId = site ? site.id : null;
  els.siteModalError.classList.add('hidden');

  if (site) {
    els.siteModalTitle.textContent = '编辑网站';
    els.siteName.value = site.siteName || '';
    els.siteUrl.value = site.url || '';
    els.siteFirstAccount.classList.add('hidden');
  } else {
    els.siteModalTitle.textContent = '新增网站';
    els.siteName.value = prefill.name || '';
    els.siteUrl.value = prefill.url || '';
    els.siteAccountName.value = '';
    els.siteUsername.value = '';
    els.sitePassword.value = '';
    els.siteFirstAccount.classList.remove('hidden');
  }
  els.siteModal.classList.remove('hidden');
  els.siteName.focus();
}

function openAccountModal(account = null) {
  state.editingAccountId = account ? account.id : null;
  els.accountModalError.classList.add('hidden');

  if (account) {
    els.accountModalTitle.textContent = '编辑账号';
    els.accAccountName.value = account.accountName || '';
    els.accUsername.value = account.username || '';
    els.accPassword.value = account.password || '';
  } else {
    els.accountModalTitle.textContent = '添加账号';
    els.accAccountName.value = '';
    els.accUsername.value = '';
    els.accPassword.value = '';
  }
  els.accountModal.classList.remove('hidden');
  els.accUsername.focus();
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

// 模态框统一取消按钮事件
document.querySelectorAll('.modal-cancel').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const modal = e.target.closest('.modal');
    if (modal) closeModal(modal);
  });
});

// 网站表单提交
els.siteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const siteData = {
    id: state.editingSiteId,
    siteName: els.siteName.value.trim(),
    url: els.siteUrl.value.trim(),
  };

  if (!state.editingSiteId) {
    siteData.accountName = els.siteAccountName.value.trim();
    siteData.username = els.siteUsername.value.trim();
    siteData.password = els.sitePassword.value;
  }

  const res = await sendMsg('SAVE_SITE', { site: siteData });
  if (res.ok) {
    state.sites = res.sites;
    closeModal(els.siteModal);
    renderSites();
    if (state.editingSiteId) {
      selectSite(state.editingSiteId);
    } else if (state.sites.length > 0) {
      selectSite(state.sites[state.sites.length - 1].id);
    }
    showToast('网站已保存');
  } else {
    els.siteModalError.textContent = res.error || '保存失败';
    els.siteModalError.classList.remove('hidden');
  }
});

// 账号表单提交
els.accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selectedSiteId) return;

  const accountData = {
    id: state.editingAccountId,
    accountName: els.accAccountName.value.trim(),
    username: els.accUsername.value.trim(),
    password: els.accPassword.value,
  };

  const res = await sendMsg('SAVE_ACCOUNT', {
    siteId: state.selectedSiteId,
    account: accountData,
  });

  if (res.ok) {
    state.sites = res.sites;
    closeModal(els.accountModal);
    selectSite(state.selectedSiteId);
    showToast('账号已保存');
  } else {
    els.accountModalError.textContent = res.error || '保存失败';
    els.accountModalError.classList.remove('hidden');
  }
});

// 随机密码生成
els.generateBtn.addEventListener('click', () => {
  els.accPassword.value = generateRandomPassword(16);
});

// 绑定顶部动作
els.addSiteBtn.addEventListener('click', () => openSiteModal());
els.addAccountBtn.addEventListener('click', () => openAccountModal());
els.editSiteBtn.addEventListener('click', () => {
  const current = state.sites.find((s) => s.id === state.selectedSiteId);
  if (current) openSiteModal(current);
});

els.deleteSiteBtn.addEventListener('click', async () => {
  const current = state.sites.find((s) => s.id === state.selectedSiteId);
  if (!current) return;
  if (confirm(`确定删除网站「${current.siteName}」及其全部账号吗？`)) {
    const res = await sendMsg('DELETE_SITE', { siteId: current.id });
    if (res.ok) {
      state.sites = res.sites;
      state.selectedSiteId = null;
      selectSite(null);
      showToast('网站已删除');
    }
  }
});

els.openSiteBtn.addEventListener('click', () => {
  const current = state.sites.find((s) => s.id === state.selectedSiteId);
  if (current && current.url) {
    chrome.tabs.create({ url: current.url });
  }
});

// 修改密码
els.passwordBtn.addEventListener('click', () => {
  els.passwordModalError.classList.add('hidden');
  els.pwdCurrent.value = '';
  els.pwdNext.value = '';
  els.pwdConfirm.value = '';
  els.passwordModal.classList.remove('hidden');
  els.pwdCurrent.focus();
});

els.passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = els.pwdCurrent.value;
  const newPassword = els.pwdNext.value;
  const confirmPassword = els.pwdConfirm.value;

  if (newPassword.length < 8) {
    els.passwordModalError.textContent = '新主密码至少需要 8 位';
    els.passwordModalError.classList.remove('hidden');
    return;
  }
  if (newPassword !== confirmPassword) {
    els.passwordModalError.textContent = '两次输入的新主密码不一致';
    els.passwordModalError.classList.remove('hidden');
    return;
  }

  const res = await sendMsg('CHANGE_PASSWORD', { currentPassword, newPassword });
  if (res.ok) {
    closeModal(els.passwordModal);
    showToast('主密码已成功修改');
  } else {
    els.passwordModalError.textContent = res.error || '修改失败';
    els.passwordModalError.classList.remove('hidden');
  }
});

// 导出备份
els.exportBtn.addEventListener('click', async () => {
  const res = await sendMsg('EXPORT_VAULT');
  if (!res.ok || !res.data) {
    showToast('导出失败');
    return;
  }
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `KeyPass_backup_${dateStr}.kps`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('备份文件已下载');
});

// 导入备份
function openImportDialog() {
  els.importModalError.classList.add('hidden');
  els.importFile.value = '';
  els.importPassword.value = '';
  els.importModal.classList.remove('hidden');
}

els.importBtn.addEventListener('click', openImportDialog);
if (els.authImportBtn) {
  els.authImportBtn.addEventListener('click', openImportDialog);
}

els.importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = els.importFile.files[0];
  const password = els.importPassword.value;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const fileContent = JSON.parse(reader.result);
      const res = await sendMsg('IMPORT_VAULT', { fileContent, password });
      if (res.ok) {
        state.sites = res.sites || [];
        closeModal(els.importModal);
        await showAppView();
        if (state.sites.length > 0) {
          selectSite(state.sites[0].id);
        }
        showToast('备份导入成功');
      } else {
        els.importModalError.textContent = res.error || '导入失败';
        els.importModalError.classList.remove('hidden');
      }
    } catch {
      els.importModalError.textContent = '文件内容不是合法的 JSON 密码库';
      els.importModalError.classList.remove('hidden');
    }
  };
  reader.readAsText(file);
});

// 锁定
els.lockBtn.addEventListener('click', async () => {
  await sendMsg('LOCK');
  showAuthView(false);
});

// 搜索框
els.searchInput.addEventListener('input', () => {
  renderSites();
});

function showAuthView(isNew) {
  els.authView.classList.remove('hidden');
  els.appView.classList.add('hidden');
  els.authError.classList.add('hidden');
  els.masterPassword.value = '';
  els.masterConfirm.value = '';

  if (isNew) {
    els.passwordLabel.textContent = '设置主密码';
    els.confirmWrap.classList.remove('hidden');
    els.authSubmit.textContent = '创建密码库';
  } else {
    els.passwordLabel.textContent = '主密码';
    els.confirmWrap.classList.add('hidden');
    els.authSubmit.textContent = '解锁';
  }
  els.masterPassword.focus();
}

async function showAppView() {
  els.authView.classList.add('hidden');
  els.appView.classList.remove('hidden');

  const res = await sendMsg('GET_ALL_SITES');
  if (res.ok) {
    state.sites = res.sites || [];
    renderSites();

    // 检查是否有 URL 快捷新增参数
    const params = new URLSearchParams(window.location.search);
    if (params.get('add') === '1') {
      openSiteModal(null, {
        url: params.get('url') || '',
        name: params.get('name') || '',
      });
    } else if (state.sites.length > 0) {
      selectSite(state.sites[0].id);
    }
  }
}

// 认证表单提交
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
      await showAppView();
    } else {
      els.authError.textContent = res.error || '创建密码库失败';
      els.authError.classList.remove('hidden');
    }
  } else {
    const res = await sendMsg('UNLOCK', { password });
    if (res.ok) {
      await showAppView();
    } else {
      els.authError.textContent = res.error || '主密码不正确';
      els.authError.classList.remove('hidden');
    }
  }
});

async function init() {
  const status = await sendMsg('GET_STATUS');
  if (!status.exists) {
    showAuthView(true);
  } else if (!status.unlocked) {
    showAuthView(false);
  } else {
    await showAppView();
  }
}

init();
