'use strict';
const $ = (selector) => document.querySelector(selector);
async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`無法載入資料 (${response.status})`);
  return response.json();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
async function home() {
  const container = $('#scenes');
  try {
    const scenes = await loadJSON('data/scenarios/index.json');
    container.replaceChildren();
    const icons = ['💪', '☕', '🌿'];
    scenes.forEach((scene, index) => {
      const card = element('a', 'scene-card');
      card.href = `chat.html?scene=${encodeURIComponent(scene.id)}`;
      const top = element('div', 'card-top');
      top.append(element('span', 'card-icon', icons[index % icons.length]), element('span', 'card-number', `0${index + 1} / CONVERSATION`));
      card.append(top, element('h3', '', scene.title_zh), element('p', '', scene.description_zh));
      const bottom = element('div', 'card-bottom');
      bottom.append(element('span', '', '開始聊天'), element('span', 'arrow', '↗'));
      card.append(bottom); container.append(card);
    });
  } catch (error) { container.textContent = '情境載入失敗，請使用本機 HTTP 伺服器開啟網站後再試。'; }
}
async function chat() {
  const errorBox = $('#error');
  try {
    const id = new URLSearchParams(location.search).get('scene');
    const index = await loadJSON('data/scenarios/index.json');
    const entry = index.find((item) => item.id === id);
    if (!entry) throw new Error('找不到這個情境，請回首頁選擇。');
    const scene = await loadJSON(entry.file);
    if (scene.id !== id) throw new Error('情境資料不一致，請回首頁重新選擇。');
    $('#chat-app').hidden = false;
    $('#scene-title').textContent = scene.title_zh;
    $('#scene-description').textContent = scene.description_zh;
    $('#scene-icon').textContent = scene.emoji || '✳';
    document.title = `${scene.title_zh} — izzna`;
    const dialog = $('#word-dialog');
    function showWord(word) {
      $('#word-title').textContent = word.surface;
      const content = $('#word-content'); content.replaceChildren();
      const fields = [['中文意思', word.meaning_zh], ['原形', word.lemma], ['詞幹／詞根', word.stem_zh], ['詞尾／變化', word.ending_zh], ['文法與語氣', word.analysis_zh], ['例句', word.example_ko], ['例句意思', word.example_zh]];
      fields.forEach(([label, value]) => { const row = element('div', 'word-row'); row.append(element('div', 'word-label', label), element('div', '', value || '未提供')); content.append(row); });
      dialog.showModal();
    }
    $('#close-dialog').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    function addMessage(role, text) {
      const row = element('div', `message-row ${role}`);
      if (role === 'assistant') row.append(element('div', 'message-avatar', '✳'));
      const wrap = element('div', 'message-wrap');
      wrap.append(element('div', 'message-name', role === 'assistant' ? '친구 · 朋友' : '나 · 我'));
      const bubble = element('div', 'bubble');
      if (role === 'assistant') {
        const words = [...(scene.vocabulary || [])].sort((a, b) => b.surface.length - a.surface.length);
        let remaining = text;
        while (remaining) {
          let match = null, position = remaining.length;
          words.forEach((word) => { const i = remaining.indexOf(word.surface); if (i >= 0 && i < position) { match = word; position = i; } });
          if (!match) { bubble.append(document.createTextNode(remaining)); break; }
          bubble.append(document.createTextNode(remaining.slice(0, position)));
          const button = element('button', 'word', match.surface); button.type = 'button'; button.setAttribute('aria-label', `查看 ${match.surface} 的解析`); button.addEventListener('click', () => showWord(match)); bubble.append(button);
          remaining = remaining.slice(position + match.surface.length);
        }
      } else bubble.textContent = text;
      wrap.append(bubble); row.append(wrap); $('#messages').append(row); row.scrollIntoView({block:'nearest'});
    }
    (scene.demo_messages?.length ? scene.demo_messages : [{role:'assistant',text:scene.opening_ko}]).forEach((message) => addMessage(message.role, message.text));
    function list(target, items, render) { const ul = element('ul'); items.forEach((item) => { const li = element('li'); render(li, item); ul.append(li); }); $(target).append(ul); }
    list('#ideas', scene.reply_ideas_zh || [], (li, item) => { li.textContent = item; });
    list('#vocab-hints', scene.vocabulary || [], (li, word) => { li.textContent = `${word.lemma} · ${word.meaning_zh}`; });
    list('#grammar-hints', scene.grammar || [], (li, grammar) => { li.append(element('strong', '', grammar.pattern), document.createTextNode(`：${grammar.explanation_zh}`)); });
    list('#sentence-hints', scene.sentence_hints || [], (li, hint) => { li.textContent = hint; });
    // This provider can later be replaced by a backend while the lookup UI stays unchanged.
    let lookupData;
    async function lookupChinese(query) {
      if (!lookupData) lookupData = await loadJSON('data/lookup.json');
      return lookupData.find((entry) => entry.aliases.includes(query.trim())) || null;
    }
    const draft = $('#message-input');
    const panel = $('#lookup-panel');
    const result = $('#lookup-result');
    let selectedMarker = null;
    let requestId = 0;
    function markers() {
      return [...draft.value.matchAll(/\[([^\[\]]*[\u3400-\u9fff][^\[\]]*)\]/g)]
        .map((match) => ({ text: match[0], query: match[1].trim(), start: match.index }));
    }
    function updateMarkers() {
      const container = $('#draft-markers'); container.replaceChildren();
      const found = markers();
      if (!found.length) $('#draft-warning').hidden = true;
      found.forEach((marker, index) => {
        const button = element('button', 'draft-marker', `查詢 ${marker.text}`);
        button.type = 'button';
        button.addEventListener('click', () => {
          selectedMarker = { ...marker, index, draft: draft.value };
          panel.open = true; $('#lookup-input').value = marker.query;
          runLookup(marker.query, selectedMarker);
        });
        container.append(button);
      });
    }
    async function runLookup(query, marker = null) {
      const currentRequest = ++requestId;
      result.replaceChildren();
      if (!query.trim()) { result.append(element('p', 'lookup-status', '請輸入想查詢的中文詞語。')); return; }
      result.append(element('p', 'lookup-status', '查詢中…'));
      try {
        const entry = await lookupChinese(query);
        if (currentRequest !== requestId) return;
        result.replaceChildren();
        if (!entry) { result.append(element('p', 'lookup-status', 'Demo 詞庫尚未收錄這個詞語，請試試其他詞。')); return; }
        const card = element('div', 'lookup-result-card');
        card.append(element('h3', '', entry.expression_ko));
        [['原形',entry.lemma],['中文意思',entry.meaning_zh],['詞幹／詞根',entry.stem_zh],['詞尾與變化',entry.ending_zh],['使用情境與語氣',entry.usage_zh],['例句',`${entry.example_ko}　${entry.example_zh}`]].forEach(([label,value]) => {
          const row = element('p'); row.append(element('strong', '', `${label}：`), document.createTextNode(value || '未提供')); card.append(row);
        });
        if (marker) {
          card.append(element('p', '', '選擇詞形後才會替換這個標記；請依句子自行調整詞尾。'));
          const forms = element('div', 'lookup-forms');
          entry.forms.forEach((form) => {
            const button = element('button', 'insert-form', `填入 ${form}`); button.type = 'button';
            button.addEventListener('click', () => {
              if (draft.value !== marker.draft || draft.value.slice(marker.start, marker.start + marker.text.length) !== marker.text) {
                result.replaceChildren(element('p', 'lookup-status', '草稿已變更，請重新選擇要查詢的標記。')); return;
              }
              draft.setRangeText(form, marker.start, marker.start + marker.text.length, 'end');
              selectedMarker = null; updateMarkers(); draft.focus();
              result.replaceChildren(element('p', 'lookup-status', '已填入選擇的詞形，請確認是否符合句子。'));
            });
            forms.append(button);
          }); card.append(forms);
        }
        result.append(card);
      } catch (error) {
        if (currentRequest === requestId) result.replaceChildren(element('p', 'lookup-status', '詞庫載入失敗，請稍後再試。'));
      }
    }
    draft.addEventListener('input', updateMarkers);
    $('#lookup-button').addEventListener('click', () => { selectedMarker = null; runLookup($('#lookup-input').value); });
    $('#lookup-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); selectedMarker = null; runLookup(event.currentTarget.value); }
    });
    let turn = 0;
    $('#chat-form').addEventListener('submit', (event) => {
      event.preventDefault(); const input = $('#message-input'); const value = input.value.trim(); if (!value) return;
      if (markers().length) { $('#draft-warning').hidden = false; input.focus(); return; }
      addMessage('user', value); input.value = ''; updateMarkers();
      const matches = (scene.responses || []).filter((response) => response.keywords.some((keyword) => value.includes(keyword)));
      const choices = matches.length ? matches.map((match) => match.text) : scene.fallback_replies;
      addMessage('assistant', choices[turn % choices.length]); turn++; input.focus();
    });
  } catch (error) { errorBox.hidden = false; errorBox.textContent = error.message || '情境載入失敗，請使用 HTTP 伺服器開啟網站。'; }
}
if (document.body.dataset.page === 'home') home(); else chat();
