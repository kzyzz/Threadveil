(function () {
  'use strict';

  const defaults = window.ThreadveilDefaults || {};
  const signalMeta = defaults.signalMeta || [];
  const defaultRuleConfig = defaults.ruleConfig || {};
  const $ = (sel) => document.querySelector(sel);

  let settings = {
    enabled: true,
    threshold: 5,
    useHeuristic: true,
    debug: false,
    customKeywords: [],
    rules: [],
    signalWeights: {},
    ruleConfig: mergeRuleConfig({}),
  };

  const numberFields = [
    'shortReplyMaxChars',
    'anyLinkMaxChars',
    'emojiOverloadMin',
    'emojiBombMin',
    'emojiBombMaxChars',
    'highEmojiDensityMin',
    'highEmojiDensityRatio',
    'promotionMentionMaxChars',
  ];
  const listFields = ['externalLinkPatterns', 'templatePhrases', 'templateRegexes', 'extremeKeywords'];
  const boolFields = ['useDefaultExternalLinks', 'useDefaultTemplates', 'useDefaultExtremeKeywords'];

  function mergeRuleConfig(config) {
    const merged = Object.assign({}, defaultRuleConfig, config || {});
    listFields.forEach(key => { merged[key] = Array.isArray(merged[key]) ? merged[key] : []; });
    boolFields.forEach(key => { merged[key] = merged[key] !== false; });
    merged.suggestiveEmojiChars = merged.suggestiveEmojiChars || '';
    return merged;
  }

  function save() {
    chrome.storage.sync.set({
      enabled: settings.enabled,
      threshold: settings.threshold,
      useHeuristic: settings.useHeuristic,
      debug: settings.debug,
      customKeywords: settings.customKeywords,
      rules: settings.rules,
      signalWeights: settings.signalWeights,
      ruleConfig: settings.ruleConfig,
    });
  }

  function escHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function linesToList(value) {
    return value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  }

  function listToLines(value) {
    return (value || []).join('\n');
  }

  function bindBasics() {
    $('#enabled').addEventListener('change', () => {
      settings.enabled = $('#enabled').checked;
      save();
    });
    $('#useHeuristic').addEventListener('change', () => {
      settings.useHeuristic = $('#useHeuristic').checked;
      save();
    });
    $('#debug').addEventListener('change', () => {
      settings.debug = $('#debug').checked;
      save();
    });
    $('#threshold').addEventListener('input', () => {
      settings.threshold = Number($('#threshold').value);
      $('#thresholdVal').textContent = settings.threshold;
      save();
    });
  }

  function renderKeywords() {
    const box = $('#kwTags');
    box.innerHTML = '';
    if (!settings.customKeywords.length) {
      box.innerHTML = '<span class="hint">暂无关键词</span>';
      return;
    }
    settings.customKeywords.forEach((kw, index) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `<span title="${escHtml(kw)}">${escHtml(kw)}</span><button data-index="${index}" title="删除">x</button>`;
      box.appendChild(tag);
    });
    box.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.customKeywords.splice(Number(btn.dataset.index), 1);
        save();
        renderKeywords();
      });
    });
  }

  function bindKeywords() {
    $('#addKw').addEventListener('click', () => {
      const input = $('#kwInput');
      const value = input.value.trim().toLowerCase();
      if (!value || settings.customKeywords.includes(value)) return;
      settings.customKeywords.push(value);
      input.value = '';
      save();
      renderKeywords();
    });
    $('#kwInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#addKw').click();
    });
  }

  function renderRules() {
    const box = $('#rulesList');
    box.innerHTML = '';
    if (!settings.rules.length) {
      box.innerHTML = '<div class="hint">暂无自定义规则</div>';
      return;
    }
    settings.rules.forEach((rule, index) => {
      const item = document.createElement('div');
      item.className = 'rule-item';
      item.innerHTML = `
        <span class="rule-type">${rule.type}</span>
        <span class="rule-pattern" title="${escHtml(rule.pattern)}">${escHtml(rule.pattern)}</span>
        <button class="icon-btn toggle" data-index="${index}" title="${rule.enabled === false ? '启用' : '停用'}">${rule.enabled === false ? 'off' : 'on'}</button>
        <button class="icon-btn remove" data-index="${index}" title="删除">x</button>
      `;
      box.appendChild(item);
    });
    box.querySelectorAll('.toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const rule = settings.rules[Number(btn.dataset.index)];
        rule.enabled = rule.enabled === false;
        save();
        renderRules();
      });
    });
    box.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.rules.splice(Number(btn.dataset.index), 1);
        save();
        renderRules();
      });
    });
  }

  function bindRules() {
    $('#addRule').addEventListener('click', () => {
      const pattern = $('#rulePattern').value.trim();
      if (!pattern) return;
      settings.rules.push({
        type: $('#ruleType').value,
        pattern,
        caseSensitive: $('#caseSensitive').checked,
        enabled: true,
      });
      $('#rulePattern').value = '';
      save();
      renderRules();
    });
    $('#rulePattern').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#addRule').click();
    });
  }

  function renderRuleConfig() {
    const cfg = settings.ruleConfig;
    numberFields.forEach(key => { $('#' + key).value = cfg[key]; });
    listFields.forEach(key => { $('#' + key).value = listToLines(cfg[key]); });
    boolFields.forEach(key => { $('#' + key).checked = cfg[key] !== false; });
    $('#suggestiveEmojiChars').value = cfg.suggestiveEmojiChars || '';
  }

  function bindRuleConfig() {
    numberFields.forEach(key => {
      $('#' + key).addEventListener('change', () => {
        settings.ruleConfig[key] = Number($('#' + key).value);
        save();
      });
    });
    listFields.forEach(key => {
      $('#' + key).addEventListener('change', () => {
        settings.ruleConfig[key] = linesToList($('#' + key).value);
        save();
      });
    });
    boolFields.forEach(key => {
      $('#' + key).addEventListener('change', () => {
        settings.ruleConfig[key] = $('#' + key).checked;
        save();
      });
    });
    $('#suggestiveEmojiChars').addEventListener('change', () => {
      settings.ruleConfig.suggestiveEmojiChars = $('#suggestiveEmojiChars').value.trim();
      save();
    });
    $('#resetRuleConfig').addEventListener('click', () => {
      settings.ruleConfig = mergeRuleConfig({});
      save();
      renderRuleConfig();
    });
  }

  function renderWeights() {
    const box = $('#weightsList');
    box.innerHTML = '';
    signalMeta.forEach(meta => {
      const value = settings.signalWeights[meta.id] !== undefined ? settings.signalWeights[meta.id] : meta.def;
      const row = document.createElement('div');
      row.className = 'weight-row';
      row.innerHTML = `
        <span class="weight-label" title="${meta.id}">${meta.label}</span>
        <input type="range" min="0" max="10" step="1" value="${value}" data-id="${meta.id}">
        <span class="weight-val">${value}</span>
      `;
      box.appendChild(row);
    });
    box.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        settings.signalWeights[input.dataset.id] = Number(input.value);
        input.nextElementSibling.textContent = input.value;
        save();
      });
    });
  }

  function bindWeights() {
    $('#resetWeights').addEventListener('click', () => {
      settings.signalWeights = {};
      save();
      renderWeights();
    });
  }

  function bindImportExport() {
    $('#exportConfig').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'threadveil-config.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    $('#importConfig').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          settings = Object.assign(settings, data, { ruleConfig: mergeRuleConfig(data.ruleConfig) });
          save();
          renderAll();
        } catch (e) {
          alert('导入失败：' + e.message);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    });
    $('#clearAll').addEventListener('click', () => {
      if (!confirm('确定清空关键词、自定义规则和规则库配置吗？')) return;
      settings.customKeywords = [];
      settings.rules = [];
      settings.signalWeights = {};
      settings.ruleConfig = mergeRuleConfig({});
      save();
      renderAll();
    });
  }

  function renderAll() {
    $('#enabled').checked = settings.enabled;
    $('#useHeuristic').checked = settings.useHeuristic;
    $('#debug').checked = settings.debug;
    $('#threshold').value = settings.threshold;
    $('#thresholdVal').textContent = settings.threshold;
    renderKeywords();
    renderRules();
    renderRuleConfig();
    renderWeights();
  }

  function init() {
    bindBasics();
    bindKeywords();
    bindRules();
    bindRuleConfig();
    bindWeights();
    bindImportExport();

    chrome.storage.sync.get([
      'enabled', 'threshold', 'useHeuristic', 'debug',
      'customKeywords', 'rules', 'signalWeights', 'ruleConfig',
    ], (data) => {
      settings.enabled = data.enabled !== undefined ? data.enabled : true;
      settings.threshold = data.threshold || 5;
      settings.useHeuristic = data.useHeuristic !== false;
      settings.debug = data.debug === true;
      settings.customKeywords = data.customKeywords || [];
      settings.rules = data.rules || [];
      settings.signalWeights = data.signalWeights || {};
      settings.ruleConfig = mergeRuleConfig(data.ruleConfig);
      renderAll();
    });
  }

  init();
})();
