(function () {
  'use strict';

  // ======================== STATE ========================
  let settings = {
    enabled: true,
    threshold: 5,
    useHeuristic: true,
    customKeywords: [],
    rules: [],
    signalWeights: {},
  };
  let blockedCount = 0;
  let badgeEl = null;
  let opText = '';
  let opTokens = [];

  // ======================== SIGNAL DEFINITIONS ========================
  // Each signal returns { hit: bool, weight: number, detail: string }
  const SIGNALS = {
    // Handle looks auto-generated
    autoGenHandle(info) {
      const h = info.handle.replace('@', '');
      // Richard18928428, EmmaBartlett7254, cutegirl918, amy_33482, graham_tro48205
      const match = /^[A-Z][a-z]+\d{4,}$/.test(h) ||
        /^[A-Z][a-z]+[A-Z][a-z]+\d{1,}$/.test(h) ||
        /^[a-z]+\d{4,}$/i.test(h) ||
        /^[a-z]+_[a-z]*\d{3,}$/i.test(h) ||
        /^[a-zA-Z]{5,}\d{3,}$/.test(h);
      return match ? { hit: true, weight: 2, detail: '随机用户名' } : null;
    },

    // Display name has high emoji density
    emojiName(info) {
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojis = (info.displayName.match(emojiRe) || []);
      const len = info.displayName.replace(/\s/g, '').length || 1;
      if (emojis.length >= 2 && emojis.length / len > 0.3) {
        return { hit: true, weight: 2, detail: '名称含大量emoji' };
      }
      return null;
    },

    // Unicode decoration: rare script chars, math symbols, etc.
    unicodeDeco(info) {
      // Detect unusual unicode blocks often used by bots for decoration
      const decoRe = /[\u{1F000}-\u{1F02F}\u{10A00}-\u{10AFF}\u{1D400}-\u{1D7FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2E80}-\u{2FDF}]/u;
      // Also specific common bot decorations
      const specificDeco = /[𓆩𓆪♡♥︎꧁꧂༺༻◈◆◇◉◎●◦▸▶▷►▻▼▽△▲☆★]/;
      if (decoRe.test(info.displayName) || specificDeco.test(info.displayName)) {
        return { hit: true, weight: 2, detail: 'Unicode装饰字符' };
      }
      return null;
    },

    // Reply has no meaningful text — only emojis, ≤3 Chinese or ≤5 ASCII chars
    emptyContentWithEmoji(info) {
      const clean = info.text.replace(/\s/g, '');
      if (!clean) return null;
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojiCount = (clean.match(emojiRe) || []).length;
      if (emojiCount < 2) return null;
      const textOnly = clean.replace(emojiRe, '').replace(/[0-9]/g, '');
      // Chinese ≤3 chars or ASCII ≤5 chars + several emojis = bot pattern
      if (textOnly.length <= 5 && emojiCount >= 2) {
        return { hit: true, weight: 6, detail: '短字符+emoji' };
      }
      return null;
    },

    // Emojis spliced inside English words: "Swi🌸ft", "pizz🌹a"
    midWordEmoji(info) {
      const chars = Array.from(info.text);
      let midWordCount = 0;
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (/\p{Emoji_Presentation}/u.test(c) || /\p{Extended_Pictographic}/u.test(c)) {
          let bi = i - 1;
          while (bi >= 0) {
            const cp = chars[bi].codePointAt(0);
            if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D) { bi--; continue; }
            break;
          }
          let ai = i + 1;
          while (ai < chars.length) {
            const cp = chars[ai].codePointAt(0);
            if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D) { ai++; continue; }
            break;
          }
          const before = bi >= 0 ? chars[bi] : ' ';
          const after = ai < chars.length ? chars[ai] : ' ';
          if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) {
            midWordCount++;
          }
        }
      }
      if (midWordCount >= 2) {
        return { hit: true, weight: 5, detail: '词中夹emoji' };
      }
      return null;
    },

    // Unusually high number of emojis (8+) in a single reply
    emojiOverload(info) {
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojiCount = (info.text.match(emojiRe) || []).length;
      if (emojiCount >= 8) {
        return { hit: true, weight: 5, detail: '大量emoji(' + emojiCount + ')' };
      }
      return null;
    },

    // Sexual keywords from user's custom list
    sexualKeywords(info) {
      if (!settings.customKeywords.length) return null;
      let count = 0;
      const lower = info.text.toLowerCase();
      for (const kw of settings.customKeywords) {
        if (lower.includes(kw.toLowerCase())) count++;
      }
      if (count > 0) {
        return { hit: true, weight: Math.min(count * 3, 6), detail: `敏感词 x${count}` };
      }
      return null;
    },

    // Suggestive emoji: 💘🍑🥵💋👉👌🔞🔥👙🌸
    hornyEmoji(info) {
      const re = /[💘🍑🥵💋👉👌🔞🔥👙🌸🍆💦👅🫦🫣😈😏😳😙😗😘😝😚😋🤤🥳❤️‍🔥❣️🍓✈️🌡️😵🎲🅿️🥌🫧💗💓💕💖💞🫦🫧💋💄👙👄💅]/u;
      if (re.test(info.text)) {
        return { hit: true, weight: 2, detail: '暗示性表情' };
      }
      return null;
    },

    // Short reply (< 20 chars, excluding spaces)
    shortReply(info) {
      const clean = info.text.replace(/\s/g, '');
      if (clean.length > 0 && clean.length < 20) {
        return { hit: true, weight: 1, detail: '短句回复' };
      }
      return null;
    },

    // External platform links (Chinese + foreign spam platforms)
    externalLinks(info) {
      const re = /t\.me\/|t\.cn\/|bit\.ly\/|linktr\.ee\/|beacons\.ai\/|onlyfans\.com|fansly\.com|discord\.gg\/|m\.e\/|pan\.quark\.cn\/|pan\.baidu\.com\/|lanzou\w\.com\/|weixin\.qq\.com\/|v\.douyin\.com\/|xhslink\.com/i;
      if (re.test(info.text)) {
        return { hit: true, weight: 5, detail: '外部链接' };
      }
      return null;
    },

    // High emoji density in tweet text
    highEmojiDensity(info) {
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojis = (info.text.match(emojiRe) || []);
      const len = info.text.replace(/\s/g, '').length || 1;
      if (emojis.length >= 3 && emojis.length / len > 0.25) {
        return { hit: true, weight: 3, detail: 'emoji密度过高' };
      }
      return null;
    },

    // Emoji bomb: 3+ emojis in a short reply (strong spam signal)
    emojiBomb(info) {
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojis = (info.text.match(emojiRe) || []);
      const cleanLen = info.text.replace(/\s/g, '').length;
      if (emojis.length >= 3 && cleanLen < 60) {
        return { hit: true, weight: 5, detail: 'emoji轰炸' };
      }
      return null;
    },

    // @mentions in reply (spam bots often @ others)
    atMentions(info) {
      const mentions = (info.text.match(/@\w{2,}/g) || []);
      if (mentions.length >= 2) {
        return { hit: true, weight: 1, detail: '多次@他人' };
      }
      return null;
    },

    // Single @mention + short/emoji content = promotion pattern
    promotionMention(info) {
      const mentions = (info.text.match(/@\w{2,}/g) || []);
      if (mentions.length !== 1) return null;
      const clean = info.text.replace(/\s/g, '');
      // Short text with one @mention and emoji/suggestive symbols
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojiCount = (info.text.match(emojiRe) || []).length;
      if (clean.length < 80 && emojiCount >= 2) {
        return { hit: true, weight: 4, detail: '引流@' + mentions[0] };
      }
      return null;
    },

    // Chinese template phrases separated by emojis + @mention
    // e.g. "比她好看的没她骚💔比她骚的没她好看❤️‍🔥@xxx"
    emojiSeparatedMention(info) {
      const mentions = info.text.match(/@\w{2,}/g) || [];
      if (mentions.length === 0) return null;
      const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
      const emojis = info.text.match(emojiRe) || [];
      if (emojis.length < 2) return null;
      const chineseCount = (info.text.match(/[一-龥]/g) || []).length;
      if (chineseCount < 6) return null;
      return { hit: true, weight: 6, detail: '模板文案+emoji+@' };
    },

    // Handle starts with numbers (e.g. @66_tanya)
    handleStartsWithNumber(info) {
      const h = info.handle.replace('@', '');
      if (/^\d{2,}/.test(h)) {
        return { hit: true, weight: 2, detail: '数字前缀用户名' };
      }
      return null;
    },

    // Known bot template phrases
    templatePhrases(info) {
      const templates = [
        '比她好看的没她骚', '比她骚的没她好看',
        '刷了半天的', '就她的主页能打',
        '比她好看', '没她骚', '没她好看',
        '点击主页', '点主页', '看主页',
        '免费破处', '免费约', '免费看',
        '每晚准时', '大秀', '直播',
        '私信我', '加我微', '加我Q',
        '她好涩', '我不行了', '宇宙第一骚',
        '涩', '想要我', '想被', '来陪我',
      ];
      const lower = info.text.toLowerCase();
      for (const t of templates) {
        if (lower.includes(t.toLowerCase())) {
          return { hit: true, weight: 4, detail: '模板文案' };
        }
      }
      return null;
    },

    // Any URL in a short reply (generic link spam)
    anyLink(info) {
      const urlRe = /https?:\/\/\S+/i;
      if (urlRe.test(info.text) && info.text.replace(/\s/g, '').length < 80) {
        return { hit: true, weight: 4, detail: '短回复含链接' };
      }
      return null;
    },
  };

  // ======================== OP TEXT EXTRACTION ========================
  function extractOpText() {
    // The main tweet is the first article[data-testid="tweet"] on the page
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    if (articles.length === 0) return;

    const mainArticle = articles[0];
    const textEl = mainArticle.querySelector('[data-testid="tweetText"]');
    if (textEl) {
      opText = textEl.textContent.trim();
      opTokens = tokenize(opText);
    }
  }

  function tokenize(text) {
    const clean = text.toLowerCase().replace(/[^一-龥a-zA-Z0-9]/g, ' ');
    const words = clean.split(/\s+/).filter(w => w.length >= 2);
    // Also extract Chinese bigrams
    const chineseOnly = clean.replace(/[^一-龥]/g, '');
    const bigrams = [];
    for (let i = 0; i < chineseOnly.length - 1; i++) {
      bigrams.push(chineseOnly.substring(i, i + 2));
    }
    return [...new Set([...words, ...bigrams])];
  }

  // ======================== SETTINGS ========================
  function loadSettings() {
    chrome.storage.sync.get([
      'enabled', 'threshold', 'useHeuristic',
      'customKeywords', 'rules', 'signalWeights'
    ], (data) => {
      settings.enabled = data.enabled !== undefined ? data.enabled : true;
      settings.threshold = data.threshold || 5;
      settings.useHeuristic = data.useHeuristic !== false;
      settings.customKeywords = data.customKeywords || [];
      settings.rules = (data.rules || []).filter(r => r.enabled !== false);
      settings.signalWeights = data.signalWeights || {};
      if (settings.enabled) scanAll();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.threshold) settings.threshold = changes.threshold.newValue;
    if (changes.useHeuristic) settings.useHeuristic = changes.useHeuristic.newValue;
    if (changes.customKeywords) settings.customKeywords = changes.customKeywords.newValue || [];
    if (changes.rules) settings.rules = (changes.rules.newValue || []).filter(r => r.enabled !== false);
    if (changes.signalWeights) settings.signalWeights = changes.signalWeights.newValue || {};

    if (changes.enabled && changes.enabled.newValue === false) {
      showBadgesOnBlocked();
      return;
    }
    if (changes.enabled && changes.enabled.newValue === true) {
      removeAllScoreBadges();
      scheduleScan();
      return;
    }
    // Settings changed — unblock previously hidden cells so they get re-evaluated
    document.querySelectorAll('[data-testid="cellInnerDiv"][data-bb-hidden="1"]').forEach(el => {
      el.style.visibility = '';
      el.style.height = '';
      el.style.minHeight = '';
      el.style.overflow = '';
      el.dataset.bbHidden = '';
    });
    document.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
      el.dataset.bbBlocked = '0';
    });
    scheduleScan();
  });

  // ======================== TWEET INFO EXTRACTION ========================
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

    const text = textEl ? textEl.textContent.trim() : '';
    return { displayName, handle, text, article };
  }

  // ======================== SCORING ENGINE ========================
  function scoreTweet(info) {
    // 1. Check custom regex rules first (these are hard-blocks)
    for (const rule of settings.rules) {
      if (rule.enabled === false) continue;
      try {
        const flags = rule.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(rule.pattern, flags);
        let matchTarget = '';
        if (rule.type === 'username') matchTarget = info.displayName + ' ' + info.handle;
        else if (rule.type === 'text') matchTarget = info.text;
        else matchTarget = info.bio || '';
        if (regex.test(matchTarget)) {
          return { score: 99, hits: [{ detail: 'regex: ' + rule.pattern, weight: 99 }] };
        }
      } catch (e) { /* invalid regex */ }
    }

    // 2. Heuristic scoring
    if (!settings.useHeuristic) return { score: 0, hits: [] };

    let totalScore = 0;
    const hits = [];

    for (const [name, fn] of Object.entries(SIGNALS)) {
      const cfgWeight = settings.signalWeights[name];
      if (cfgWeight === 0) continue;
      const result = fn(info);
      if (result && result.hit) {
        const w = cfgWeight !== undefined ? cfgWeight : result.weight;
        totalScore += w;
        hits.push({ detail: result.detail, weight: w });
      }
    }

    return { score: totalScore, hits };
  }

  // ======================== BLOCK / UNBLOCK ========================
  // Twitter uses virtual list: each reply has two sibling [data-testid="cellInnerDiv"]
  // with the same translateY. Hide both to collapse the gap cleanly.
  function getCellDivs(article) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (!cell) return [null, null];
    const transform = cell.style.transform;
    // Find the adjacent spacer cellInnerDiv with the same translateY
    let spacer = null;
    if (transform) {
      const prev = cell.previousElementSibling;
      if (prev && prev.matches('[data-testid="cellInnerDiv"]') && prev.style.transform === transform) {
        spacer = prev;
      }
    }
    return [cell, spacer];
  }

  function softBlock(article, scoreInfo) {
    if (article.dataset.bbBlocked === '1') return;

    const [cell, spacer] = getCellDivs(article);
    if (!cell) return;

    article.dataset.bbBlocked = '1';
    article.dataset.bbScore = scoreInfo.score;
    article.dataset.bbHits = scoreInfo.hits.map(h => h.detail).join(', ');
    // Use visibility:hidden instead of display:none — keeps element in DOM
    // so the virtual list doesn't recycle and re-create it endlessly
    cell.style.visibility = 'hidden';
    cell.style.height = '0';
    cell.style.minHeight = '0';
    cell.style.overflow = 'hidden';
    cell.dataset.bbHidden = '1';
    if (spacer) {
      spacer.style.visibility = 'hidden';
      spacer.style.height = '0';
      spacer.style.minHeight = '0';
      spacer.style.overflow = 'hidden';
      spacer.dataset.bbHidden = '1';
    }
    blockedCount++;
  }

  function unblockTweet(article) {
    if (article.dataset.bbBlocked !== '1') return;
    article.dataset.bbBlocked = '0';
    let cell = article.closest('[data-testid="cellInnerDiv"]');
    if (cell && cell.dataset.bbHidden === '1') {
      cell.style.visibility = '';
      cell.style.height = '';
      cell.style.minHeight = '';
      cell.style.overflow = '';
      cell.dataset.bbHidden = '';
      const prev = cell.previousElementSibling;
      if (prev && prev.matches && prev.matches('[data-testid="cellInnerDiv"]') && prev.dataset.bbHidden === '1') {
        prev.style.visibility = '';
        prev.style.height = '';
        prev.style.minHeight = '';
        prev.style.overflow = '';
        prev.dataset.bbHidden = '';
      }
    }
  }

  function unblockAll() {
    document.querySelectorAll('[data-testid="cellInnerDiv"][data-bb-hidden="1"]').forEach(el => {
      el.style.visibility = '';
      el.style.height = '';
      el.style.minHeight = '';
      el.style.overflow = '';
      el.dataset.bbHidden = '';
    });
    document.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
      el.dataset.bbBlocked = '0';
    });
    blockedCount = 0;
    updateBadge();
  }

  function showBadgesOnBlocked() {
    // Unhide all cells
    document.querySelectorAll('[data-testid="cellInnerDiv"][data-bb-hidden="1"]').forEach(el => {
      el.style.visibility = '';
      el.style.height = '';
      el.style.minHeight = '';
      el.style.overflow = '';
      el.dataset.bbHidden = '';
    });
    // Add score badges to blocked articles
    document.querySelectorAll('article[data-testid="tweet"][data-bb-blocked="1"]').forEach(article => {
      addScoreBadge(article);
    });
    blockedCount = 0;
    updateBadge();
  }

  function addScoreBadge(article) {
    if (article.querySelector('.bb-score-badge')) return;
    const score = article.dataset.bbScore || '?';
    const hits = article.dataset.bbHits || '';
    const badge = document.createElement('div');
    badge.className = 'bb-score-badge';
    badge.innerHTML = score + '分' + (hits ? '<span class="bb-score-detail">| ' + escHtml2(hits) + '</span>' : '');
    article.appendChild(badge);
  }

  function removeAllScoreBadges() {
    document.querySelectorAll('.bb-score-badge').forEach(el => el.remove());
    document.querySelectorAll('article[data-testid="tweet"][data-bb-blocked="1"]').forEach(el => {
      el.dataset.bbBlocked = '0';
    });
  }

  // ======================== INLINE BLOCK BUTTON ========================
  function addInlineButtons(article, info) {
    // Quick block user button
    if (!article.querySelector('.bb-inline-block-btn')) {
      const caretBtn = article.querySelector('[data-testid="caret"]');
      if (caretBtn) {
        const container = caretBtn.closest('.css-175oi2r');
        if (container && !container.querySelector('.bb-inline-block-btn')) {
          const btn = document.createElement('button');
          btn.className = 'bb-inline-block-btn';
          btn.title = '屏蔽 ' + info.handle;
          btn.textContent = '🚫';
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            quickBlockUser(info.handle);
          });
          container.appendChild(btn);
        }
      }
    }
  }

  function quickBlockUser(handle) {
    const rule = {
      type: 'username',
      pattern: escapeRegex(handle),
      caseSensitive: false,
      enabled: true,
    };
    chrome.storage.sync.get('rules', (data) => {
      const existing = (data.rules || []).find(r =>
        r.type === 'username' && r.pattern === rule.pattern
      );
      if (existing) {
        showToast('已屏蔽过: ' + handle);
        return;
      }
      const newRules = [...(data.rules || []), rule];
      chrome.storage.sync.set({ rules: newRules });
      showToast('已屏蔽用户: ' + handle);
    });
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escHtml2(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ======================== TEXT SELECTION → ADD KEYWORD ========================
  function setupSelectionHandler() {
    document.addEventListener('mouseup', (e) => {
      setTimeout(() => {
        const sel = window.getSelection();
        const text = (sel || '').toString().trim();
        if (!text || text.length < 1 || text.length > 50) {
          removeFloatingBtn();
          return;
        }

        // Check if selection is inside a tweet
        const anchor = sel.anchorNode;
        if (!anchor) { removeFloatingBtn(); return; }
        const tweet = anchor.parentElement?.closest?.('article[data-testid="tweet"]');
        if (!tweet) { removeFloatingBtn(); return; }

        showFloatingBtn(text, e);
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      const btn = document.querySelector('.bb-float-btn');
      if (btn && !btn.contains(e.target)) {
        removeFloatingBtn();
      }
    });
  }

  function showFloatingBtn(text, event) {
    removeFloatingBtn();

    const btn = document.createElement('div');
    btn.className = 'bb-float-btn';
    btn.innerHTML = `<span>+ 屏蔽</span><em>"${text.length > 20 ? text.slice(0, 20) + '...' : text}"</em>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addKeyword(text);
      removeFloatingBtn();
    });

    // Position near the selection
    const x = event.clientX + 10;
    const y = event.clientY - 30;
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';

    document.body.appendChild(btn);
  }

  function removeFloatingBtn() {
    const btn = document.querySelector('.bb-float-btn');
    if (btn) btn.remove();
  }

  function addKeyword(text) {
    const kw = text.trim().toLowerCase();
    chrome.storage.sync.get('customKeywords', (data) => {
      const keywords = data.customKeywords || [];
      if (keywords.includes(kw)) {
        showToast('关键词已存在: ' + kw);
        return;
      }
      keywords.push(kw);
      chrome.storage.sync.set({ customKeywords: keywords });
      showToast('已添加关键词: ' + kw);
    });
  }

  // ======================== TOAST ========================
  function showToast(msg) {
    let toast = document.querySelector('.bb-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'bb-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('bb-toast-show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.classList.remove('bb-toast-show'); }, 2000);
  }

  // ======================== SCAN ========================
  let scanTimeout = null;
  let firstArticleCache = null;

  function getFirstArticle() {
    if (!firstArticleCache || !document.contains(firstArticleCache)) {
      firstArticleCache = document.querySelector('article[data-testid="tweet"]');
    }
    return firstArticleCache;
  }

  // Scan ALL articles (simple, reliable, no marker state to go stale)
  function scanAll() {
    if (!settings.enabled) return;
    if (!isStatusPage()) return;

    extractOpText();
    blockedCount = 0;
    firstArticleCache = null;
    const main = getFirstArticle();

    // Re-count hidden cells first
    document.querySelectorAll('[data-testid="cellInnerDiv"][data-bb-hidden="1"]').forEach(() => {
      blockedCount++;
    });

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];

      // Skip main tweet
      if (article === main) continue;

      // Skip already blocked
      if (article.dataset.bbBlocked === '1') continue;

      // Skip inline composer
      if (!article.querySelector('[data-testid="User-Name"]')) continue;

      const info = extractTweetInfo(article);
      addInlineButtons(article, info);

      const result = scoreTweet(info);
      if (result.score >= settings.threshold || result.score >= 99) {
        softBlock(article, result);
      }
    }

    updateBadge();
  }

  // Throttled scan trigger (200ms)
  function scheduleScan() {
    if (scanTimeout) return;
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      scanAll();
    }, 200);
  }

  // ======================== BADGE ========================
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
        badgeEl.title = '点击开关屏蔽';
        document.body.appendChild(badgeEl);

        badgeEl.addEventListener('click', () => {
          chrome.storage.sync.get('enabled', (d) => {
            chrome.storage.sync.set({ enabled: !d.enabled });
          });
        });
      }

      badgeEl.textContent = data.enabled === false ? '屏蔽已关闭' : blockedCount + ' 条已屏蔽';
      badgeEl.style.display = '';
    });
  }

  // ======================== MUTATION OBSERVER ========================
  function observe() {
    const mo = new MutationObserver((mutations) => {
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
    mo.observe(document.body, { childList: true, subtree: true });
    observer = mo;
  }

  // ======================== SPA NAVIGATION DETECTION ========================
  let lastPath = location.pathname;
  let navCheckTimer = null;
  let observer = null;

  function isStatusPage() {
    return location.pathname.includes('/status/');
  }

  function checkPageChange() {
    const currentPath = location.pathname;
    if (currentPath === lastPath) return;
    const wasStatus = lastPath.includes('/status/');
    const isStatus = currentPath.includes('/status/');
    lastPath = currentPath;

    if (isStatus && !wasStatus) {
      // Navigated to a status page
      scanAll();
    } else if (!isStatus && wasStatus) {
      // Navigated away from status page
      unblockAll();
    }
  }

  // ======================== INIT ========================
  function init() {
    loadSettings();
    observe();
    setupSelectionHandler();
    navCheckTimer = setInterval(checkPageChange, 500);

    if (isStatusPage()) {
      scheduleScan();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
