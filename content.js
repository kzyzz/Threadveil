(function () {
  'use strict';

  let rules = [];
  let globalEnabled = true;
  let blockedCount = 0;
  let badgeEl = null;

  // Built-in spam signals (heuristic, always checked)
  const SPAM_SIGNALS = {
    // Excessive emoji ratio in tweet text (>40%)
    emojiBomb: (info) => {
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojiCount = (info.text.match(emojiRe) || []).length;
      const len = info.text.replace(/\s/g, '').length;
      return len > 0 && emojiCount > 5 && emojiCount / len > 0.4;
    },
    // Telegram / external links
    externalLinks: (info) => {
      return /t\.me\/|t\.cn\/|bit\.ly\/|linktr\.ee\/|onlyfans\.com|fansly\.com/i.test(info.text);
    },
    // Handle looks auto-generated: starts with letter, ends with 7+ digits
    autoGenHandle: (info) => {
      return /^@[a-zA-Z]+\d{7,}$/.test(info.handle);
    },
    // Handle with underscore + long number suffix
    randomHandle: (info) => {
      return /^@[a-zA-Z]+_\d{6,}$/.test(info.handle);
    },
    // Display name with suspicious pattern (emoji + suggestive keywords)
    suspiciousDisplayName: (info) => {
      const dn = info.displayName;
      const suggestive = /(私信|加我|看片|福利|资源|约|成人|视频|直播|全套|服务|上门|一夜|裸聊|激情|少妇|人妻|学生妹)/i;
      const agePattern = /\d{2}[岁歳]/;
      return suggestive.test(dn) || agePattern.test(dn);
    },
    // Comment text spam keywords
    spamKeywords: (info) => {
      const kw = /(私信我|加我微信|加我QQ|扫码|点击链接|免费看|点我|看主页|看简介|私聊|联系我|包夜|包养|援交|约炮|一夜情)/i;
      return kw.test(info.text);
    },
  };

  // --- Load rules from storage ---
  function loadRules() {
    chrome.storage.sync.get(['rules', 'enabled', 'useHeuristic'], (data) => {
      rules = (data.rules || []).filter(r => r.enabled !== false);
      globalEnabled = data.enabled !== undefined ? data.enabled : true;
      window.__bb_useHeuristic = data.useHeuristic !== undefined ? data.useHeuristic : true;
      if (!globalEnabled) return;
      scanAll();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.rules) {
      rules = (changes.rules.newValue || []).filter(r => r.enabled !== false);
    }
    if (changes.useHeuristic) {
      window.__bb_useHeuristic = changes.useHeuristic.newValue;
    }
    if (changes.enabled && changes.enabled.newValue === false) {
      globalEnabled = false;
      unblockAll();
      return;
    }
    if (changes.enabled && changes.enabled.newValue === true) {
      globalEnabled = true;
    }
    scanAll();
  });

  // --- Extract info from a tweet article ---
  function extractTweetInfo(article) {
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const textEl = article.querySelector('[data-testid="tweetText"]');

    const spans = nameEl ? nameEl.querySelectorAll('span') : [];
    let displayName = '';
    let handle = '';

    for (const span of spans) {
      const txt = span.textContent.trim();
      if (txt.startsWith('@') && !handle) {
        handle = txt;
      } else if (txt && !txt.startsWith('@') && txt !== '·' && !displayName) {
        displayName = txt;
      }
    }

    if (!handle && nameEl) {
      const link = nameEl.querySelector('a[href^="/"]');
      if (link) {
        const href = link.getAttribute('href');
        handle = href ? '@' + href.split('/')[1] : '';
      }
    }

    let bio = '';
    const bioEl = article.querySelector('[data-testid="UserDescription"]');
    if (bioEl) bio = bioEl.textContent.trim();

    const text = textEl ? textEl.textContent.trim() : '';

    return { displayName, handle, bio, text, article };
  }

  // --- Check if tweet matches any user rule ---
  function matchesUserRule(info, rule) {
    try {
      const flags = rule.caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(rule.pattern, flags);

      switch (rule.type) {
        case 'username':
          return regex.test(info.displayName) || regex.test(info.handle);
        case 'text':
          return regex.test(info.text);
        case 'bio':
          return info.bio ? regex.test(info.bio) : false;
        default:
          return false;
      }
    } catch (e) {
      return false;
    }
  }

  // --- Check heuristic signals ---
  function matchesHeuristic(info) {
    if (!window.__bb_useHeuristic) return null;
    for (const [key, fn] of Object.entries(SPAM_SIGNALS)) {
      if (fn(info)) return key;
    }
    return null;
  }

  function shouldBlock(info) {
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      if (matchesUserRule(info, rule)) return { type: 'rule', source: rule };
    }
    const heuristic = matchesHeuristic(info);
    if (heuristic) return { type: 'heuristic', source: heuristic };
    return null;
  }

  // --- Block / unblock a tweet ---
  function blockTweet(article, reason) {
    if (article.dataset.bbBlocked === '1') return;
    article.dataset.bbBlocked = '1';
    article.classList.add('bb-blocked-tweet');

    const label = document.createElement('div');
    label.className = 'bb-blocked-label';
    label.textContent = typeof reason.source === 'string'
      ? 'Blocked: ' + reason.source
      : 'Blocked: ' + (reason.source.pattern || reason.source.type);
    article.appendChild(label);

    blockedCount++;
  }

  function unblockTweet(article) {
    article.classList.remove('bb-blocked-tweet');
    article.dataset.bbBlocked = '0';
    const label = article.querySelector('.bb-blocked-label');
    if (label) label.remove();
  }

  function unblockAll() {
    document.querySelectorAll('[data-bb-blocked="1"]').forEach(unblockTweet);
    blockedCount = 0;
    updateBadge();
  }

  // --- Inline "block user" button ---
  function addBlockButton(article, info) {
    // Check if we already added a button
    if (article.querySelector('.bb-inline-block-btn')) return;

    // Find the "more" / caret button area
    const caretBtn = article.querySelector('[data-testid="caret"]');
    if (!caretBtn) return;

    const container = caretBtn.closest('.css-175oi2r');
    if (!container || container.querySelector('.bb-inline-block-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'bb-inline-block-btn';
    btn.title = 'Block this user';
    btn.textContent = '🚫';
    btn.style.cssText = `
      background: none; border: 1px solid #f4212e; color: #f4212e;
      font-size: 13px; cursor: pointer; border-radius: 9999px;
      padding: 2px 8px; margin-left: 4px; opacity: 0; transition: opacity 0.15s;
    `;

    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => {
      // Keep visible if the caret row is hovered
      const row = caretBtn.closest('[class*="css-"]');
      if (row && row.matches(':hover')) btn.style.opacity = '1';
      else btn.style.opacity = '0';
    });

    // Show on row hover
    const actionRow = container.closest('.r-1awozwy');
    if (actionRow) {
      actionRow.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      actionRow.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const rule = {
        type: 'username',
        pattern: escapeRegex(info.handle),
        caseSensitive: false,
        enabled: true,
      };

      chrome.storage.sync.get('rules', (data) => {
        const existing = (data.rules || []).find(r =>
          r.type === 'username' && r.pattern === rule.pattern
        );
        if (existing) {
          showToast('Already blocked: ' + info.handle);
          return;
        }
        const newRules = [...(data.rules || []), rule];
        chrome.storage.sync.set({ rules: newRules });
        showToast('Blocked user: ' + info.handle);
      });
    });

    container.appendChild(btn);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // --- Toast ---
  function showToast(msg) {
    let toast = document.querySelector('.bb-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'bb-toast';
      toast.style.cssText = `
        position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
        background: #1d9bf0; color: #fff; padding: 8px 20px; border-radius: 9999px;
        font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 999999; pointer-events: none; transition: opacity 0.3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  // --- Scan all tweets ---
  function scanAll() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    blockedCount = 0;

    articles.forEach((article) => {
      unblockTweet(article);
      const info = extractTweetInfo(article);
      addBlockButton(article, info);

      const matched = shouldBlock(info);
      if (matched) {
        blockTweet(article, matched);
      }
    });

    updateBadge();
  }

  // --- Badge ---
  function updateBadge() {
    chrome.storage.sync.get('enabled', (data) => {
      const showBadge = blockedCount > 0 || data.enabled === false;

      if (!showBadge) {
        if (badgeEl) badgeEl.style.display = 'none';
        return;
      }

      if (!badgeEl) {
        badgeEl = document.createElement('div');
        badgeEl.className = 'bb-stats-badge';
        badgeEl.title = 'Click to toggle blocking on/off';
        document.body.appendChild(badgeEl);

        badgeEl.addEventListener('click', () => {
          chrome.storage.sync.get('enabled', (d) => {
            const newState = !d.enabled;
            chrome.storage.sync.set({ enabled: newState });
            badgeEl.textContent = newState ? blockedCount + ' blocked' : 'Blocking OFF';
            if (!newState) unblockAll();
          });
        });
      }

      badgeEl.textContent = data.enabled === false ? 'Blocking OFF' : blockedCount + ' blocked';
      badgeEl.style.display = '';
    });
  }

  // --- MutationObserver ---
  let pendingScan = false;
  function scheduleScan() {
    if (pendingScan) return;
    pendingScan = true;
    requestAnimationFrame(() => {
      pendingScan = false;
      scanAll();
    });
  }

  function observe() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if ((node.matches && node.matches('article[data-testid="tweet"]')) ||
              (node.matches && node.matches('[data-testid="cellInnerDiv"]')) ||
              (node.querySelectorAll && node.querySelectorAll('article[data-testid="tweet"]').length > 0)) {
            scheduleScan();
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --- Init ---
  function init() {
    loadRules();
    observe();
    scheduleScan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
