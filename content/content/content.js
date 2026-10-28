/**
 * KeyPass 网页内容脚本
 * 负责探测网页登录表单、挂载钥匙小图标，并实现安全穿透填入
 */

(() => {
  if (window.__keypass_content_script_loaded__) return;
  window.__keypass_content_script_loaded__ = true;

  const SVG_ICON = `
    <svg viewBox="0 0 64 64" class="keypass-icon-svg">
      <rect width="64" height="64" rx="16" fill="#1d2430"/>
      <path fill="#e2b15a" d="M28 18a12 12 0 0 1 7.2 21.6L42 46.4 38.8 50 32 43.2l-3.2 3.2-3.2-3.2 3.2-3.2A12 12 0 0 1 28 18zm0 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/>
    </svg>
  `;

  let activeDropdown = null;
  let activeTip = null;
  const attachedPairs = [];

  function setNativeInputValue(input, value) {
    if (!input) return;
    input.focus();
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlightInputs(inputs) {
    for (const inp of inputs) {
      if (!inp) continue;
      inp.classList.add('keypass-fill-highlight');
      setTimeout(() => {
        inp.classList.remove('keypass-fill-highlight');
      }, 1200);
    }
  }

  function removeTip() {
    if (activeTip) {
      activeTip.remove();
      activeTip = null;
    }
  }

  function showTip(anchorEl, text) {
    removeTip();
    const tip = document.createElement('div');
    tip.className = 'keypass-floating-tip';
    tip.textContent = text;
    document.body.appendChild(tip);

    const rect = anchorEl.getBoundingClientRect();
    tip.style.top = `${window.scrollY + rect.bottom + 6}px`;
    tip.style.left = `${Math.max(10, window.scrollX + rect.right - tip.offsetWidth)}px`;
    activeTip = tip;

    setTimeout(() => {
      if (activeTip === tip) removeTip();
    }, 2500);
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
  }

  function fillPair(usernameInput, passwordInput, username, password) {
    if (usernameInput && username) {
      setNativeInputValue(usernameInput, username);
    }
    if (passwordInput && password) {
      setNativeInputValue(passwordInput, password);
    }
    highlightInputs([usernameInput, passwordInput]);
    closeDropdown();
    removeTip();
  }

  function openDropdown(anchorBtn, usernameInput, passwordInput, matchedSites) {
    closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'keypass-dropdown';

    const header = document.createElement('div');
    header.className = 'keypass-dropdown-header';
    header.textContent = 'KeyPass 选择填入账号';
    dropdown.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'keypass-dropdown-list';

    let totalAccounts = 0;
    for (const site of matchedSites) {
      const accounts = Array.isArray(site.accounts) ? site.accounts : [];
      for (const acc of accounts) {
        totalAccounts++;
        const item = document.createElement('li');
        item.className = 'keypass-dropdown-item';

        const title = document.createElement('span');
        title.className = 'keypass-dropdown-item-title';
        title.textContent = acc.accountName || site.siteName || '默认账号';

        const user = document.createElement('span');
        user.className = 'keypass-dropdown-item-user';
        user.textContent = acc.username || '（无用户名）';

        item.appendChild(title);
        item.appendChild(user);

        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          fillPair(usernameInput, passwordInput, acc.username, acc.password);
        });

        list.appendChild(item);
      }
    }

    if (totalAccounts === 0) {
      const empty = document.createElement('li');
      empty.className = 'keypass-dropdown-item';
      empty.textContent = '此网站未保存账号';
      list.appendChild(empty);
    }

    dropdown.appendChild(list);
    document.body.appendChild(dropdown);

    const rect = anchorBtn.getBoundingClientRect();
    dropdown.style.top = `${window.scrollY + rect.bottom + 4}px`;
    const left = window.scrollX + rect.right - 200;
    dropdown.style.left = `${Math.max(10, left)}px`;

    activeDropdown = dropdown;
  }

  function handleIconClick(btn, usernameInput, passwordInput) {
    chrome.runtime.sendMessage({ action: 'GET_MATCHING_ACCOUNTS', url: window.location.href }, (response) => {
      if (chrome.runtime.lastError || !response) {
        showTip(btn, '无法连接插件后台服务');
        return;
      }

      if (!response.unlocked) {
        showTip(btn, '请先在右上角插件图标中解锁');
        return;
      }

      const matched = response.matched || [];
      if (matched.length === 0) {
        showTip(btn, '未找到当前网站保存的账号');
        return;
      }

      // 提取全部可用账号
      const allAccounts = [];
      for (const s of matched) {
        for (const a of s.accounts || []) {
          allAccounts.push({ site: s, account: a });
        }
      }

      if (allAccounts.length === 0) {
        showTip(btn, '当前网站未登记账号密码');
        return;
      }

      if (allAccounts.length === 1) {
        const item = allAccounts[0];
        fillPair(usernameInput, passwordInput, item.account.username, item.account.password);
        return;
      }

      // 存在多个账号时，展开浮层供用户选择
      openDropdown(btn, usernameInput, passwordInput, matched);
    });
  }

  function findPrecedingUsernameInput(pwInput) {
    // 优先从同一表单中查找
    const form = pwInput.form;
    const candidates = form
      ? Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="password"])'))
      : Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="password"])'));

    const pwIndex = candidates.indexOf(pwInput);
    const validInputs = pwIndex >= 0 ? candidates.slice(0, pwIndex) : candidates;

    // 倒序匹配最近的账号/邮箱输入框
    for (let i = validInputs.length - 1; i >= 0; i--) {
      const inp = validInputs[i];
      const type = (inp.type || 'text').toLowerCase();
      if (type === 'text' || type === 'email' || type === 'tel') {
        const style = window.getComputedStyle(inp);
        if (style.display !== 'none' && style.visibility !== 'hidden' && inp.offsetWidth > 0) {
          return inp;
        }
      }
    }
    return null;
  }

  function updateIconPosition(btn, targetInput) {
    if (!document.body.contains(targetInput)) {
      btn.remove();
      return;
    }
    const rect = targetInput.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'flex';
    const top = window.scrollY + rect.top + (rect.height - 22) / 2;
    const left = window.scrollX + rect.right - 26;
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
  }

  function createIconButton(targetInput, usernameInput, passwordInput) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keypass-icon-btn';
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('aria-label', 'KeyPass 填入账号密码');
    btn.innerHTML = SVG_ICON;

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleIconClick(btn, usernameInput, passwordInput);
    });

    document.body.appendChild(btn);
    updateIconPosition(btn, targetInput);
    return btn;
  }

  function scanAndAttach() {
    const passwords = Array.from(document.querySelectorAll('input[type="password"]'));
    for (const pw of passwords) {
      if (pw.dataset.keypassAttached === 'true') continue;
      const style = window.getComputedStyle(pw);
      if (style.display === 'none' || style.visibility === 'hidden' || pw.offsetWidth === 0) {
        continue;
      }

      pw.dataset.keypassAttached = 'true';
      const userInp = findPrecedingUsernameInput(pw);

      const pwBtn = createIconButton(pw, userInp, pw);
      let userBtn = null;
      if (userInp && userInp.dataset.keypassAttached !== 'true') {
        userInp.dataset.keypassAttached = 'true';
        userBtn = createIconButton(userInp, userInp, pw);
      }

      attachedPairs.push({
        pw,
        userInp,
        pwBtn,
        userBtn,
      });
    }
  }

  function repositionAll() {
    for (const pair of attachedPairs) {
      if (pair.pwBtn && pair.pw) updateIconPosition(pair.pwBtn, pair.pw);
      if (pair.userBtn && pair.userInp) updateIconPosition(pair.userBtn, pair.userInp);
    }
  }

  // 监听位置变动
  window.addEventListener('resize', repositionAll, { passive: true });
  window.addEventListener('scroll', repositionAll, { passive: true });
  document.addEventListener('click', (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeDropdown();
    }
  });

  // 监听来自右上角弹窗的一键填入指令
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'FILL_CREDENTIALS') {
      scanAndAttach();
      const firstPair = attachedPairs.find((p) => document.body.contains(p.pw));
      if (firstPair) {
        fillPair(firstPair.userInp, firstPair.pw, msg.username, msg.password);
        sendResponse({ ok: true, filled: true });
      } else {
        // 未探测到密码框时，尝试填入当前聚焦的输入框
        const active = document.activeElement;
        if (active && active.tagName === 'INPUT') {
          setNativeInputValue(active, msg.username || msg.password);
          highlightInputs([active]);
          sendResponse({ ok: true, filled: true, target: 'focused' });
        } else {
          sendResponse({ ok: false, message: '未找到输入框' });
        }
      }
    }
  });

  // 初始扫描与动态 DOM 监听
  scanAndAttach();

  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanAndAttach();
      repositionAll();
    }, 200);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
