(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let rules = [];
  let globalEnabled = true;

  // --- Persist ---
  function save() {
    chrome.storage.sync.set({ rules, enabled: globalEnabled });
  }

  // --- Render rule list ---
  function render() {
    const list = $('#rulesList');
    const hint = $('#emptyHint');

    list.innerHTML = '';
    const activeRules = rules.filter(r => !r._deleted);

    if (activeRules.length === 0) {
      hint.style.display = '';
      return;
    }
    hint.style.display = 'none';

    activeRules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'rule-item' + (rule.enabled === false ? ' disabled' : '');

      const typeClass = 'type-' + rule.type;

      div.innerHTML = `
        <span class="rule-type ${typeClass}">${rule.type}</span>
        <span class="rule-pattern" title="${escHtml(rule.pattern)}">${escHtml(rule.pattern)}</span>
        <button class="btn-toggle" data-idx="${idx}" title="${rule.enabled === false ? 'Enable' : 'Disable'}">${rule.enabled === false ? '⊘' : '●'}</button>
        <button class="btn-delete" data-idx="${idx}" title="Delete">✕</button>
      `;

      list.appendChild(div);
    });

    // Bind events
    list.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx);
        rules.splice(idx, 1);
        save();
        render();
      });
    });

    list.querySelectorAll('.btn-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx);
        rules[idx].enabled = rules[idx].enabled === false ? true : false;
        save();
        render();
      });
    });
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Init: load from storage ---
  function init() {
    chrome.storage.sync.get(['rules', 'enabled'], (data) => {
      rules = data.rules || [];
      globalEnabled = data.enabled !== undefined ? data.enabled : true;
      $('#globalEnabled').checked = globalEnabled;
      render();
    });
  }

  // --- Events ---
  $('#globalEnabled').addEventListener('change', () => {
    globalEnabled = $('#globalEnabled').checked;
    save();
  });

  $('#btnAdd').addEventListener('click', () => {
    const type = $('#ruleType').value;
    const pattern = $('#rulePattern').value.trim();
    const caseSensitive = $('#caseSensitive').checked;

    if (!pattern) return;

    rules.push({
      type,
      pattern,
      caseSensitive,
      enabled: true,
    });

    $('#rulePattern').value = '';
    save();
    render();
  });

  $('#rulePattern').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnAdd').click();
  });

  // Export
  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot-blocker-rules.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import
  $('#btnImport').addEventListener('click', () => {
    $('#importFile').click();
  });

  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!Array.isArray(imported)) throw new Error('Not an array');
        rules = imported;
        save();
        render();
      } catch (err) {
        alert('Invalid rules file: ' + err.message);
      }
    };
    reader.readAsText(file);
    $('#importFile').value = '';
  });

  // Clear All
  $('#btnClear').addEventListener('click', () => {
    if (confirm('Delete all blocking rules?')) {
      rules = [];
      save();
      render();
    }
  });

  init();
})();
