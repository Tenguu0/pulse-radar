// Pulse Radar's plain dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, the per-protocol detail view, the
// already-trading tab and the method tab. No network: every byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var meta = DATA.meta;

  var state = { q: '', cat: 'all', chain: 'all', mintvl: 0, sort: 'implied', watch: false, launch: false, star: false, sel: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }

  // --- starred protocols, kept in the reader's own browser ---
  var STAR_KEY = 'pulse-starred';
  function loadStars() {
    try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  var stars = loadStars();
  function saveStars() { try { localStorage.setItem(STAR_KEY, JSON.stringify(Array.from(stars))); } catch (e) { /* private mode */ } }
  function isStar(slug) { return stars.has(slug); }

  // --- header stats + snapshot date ---
  $('asof').textContent = meta.as_of;
  $('stats').innerHTML =
    '<span><b>' + meta.protocols_total + '</b> protocols scanned</span>' +
    '<span><b>' + meta.pre_token_total + '</b> pre-token</span>' +
    '<span><b>' + meta.watchlist_total + '</b> on the watchlist</span>' +
    '<span>global median 7d <b>' + fmtPct(meta.global_median_7d) + '</b></span>' +
    '<span>top pulse <b>' + esc(rows.slice().sort(function (a, b) { return b.pulse - a.pulse; })[0].name) + '</b></span>';

  // --- top five by pulse ---
  var top5 = rows.slice().sort(function (a, b) { return b.pulse - a.pulse || b.implied_value_usd - a.implied_value_usd; }).slice(0, 5);
  $('top5').innerHTML = top5.map(function (r, i) {
    return '<button type="button" class="topcard" data-slug="' + esc(r.slug) + '">' +
      '<span class="t-rank">Pulse #' + (i + 1) + ' · ' + r.pulse.toFixed(1) + '</span>' +
      '<span class="t-name">' + esc(r.name) + '</span>' +
      '<span class="t-val">Implied ' + fmtUsd(r.implied_value_usd) + ' · TVL ' + fmtUsd(r.tvl_usd) + '</span>' +
      '<span class="pulsebar' + (r.pulse >= 70 ? ' hot' : '') + '"><i style="width:' + r.pulse + '%"></i></span>' +
      '</button>';
  }).join('');

  // --- filter selects ---
  var cats = Array.from(new Set(rows.map(function (r) { return r.category; }).filter(Boolean))).sort();
  $('cat').innerHTML += cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  var chains = Array.from(new Set(rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort();
  $('chain').innerHTML += chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  // --- tabs ---
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      ['board', 'live', 'method'].forEach(function (t) { $('panel-' + t).hidden = (t !== btn.dataset.tab); });
      if (btn.dataset.tab === 'live') renderLive();
    });
  });

  // --- filtering + sorting ---
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.launch && !r.launch_ready) return false;
      if (state.star && !isStar(r.slug)) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      pulse: function (a, b) { return b.pulse - a.pulse || b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (a.age_days === null ? 1e9 : a.age_days) - (b.age_days === null ? 1e9 : b.age_days); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[state.sort];
    return list.sort(by);
  }

  function pctClass(n) { return n === null ? '' : (n >= 0 ? 'up' : 'down'); }

  function renderBoard() {
    var list = filtered();
    $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' pre-token protocols' +
      (state.watch ? ' · watchlist only' : '') + (state.launch ? ' · launch-ready only' : '') + (state.star ? ' · starred only' : '');
    $('rows').innerHTML = list.map(function (r) {
      var chg = r.change_7d;
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' +
          (r.watchlist ? '<span class="pill">Watchlist</span>' : '') +
          (r.launch_ready ? '<span class="pill launch">Launch-ready</span>' : '') +
          '<span class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
        '<td><span class="mini-pulse"><i style="width:' + r.pulse + '%"></i></span>' + r.pulse.toFixed(1) + '</td>' +
        '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(chg) + '">' + fmtPct(chg) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><button type="button" class="star' + (isStar(r.slug) ? ' on' : '') + '" data-star="' + esc(r.slug) + '" aria-label="Star ' + esc(r.name) + '">' + (isStar(r.slug) ? '★' : '☆') + '</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  // --- detail view ---
  function factorBar(label, value, cls) {
    return '<div class="factor"><span>' + label + '</span><span class="bar"><i class="' + (cls || '') + '" style="width:' + Math.round(value * 100) + '%"></i></span><span>' + (value * 100).toFixed(0) + '%</span></div>';
  }
  function cmpBar(label, value, scale) {
    if (value === null || value === undefined) return '<div class="factor"><span>' + label + '</span><span class="bar"></span><span>n/a</span></div>';
    var w = Math.min(100, Math.abs(value) / scale * 100);
    return '<div class="factor"><span>' + label + '</span><span class="bar"><i class="' + (value >= 0 ? 'pos' : 'neg') + '" style="width:' + w.toFixed(1) + '%"></i></span><span class="' + pctClass(value) + '">' + fmtPct(value) + '</span></div>';
  }

  function renderDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    state.sel = slug;
    var f = r.factors;
    var scale = Math.max(Math.abs(r.change_7d || 0), Math.abs(r.category_median_7d || 0), Math.abs(meta.global_median_7d), 10);
    var d = $('detail');
    d.hidden = false;
    d.innerHTML =
      '<h2>' + esc(r.name) + ' <span style="color:var(--dim);font-size:16px">#' + r.rank + ' · pulse ' + r.pulse.toFixed(1) + '</span></h2>' +
      '<div class="meta">' +
        '<span>Implied value <b>' + fmtUsd(r.implied_value_usd) + '</b></span>' +
        '<span>TVL <b>' + fmtUsd(r.tvl_usd) + '</b></span>' +
        '<span>7d <b class="' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</b></span>' +
        '<span>Age <b>' + fmtAge(r.age_days) + '</b></span>' +
        '<span>Category <b>' + esc(r.category || 'Uncategorised') + '</b></span>' +
        '<span>Chains <b>' + esc(r.chains.join(', ')) + '</b></span>' +
        (r.watchlist ? '<span>On the <b>watchlist</b></span>' : '') +
        (r.launch_ready ? '<span><b>Launch-ready</b></span>' : '') +
      '</div>' +
      '<div class="dialrow">' +
        '<div class="dial" style="--p:' + r.pulse + '"><b>' + r.pulse.toFixed(1) + '</b></div>' +
        '<div class="factors">' +
          factorBar('Momentum', f.momentum) + factorBar('Category heat', f.heat) +
          factorBar('Recency', f.recency) + factorBar('Breadth', f.breadth) +
          factorBar('Size', f.size) + factorBar('Risk kept', f.risk, 'risk') +
        '</div>' +
      '</div>' +
      '<div class="compare"><h3>7-day growth vs its category and the field</h3>' +
        cmpBar(r.name, r.change_7d, scale) +
        cmpBar((r.category || 'Uncategorised') + ' median', r.category_median_7d, scale) +
        cmpBar('Global median', meta.global_median_7d, scale) +
      '</div>' +
      '<div class="farm"><h3>Farm plan — five steps</h3><ol>' +
        r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>' +
      '<div class="actions"><button type="button" id="d-star">' + (isStar(r.slug) ? '★ Starred — click to unstar' : '☆ Star this protocol') + '</button></div>';
    $('d-star').addEventListener('click', function () {
      if (isStar(r.slug)) stars.delete(r.slug); else stars.add(r.slug);
      saveStars(); renderBoard(); renderDetail(r.slug);
    });
    d.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // --- already-trading tab ---
  var liveRendered = false;
  function renderLive() {
    if (liveRendered) return;
    liveRendered = true;
    $('live-rows').innerHTML = DATA.live.map(function (p) {
      var ratio = (p.mcap_usd !== null && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : 'n/a';
      return '<tr><td><strong>' + esc(p.name) + '</strong><span class="sub">' + esc(p.chains.slice(0, 3).join(', ')) + '</span></td>' +
        '<td>' + esc(p.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="num">' + ratio + '</td>' +
        '<td class="num ' + pctClass(p.change_7d) + '">' + fmtPct(p.change_7d) + '</td></tr>';
    }).join('');
  }

  // --- wiring ---
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('mintvl').addEventListener('input', function (e) { state.mintvl = Math.max(0, Number(e.target.value) || 0); renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  function wireToggle(id, key) {
    $(id).addEventListener('click', function () {
      state[key] = !state[key];
      $(id).setAttribute('aria-pressed', state[key] ? 'true' : 'false');
      renderBoard();
    });
  }
  wireToggle('t-watch', 'watch'); wireToggle('t-launch', 'launch'); wireToggle('t-star', 'star');
  $('reset').addEventListener('click', function () {
    state.q = ''; state.cat = 'all'; state.chain = 'all'; state.mintvl = 0; state.sort = 'implied';
    state.watch = false; state.launch = false; state.star = false;
    $('q').value = ''; $('cat').value = 'all'; $('chain').value = 'all'; $('mintvl').value = '0'; $('sort').value = 'implied';
    ['t-watch', 't-launch', 't-star'].forEach(function (id) { $(id).setAttribute('aria-pressed', 'false'); });
    renderBoard();
  });

  document.addEventListener('click', function (e) {
    var starBtn = e.target.closest('[data-star]');
    if (starBtn) {
      e.stopPropagation();
      var slug = starBtn.dataset.star;
      if (isStar(slug)) stars.delete(slug); else stars.add(slug);
      saveStars(); renderBoard();
      return;
    }
    var card = e.target.closest('.topcard');
    if (card) { renderDetail(card.dataset.slug); renderBoard(); return; }
    var row = e.target.closest('#rows tr[data-slug]');
    if (row) { renderDetail(row.dataset.slug); renderBoard(); }
  });

  renderBoard();
})();
