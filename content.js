(function () {
  'use strict';

  // ======================== STATE ========================
  let settings = {
    enabled: true,
    threshold: 5,
    useHeuristic: true,
    debug: false,
    customKeywords: [],
    rules: [],
    signalWeights: {},
  };
  let blockedCount = 0;
  let badgeEl = null;
  let mainAuthorHandle = '';

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
      const emojiCount = countEmojis(info.displayName);
      const len = info.displayName.replace(/\s/g, '').length || 1;
      if (emojiCount >= 2 && emojiCount / len > 0.3) {
        return { hit: true, weight: 2, detail: '名称含大量emoji' };
      }
      return null;
    },

    // Unicode decoration: rare script chars, math symbols, etc.
    // Checks both display name and tweet text
    unicodeDeco(info) {
      try {
        // Detect unusual unicode blocks often used by bots for decoration
        const decoRe = new RegExp('[\\u{1F000}-\\u{1F02F}\\u{10A00}-\\u{10AFF}\\u{1D400}-\\u{1D7FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}\\u{2E80}-\\u{2FDF}]', 'u');
        // Bot-framing decorations: CJK brackets, punctuation ornaments, circled numbers/symbols
        const specificDeco = /[𓆩𓆪♡♥︎꧁꧂༺༻◈◆◇◉◎●◦▸▶▷►▻▼▽△▲☆★〚〢〛〠〥〘⸙⸝⦌⦍⦿⊜⓸⓻⚘〜⋆]/;
        const targets = [info.displayName, info.text];
        for (const t of targets) {
          if (decoRe.test(t) || specificDeco.test(t)) {
            return { hit: true, weight: 2, detail: 'Unicode装饰字符' };
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    },

    // Reply has no meaningful text — only emojis, ≤3 Chinese or ≤5 ASCII chars
    emptyContentWithEmoji(info) {
      const clean = info.text.replace(/\s/g, '');
      if (!clean) return null;
      const emojiCount = countEmojis(clean);
      if (emojiCount < 2) return null;
      const textOnly = textWithoutEmoji(clean).replace(/[0-9]/g, '');
      if (textOnly.length <= 5 && emojiCount >= 2) {
        return { hit: true, weight: 6, detail: '短字符+emoji' };
      }
      return null;
    },

    // Regex-based: letter + emoji(s) + letter (fast, catches the obvious patterns)
    emojiMidWordRe(info) {
      try {
        const re = /[a-zA-Z]\p{Emoji_Presentation}+[a-zA-Z]/gu;
        const matches = info.text.match(re);
        if (matches && matches.length >= 1) {
          return { hit: true, weight: 6, detail: '词中夹emoji(RE) x' + matches.length };
        }
        return null;
      } catch (e) {
        return null;
      }
    },

    // Emojis spliced inside English words: "Swi🌸ft", "pizz🌹a", "s🔥oftly"
    midWordEmoji(info) {
      const chars = Array.from(info.text);
      let midWordCount = 0;
      for (let i = 0; i < chars.length; i++) {
        const cp = chars[i].codePointAt(0);
        if (!isEmojiCP(cp)) continue;
        let bi = i - 1;
        while (bi >= 0) {
          const bcp = chars[bi].codePointAt(0);
          if (bcp === 0xFE0F || bcp === 0xFE0E || bcp === 0x200D) { bi--; continue; }
          break;
        }
        let ai = i + 1;
        while (ai < chars.length) {
          const acp = chars[ai].codePointAt(0);
          if (acp === 0xFE0F || acp === 0xFE0E || acp === 0x200D) { ai++; continue; }
          break;
        }
        const before = bi >= 0 ? chars[bi] : ' ';
        const after = ai < chars.length ? chars[ai] : ' ';
        if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) {
          midWordCount++;
        }
      }
      if (midWordCount >= 1) {
        return { hit: true, weight: 5, detail: '词中夹emoji x' + midWordCount };
      }
      return null;
    },

    // Unusually high number of emojis (8+) in a single reply
    emojiOverload(info) {
      const emojiCount = countEmojis(info.text);
      if (emojiCount >= 8) {
        return { hit: true, weight: 5, detail: '大量emoji(' + emojiCount + ')' };
      }
      return null;
    },

    // Sexual keywords from user's custom list (check text + display name)
    sexualKeywords(info) {
      if (!settings.customKeywords.length) return null;
      let count = 0;
      const targets = [info.text, info.displayName];
      for (const target of targets) {
        const lower = target.toLowerCase();
        for (const kw of settings.customKeywords) {
          if (lower.includes(kw.toLowerCase())) count++;
        }
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
      const emojiCount = countEmojis(info.text);
      const len = info.text.replace(/\s/g, '').length || 1;
      if (emojiCount >= 3 && emojiCount / len > 0.25) {
        return { hit: true, weight: 3, detail: 'emoji密度过高' };
      }
      return null;
    },

    // Emoji bomb: 3+ emojis in a short reply (strong spam signal)
    emojiBomb(info) {
      const emojiCount = countEmojis(info.text);
      const cleanLen = info.text.replace(/\s/g, '').length;
      if (emojiCount >= 3 && cleanLen < 60) {
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
      const emojiCount = countEmojis(info.text);
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
      if (countEmojis(info.text) < 2) return null;
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

    // Known bot template phrases (substring + regex), check text + display name
    templatePhrases(info) {
      const targets = [info.text, info.displayName];
      for (const target of targets) {
        const lower = target.toLowerCase();

        // Substring matches
        const templates = [
          // Chinese
          '比她好看的没她骚', '比她骚的没她好看',
          '刷了半天的', '就她的主页能打',
          '比她好看', '没她骚', '没她好看',
          '点击主页', '点主页', '看主页',
          '免费破处', '免费约', '免费看',
          '每晚准时', '大秀', '直播',
          '私信我', '加我微', '加我Q',
          '她好涩', '我不行了', '宇宙第一骚',
          '涩', '想要我', '想被', '来陪我',
          'sao货', '骚货', '我就曰过', '我就日过',
          '这个骚货', '没人比她', '线下的',
          // English romance-spam templates
          'i miss the sound', 'i miss the way',
          'thoughts of you', 'filled with thoughts',
          'kissed me good', 'the way you kissed',
          'carry your memory', 'precious gem',
          'journey i\'m glad', 'glad i took',
          'the moon knows', 'how much i miss',
          'you made me smile', 'world needs you',
          'every breath i take', 'breath i take',
          'love is a journey', 'love is',
        ];
        for (const t of templates) {
          if (lower.includes(t.toLowerCase())) {
            return { hit: true, weight: 4, detail: '模板文案' };
          }
        }

        // Regex patterns for structured templates with evasion characters
        const regexPatterns = [
          /线下.{0,20}骚/,
          /线下.{0,20}sao/i,
          /[就都].{0,3}[曰日].{0,3}过/,
          /👉\s*@\w/,
          /[a-z0-9]\s*线下/,
          /\Bsao\b/i,
        ];
        for (const re of regexPatterns) {
          if (re.test(target)) {
            return { hit: true, weight: 4, detail: '模板文案' };
          }
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

    // Extreme sexual/NSFW keywords in display name or text
    extremeContent(info) {
      const targets = [info.displayName, info.text];
      for (const t of targets) {
        const lower = t.toLowerCase();
        for (const kw of EXTREME_KW) {
          if (lower.includes(kw.toLowerCase())) {
            return { hit: true, weight: 6, detail: '敏感内容: ' + kw };
          }
        }
      }
      return null;
    },
  };

  // ======================== EXTREME KEYWORDS (display name + text) ========================
  const EXTREME_KW = [
    '母狗', '找主人', '求调教', '求操', '想被操', '求草', '骚母狗',
    '求爸爸', '发情', '求虐', '想被艹', '母畜', '贱狗', '求啪',
    '求约', '约吗', '文爱', '语爱', '磕炮', '视频做', 'luo聊',
    '自慰', '打飞机', '骚逼', '贱婢', '小母狗', '骚货',
    '找单男', '单男', '约炮',
  ];

  // ======================== EMOJI HELPERS ========================
  // Standard Unicode property: matches all emoji presentation characters
  const EMOJI_RE = /\p{Emoji_Presentation}/gu;

  function isEmojiCP(cp) {
    return EMOJI_RE.test(String.fromCodePoint(cp));
  }
  function countEmojis(text) {
    const m = text.match(EMOJI_RE);
    return m ? m.length : 0;
  }
  function textWithoutEmoji(text) {
    let out = '';
    for (const c of Array.from(text)) {
      const cp = c.codePointAt(0);
      if (EMOJI_RE.test(c)) continue;
      // Strip variation selectors, all zero-width formatting chars
      if (cp === 0xFE0F || cp === 0xFE0E) continue;
      if (cp === 0x200B || cp === 0x200C || cp === 0x200D) continue;  // ZWS, ZWNJ, ZWJ
      if (cp === 0x2060 || cp === 0xFEFF || cp === 0x00AD) continue;  // WJ, BOM, soft-hyphen
      if (cp === 0x200E || cp === 0x200F) continue;  // LRM, RLM
      out += c;
    }
    return out;
  }

  // ======================== SETTINGS ========================
  function loadSettings() {
    chrome.storage.sync.get([
      'enabled', 'threshold', 'useHeuristic', 'debug',
      'customKeywords', 'rules', 'signalWeights'
    ], (data) => {
      settings.enabled = data.enabled !== undefined ? data.enabled : true;
      settings.threshold = data.threshold || 5;
      settings.useHeuristic = data.useHeuristic !== false;
      settings.debug = data.debug === true;
      settings.customKeywords = data.customKeywords || [];
      settings.rules = (data.rules || []).filter(r => r.enabled !== false);
      settings.signalWeights = data.signalWeights || {};
      if (settings.debug) {
        console.log('%c🐛 Bot Blocker 调试模式已开启 %c阈值=' + settings.threshold,
          'color:#0f0;font-size:14px;', 'color:#ccc;');
        showDebugPanel();
      }
      if (settings.enabled) scanAll();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.threshold) settings.threshold = changes.threshold.newValue;
    if (changes.useHeuristic) settings.useHeuristic = changes.useHeuristic.newValue;
    if (changes.debug) {
      settings.debug = changes.debug.newValue === true;
      if (settings.debug) {
        console.log('%c🐛 调试模式已开启', 'color:#0f0;font-size:14px;');
        showDebugPanel();
      } else {
        hideDebugPanel();
        clearAllDebugMarks();
      }
    }
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
    blockedCount = 0;
    document.querySelectorAll('[data-testid="cellInnerDiv"].bb-blocked, [data-testid="cellInnerDiv"].bb-blocked-spacer').forEach(el => {
      el.classList.remove('bb-blocked', 'bb-blocked-spacer');
    });
    document.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
      el.dataset.bbBlocked = '0';
      el.dataset.bbRevealed = '0';
      el.classList.remove('bb-blocked');
      removeBlockCard(el);
      el.style.display = '';
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

    const text = textEl ? getTweetText(textEl).trim() : '';
    return { displayName, handle, text, article };
  }

  // Extract full text from tweet body, converting emoji <img> tags back to emoji chars
  function getTweetText(el) {
    let out = '';
    walkTextNodes(el);
    return out;

    function walkTextNodes(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (tag === 'IMG') {
            // Twitter renders emojis as <img alt="🎶" ...>
            const alt = child.getAttribute('alt') || '';
            out += alt;
          } else if (tag === 'BR') {
            out += '\n';
          } else {
            walkTextNodes(child);
          }
        }
      }
    }
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
  // CSS class-based hiding: !important stylesheet rule beats Twitter's inline styles
  // when Twitter recycles cells in its virtual list
  function getCellDivs(article) {
    // Try known cell selectors (Twitter may change DOM structure)
    let cell = article.closest('[data-testid="cellInnerDiv"]');
    if (!cell) cell = article.closest('[data-testid="tweet"]')?.parentElement?.closest('[data-testid="cellInnerDiv"]');
    if (!cell) {
      // Walk up to find a div with inline transform (virtual list positioning)
      let el = article.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        if (el.style && el.style.transform && el.style.transform.includes('translateY')) {
          cell = el;
          break;
        }
        el = el.parentElement;
      }
    }
    if (!cell) return [null, null];
    const transform = cell.style.transform;
    let spacer = null;
    if (transform) {
      const prev = cell.previousElementSibling;
      if (prev && prev.matches && prev.matches('[data-testid="cellInnerDiv"]') && prev.style.transform === transform) {
        spacer = prev;
      }
    }
    return [cell, spacer];
  }

  function softBlock(article, scoreInfo) {
    if (article.dataset.bbBlocked === '1') return;
    const [cell, spacer] = getCellDivs(article);

    article.dataset.bbBlocked = '1';
    article.dataset.bbRevealed = '0';
    article.dataset.bbScore = scoreInfo.score;
    article.dataset.bbHits = scoreInfo.hits.map(h => h.detail).join(', ');

    if (cell) {
      cell.classList.add('bb-blocked');
      if (spacer) spacer.classList.add('bb-blocked-spacer');
    } else {
      article.style.display = 'none';
    }

    blockedCount++;
    updateBadge();
  }

  function unblockTweet(article) {
    if (article.dataset.bbBlocked !== '1') return;
    article.dataset.bbBlocked = '0';
    article.dataset.bbRevealed = '1';
    removeBlockCard(article);
    article.style.display = '';
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (cell) {
      cell.classList.remove('bb-blocked');
      const prev = cell.previousElementSibling;
      if (prev && prev.matches && prev.matches('[data-testid="cellInnerDiv"]') && prev.classList.contains('bb-blocked-spacer')) {
        prev.classList.remove('bb-blocked-spacer');
      }
    }
    article.classList.remove('bb-blocked');
    blockedCount = Math.max(0, blockedCount - 1);
    updateBadge();
  }

  function unblockAll() {
    document.querySelectorAll('[data-testid="cellInnerDiv"].bb-blocked, [data-testid="cellInnerDiv"].bb-blocked-spacer').forEach(el => {
      el.classList.remove('bb-blocked', 'bb-blocked-spacer');
    });
    document.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
      el.dataset.bbBlocked = '0';
      el.dataset.bbRevealed = '0';
      el.classList.remove('bb-blocked');
      removeBlockCard(el);
      el.style.display = '';
    });
    blockedCount = 0;
    updateBadge();
  }

  function showBadgesOnBlocked() {
    document.querySelectorAll('[data-testid="cellInnerDiv"].bb-blocked, [data-testid="cellInnerDiv"].bb-blocked-spacer').forEach(el => {
      el.classList.remove('bb-blocked', 'bb-blocked-spacer');
    });
    document.querySelectorAll('article[data-testid="tweet"][data-bb-blocked="1"]').forEach(article => {
      article.dataset.bbRevealed = '1';
      article.classList.remove('bb-blocked');
      removeBlockCard(article);
      article.style.display = '';
      addScoreBadge(article);
    });
    blockedCount = 0;
    updateBadge();
  }

  function removeBlockCard(article) {
    article.querySelectorAll(':scope > .bb-block-card').forEach(el => el.remove());
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
      el.dataset.bbRevealed = '0';
    });
  }

  // ======================== DEBUG MODE ========================
  let debugPanel = null;
  let debugStats = { scanned: 0, blocked: 0, apiBlocked: 0, lastScore: 0, lastHandle: '' };

  function showDebugPanel() {
    if (debugPanel) return;
    debugPanel = document.createElement('div');
    debugPanel.className = 'bb-debug-panel';
    debugPanel.innerHTML = '🐛 调试中...';
    document.body.appendChild(debugPanel);
    updateDebugPanel();
  }

  function hideDebugPanel() {
    if (debugPanel) { debugPanel.remove(); debugPanel = null; }
  }

  function updateDebugPanel() {
    if (!debugPanel) return;
    const s = debugStats;
    const threshold = settings.threshold;
    debugPanel.innerHTML =
      '🐛 <b>DEBUG</b> | 阈值=' + threshold +
      ' | 扫描:' + s.scanned +
      ' | 屏蔽:' + s.blocked +
      ' | API过滤:' + s.apiBlocked +
      (s.lastHandle ? ' | 最近:' + s.lastHandle + '(' + s.lastScore + '分)' : '');
  }

  function clearAllDebugMarks() {
    document.querySelectorAll('.bb-debug-badge').forEach(el => el.remove());
    document.querySelectorAll('article.bb-debug-border, article.bb-debug-danger, article.bb-debug-warn, article.bb-debug-safe, article.bb-debug-blocked').forEach(el => {
      el.classList.remove('bb-debug-border', 'bb-debug-danger', 'bb-debug-warn', 'bb-debug-safe', 'bb-debug-blocked');
      delete el.dataset.bbDebugWouldBlock;
    });
  }

  function addDebugBadge(article, score, hits, isBlocked) {
    // Remove old badge if present
    const old = article.querySelector('.bb-debug-badge');
    if (old) old.remove();

    const badge = document.createElement('div');
    badge.className = 'bb-debug-badge';
    const hitDetails = hits.map(h => h.detail + '(' + h.weight + ')').join(', ');

    if (isBlocked) {
      badge.className += ' bb-debug-blocked';
      badge.innerHTML = 'BLOCKED ' + score + '分';
    } else if (score >= settings.threshold) {
      badge.className += ' bb-debug-danger';
      badge.innerHTML = '🔴 ' + score + '分';
    } else if (score >= settings.threshold * 0.6) {
      badge.className += ' bb-debug-warn';
      badge.innerHTML = '🟡 ' + score + '分';
    } else {
      badge.className += ' bb-debug-safe';
      badge.innerHTML = '🟢 ' + score + '分';
    }

    if (hitDetails) {
      badge.innerHTML += '<span class="bb-debug-detail">| ' + escHtml2(hitDetails) + '</span>';
    }

    article.appendChild(badge);
  }

  function addDebugBorder(article, score, isBlocked) {
    article.classList.add('bb-debug-border');
    if (isBlocked) {
      article.classList.add('bb-debug-blocked');
    } else if (score >= settings.threshold) {
      article.classList.add('bb-debug-danger');
    } else if (score >= settings.threshold * 0.6) {
      article.classList.add('bb-debug-warn');
    } else {
      article.classList.add('bb-debug-safe');
    }
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
  let scanning = false;
  let firstArticleCache = null;

  function getFirstArticle() {
    if (!firstArticleCache || !document.contains(firstArticleCache)) {
      firstArticleCache = document.querySelector('article[data-testid="tweet"]');
    }
    return firstArticleCache;
  }

  function normalizeHandle(handle) {
    return (handle || '').trim().replace(/^@/, '').toLowerCase();
  }

  function getMainAuthorHandle() {
    const main = getFirstArticle();
    if (!main) return '';
    if (!mainAuthorHandle) {
      mainAuthorHandle = normalizeHandle(extractTweetInfo(main).handle);
    }
    return mainAuthorHandle;
  }

  function getNextArticle(article) {
    const [cell] = getCellDivs(article);
    let el = cell ? cell.nextElementSibling : article.parentElement;
    for (let i = 0; i < 8 && el; i++, el = el.nextElementSibling) {
      if (el.matches && el.matches('[data-testid="cellInnerDiv"]')) {
        const nextArticle = el.querySelector('article[data-testid="tweet"]');
        if (nextArticle) return nextArticle;
      }
    }
    return null;
  }

  function getPreviousArticle(article) {
    const [cell] = getCellDivs(article);
    let el = cell ? cell.previousElementSibling : article.parentElement;
    for (let i = 0; i < 8 && el; i++, el = el.previousElementSibling) {
      if (el.matches && el.matches('[data-testid="cellInnerDiv"]')) {
        const prevArticle = el.querySelector('article[data-testid="tweet"]');
        if (prevArticle) return prevArticle;
      }
    }
    return null;
  }

  function revealAuthorReplyTarget(article, info) {
    const mainHandle = getMainAuthorHandle();
    if (!mainHandle || normalizeHandle(info.handle) !== mainHandle) return;

    const prevArticle = getPreviousArticle(article);
    if (!prevArticle || prevArticle === getFirstArticle()) return;
    if (prevArticle.dataset.bbBlocked === '1') {
      unblockTweet(prevArticle);
    }
    prevArticle.dataset.bbAuthorProtected = '1';
  }

  function isAuthorProtected(article, info) {
    const mainHandle = getMainAuthorHandle();
    if (!mainHandle) return false;
    if (normalizeHandle(info.handle) === mainHandle) return true;

    const nextArticle = getNextArticle(article);
    if (!nextArticle) return false;
    const nextInfo = extractTweetInfo(nextArticle);
    return normalizeHandle(nextInfo.handle) === mainHandle;
  }

  // Process a single article (called synchronously from observer — zero flash)
  function processArticle(article) {
    if (!settings.enabled) return;
    if (!article.querySelector('[data-testid="User-Name"]')) return;

    const info = extractTweetInfo(article);
    revealAuthorReplyTarget(article, info);
    const tweetKey = info.handle + '\n' + info.text.slice(0, 160);
    if (article.dataset.bbTweetKey && article.dataset.bbTweetKey !== tweetKey) {
      const wasBlocked = article.dataset.bbBlocked === '1';
      article.dataset.bbBlocked = '0';
      article.dataset.bbRevealed = '0';
      article.classList.remove('bb-blocked');
      removeBlockCard(article);
      article.style.display = '';
      const recycledCell = article.closest('[data-testid="cellInnerDiv"]');
      if (recycledCell) {
        recycledCell.classList.remove('bb-blocked');
        const prev = recycledCell.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('bb-blocked-spacer')) {
          prev.classList.remove('bb-blocked-spacer');
        }
      }
      if (wasBlocked) blockedCount = Math.max(0, blockedCount - 1);
    }
    article.dataset.bbTweetKey = tweetKey;

    if (article.dataset.bbBlocked === '1') return;
    if (article.dataset.bbRevealed === '1') return;

    // Twitter recycles virtual-list cells; clear stale block classes before scoring new content.
    const parentCell = article.closest('[data-testid="cellInnerDiv"]');
    if (parentCell && parentCell.classList.contains('bb-blocked') && article.dataset.bbBlocked !== '1') {
      parentCell.classList.remove('bb-blocked');
      article.classList.remove('bb-blocked');
      removeBlockCard(article);
    }

    addInlineButtons(article, info);

    const result = scoreTweet(info);

    // Debug logging
    if (settings.debug) {
      const hitList = result.hits.map(h => h.detail + '(' + h.weight + ')').join(', ');
      console.log(
        '%c[BB] %c' + info.handle + '%c score=' + result.score + ' %c' + (result.score >= settings.threshold ? 'BLOCK' : 'PASS'),
        'color:#1d9bf0;', 'color:#fff;', result.score >= settings.threshold ? 'color:#f4212e;font-weight:bold;' : 'color:#0f0;',
        'color:#888;'
      );
      if (hitList) console.log('  └ hits: ' + hitList);
    }

    const main = getFirstArticle();
    const isMain = (article === main);

    if (isMain) {
      // Main tweet: score but never block
      article.dataset.bbScore = result.score;
      article.dataset.bbHits = result.hits.map(h => h.detail).join(', ');
      if (settings.debug) {
        addDebugBadge(article, result.score, result.hits, false);
        addDebugBorder(article, result.score, false);
        debugStats.scanned++;
        debugStats.lastScore = result.score;
        debugStats.lastHandle = info.handle;
        updateDebugPanel();
      } else if (result.score >= settings.threshold) {
        addScoreBadge(article);
      }
      return;
    }

    if (isAuthorProtected(article, info)) {
      article.dataset.bbAuthorProtected = '1';
      return;
    }

    // Reply tweets
    if (settings.debug) {
      // In debug mode: show badge on ALL replies, but don't actually hide
      const shouldBlock = result.score >= settings.threshold || result.score >= 99;
      addDebugBadge(article, result.score, result.hits, shouldBlock);
      addDebugBorder(article, result.score, shouldBlock);
      debugStats.scanned++;
      debugStats.lastScore = result.score;
      debugStats.lastHandle = info.handle;
      if (shouldBlock) {
        article.dataset.bbScore = result.score;
        article.dataset.bbHits = result.hits.map(h => h.detail).join(', ');
        article.dataset.bbDebugWouldBlock = '1';
        debugStats.blocked++;
      }
      updateDebugPanel();
      return;
    }

    if (result.score >= settings.threshold || result.score >= 99) {
      softBlock(article, result);
    }
  }

  // Full scan of all articles (initial load, settings change, navigation)
  function scanAll() {
    if (!settings.enabled) return;
    if (!isStatusPage()) return;
    if (scanning) return;
    scanning = true;

    try {
      firstArticleCache = null;
      mainAuthorHandle = '';

      if (settings.debug) {
        debugStats.scanned = 0;
        debugStats.blocked = 0;
        console.log('%c[BB] ===== 开始扫描页面 =====', 'color:#1d9bf0;');
      }

      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (let i = 0; i < articles.length; i++) {
        processArticle(articles[i]);
      }

      updateBadge();

      if (settings.debug) {
        console.log('%c[BB] ===== 扫描完成: ' + debugStats.scanned + '条, 屏蔽' + debugStats.blocked + '条 =====', 'color:#1d9bf0;');
      }
    } catch (e) {
      if (settings.debug) console.error('[BB] scanAll error:', e);
    }
    scanning = false;
  }

  // Throttled full scan (fallback, 500ms)
  function scheduleScan() {
    if (scanTimeout) return;
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      scanAll();
    }, 500);
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
      if (!settings.enabled) return;
      if (!isStatusPage()) return;
      let found = 0;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // New article directly added
          if (node.matches && node.matches('article[data-testid="tweet"]')) {
            processArticle(node);
            found++;
          }
          // Container with articles inside
          if (node.querySelectorAll) {
            const articles = node.querySelectorAll('article[data-testid="tweet"]');
            articles.forEach(a => { processArticle(a); found++; });
          }
        }
      }
      if (found > 0) updateBadge();
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

  // ======================== API INTERCEPTION ========================
  // Filter blocked tweets from API responses before they enter the DOM.
  // Intercepts both window.fetch AND XMLHttpRequest.
  const originalFetch = window.fetch.bind(window);

  function isGraphQLTweetApi(url) {
    if (!url.includes('/graphql/')) return false;
    // Match known tweet endpoints
    if (url.includes('TweetDetail')) return true;
    if (url.includes('TweetResultByRestId')) return true;
    if (url.includes('HomeTimeline')) return true;
    if (url.includes('HomeLatestTimeline')) return true;
    if (url.includes('UserTweets')) return true;
    return false;
  }

  function extractMainTweetId() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function findTweetResult(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const ic = entry.content && entry.content.itemContent;
    if (ic && ic.tweet_results && ic.tweet_results.result) return ic.tweet_results.result;
    if (ic && Array.isArray(ic.items)) {
      for (const item of ic.items) {
        const r = findTweetResult(item);
        if (r) return r;
      }
    }
    return null;
  }

  function extractAPITweetInfo(tweetResult) {
    const legacy = tweetResult.legacy || {};
    const core = tweetResult.core || {};
    const ur = (core.user_results || {}).result || {};
    const ul = ur.legacy || {};
    return {
      displayName: ul.name || '',
      handle: '@' + (ul.screen_name || ''),
      text: legacy.full_text || '',
      article: null,
    };
  }

  function filterEntriesArray(entries, mainTweetId) {
    let filtered = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') { filtered.push(entry); continue; }
      const eid = entry.entryId;
      if (typeof eid !== 'string') { filtered.push(entry); continue; }
      if (eid.startsWith('cursor-')) { filtered.push(entry); continue; }
      if (!eid.startsWith('tweet-')) { filtered.push(entry); continue; }

      const tweetIdM = eid.match(/^tweet-(\d+)/);
      const tweetId = tweetIdM ? tweetIdM[1] : null;
      if (tweetId && mainTweetId && tweetId === mainTweetId) { filtered.push(entry); continue; }

      const tr = findTweetResult(entry);
      if (!tr) { filtered.push(entry); continue; }

      const info = extractAPITweetInfo(tr);
      const mainHandle = getMainAuthorHandle();
      if (mainHandle && normalizeHandle(info.handle) === mainHandle) {
        filtered.push(entry);
        continue;
      }
      const result = scoreTweet(info);
      if (result.score >= settings.threshold || result.score >= 99) {
        blockedCount++;
        if (settings.debug) {
          debugStats.apiBlocked++;
          console.log('%c[BB-API] %c' + info.handle + '%c score=' + result.score + ' %cFILTERED',
            'color:#f91880;', 'color:#fff;', 'color:#f4212e;font-weight:bold;', 'color:#888;');
          updateDebugPanel();
        }
        updateBadge();
        continue;
      }
      filtered.push(entry);
    }
    return filtered;
  }

  function walkAndFilter(obj, mainTweetId) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' && typeof obj[0].entryId === 'string') {
        return filterEntriesArray(obj, mainTweetId);
      }
      return obj.map(item => walkAndFilter(item, mainTweetId));
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'entries' && Array.isArray(value)) {
        result[key] = filterEntriesArray(value, mainTweetId);
      } else {
        result[key] = walkAndFilter(value, mainTweetId);
      }
    }
    return result;
  }

  function filterResponseText(text) {
    if (!text || text.length < 100) return text;
    try {
      const data = JSON.parse(text);
      const mainTweetId = extractMainTweetId();
      const filtered = walkAndFilter(data, mainTweetId);
      return JSON.stringify(filtered);
    } catch (e) {
      return text;
    }
  }

  // --- fetch interception ---
  window.fetch = async function (input, init) {
    const response = await originalFetch(input, init);
    if (!isStatusPage() || !settings.enabled) return response;
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    if (!isGraphQLTweetApi(url)) return response;

    try {
      const clone = response.clone();
      const raw = await clone.text();
      const filtered = filterResponseText(raw);
      if (filtered === raw) return response;

      // Build clean headers (strip Content-Encoding so browser doesn't try to decompress)
      const headers = new Headers();
      for (const [k, v] of response.headers.entries()) {
        const lk = k.toLowerCase();
        if (lk === 'content-encoding' || lk === 'content-length') continue;
        headers.set(k, v);
      }
      headers.set('content-type', 'application/json');

      return new Response(filtered, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    } catch (e) {
      return response;
    }
  };

  // --- XHR interception ---
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OrigXHR();
    let _url = '';
    let _filtered = null;
    const origOpen = xhr.open;
    const origSend = xhr.send;

    xhr.open = function (method, url) {
      _url = typeof url === 'string' ? url : (url ? url.toString() : '');
      return origOpen.apply(this, arguments);
    };

    xhr.send = function (body) {
      if (isStatusPage() && settings.enabled && isGraphQLTweetApi(_url)) {
        const origListener = this.onreadystatechange;
        const origLoad = this.onload;
        const handler = function () {
          if (xhr.readyState === 4 && xhr.status === 200) {
            try {
              const filtered = filterResponseText(xhr.responseText);
              if (filtered !== xhr.responseText) {
                _filtered = filtered;
                Object.defineProperty(xhr, 'responseText', { get: function () { return _filtered; }, configurable: true });
                Object.defineProperty(xhr, 'response', { get: function () { return _filtered; }, configurable: true });
              }
            } catch (e) { /* pass */ }
          }
          if (origListener) origListener.apply(this, arguments);
        };
        this.onreadystatechange = handler;
        if (origLoad) this.onload = handler;
      }
      return origSend.apply(this, arguments);
    };

    return xhr;
  };
  window.XMLHttpRequest.prototype = OrigXHR.prototype;

  // ======================== INIT ========================
  function init() {
    console.log('%c🛡 Bot Blocker v1.0 %c已加载 %c| ' + new Date().toLocaleTimeString(),
      'color:#1d9bf0;font-weight:bold;', 'color:#ccc;', 'color:#888;');

    loadSettings();
    observe();
    setupSelectionHandler();
    navCheckTimer = setInterval(checkPageChange, 500);

    if (isStatusPage()) {
      scheduleScan();
    }

    // Periodic safety-net scan (catches recycled cells, content-only changes)
    setInterval(() => {
      if (settings.enabled && isStatusPage()) scanAll();
    }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
