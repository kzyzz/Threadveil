(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let settings = {
    enabled: true,
    threshold: 6,
    useHeuristic: true,
    customKeywords: [],
    rules: [],
    signalWeights: {},
  };

  const SIGNAL_META = [
    { id: 'midWordEmoji', label: '词中夹emoji', def: 5 },
    { id: 'emojiOverload', label: '大量emoji(≥8)', def: 5 },
    { id: 'emojiSeparatedMention', label: '模板文案+emoji+@', def: 6 },
    { id: 'emptyContentWithEmoji', label: '短字符+emoji', def: 6 },
    { id: 'emojiBomb', label: 'emoji轰炸', def: 5 },
    { id: 'highEmojiDensity', label: 'emoji密度过高', def: 3 },
    { id: 'externalLinks', label: '外部链接', def: 5 },
    { id: 'anyLink', label: '短回复含链接', def: 4 },
    { id: 'promotionMention', label: '引流@', def: 4 },
    { id: 'templatePhrases', label: '模板文案', def: 4 },
    { id: 'hornyEmoji', label: '暗示性表情', def: 2 },
    { id: 'autoGenHandle', label: '随机用户名', def: 2 },
    { id: 'handleStartsWithNumber', label: '数字前缀用户名', def: 2 },
    { id: 'emojiName', label: '名称含大量emoji', def: 2 },
    { id: 'unicodeDeco', label: 'Unicode装饰', def: 2 },
    { id: 'atMentions', label: '多次@他人', def: 1 },
    { id: 'shortReply', label: '短句回复', def: 1 },
  ];

  function save() {
    chrome.storage.sync.set({
      enabled: settings.enabled,
      threshold: settings.threshold,
      useHeuristic: settings.useHeuristic,
      customKeywords: settings.customKeywords,
      rules: settings.rules,
      signalWeights: settings.signalWeights,
    });
  }

  // ======================== GLOBAL TOGGLE ========================
  $('#globalEnabled').addEventListener('change', () => {
    settings.enabled = $('#globalEnabled').checked;
    save();
  });

  // ======================== HEURISTIC TOGGLE ========================
  $('#useHeuristic').addEventListener('change', () => {
    settings.useHeuristic = $('#useHeuristic').checked;
    save();
  });

  // ======================== THRESHOLD ========================
  $('#threshold').addEventListener('input', () => {
    settings.threshold = parseInt($('#threshold').value);
    $('#thresholdVal').textContent = settings.threshold;
    save();
  });

  // ======================== KEYWORD MANAGEMENT ========================
  function renderKeywords() {
    const container = $('#kwTags');
    container.innerHTML = '';

    if (!settings.customKeywords.length) {
      container.innerHTML = '<span class="empty">暂无关键词，选中推文中的文字快速添加</span>';
      return;
    }

    settings.customKeywords.forEach((kw, idx) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `
        ${escHtml(kw)}
        <button data-idx="${idx}" title="删除">×</button>
      `;
      container.appendChild(tag);
    });

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        settings.customKeywords.splice(idx, 1);
        save();
        renderKeywords();
      });
    });
  }

  $('#btnAddKw').addEventListener('click', () => {
    const input = $('#kwInput');
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    if (settings.customKeywords.includes(val)) {
      input.value = '';
      return;
    }
    settings.customKeywords.push(val);
    input.value = '';
    save();
    renderKeywords();
  });

  $('#kwInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnAddKw').click();
  });

  // ======================== WEIGHT MANAGEMENT ========================
  function renderWeights() {
    const container = $('#weightsList');
    if (!container) return;
    container.innerHTML = '';
    SIGNAL_META.forEach(meta => {
      const val = settings.signalWeights[meta.id] !== undefined ? settings.signalWeights[meta.id] : meta.def;
      const row = document.createElement('div');
      row.className = 'weight-row';
      row.innerHTML = `
        <span class="weight-label" title="${meta.id}">${meta.label}</span>
        <input type="range" min="0" max="10" value="${val}" data-signal="${meta.id}" class="${val === 0 ? 'zero' : ''}">
        <span class="weight-val" style="color:${val === 0 ? '#f4212e' : val > meta.def ? '#00ba7c' : '#1d9bf0'}">${val}</span>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('input[type="range"]').forEach(slider => {
      slider.addEventListener('input', () => {
        const id = slider.dataset.signal;
        const v = parseInt(slider.value);
        settings.signalWeights[id] = v;
        const meta = SIGNAL_META.find(m => m.id === id);
        slider.className = v === 0 ? 'zero' : '';
        const valSpan = slider.nextElementSibling;
        valSpan.textContent = v;
        valSpan.style.color = v === 0 ? '#f4212e' : v > (meta ? meta.def : 5) ? '#00ba7c' : '#1d9bf0';
        save();
      });
    });
  }

  $('#btnResetWeights').addEventListener('click', () => {
    settings.signalWeights = {};
    renderWeights();
    save();
  });

  // ======================== PRESET QUICK-ADD ========================
  function renderPresets() {
    $$('.preset-chip').forEach(chip => {
      const kw = chip.dataset.preset.toLowerCase();
      if (settings.customKeywords.includes(kw)) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
      chip.onclick = () => {
        if (settings.customKeywords.includes(kw)) {
          settings.customKeywords = settings.customKeywords.filter(k => k !== kw);
        } else {
          settings.customKeywords.push(kw);
        }
        save();
        renderKeywords();
        renderPresets();
      };
    });
  }

  // ======================== CUSTOM REGEX RULES ========================
  function renderRules() {
    const list = $('#rulesList');
    const empty = $('#rulesEmpty');
    list.innerHTML = '';

    if (!settings.rules.length) {
      empty.style.display = '';
      list.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    list.style.display = '';

    settings.rules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'rule-item' + (rule.enabled === false ? ' disabled' : '');
      div.innerHTML = `
        <span class="rule-type-tag type-${rule.type}">${rule.type === 'username' ? '用户' : rule.type === 'text' ? '内容' : '简介'}</span>
        <span class="rule-pattern" title="${escHtml(rule.pattern)}">${escHtml(rule.pattern)}</span>
        <button class="btn-icon toggle-rule" data-idx="${idx}" title="${rule.enabled === false ? '启用' : '禁用'}">${rule.enabled === false ? '⊘' : '●'}</button>
        <button class="btn-icon del-rule" data-idx="${idx}" title="删除">✕</button>
      `;
      list.appendChild(div);
    });

    list.querySelectorAll('.del-rule').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.rules.splice(parseInt(btn.dataset.idx), 1);
        save();
        renderRules();
      });
    });

    list.querySelectorAll('.toggle-rule').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        settings.rules[idx].enabled = settings.rules[idx].enabled === false ? true : false;
        save();
        renderRules();
      });
    });
  }

  $('#btnAddRule').addEventListener('click', () => {
    const type = $('#ruleType').value;
    const pattern = $('#rulePattern').value.trim();
    const caseSensitive = $('#caseSensitive').checked;
    if (!pattern) return;

    settings.rules.push({ type, pattern, caseSensitive, enabled: true });
    $('#rulePattern').value = '';
    save();
    renderRules();
  });

  $('#rulePattern').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnAddRule').click();
  });

  // ======================== IMPORT / EXPORT ========================
  $('#btnExport').addEventListener('click', () => {
    const data = {
      threshold: settings.threshold,
      useHeuristic: settings.useHeuristic,
      customKeywords: settings.customKeywords,
      rules: settings.rules,
      signalWeights: settings.signalWeights,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot-blocker-config.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());

  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.threshold !== undefined) settings.threshold = data.threshold;
        if (data.useHeuristic !== undefined) settings.useHeuristic = data.useHeuristic;
        if (Array.isArray(data.customKeywords)) settings.customKeywords = data.customKeywords;
        if (Array.isArray(data.rules)) settings.rules = data.rules;
        if (data.signalWeights && typeof data.signalWeights === 'object') settings.signalWeights = data.signalWeights;
        save();
        refreshUI();
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    $('#importFile').value = '';
  });

  // ======================== CLEAR ALL ========================
  $('#btnClear').addEventListener('click', () => {
    if (confirm('确定要删除所有屏蔽规则和关键词吗？')) {
      settings.customKeywords = [];
      settings.rules = [];
      settings.threshold = 5;
      save();
      refreshUI();
    }
  });

  // ======================== HELPERS ========================
  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function refreshUI() {
    $('#globalEnabled').checked = settings.enabled;
    $('#useHeuristic').checked = settings.useHeuristic;
    $('#threshold').value = settings.threshold;
    $('#thresholdVal').textContent = settings.threshold;
    renderKeywords();
    renderPresets();
    renderRules();
    renderWeights();
  }

  // ======================== INIT ========================
  function init() {
    chrome.storage.sync.get([
      'enabled', 'threshold', 'useHeuristic',
      'customKeywords', 'rules', 'signalWeights'
    ], (data) => {
      settings.enabled = data.enabled !== undefined ? data.enabled : true;
      settings.threshold = data.threshold || 5;
      settings.useHeuristic = data.useHeuristic !== false;
      settings.customKeywords = data.customKeywords || [];
      settings.rules = data.rules || [];
      settings.signalWeights = data.signalWeights || {};
      refreshUI();
    });
  }

  init();
})();
