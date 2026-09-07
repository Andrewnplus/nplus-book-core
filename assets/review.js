/* nplus-book-core/assets/review.js — 校閱模式
 *
 * 讓讀者在任何一本書上像電子書閱讀器一樣劃線、加註。資料存在瀏覽器的
 * localStorage，一鍵匯出成 JSON，交給 /book-apply-review skill 改回 Markdown
 * 源檔。站台是靜態的、沒有後端，所以幾件事只能這樣做：
 *
 *   - 全庫都在 nplus.wiki 同一個 origin 底下，localStorage 是共用的，key 一定要
 *     帶 station（baseURL 最後一段，跟 /index.json 的 station 同一個算法）。
 *   - 定位靠文字不靠 DOM 路徑：存選取的原文（exact）加前後各 30 字（prefix /
 *     suffix），重新載入時在內文的純文字裡找回來。書改版後找不到的標成
 *     「定位失敗」，仍然會匯出——匯出本來就發生在改稿之前。
 *   - 劃線永遠顯示，工具列與面板只在校閱模式開啟時出現（review:mode）。
 *
 * 匯出的 JSON 就是資料契約，欄位說明在 README「校閱模式」一節，skill 讀的是
 * 那份說明；改欄位兩邊要一起改。
 */
(function () {
  'use strict';

  var page = document.getElementById('rv-page');
  var article = document.querySelector('article.book-article');
  if (!page || !article) return;

  var STATION = page.getAttribute('data-station') || '';
  var SOURCE = page.getAttribute('data-source') || '';
  var PAGE_TITLE = page.getAttribute('data-title') || document.title;
  var SITE = page.getAttribute('data-site') || '';
  var BOOK = page.getAttribute('data-book') || '';
  var PAGE_REVIEWED = page.getAttribute('data-reviewed') === 'true';
  var PAGE_PATH = location.pathname;

  var FORMAT = 'nplus-review/1';
  var KEY = 'review:' + STATION;
  var MODE_KEY = 'review:mode';
  var CONTEXT = 30;

  var KINDS = [
    { id: 'highlight', label: '重點', needsNote: false, hint: '這段重要：改稿時保留，並在源檔用 <mark> 標起來' },
    { id: 'fix',       label: '修改', needsNote: true,  hint: '要怎麼改？翻譯不順、事實有誤、要補例子…' },
    { id: 'question',  label: '疑問', needsNote: true,  hint: '寫下疑問；套用時先討論，再決定要不要改稿' },
    { id: 'delete',    label: '刪除', needsNote: false, hint: '這段要拿掉，理由可留可不留' }
  ];

  function kindOf(id) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 儲存                                                                 */
  /* ------------------------------------------------------------------ */

  var items = load();
  var orphans = 0;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, station: STATION, items: items }));
    } catch (e) {
      toast('存不進 localStorage，這次的標記只在本頁有效');
    }
    refresh();
  }

  function uid() {
    return 'rv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function byId(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function pageItems() {
    return items.filter(function (a) { return a.source === SOURCE; });
  }

  function modeOn() {
    try { return localStorage.getItem(MODE_KEY) === 'on'; } catch (e) { return false; }
  }

  function setMode(on) {
    try {
      if (on) localStorage.setItem(MODE_KEY, 'on');
      else localStorage.removeItem(MODE_KEY);
    } catch (e) { /* 存不了就只在本頁生效 */ }
    applyMode(on);
  }

  /* ------------------------------------------------------------------ */
  /* 文字索引：把內文所有文字節點串成一條字串，位移 <-> 節點互相換算。       */
  /* 標題末尾的 <a class="anchor">#</a>、script/style 與我們自己的 UI 不算。 */
  /* ------------------------------------------------------------------ */

  function skipped(node) {
    var el = node.parentElement;
    return !el || !!el.closest('script, style, a.anchor, .rv-ui');
  }

  function buildIndex() {
    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], offsets = [], text = '';
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      offsets.push(text.length);
      text += walker.currentNode.data;
    }
    return { nodes: nodes, offsets: offsets, text: text };
  }

  /* ref 之後（inclusive 時含 ref 本身與其子孫）第一個被索引的文字節點的起點 */
  function firstAfter(idx, ref, inclusive) {
    for (var i = 0; i < idx.nodes.length; i++) {
      var n = idx.nodes[i];
      if (inclusive && (n === ref || (ref.contains && ref.contains(n)))) return idx.offsets[i];
      var pos = ref.compareDocumentPosition(n);
      if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) && !(pos & Node.DOCUMENT_POSITION_CONTAINED_BY)) {
        return idx.offsets[i];
      }
    }
    return idx.text.length;
  }

  /* ref 之前最後一個被索引的文字節點的終點 */
  function endBefore(idx, ref) {
    for (var i = idx.nodes.length - 1; i >= 0; i--) {
      if (ref.compareDocumentPosition(idx.nodes[i]) & Node.DOCUMENT_POSITION_PRECEDING) {
        return idx.offsets[i] + idx.nodes[i].data.length;
      }
    }
    return 0;
  }

  function offsetOf(idx, container, offset, atEnd) {
    if (container.nodeType === 3) {
      var i = idx.nodes.indexOf(container);
      if (i >= 0) return idx.offsets[i] + offset;
      return atEnd ? endBefore(idx, container) : firstAfter(idx, container, false);
    }
    var child = container.childNodes[offset];
    if (child) return firstAfter(idx, child, true);
    return firstAfter(idx, container, false);
  }

  function headingText(h) {
    var s = '';
    Array.prototype.forEach.call(h.childNodes, function (n) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1 && !n.classList.contains('anchor')) s += n.textContent;
    });
    return s.trim();
  }

  function headingAt(idx, start) {
    var best = null;
    article.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (h) {
      for (var i = 0; i < idx.nodes.length; i++) {
        if (h.contains(idx.nodes[i])) {
          if (idx.offsets[i] <= start) best = h;
          return;
        }
      }
    });
    return best ? { heading: headingText(best), headingId: best.id || '' } : { heading: '', headingId: '' };
  }

  /* ------------------------------------------------------------------ */
  /* 定位與包裹                                                           */
  /* ------------------------------------------------------------------ */

  function overlapEnd(s, p) {
    var n = 0;
    while (n < s.length && n < p.length && s[s.length - 1 - n] === p[p.length - 1 - n]) n++;
    return n;
  }

  function overlapStart(s, p) {
    var n = 0;
    while (n < s.length && n < p.length && s[n] === p[n]) n++;
    return n;
  }

  function locate(idx, a) {
    var t = idx.text, exact = a.exact;
    if (!exact) return null;
    var i;
    if (a.prefix || a.suffix) {
      i = t.indexOf((a.prefix || '') + exact + (a.suffix || ''));
      if (i >= 0) {
        i += (a.prefix || '').length;
        return [i, i + exact.length];
      }
    }
    /* 上下文對不上（前後段被改過）就找所有出現位置，挑前後文最像的那個 */
    var best = -1, bestScore = -1, from = 0;
    while ((i = t.indexOf(exact, from)) >= 0) {
      var score = overlapEnd(t.slice(Math.max(0, i - CONTEXT), i), a.prefix || '')
        + overlapStart(t.slice(i + exact.length, i + exact.length + CONTEXT), a.suffix || '');
      if (score > bestScore) { bestScore = score; best = i; }
      from = i + 1;
    }
    return best < 0 ? null : [best, best + exact.length];
  }

  function wrap(idx, start, end, a) {
    for (var i = 0; i < idx.nodes.length; i++) {
      var node = idx.nodes[i], from = idx.offsets[i], len = node.data.length;
      if (len === 0 || from + len <= start || from >= end) continue;
      var s = Math.max(0, start - from), e = Math.min(len, end - from);
      var target = node;
      if (e < len) target.splitText(e);
      if (s > 0) target = target.splitText(s);
      /* 段落之間的純空白節點不包，免得出現一顆顆懸空的色塊 */
      if (!target.data.trim()) continue;
      var m = document.createElement('mark');
      m.className = 'rv-hl rv-hl--' + a.kind;
      m.setAttribute('data-rv-id', a.id);
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
    }
  }

  function unwrap(id) {
    article.querySelectorAll('mark.rv-hl[data-rv-id="' + id + '"]').forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function recolor(id, kind) {
    article.querySelectorAll('mark.rv-hl[data-rv-id="' + id + '"]').forEach(function (m) {
      m.className = 'rv-hl rv-hl--' + kind;
    });
  }

  function renderAll() {
    orphans = 0;
    pageItems().filter(function (a) { return a.exact; }).forEach(function (a) {
      /* 每包一筆就重建索引：包裹會把文字節點切開，位移不變但節點清單變了 */
      var idx = buildIndex();
      var pos = locate(idx, a);
      if (!pos) { orphans++; return; }
      wrap(idx, pos[0], pos[1], a);
    });
  }

  /* ------------------------------------------------------------------ */
  /* UI 小工具                                                            */
  /* ------------------------------------------------------------------ */

  var ui = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function btn(label, cls, onClick) {
    var b = el('button', 'rv-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /* 把浮動框放在 rect 上方置中；上方擠不下就放下方，左右夾在視窗內 */
  function place(box, rect) {
    box.hidden = false;
    box.style.visibility = 'hidden';
    var w = box.offsetWidth, h = box.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), vw - w - 8);
    var top = rect.top - h - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, vh - h - 8);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.visibility = '';
  }

  var toastTimer = null;
  function toast(msg) {
    if (!ui.toast) {
      ui.toast = el('div', 'rv-ui rv-toast');
      ui.toast.setAttribute('role', 'status');
      document.body.appendChild(ui.toast);
    }
    ui.toast.textContent = msg;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 1800);
  }

  function stamp() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes());
  }

  /* ------------------------------------------------------------------ */
  /* 選取工具列：選了字就浮出來，四顆按鈕；修改／疑問要先寫註記            */
  /* ------------------------------------------------------------------ */

  var pending = null;     /* { idx, start, end, rect } 目前選取的位置 */
  var activeKind = null;  /* 註記框開著時是哪一種標記 */

  function buildBar() {
    var bar = el('div', 'rv-ui rv-bar');
    bar.hidden = true;
    /* 按下按鈕不能把選取弄丟；textarea 例外，它要拿焦點 */
    bar.addEventListener('mousedown', function (e) {
      if (e.target.tagName !== 'TEXTAREA') e.preventDefault();
    });

    var row = el('div', 'rv-row');
    KINDS.forEach(function (k) {
      var b = btn(k.label, 'rv-btn--' + k.id, function () {
        if (!pending) return;
        if (k.needsNote) openNote(k);
        else commit(k.id, '');
      });
      b.title = k.hint;
      row.appendChild(b);
    });
    bar.appendChild(row);

    var note = el('div', 'rv-note');
    note.hidden = true;
    var hint = el('p', 'rv-note__hint');
    var ta = el('textarea', 'rv-textarea');
    ta.rows = 3;
    var actions = el('div', 'rv-row');
    actions.appendChild(btn('儲存', 'rv-btn--primary', function () {
      if (activeKind) commit(activeKind.id, ta.value.trim());
    }));
    actions.appendChild(btn('取消', '', hideBar));
    note.appendChild(hint);
    note.appendChild(ta);
    note.appendChild(actions);
    bar.appendChild(note);

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (activeKind) commit(activeKind.id, ta.value.trim());
      } else if (e.key === 'Escape') {
        hideBar();
      }
    });

    document.body.appendChild(bar);
    ui.bar = bar;
    ui.barRow = row;
    ui.note = note;
    ui.noteHint = hint;
    ui.noteText = ta;
  }

  function showBar() {
    ui.barRow.hidden = false;
    ui.note.hidden = true;
    activeKind = null;
    place(ui.bar, pending.rect);
  }

  function hideBar() {
    ui.bar.hidden = true;
    activeKind = null;
    pending = null;
  }

  function openNote(kind) {
    activeKind = kind;
    ui.noteHint.textContent = kind.hint;
    ui.noteText.value = '';
    ui.noteText.placeholder = kind.label + '：' + '（Ctrl/⌘ + Enter 儲存）';
    ui.barRow.hidden = true;
    ui.note.hidden = false;
    place(ui.bar, pending.rect);
    ui.noteText.focus();
  }

  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    if (!modeOn() || activeKind) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(onSelection, 200);
  });

  function onSelection() {
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideBar(); return; }
    var anchor = sel.anchorNode;
    var anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (anchorEl && anchorEl.closest('.rv-ui')) return;

    var range = sel.getRangeAt(0);
    if (!range.intersectsNode(article)) { hideBar(); return; }

    var idx = buildIndex();
    var start = offsetOf(idx, range.startContainer, range.startOffset, false);
    var end = offsetOf(idx, range.endContainer, range.endOffset, true);
    var t = idx.text;
    while (start < end && /\s/.test(t[start])) start++;
    while (end > start && /\s/.test(t[end - 1])) end--;
    if (end <= start) { hideBar(); return; }

    pending = { idx: idx, start: start, end: end, rect: range.getBoundingClientRect() };
    showBar();
  }

  function commit(kindId, note) {
    var p = pending;
    if (!p) return;
    var t = p.idx.text;
    var h = headingAt(p.idx, p.start);
    var a = {
      id: uid(),
      kind: kindId,
      source: SOURCE,
      page: PAGE_PATH,
      title: PAGE_TITLE,
      heading: h.heading,
      headingId: h.headingId,
      exact: t.slice(p.start, p.end),
      prefix: t.slice(Math.max(0, p.start - CONTEXT), p.start),
      suffix: t.slice(p.end, p.end + CONTEXT),
      note: note || '',
      at: p.start,
      createdAt: new Date().toISOString()
    };
    items.push(a);
    wrap(p.idx, p.start, p.end, a);
    var sel = document.getSelection();
    if (sel) sel.removeAllRanges();
    hideBar();
    save();
    toast(kindOf(kindId).label + '已記下');
  }

  /* ------------------------------------------------------------------ */
  /* 既有劃線的浮動框：改種類、改註記、刪除                                */
  /* ------------------------------------------------------------------ */

  var popId = null;

  function buildPop() {
    var pop = el('div', 'rv-ui rv-pop');
    pop.hidden = true;
    var meta = el('p', 'rv-pop__meta');
    var quote = el('blockquote', 'rv-pop__quote');
    var select = el('select', 'rv-select');
    KINDS.forEach(function (k) {
      var o = el('option', '', k.label);
      o.value = k.id;
      select.appendChild(o);
    });
    var ta = el('textarea', 'rv-textarea');
    ta.rows = 3;
    ta.placeholder = '註記';
    var actions = el('div', 'rv-row');
    actions.appendChild(btn('儲存', 'rv-btn--primary', function () {
      var a = byId(popId);
      if (!a) return;
      a.kind = select.value;
      a.note = ta.value.trim();
      a.updatedAt = new Date().toISOString();
      recolor(a.id, a.kind);
      save();
      closePop();
      toast('已更新');
    }));
    actions.appendChild(btn('刪除此筆', 'rv-btn--danger', function () {
      removeItem(popId);
      closePop();
    }));
    actions.appendChild(btn('關閉', '', closePop));
    var head = el('div', 'rv-row');
    head.appendChild(select);
    pop.appendChild(meta);
    pop.appendChild(quote);
    pop.appendChild(head);
    pop.appendChild(ta);
    pop.appendChild(actions);
    document.body.appendChild(pop);
    ui.pop = pop;
    ui.popMeta = meta;
    ui.popQuote = quote;
    ui.popSelect = select;
    ui.popText = ta;
  }

  function openPop(id, rect) {
    var a = byId(id);
    if (!a) return;
    popId = id;
    ui.popMeta.textContent = (a.heading ? a.heading + ' · ' : '') + a.createdAt.slice(0, 10);
    ui.popQuote.textContent = a.exact;
    ui.popSelect.value = a.kind;
    ui.popText.value = a.note || '';
    place(ui.pop, rect);
  }

  function closePop() {
    ui.pop.hidden = true;
    popId = null;
  }

  function removeItem(id) {
    var a = byId(id);
    if (!a) return;
    items.splice(items.indexOf(a), 1);
    unwrap(id);
    save();
    toast('已刪除');
  }

  article.addEventListener('click', function (e) {
    if (!modeOn()) return;
    var m = e.target.closest('mark.rv-hl');
    if (!m) return;
    e.preventDefault();
    var sel = document.getSelection();
    if (sel && !sel.isCollapsed) return; /* 正在選字，不是要點開它 */
    hideBar();
    openPop(m.getAttribute('data-rv-id'), m.getBoundingClientRect());
  });

  document.addEventListener('click', function (e) {
    if (ui.pop && !ui.pop.hidden && !ui.pop.contains(e.target) && !e.target.closest('mark.rv-hl')) closePop();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (ui.pop && !ui.pop.hidden) closePop();
    else if (ui.bar && !ui.bar.hidden) hideBar();
  });

  window.addEventListener('scroll', function () {
    if (ui.bar && !ui.bar.hidden && !activeKind) hideBar();
  }, { passive: true });

  /* ------------------------------------------------------------------ */
  /* 面板：計數、章節備註、已讀、匯出、清除                                 */
  /* ------------------------------------------------------------------ */

  function buildPanel() {
    var panel = el('div', 'rv-ui rv-panel');
    panel.setAttribute('aria-label', '校閱面板');

    var head = el('div', 'rv-panel__head');
    head.appendChild(el('strong', '', '校閱模式'));
    var count = el('span', 'rv-panel__count');
    head.appendChild(count);

    var row1 = el('div', 'rv-row');
    row1.appendChild(btn('備註本章', '', function () {
      ui.pageNote.hidden = !ui.pageNote.hidden;
      if (!ui.pageNote.hidden) ui.pageNoteText.focus();
    }));
    var check = el('label', 'rv-check');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function () { setReviewed(cb.checked); });
    check.appendChild(cb);
    check.appendChild(document.createTextNode('本章已讀'));
    row1.appendChild(check);

    var pageNote = el('div', 'rv-note');
    pageNote.hidden = true;
    var pnt = el('textarea', 'rv-textarea');
    pnt.rows = 3;
    pnt.placeholder = '對整章的指示，例如：太薄，補兩個例子；用詞跟前一章不一致';
    var pna = el('div', 'rv-row');
    pna.appendChild(btn('儲存', 'rv-btn--primary', function () {
      var text = pnt.value.trim();
      if (!text) return;
      items.push({
        id: uid(), kind: 'note', source: SOURCE, page: PAGE_PATH, title: PAGE_TITLE,
        heading: '', headingId: '', exact: '', prefix: '', suffix: '',
        note: text, at: -1, createdAt: new Date().toISOString()
      });
      pnt.value = '';
      pageNote.hidden = true;
      save();
      toast('備註已記下');
    }));
    pna.appendChild(btn('取消', '', function () { pageNote.hidden = true; }));
    pageNote.appendChild(pnt);
    pageNote.appendChild(pna);

    var list = el('ul', 'rv-panel__list');

    var row2 = el('div', 'rv-row');
    row2.appendChild(btn('匯出', 'rv-btn--primary', exportFile));
    row2.appendChild(btn('複製', '', copyJson));
    row2.appendChild(btn('清除已匯出', '', clearExported));
    row2.appendChild(btn('全部清除', 'rv-btn--danger', clearAll));

    panel.appendChild(head);
    panel.appendChild(row1);
    panel.appendChild(pageNote);
    panel.appendChild(list);
    panel.appendChild(row2);
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.count = count;
    ui.readCb = cb;
    ui.pageNote = pageNote;
    ui.pageNoteText = pnt;
    ui.list = list;
  }

  /* 已讀是相對於頁面 frontmatter 的差異：源檔未標而勾起來 → reviewed；
     源檔已標而勾掉 → unreviewed；切回基線就不留任何標記。 */
  function reviewedItem() {
    for (var i = 0; i < items.length; i++) {
      if ((items[i].kind === 'reviewed' || items[i].kind === 'unreviewed') && items[i].source === SOURCE) return items[i];
    }
    return null;
  }

  function isReviewed() {
    var cur = reviewedItem();
    return cur ? cur.kind === 'reviewed' : PAGE_REVIEWED;
  }

  function setReviewed(on) {
    var cur = reviewedItem();
    if (cur) items.splice(items.indexOf(cur), 1);
    if (on !== PAGE_REVIEWED) {
      items.push({
        id: uid(), kind: on ? 'reviewed' : 'unreviewed', source: SOURCE, page: PAGE_PATH, title: PAGE_TITLE,
        heading: '', headingId: '', exact: '', prefix: '', suffix: '',
        note: '', at: -2, createdAt: new Date().toISOString()
      });
      if (!on) toast('記為取消已讀；套用後側欄的勾勾才會消失');
    }
    save();
  }

  function refresh() {
    var here = pageItems().length;
    var text = '本章 ' + here + ' · 全書 ' + items.length;
    if (orphans) text += ' · ' + orphans + ' 筆定位失敗';
    ui.count.textContent = text;
    ui.readCb.checked = isReviewed();

    ui.list.textContent = '';
    pageItems().filter(function (a) { return a.kind === 'note'; }).forEach(function (a) {
      var li = el('li');
      var x = btn('✕', 'rv-x', function () { removeItem(a.id); });
      x.setAttribute('aria-label', '刪除這則備註');
      li.appendChild(x);
      li.appendChild(el('span', '', a.note));
      ui.list.appendChild(li);
    });
    ui.list.hidden = !ui.list.firstChild;

    document.querySelectorAll('[data-review-count]').forEach(function (badge) {
      badge.textContent = String(items.length);
      badge.hidden = items.length === 0;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 匯出                                                                 */
  /* ------------------------------------------------------------------ */

  function squash(s) {
    return (s || '').replace(/\s+/g, ' ');
  }

  function payload() {
    var list = items.slice().sort(function (a, b) {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      if (a.at !== b.at) return a.at - b.at;
      return a.createdAt < b.createdAt ? -1 : 1;
    }).map(function (a) {
      return {
        id: a.id,
        kind: a.kind,
        source: a.source,
        page: a.page,
        title: a.title,
        heading: a.heading || '',
        headingId: a.headingId || '',
        exact: squash(a.exact),
        prefix: squash(a.prefix),
        suffix: squash(a.suffix),
        note: a.note || '',
        createdAt: a.createdAt,
        updatedAt: a.updatedAt || ''
      };
    });
    return {
      format: FORMAT,
      station: STATION,
      site: SITE,
      book: BOOK,
      exportedAt: new Date().toISOString(),
      count: list.length,
      items: list
    };
  }

  function markExported() {
    var now = new Date().toISOString();
    items.forEach(function (a) { a.exportedAt = now; });
    save();
  }

  function exportFile() {
    if (!items.length) { toast('還沒有任何標記'); return; }
    var name = 'review-' + STATION + '-' + stamp() + '.json';
    var json = JSON.stringify(payload(), null, 2);
    var blob = new Blob([json], { type: 'application/json' });

    /* 手機上下載常常不知道存去哪，能分享就走分享（存到雲端硬碟、傳給自己） */
    if (navigator.share && navigator.canShare && window.matchMedia('(pointer: coarse)').matches) {
      try {
        var file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).then(markExported).catch(function () {});
          return;
        }
      } catch (e) { /* 不支援 File 建構就走下載 */ }
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    markExported();
    toast('已匯出 ' + name);
  }

  function copyJson() {
    if (!items.length) { toast('還沒有任何標記'); return; }
    var json = JSON.stringify(payload(), null, 2);
    if (!navigator.clipboard) { toast('這個瀏覽器不給寫剪貼簿，請用匯出'); return; }
    navigator.clipboard.writeText(json).then(function () {
      markExported();
      toast('JSON 已複製到剪貼簿');
    }, function () {
      toast('複製失敗，請用匯出');
    });
  }

  function clearExported() {
    var gone = items.filter(function (a) { return a.exportedAt; });
    if (!gone.length) { toast('沒有已匯出的標記'); return; }
    if (!window.confirm('清除 ' + gone.length + ' 筆已匯出的標記？（未匯出的會留下）')) return;
    gone.forEach(function (a) { unwrap(a.id); });
    items = items.filter(function (a) { return !a.exportedAt; });
    save();
    toast('已清除 ' + gone.length + ' 筆');
  }

  function clearAll() {
    if (!items.length) return;
    if (!window.confirm('清除這本書全部 ' + items.length + ' 筆標記？沒匯出的會消失。')) return;
    items.forEach(function (a) { unwrap(a.id); });
    items = [];
    save();
  }

  /* ------------------------------------------------------------------ */
  /* 開關與啟動                                                           */
  /* ------------------------------------------------------------------ */

  function applyMode(on) {
    if (on) document.documentElement.setAttribute('data-review', 'on');
    else document.documentElement.removeAttribute('data-review');
    document.querySelectorAll('[data-review-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (!on) {
      hideBar();
      closePop();
      var sel = document.getSelection();
      if (sel) sel.removeAllRanges();
    }
  }

  document.querySelectorAll('[data-review-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = !modeOn();
      setMode(next);
      if (next) toast('校閱模式：選取文字即可劃線');
    });
  });

  buildBar();
  buildPop();
  buildPanel();
  renderAll();
  refresh();
  applyMode(modeOn());
})();
