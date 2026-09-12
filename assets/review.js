/* nplus-book-core/assets/review.js — 已讀標記
 *
 * 讀完一章按右下角的「本章已讀」，或在側欄章節樹逐章勾選；標記存在瀏覽器的
 * localStorage，一鍵匯出成 JSON，交給 /book-apply-review skill 寫進源檔的
 * frontmatter（reviewed: true）。站台是靜態的、沒有後端，所以幾件事只能這樣做：
 *
 *   - 全庫都在 nplus.wiki 同一個 origin 底下，localStorage 是共用的，key 一定要
 *     帶 station（baseURL 最後一段，跟 /index.json 的 station 同一個算法）。
 *   - 每一章的基線是 build 時寫進頁面的 frontmatter 狀態（data-reviewed）。只記
 *     「跟基線不同」的差異：未標而勾 → reviewed，已標而取消 → unreviewed，切回
 *     基線就什麼都不留。
 *   - 差異在側欄永遠看得到（待匯出的勾是淡的）；勾選框與右下角的按鈕只在開關
 *     開著時出現（review:mode）。
 *
 * 匯出的 JSON 就是資料契約，欄位說明在 README「已讀標記」一節，skill 讀的是
 * 那份說明；改欄位兩邊要一起改。
 */
(function () {
  'use strict';

  var page = document.getElementById('rv-page');
  if (!page) return;

  var STATION = page.getAttribute('data-station') || '';
  var SITE = page.getAttribute('data-site') || '';
  var BOOK = page.getAttribute('data-book') || '';

  /* 這一頁自己，跟側欄樹上的每一列同一個形狀 */
  var HERE = {
    source: page.getAttribute('data-source') || '',
    page: location.pathname,
    title: page.getAttribute('data-title') || document.title,
    baseline: page.getAttribute('data-reviewed') === 'true'
  };

  var FORMAT = 'nplus-review/2';
  var KEY = 'review:' + STATION;
  var MODE_KEY = 'review:mode';

  /* ------------------------------------------------------------------ */
  /* 儲存                                                                 */
  /* ------------------------------------------------------------------ */

  var items = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!Array.isArray(data.items)) return [];
      /* 舊版（nplus-review/1）的劃線與整章備註這裡不再顯示也不再匯出 */
      return data.items.filter(function (a) { return a.kind === 'reviewed' || a.kind === 'unreviewed'; });
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

  function pendingFor(source) {
    for (var i = 0; i < items.length; i++) if (items[i].source === source) return items[i];
    return null;
  }

  function unexported() {
    return items.filter(function (a) { return !a.exportedAt; }).length;
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
  /* 已讀狀態：基線 XOR 差異                                               */
  /* ------------------------------------------------------------------ */

  function stateOf(ch) {
    var p = pendingFor(ch.source);
    return p ? p.kind === 'reviewed' : ch.baseline;
  }

  function setReviewed(ch, on) {
    var cur = pendingFor(ch.source);
    if (cur) items.splice(items.indexOf(cur), 1);
    if (on !== ch.baseline) {
      items.push({
        id: uid(),
        kind: on ? 'reviewed' : 'unreviewed',
        source: ch.source,
        page: ch.page,
        title: ch.title,
        createdAt: new Date().toISOString()
      });
    }
    save();
  }

  function toggle(ch) {
    setReviewed(ch, !stateOf(ch));
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
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function checkIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7');
    svg.appendChild(path);
    return svg;
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
  /* 側欄章節樹：每個有源檔的連結尾端掛一格勾選框（開關開著才顯示）；        */
  /* 開關關著時只把差異畫在 build 出來的勾勾上：待匯出的已讀補一個淡勾，      */
  /* 待匯出的取消把原本的勾藏起來。                                        */
  /* ------------------------------------------------------------------ */

  var rows = [];

  function buildTree() {
    document.querySelectorAll('.book-menu a[data-rv-source]').forEach(function (a) {
      var ch = {
        source: a.getAttribute('data-rv-source'),
        page: a.getAttribute('href') || '',
        title: a.getAttribute('data-rv-title') || a.textContent.trim(),
        baseline: a.getAttribute('data-rv-reviewed') === 'true'
      };
      var tick = el('span', 'rv-tick');
      tick.setAttribute('role', 'checkbox');
      tick.tabIndex = 0;
      tick.appendChild(checkIcon());
      /* 勾選框住在 <a> 裡面，點它不能跟著連結跳走 */
      tick.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggle(ch);
      });
      tick.addEventListener('keydown', function (e) {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        toggle(ch);
      });
      a.appendChild(tick);
      rows.push({ a: a, ch: ch, tick: tick, mark: a.querySelector('.reviewed-check'), pend: null });
    });
  }

  function paintTree() {
    rows.forEach(function (r) {
      var on = stateOf(r.ch);
      var p = pendingFor(r.ch.source);
      r.tick.setAttribute('aria-checked', on ? 'true' : 'false');
      r.tick.classList.toggle('rv-tick--pending', !!p);
      r.tick.title = on ? (p ? '已讀（待匯出）' : '已讀') : (p ? '取消已讀（待匯出）' : '標記本章已讀');

      if (p && p.kind === 'reviewed') {
        if (!r.pend) {
          r.pend = el('span', 'reviewed-check reviewed-check--pending', '✓');
          r.pend.title = '已讀（待匯出）';
          r.a.insertBefore(r.pend, r.tick);
        }
        r.pend.hidden = false;
      } else if (r.pend) {
        r.pend.hidden = true;
      }
      if (r.mark) r.mark.hidden = !!(p && p.kind === 'unreviewed');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 右下角：「本章已讀」大按鈕，旁邊一顆待匯出計數；點計數開匯出選單          */
  /* ------------------------------------------------------------------ */

  function buildTray() {
    var tray = el('div', 'rv-ui rv-tray');

    var chip = btn('', 'rv-chip', function () { openMenu(ui.menu.hidden); });
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.hidden = true;

    var fab = btn('', 'rv-fab', function () { toggle(HERE); });
    fab.setAttribute('aria-pressed', 'false');
    fab.appendChild(checkIcon());
    var label = el('span');
    fab.appendChild(label);

    tray.appendChild(chip);
    tray.appendChild(fab);
    document.body.appendChild(tray);

    var menu = el('div', 'rv-ui rv-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.appendChild(btn('匯出 JSON', 'rv-btn', function () { openMenu(false); exportFile(); }));
    menu.appendChild(btn('複製 JSON', 'rv-btn', function () { openMenu(false); copyJson(); }));
    menu.appendChild(btn('清除已匯出', 'rv-btn', function () { openMenu(false); clearExported(); }));
    menu.appendChild(btn('全部清除', 'rv-btn rv-btn--danger', function () { openMenu(false); clearAll(); }));
    document.body.appendChild(menu);

    ui.tray = tray;
    ui.chip = chip;
    ui.fab = fab;
    ui.fabLabel = label;
    ui.menu = menu;
  }

  function openMenu(open) {
    ui.menu.hidden = !open;
    ui.chip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function paintTray() {
    var on = stateOf(HERE);
    ui.fab.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.fab.title = on ? '再按一下取消已讀' : '讀完了，標記本章已讀';
    ui.fabLabel.textContent = on ? '已讀' : '本章已讀';

    var left = unexported();
    ui.chip.hidden = items.length === 0;
    ui.chip.textContent = left ? left + ' 待匯出' : items.length + ' 已匯出';
    if (!items.length) openMenu(false);
  }

  document.addEventListener('click', function (e) {
    if (ui.menu && !ui.menu.hidden && !ui.menu.contains(e.target) && e.target !== ui.chip) openMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.menu && !ui.menu.hidden) openMenu(false);
  });

  function refresh() {
    paintTree();
    paintTray();
    document.querySelectorAll('[data-review-count]').forEach(function (badge) {
      badge.textContent = String(items.length);
      badge.hidden = items.length === 0;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 匯出                                                                 */
  /* ------------------------------------------------------------------ */

  function payload() {
    var list = items.slice().sort(function (a, b) {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    }).map(function (a) {
      return {
        id: a.id,
        kind: a.kind,
        source: a.source,
        page: a.page,
        title: a.title,
        createdAt: a.createdAt
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
    items = items.filter(function (a) { return !a.exportedAt; });
    save();
    toast('已清除 ' + gone.length + ' 筆');
  }

  function clearAll() {
    if (!items.length) return;
    if (!window.confirm('清除這本書全部 ' + items.length + ' 筆標記？沒匯出的會消失。')) return;
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
    if (!on) openMenu(false);
  }

  document.querySelectorAll('[data-review-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = !modeOn();
      setMode(next);
      if (next) toast('讀完按右下角「本章已讀」，或在側欄逐章勾選');
    });
  });

  buildTree();
  buildTray();
  refresh();
  applyMode(modeOn());
})();
