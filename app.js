/* Notre Planning — interface (vues agenda / semaine / mois, filtres, formulaires). */
(() => {
  'use strict';

  const store = window.PlanningStore;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATS = {
    pro: { label: 'Pro', icon: '💼' },
    perso: { label: 'Perso', icon: '🏠' },
    commun: { label: 'Commun', icon: '💞' },
  };
  const RECUR_LABEL = { daily: 'Tous les jours', weekdays: 'Lun–ven', weekly: 'Chaque semaine', monthly: 'Chaque mois' };
  const HOUR_PX = 48;
  const FREE_WINDOW = [7 * 60, 23 * 60]; // créneaux "libres ensemble" cherchés entre 7h et 23h
  const FREE_MIN = 60;                   // durée minimale d'un créneau libre (minutes)
  const COLORS = ['#3b82f6', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#e8590c', '#ef4444', '#ec4899', '#9b5de5', '#64748b'];

  /* Dates ------------------------------------------------------------------- */
  const pad = n => String(n).padStart(2, '0');
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  const startOfWeek = d => { const s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toTimeInput = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fromInputs = (date, time = '00:00') => {
    const [y, m, day] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return new Date(y, m - 1, day, h, mi);
  };
  const fmt = (d, opts) => d.toLocaleDateString('fr-FR', opts);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtTime = d => `${d.getHours()}h${d.getMinutes() ? pad(d.getMinutes()) : ''}`;
  const fmtMin = m => `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`;
  // Minutes "horloge" d'un instant dans une journée, borné à [0, 1440].
  const clockMin = (date, dayStart) => {
    if (date <= dayStart) return 0;
    if (date >= addDays(dayStart, 1)) return 1440;
    return date.getHours() * 60 + date.getMinutes();
  };

  /* Récurrence : génère les occurrences d'un événement dans [from, to[ -------- */
  function occurrences(ev, from, to) {
    const start = new Date(ev.start_at);
    const end = new Date(ev.end_at);
    const dur = end - start;
    if (!ev.recurrence || ev.recurrence === 'none') {
      return end > from && start < to ? [{ ev, start, end }] : [];
    }
    const until = ev.recurrence_until ? addDays(fromInputs(ev.recurrence_until), 1) : null;
    const stepDays = { daily: 1, weekdays: 1, weekly: 7 }[ev.recurrence];
    let i = 0;
    if (stepDays) i = Math.max(0, Math.floor((from - start - dur) / (stepDays * 864e5)) - 1);
    else i = Math.max(0, (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth() - 2);
    const out = [];
    for (let guard = 0; guard < 1000; guard++, i++) {
      let s;
      if (stepDays) s = addDays(start, i * stepDays);
      else {
        s = new Date(start.getFullYear(), start.getMonth() + i, start.getDate(), start.getHours(), start.getMinutes());
        if (s.getDate() !== start.getDate()) continue; // ex. 31 dans un mois de 30 jours
      }
      if (s >= to || (until && s >= until)) break;
      if (ev.recurrence === 'weekdays' && (s.getDay() === 0 || s.getDay() === 6)) continue;
      const e = new Date(s.getTime() + dur);
      if (e > from) out.push({ ev, start: s, end: e });
    }
    return out;
  }

  /* État ---------------------------------------------------------------------- */
  const UI_KEY = 'notre-planning-ui';
  const savedUi = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } })();
  const narrowMq = matchMedia('(max-width: 700px)');
  const state = {
    view: savedUi.view || (narrowMq.matches ? 'agenda' : 'week'),
    who: savedUi.who || 'both',
    cats: savedUi.cats || { pro: true, perso: true, commun: true },
    cursor: startOfDay(new Date()),
    user: null, me: null, partner: null, household: null,
    events: [], range: null,
  };
  const saveUi = () => {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, who: state.who, cats: state.cats })); } catch { /* ignoré */ }
  };

  const personOf = ev => (ev.is_mine ? 'me' : 'partner');
  const nameOf = ev => (ev.is_mine ? 'Moi' : (state.partner?.display_name || 'Partenaire'));
  const colorOf = ev => (ev.category === 'commun' ? 'var(--commun)' : (ev.is_mine ? state.me?.color : state.partner?.color) || 'var(--accent)');
  const canEdit = ev => ev.is_mine || ev.category === 'commun';
  const isMasked = ev => !ev.is_mine && ev.is_private;
  const splitLanes = () => !!state.partner && state.who === 'both';

  function getRange() {
    if (state.view === 'week') {
      const days = narrowMq.matches ? 3 : 7;
      const from = days === 7 ? startOfWeek(state.cursor) : startOfDay(state.cursor);
      return { from, to: addDays(from, days), days };
    }
    if (state.view === 'month') {
      const from = startOfWeek(new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1));
      return { from, to: addDays(from, 42), days: 42 };
    }
    const from = startOfDay(state.cursor);
    return { from, to: addDays(from, 14), days: 14 };
  }

  function visibleOccurrences(from, to, { ignoreFilters = false } = {}) {
    const out = [];
    for (const ev of state.events) {
      if (!ignoreFilters) {
        if (!state.cats[ev.category]) continue;
        if (state.partner && state.who !== 'both' && ev.category !== 'commun' && personOf(ev) !== state.who) continue;
      }
      out.push(...occurrences(ev, from, to));
    }
    return out.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  /* Chargement ------------------------------------------------------------------ */
  let loadSeq = 0;
  async function load() {
    state.range = getRange();
    render();
    const seq = ++loadSeq;
    try {
      const rows = await store.listEvents(state.range.from, state.range.to);
      if (seq !== loadSeq) return;
      state.events = rows;
      render();
    } catch (err) {
      toastError(err);
    }
  }

  async function loadProfiles() {
    const { me, partner } = await store.getProfiles();
    state.me = me;
    state.partner = partner;
    state.household = await store.getHousehold();
  }

  function step(dir) {
    const c = state.cursor;
    if (state.view === 'month') state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    else if (state.view === 'week') state.cursor = addDays(c, dir * (narrowMq.matches ? 3 : 7));
    else state.cursor = addDays(c, dir * 7);
    load();
  }
  function setView(view) {
    state.view = view;
    saveUi();
    load();
  }

  /* Rendu ------------------------------------------------------------------------- */
  function render() {
    if (!state.range) return;
    renderToolbar();
    const main = $('#main');
    main.className = `main view-${state.view}`;
    if (state.view === 'week') renderWeek(main);
    else if (state.view === 'month') renderMonth(main);
    else renderAgenda(main);
  }

  function renderToolbar() {
    const { from, to } = state.range;
    const last = addDays(to, -1);
    let label;
    if (state.view === 'month') label = cap(fmt(state.cursor, { month: 'long', year: 'numeric' }));
    else if (from.getMonth() === last.getMonth()) label = `${from.getDate()} – ${last.getDate()} ${fmt(last, { month: 'long', year: 'numeric' })}`;
    else {
      const year = last.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
      label = `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', ...year })}`;
    }
    $('#period').textContent = label;

    $$('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    $$('#catChips [data-cat]').forEach(b => b.setAttribute('aria-pressed', String(!!state.cats[b.dataset.cat])));

    const whoSeg = $('#whoSeg');
    whoSeg.hidden = !state.partner;
    if (state.partner) {
      const opts = [
        ['me', 'Moi', state.me?.color],
        ['partner', state.partner.display_name || 'Partenaire', state.partner.color],
        ['both', 'Ensemble', null],
      ];
      whoSeg.innerHTML = opts.map(([key, label, color]) =>
        `<button data-who="${key}" aria-pressed="${state.who === key}">${color ? `<span class="dot" style="--c:${esc(color)}"></span>` : '💞'}${esc(label)}</button>`
      ).join('');
    }
  }

  // Répartit des segments qui se chevauchent en colonnes côte à côte.
  function layoutColumns(segs) {
    segs.sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], clusterEnd = -1, colEnds = [];
    const flush = () => {
      const n = colEnds.length;
      cluster.forEach(x => { x.cols = n; });
      cluster = []; colEnds = [];
    };
    for (const x of segs) {
      if (cluster.length && x.s >= clusterEnd) flush();
      let c = colEnds.findIndex(end => end <= x.s);
      if (c === -1) { c = colEnds.length; colEnds.push(x.e); } else colEnds[c] = x.e;
      x.col = c;
      cluster.push(x);
      clusterEnd = Math.max(cluster.length === 1 ? -1 : clusterEnd, x.e);
    }
    if (cluster.length) flush();
  }

  function renderWeek(main) {
    const prevScroll = $('.wk-scroll', main)?.scrollTop;
    const { from, days } = state.range;
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    const split = splitLanes();
    const occ = visibleOccurrences(from, addDays(from, days));
    const now = new Date();
    const cols = `52px repeat(${days}, minmax(0, 1fr))`;

    let html = `<div class="wk-scroll"><div class="wk-sticky"><div class="wk-row" style="grid-template-columns:${cols}"><div></div>`;
    for (const d of dates) {
      html += `<button class="wk-day ${sameDay(d, now) ? 'is-today' : ''}" data-goto="${toDateInput(d)}" title="Voir l’agenda de ce jour">
        <span>${fmt(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong></button>`;
    }
    html += '</div>';
    if (split) {
      html += `<div class="wk-row" style="grid-template-columns:${cols}"><div></div>`;
      for (let i = 0; i < days; i++) {
        html += `<div class="lane-legend"><span style="--c:${esc(state.me.color)}" title="Moi"></span><span style="--c:${esc(state.partner.color)}" title="${esc(state.partner.display_name)}"></span></div>`;
      }
      html += '</div>';
    }
    const allDay = occ.filter(o => o.ev.all_day);
    if (allDay.length) {
      html += `<div class="wk-row wk-allday" style="grid-template-columns:${cols}"><div class="wk-label">Journée</div>`;
      for (const d of dates) {
        const items = allDay.filter(o => o.start < addDays(d, 1) && o.end > d);
        html += `<div>${items.map(o => `<button class="chip-ev" data-ev="${o.ev.id}" style="--c:${esc(colorOf(o.ev))}" title="${esc(o.ev.title)}">${CATS[o.ev.category].icon} ${esc(o.ev.title)}</button>`).join('')}</div>`;
      }
      html += '</div>';
    }
    html += `</div><div class="wk-grid" style="grid-template-columns:${cols};height:${24 * HOUR_PX}px"><div class="wk-hours">`;
    for (let h = 1; h < 24; h++) html += `<span style="top:${h * HOUR_PX}px">${h}h</span>`;
    html += '</div>';

    const LANE = { all: [0, 100], me: [0, 50], partner: [50, 50] };
    for (const d of dates) {
      const dayEnd = addDays(d, 1);
      const segs = occ
        .filter(o => !o.ev.all_day && o.start < dayEnd && o.end > d)
        .map(o => {
          const s = clockMin(o.start, d);
          return { o, s, e: Math.max(clockMin(o.end, d), s + 20) };
        });
      // En vue croisée : chacun sa moitié de colonne ; un événement commun prend
      // toute la largeur s'il ne chevauche rien, sinon il va dans la moitié de son créateur.
      for (const x of segs) {
        if (!split) x.lane = 'all';
        else if (x.o.ev.category !== 'commun') x.lane = personOf(x.o.ev);
        else x.lane = segs.some(y => y !== x && y.s < x.e && y.e > x.s) ? personOf(x.o.ev) : 'all';
      }
      const groups = {};
      segs.forEach(x => (groups[x.lane] ||= []).push(x));
      Object.values(groups).forEach(layoutColumns);

      html += `<div class="wk-col ${sameDay(d, now) ? 'is-today' : ''}" data-date="${toDateInput(d)}">`;
      if (split) html += '<div class="lane-divider"></div>';
      for (const x of segs) {
        const [l, w] = LANE[x.lane];
        html += eventBlock(x.o, {
          top: (x.s / 60) * HOUR_PX,
          height: ((x.e - x.s) / 60) * HOUR_PX,
          left: l + (w * x.col) / x.cols,
          width: w / x.cols,
        });
      }
      if (sameDay(d, now)) html += `<div class="now" style="top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px"></div>`;
      html += '</div>';
    }
    html += '</div></div>';
    main.innerHTML = html;
    $('.wk-scroll', main).scrollTop = prevScroll ?? 7 * HOUR_PX - 8;
  }

  function eventBlock(o, g) {
    const ev = o.ev;
    const short = g.height < 34;
    const time = `${fmtTime(o.start)} – ${fmtTime(o.end)}`;
    const tip = `${ev.title} · ${time}${state.partner ? ` · ${nameOf(ev)}` : ''}${ev.location ? ` · ${ev.location}` : ''}`;
    return `<button class="ev ${isMasked(ev) ? 'is-masked' : ''} ${short ? 'is-short' : ''}" data-ev="${ev.id}"
      style="top:${g.top}px;height:${g.height - 2}px;left:calc(${g.left}% + 2px);width:calc(${g.width}% - 4px);--c:${esc(colorOf(ev))}"
      title="${esc(tip)}"><span class="ev-title">${CATS[ev.category].icon} ${esc(ev.title)}</span><span class="ev-time">${time}</span></button>`;
  }

  function renderMonth(main) {
    const { from } = state.range;
    const occ = visibleOccurrences(from, addDays(from, 42));
    const month = state.cursor.getMonth();
    const today = new Date();
    const max = narrowMq.matches ? 6 : 3;
    let html = '<div class="month"><div class="mo-head">';
    html += ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map(d => `<div>${d}</div>`).join('');
    html += '</div><div class="mo-grid">';
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i);
      const dEnd = addDays(d, 1);
      const items = occ.filter(o => o.start < dEnd && o.end > d);
      html += `<div class="mo-cell ${d.getMonth() !== month ? 'is-out' : ''} ${sameDay(d, today) ? 'is-today' : ''}" data-goto="${toDateInput(d)}">
        <span class="mo-num">${d.getDate()}</span><div class="mo-events">`;
      for (const o of items.slice(0, max)) {
        const time = o.ev.all_day || o.start < d ? '' : `<b>${fmtTime(o.start)}</b> `;
        html += `<button class="mo-ev" data-ev="${o.ev.id}" style="--c:${esc(colorOf(o.ev))}" title="${esc(o.ev.title)}"><i></i><span>${time}${esc(o.ev.title)}</span></button>`;
      }
      html += `</div>${items.length > max ? `<span class="mo-more">+${items.length - max} autre${items.length - max > 1 ? 's' : ''}</span>` : ''}</div>`;
    }
    main.innerHTML = html + '</div></div>';
  }

  // Créneaux où personne n'a rien de prévu (les événements "journée" ne bloquent pas).
  function freeTogether(occ, d) {
    const dEnd = addDays(d, 1);
    const busy = occ
      .filter(o => !o.ev.all_day && o.start < dEnd && o.end > d)
      .map(o => [clockMin(o.start, d), clockMin(o.end, d)])
      .sort((a, b) => a[0] - b[0]);
    let [cur, windowEnd] = FREE_WINDOW;
    const now = new Date();
    if (sameDay(d, now)) cur = Math.max(cur, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
    const free = [];
    for (const [s, e] of busy) {
      if (s >= windowEnd) break;
      if (s - cur >= FREE_MIN) free.push([cur, s]);
      cur = Math.max(cur, e);
    }
    if (windowEnd - cur >= FREE_MIN) free.push([cur, windowEnd]);
    return free;
  }

  function renderAgenda(main) {
    const { from, to } = state.range;
    const today = new Date();
    const occ = visibleOccurrences(from, to);
    const allOcc = splitLanes() ? visibleOccurrences(from, to, { ignoreFilters: true }) : null;
    let html = '<div class="agenda">';
    for (let i = 0; i < 14; i++) {
      const d = addDays(from, i);
      const dEnd = addDays(d, 1);
      const items = occ
        .filter(o => o.start < dEnd && o.end > d)
        .sort((a, b) => (b.ev.all_day - a.ev.all_day) || (a.start - b.start));
      html += `<section class="ag-day"><header class="ag-date"><span class="ag-dow">${fmt(d, { weekday: 'long' })}</span>
        <span class="ag-dnum">${fmt(d, { day: 'numeric', month: 'long' })}</span>${sameDay(d, today) ? '<span class="badge">Aujourd’hui</span>' : ''}</header>`;
      if (items.length) {
        html += '<div class="ag-list">' + items.map(o => agendaItem(o, d, dEnd)).join('') + '</div>';
      } else {
        html += '<p class="ag-empty">Rien de prévu</p>';
      }
      if (allOcc) {
        const free = freeTogether(allOcc, d);
        if (free.length) html += `<p class="ag-free">✨ Libres ensemble : ${free.map(([a, b]) => `${fmtMin(a)} – ${fmtMin(b)}`).join(' · ')}</p>`;
      }
      html += '</section>';
    }
    main.innerHTML = html + '</div>';
  }

  function agendaItem(o, d, dEnd) {
    const ev = o.ev;
    const time = ev.all_day
      ? 'Journée'
      : `${o.start < d ? '…' : fmtTime(o.start)}<br>${o.end > dEnd ? '…' : fmtTime(o.end)}`;
    const tags = [];
    if (state.partner) tags.push(ev.category === 'commun' ? '<span class="tag">💞 Ensemble</span>' : `<span class="tag"><span class="dot" style="--c:${esc(colorOf(ev))}"></span>${esc(nameOf(ev))}</span>`);
    tags.push(`<span class="tag">${CATS[ev.category].icon} ${CATS[ev.category].label}</span>`);
    if (ev.is_private) tags.push('<span class="tag">🔒 Privé</span>');
    if (ev.recurrence && ev.recurrence !== 'none') tags.push(`<span class="tag">↻ ${RECUR_LABEL[ev.recurrence]}</span>`);
    if (ev.location) tags.push(`<span class="tag">📍 ${esc(ev.location)}</span>`);
    return `<button class="ag-ev ${isMasked(ev) ? 'is-masked' : ''}" data-ev="${ev.id}" style="--c:${esc(colorOf(ev))}">
      <span class="ag-time">${time}</span><span class="ag-bar"></span>
      <span class="ag-body"><strong>${esc(ev.title)}</strong><span class="ag-meta">${tags.join('')}</span></span></button>`;
  }

  /* Formulaire événement ------------------------------------------------------------ */
  const evDlg = $('#eventDlg');
  const evForm = $('#eventForm');
  const F = evForm.elements;
  let editing = null;
  let formStart = null;

  function openEvent(id) {
    const ev = state.events.find(e => e.id === id);
    if (ev) fillEventForm(ev);
  }

  function newEvent(start) {
    if (!start) {
      const now = new Date();
      start = sameDay(state.cursor, now)
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
        : addDays(startOfDay(state.cursor), 0);
      if (!sameDay(state.cursor, now)) start.setHours(9);
    }
    const end = new Date(start.getTime() + 3600e3);
    fillEventForm({
      id: null, title: '', category: 'perso', start_at: start.toISOString(), end_at: end.toISOString(),
      all_day: false, is_private: false, recurrence: 'none', recurrence_until: null, notes: '', location: '', is_mine: true,
    });
  }

  function fillEventForm(ev) {
    editing = ev;
    const readOnly = !canEdit(ev);
    const s = new Date(ev.start_at);
    const e = new Date(ev.end_at);
    const shownEnd = ev.all_day ? addDays(e, -1) : e;
    F.title.value = ev.title || '';
    F.category.value = ev.category;
    F.all_day.checked = !!ev.all_day;
    F.start_date.value = toDateInput(s);
    F.start_time.value = toTimeInput(s);
    F.end_date.value = toDateInput(shownEnd);
    F.end_time.value = toTimeInput(e);
    F.recurrence.value = ev.recurrence || 'none';
    F.recurrence_until.value = ev.recurrence_until || '';
    F.location.value = ev.location || '';
    F.notes.value = ev.notes || '';
    F.is_private.checked = !!ev.is_private;
    formStart = s;

    $('#evDlgTitle').textContent = !ev.id ? 'Nouvel événement' : readOnly ? 'Détails' : 'Modifier l’événement';
    const owner = $('#evOwner');
    owner.hidden = !(ev.id && !ev.is_mine);
    owner.textContent = isMasked(ev)
      ? `Créneau privé de ${nameOf(ev)}.`
      : `Ajouté par ${nameOf(ev)}${readOnly ? ' (lecture seule)' : ''}.`;
    $('#evFields').disabled = readOnly;
    $('#evDelete').hidden = !ev.id || readOnly;
    $('#evSave').hidden = readOnly;
    $('#evCancel').textContent = readOnly ? 'Fermer' : 'Annuler';
    $('#evSeriesNote').hidden = !(ev.id && ev.recurrence !== 'none');
    $('#evImportNote').hidden = !ev.import_key;
    $('#privateRow').hidden = !state.partner && !ev.is_private;
    syncEventForm();
    evDlg.showModal();
    if (!ev.id) F.title.focus();
  }

  function syncEventForm() {
    const allDay = F.all_day.checked;
    $$('.time-field', evForm).forEach(el => { el.hidden = allDay; });
    F.start_time.required = F.end_time.required = !allDay;
    const commun = F.category.value === 'commun';
    if (commun) F.is_private.checked = false;
    F.is_private.disabled = commun;
    $('#untilRow').hidden = F.recurrence.value === 'none';
  }

  // Déplacer le début décale la fin pour garder la même durée.
  function onStartChange() {
    if (!F.start_date.value) return;
    const newStart = fromInputs(F.start_date.value, F.start_time.value || '00:00');
    if (formStart && F.end_date.value) {
      const end = fromInputs(F.end_date.value, F.end_time.value || '00:00');
      const shifted = new Date(end.getTime() + (newStart - formStart));
      F.end_date.value = toDateInput(shifted);
      F.end_time.value = toTimeInput(shifted);
    }
    formStart = newStart;
  }

  async function submitEvent(e) {
    e.preventDefault();
    const allDay = F.all_day.checked;
    const start = allDay ? fromInputs(F.start_date.value) : fromInputs(F.start_date.value, F.start_time.value);
    const end = allDay ? addDays(fromInputs(F.end_date.value), 1) : fromInputs(F.end_date.value, F.end_time.value);
    if (!(end > start)) return toast('La fin doit être après le début.');
    const title = F.title.value.trim();
    if (!title) return toast('Donne un titre à l’événement.');
    const recurrence = F.recurrence.value;
    const ev = {
      id: editing.id,
      title,
      category: F.category.value,
      all_day: allDay,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      location: F.location.value.trim() || null,
      notes: F.notes.value.trim() || null,
      is_private: F.category.value !== 'commun' && F.is_private.checked,
      recurrence,
      recurrence_until: recurrence !== 'none' && F.recurrence_until.value ? F.recurrence_until.value : null,
    };
    await withBusy($('#evSave'), async () => {
      await store.saveEvent(ev);
      evDlg.close();
      toast(ev.id ? 'Événement modifié' : 'Événement ajouté');
      load();
    });
  }

  async function deleteEvent() {
    if (!editing?.id) return;
    const series = editing.recurrence && editing.recurrence !== 'none';
    if (!confirm(series ? 'Supprimer toute la série d’événements ?' : 'Supprimer cet événement ?')) return;
    await withBusy($('#evDelete'), async () => {
      await store.deleteEvent(editing.id);
      evDlg.close();
      toast('Événement supprimé');
      load();
    });
  }

  /* Réglages ---------------------------------------------------------------------- */
  const setDlg = $('#settingsDlg');

  async function openSettings() {
    try { await loadProfiles(); } catch (err) { toastError(err); }
    renderSettings();
    if (!setDlg.open) setDlg.showModal();
  }

  function renderSettings() {
    const { me, partner, household } = state;
    const color = me?.color || COLORS[0];
    let share;
    if (partner) {
      share = `<p>Planning partagé avec <span class="dot" style="--c:${esc(partner.color)}"></span> <strong>${esc(partner.display_name)}</strong>.</p>
        <div><button class="btn danger" data-act="leave">Arrêter le partage</button></div>`;
    } else if (household?.waiting) {
      share = `<p>Liaison en cours… Elle se finalise automatiquement dès que l’autre personne ouvre l’app.</p>
        <div><button class="btn danger" data-act="leave">Annuler</button></div>`;
    } else if (household) {
      share = `<p>Envoie ce code à la personne avec qui partager ton planning :</p>
        <div class="code-box"><code>${esc(household.invite_code)}</code><button class="btn" data-act="copy">Copier</button></div>
        <p class="muted">Elle crée son compte, ouvre ⚙ Réglages et saisit ce code. Vos deux plannings seront alors croisés.</p>
        <div><button class="btn" data-act="refresh">Actualiser</button> <button class="btn danger" data-act="leave">Annuler l’invitation</button></div>`;
    } else {
      share = `<p>Relie ton planning à celui de ta moitié pour voir vos agendas croisés et vos créneaux libres communs.</p>
        <div><button class="btn primary" data-act="create">Créer un code d’invitation</button></div>
        <p class="muted">… ou saisis le code que l’on t’a envoyé :</p>
        <form class="inline-form" id="joinForm"><input class="input" name="code" placeholder="CODE" maxlength="12" required autocomplete="off" aria-label="Code d’invitation"><button class="btn">Rejoindre</button></form>`;
    }
    $('#settingsBody').innerHTML = `
      <section class="set-section">
        <h3>Mon profil</h3>
        <form id="profileForm" class="auth-form">
          <label class="field">Prénom<input name="display_name" maxlength="60" required value="${esc(me?.display_name)}"></label>
          <div class="field">Ma couleur
            <div class="swatches">${COLORS.map(c => `<button type="button" class="swatch" style="--c:${c}" data-color="${c}" aria-pressed="${c === color}" aria-label="Couleur ${c}"></button>`).join('')}</div>
          </div>
          <div><button class="btn primary">Enregistrer</button></div>
        </form>
      </section>
      <section class="set-section"><h3>Planning partagé</h3>${share}</section>
      <section class="set-section">
        <h3>Planning de travail</h3>
        <p class="muted">Importe le fichier Excel de ton planning pour remplir automatiquement tes journées, permanences et congés.</p>
        <div><button class="btn" data-act="import">📥 Importer un fichier Excel</button></div>
      </section>
      <section class="set-section">
        <h3>Compte</h3>
        <p class="muted">${esc(state.user?.email)}</p>
        <div>${store.mode === 'demo'
          ? '<button class="btn danger" data-act="reset-demo">Réinitialiser les données de démo</button>'
          : '<button class="btn" data-act="logout">Se déconnecter</button>'}</div>
      </section>`;
  }

  async function onSettingsClick(e) {
    const swatch = e.target.closest('[data-color]');
    if (swatch) {
      $$('[data-color]', setDlg).forEach(b => b.setAttribute('aria-pressed', String(b === swatch)));
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    await withBusy(btn, async () => {
      if (act === 'create') await store.createHousehold();
      else if (act === 'leave') {
        if (!confirm('Arrêter de partager vos plannings ? Chacun garde ses événements.')) return;
        await store.leaveHousehold();
        state.who = 'both';
      } else if (act === 'copy') {
        await navigator.clipboard.writeText(state.household.invite_code);
        return toast('Code copié');
      } else if (act === 'import') {
        setDlg.close();
        return openImport();
      } else if (act === 'logout') {
        setDlg.close();
        return store.signOut();
      } else if (act === 'reset-demo') {
        if (!confirm('Remettre les données d’exemple ?')) return;
        await store.resetDemo();
      }
      await openSettings();
      load();
    });
  }

  async function onSettingsSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (form.id === 'profileForm') {
      const color = $('[data-color][aria-pressed="true"]', form)?.dataset.color || COLORS[0];
      await withBusy($('button:not([type])', form), async () => {
        await store.updateMe({ display_name: form.elements.display_name.value.trim(), color });
        await loadProfiles();
        toast('Profil enregistré');
        render();
      });
    } else if (form.id === 'joinForm') {
      await withBusy($('button', form), async () => {
        await store.joinHousehold(form.elements.code.value);
        state.who = 'both';
        toast('Plannings reliés 🎉');
        await openSettings();
        load();
      });
    }
  }

  /* Import du planning de travail ---------------------------------------------------- */
  const impDlg = $('#importDlg');
  const impForm = $('#impForm');
  const IMP_PREFS_KEY = 'notre-planning-import';
  const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  let workbook = null;

  const loadImportPrefs = () => { try { return JSON.parse(localStorage.getItem(IMP_PREFS_KEY) || '{}'); } catch { return {}; } };
  const fmtIso = (date, opts = { day: 'numeric', month: 'short' }) => fmt(fromInputs(date), opts);
  const fmtHour = hhmm => hhmm.replace(/^0/, '').replace(':', 'h').replace(/h00$/, 'h');
  function impStatus(msg) {
    const p = $('#impStatus');
    p.hidden = !msg;
    p.textContent = msg;
  }

  function openImport() {
    workbook = null;
    $('#impFile').value = '';
    impForm.hidden = true;
    impStatus('');
    impDlg.showModal();
  }

  async function onImportFile() {
    const file = $('#impFile').files[0];
    impForm.hidden = true;
    if (!file) return;
    impStatus('Lecture du fichier… (quelques secondes pour un gros planning)');
    await new Promise(r => setTimeout(r, 50)); // laisse le message s'afficher avant le calcul
    try {
      workbook = await PlanningImport.readWorkbook(file);
    } catch (err) {
      workbook = null;
      return impStatus(translateError(err));
    }
    if (!workbook.people.length) return impStatus('Aucun collaborateur trouvé dans ce fichier.');
    const prefs = loadImportPrefs();
    const I = impForm.elements;
    const match = workbook.people.find(p => p.key === prefs.person);
    I.person.innerHTML = (match ? '' : '<option value="">— Choisis ton nom —</option>')
      + workbook.people.map(p => `<option value="${esc(p.key)}"${p === match ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    I.from.value = toDateInput(new Date());
    const hours = { ...PlanningImport.DEFAULT_HOURS, ...prefs.hours };
    for (const k of Object.keys(PlanningImport.DEFAULT_HOURS)) I[k].value = hours[k];
    impStatus(`${workbook.people.length} collaborateurs trouvés dans « ${workbook.fileName} ».`);
    impForm.hidden = false;
    renderImportPreview();
  }

  function currentImport() {
    const I = impForm.elements;
    const person = workbook?.people.find(p => p.key === I.person.value);
    if (!person || !I.from.value) return null;
    const hours = Object.fromEntries(Object.entries(PlanningImport.DEFAULT_HOURS).map(([k, def]) => [k, I[k].value || def]));
    const plan = PlanningImport.buildPlan(person);
    const fromDate = I.from.value;
    return {
      person, hours, plan, fromDate,
      events: PlanningImport.planToEvents(plan, hours, fromDate),
      from: PlanningImport.localDateTime(fromDate),
      to: PlanningImport.localDateTime(PlanningImport.addDaysIso(plan.last, 1)),
    };
  }

  function renderImportPreview() {
    const box = $('#impPreview');
    const imp = currentImport();
    $('#impSubmit').disabled = !imp?.events.length;
    if (!imp) {
      box.innerHTML = '';
      return;
    }
    const { plan, events, hours, fromDate } = imp;
    if (!events.length) {
      box.innerHTML = `<p>Rien à importer : le planning de ce fichier s’arrête le ${fmtIso(plan.last, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`;
      return;
    }
    const count = title => events.filter(e => e.title === title && !e.all_day).length;
    const conges = plan.conges.filter(c => c.to >= fromDate);
    const rest = plan.restDays.filter(d => d !== 0).map(d => WEEKDAYS[d]);
    const replaced = store.countImported(PlanningImport.IMPORT_KEY, imp.from, imp.to);
    box.innerHTML = `
      <p><strong>${events.length} événements</strong> du ${fmtIso(fromDate)} au ${fmtIso(plan.last, { day: 'numeric', month: 'short', year: 'numeric' })} :</p>
      <ul>
        <li>💼 ${count('Travail')} jours de travail : ${fmtHour(hours.start)}–${fmtHour(hours.end)} (matin seul : ${fmtHour(hours.start)}–${fmtHour(hours.morningEnd)})</li>
        <li>⏰ ${count('Permanence')} permanences : ${fmtHour(hours.start)}–${fmtHour(hours.permEnd)}</li>
        <li>🌴 ${conges.length} période${conges.length > 1 ? 's' : ''} de congés${conges.length ? ' : '
          + conges.map(c => (c.from === c.to ? fmtIso(c.from) : `${fmtIso(c.from)} → ${fmtIso(c.to)}`)).join(', ') : ''}</li>
      </ul>
      ${rest.length ? `<p class="hint">Repos habituel non importé : ${rest.join(', ')}.</p>` : ''}
      ${replaced ? `<p class="hint">${replaced} événement${replaced > 1 ? 's' : ''} importé${replaced > 1 ? 's' : ''} précédemment sur cette période ser${replaced > 1 ? 'ont' : 'a'} remplacé${replaced > 1 ? 's' : ''}.</p>` : ''}`;
  }

  async function submitImport(e) {
    e.preventDefault();
    const imp = currentImport();
    if (!imp?.events.length) return;
    try { localStorage.setItem(IMP_PREFS_KEY, JSON.stringify({ person: imp.person.key, hours: imp.hours })); } catch { /* ignoré */ }
    await withBusy($('#impSubmit'), async () => {
      const { added, removed } = await store.replaceImported(PlanningImport.IMPORT_KEY, imp.from, imp.to, imp.events);
      impDlg.close();
      toast(`${added} événements importés${removed ? ` (${removed} remplacés)` : ''}`);
      load();
    });
  }

  /* Connexion --------------------------------------------------------------------- */
  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    const f = $('#authForm');
    $$('#authTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#authTabs').hidden = mode === 'forgot';
    $$('[data-only]', f).forEach(el => { el.hidden = !el.dataset.only.split(' ').includes(mode); });
    f.elements.password.required = mode !== 'forgot';
    f.elements.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    f.elements.name.required = mode === 'signup';
    $('#authSubmit').textContent = { login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Recevoir un lien' }[mode];
    $('#forgotBtn').textContent = mode === 'forgot' ? '← Retour à la connexion' : 'Mot de passe oublié ?';
    $('#forgotBtn').hidden = mode === 'signup';
    authMessage('');
  }
  function authMessage(msg) {
    const p = $('#authMsg');
    p.hidden = !msg;
    p.textContent = msg;
  }
  async function submitAuth(e) {
    e.preventDefault();
    const f = e.target.elements;
    const email = f.email.value.trim();
    await withBusy($('#authSubmit'), async () => {
      if (authMode === 'login') await store.signIn(email, f.password.value);
      else if (authMode === 'signup') {
        const { needsConfirmation } = await store.signUp(email, f.password.value, f.name.value.trim());
        if (needsConfirmation) authMessage('Compte créé ! Clique sur le lien reçu par e-mail pour l’activer, puis connecte-toi.');
      } else {
        await store.resetPassword(email);
        authMessage('Si un compte existe pour cet e-mail, un lien de réinitialisation vient d’être envoyé.');
      }
    }, err => authMessage(translateError(err)));
  }

  function showAuth() {
    state.user = null;
    $('#app').hidden = true;
    $('#auth').hidden = false;
  }

  let unsubscribe = null;
  async function enterApp(user) {
    state.user = user;
    $('#auth').hidden = true;
    $('#app').hidden = false;
    try {
      await loadProfiles();
    } catch (err) {
      toastError(err);
    }
    load();
    // Toute modification (de l'un ou de l'autre) rafraîchit profils, plannings et réglages.
    if (!unsubscribe) {
      unsubscribe = store.subscribe(debounce(async () => {
        try { await loadProfiles(); } catch (err) { console.error(err); }
        if (setDlg.open && !setDlg.contains(document.activeElement?.closest('form'))) renderSettings();
        load();
      }, 300));
    }
  }

  /* Utilitaires --------------------------------------------------------------------- */
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  async function withBusy(btn, fn, onError = toastError) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      onError(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    try { t.hidePopover(); t.showPopover(); } catch { /* popover non supporté */ }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { try { t.hidePopover(); } catch { /* idem */ } }, 2800);
  }
  function translateError(err) {
    const code = err?.code || '';
    const msg = err?.message || String(err);
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'E-mail ou mot de passe incorrect.';
    if (code === 'auth/email-already-in-use') return 'Un compte existe déjà avec cet e-mail.';
    if (code === 'auth/weak-password') return 'Mot de passe trop court (6 caractères minimum).';
    if (code === 'auth/invalid-email') return 'Adresse e-mail invalide.';
    if (code === 'auth/too-many-requests') return 'Trop de tentatives. Réessaie dans quelques minutes.';
    if (code === 'auth/network-request-failed' || code === 'unavailable' || /Failed to fetch|NetworkError/i.test(msg)) {
      return 'Connexion impossible. Vérifie ta connexion internet.';
    }
    if (code === 'permission-denied') return 'Action non autorisée.';
    return msg;
  }
  function toastError(err) {
    console.error(err);
    toast(translateError(err));
  }

  /* Événements UI --------------------------------------------------------------------- */
  function bindUi() {
    $('#prevBtn').onclick = () => step(-1);
    $('#nextBtn').onclick = () => step(1);
    $('#todayBtn').onclick = () => { state.cursor = startOfDay(new Date()); load(); };
    $('#viewSeg').onclick = e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
    $('#whoSeg').onclick = e => {
      const b = e.target.closest('[data-who]');
      if (!b) return;
      state.who = b.dataset.who;
      saveUi();
      render();
    };
    $('#catChips').onclick = e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      state.cats[b.dataset.cat] = !state.cats[b.dataset.cat];
      saveUi();
      render();
    };
    $('#fab').onclick = () => newEvent();
    $('#settingsBtn').onclick = openSettings;

    $('#main').addEventListener('click', e => {
      const evEl = e.target.closest('[data-ev]');
      if (evEl) return openEvent(evEl.dataset.ev);
      const go = e.target.closest('[data-goto]');
      if (go) {
        state.cursor = fromInputs(go.dataset.goto);
        return setView('agenda');
      }
      const col = e.target.closest('.wk-col');
      if (col) {
        const minutes = Math.floor(((e.clientY - col.getBoundingClientRect().top) / HOUR_PX) * 2) * 30;
        const start = fromInputs(col.dataset.date);
        start.setHours(0, Math.max(0, Math.min(minutes, 23 * 60 + 30)));
        newEvent(start);
      }
    });

    // Balayage horizontal sur mobile pour changer de période.
    let touch = null;
    $('#main').addEventListener('touchstart', e => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
    $('#main').addEventListener('touchend', e => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    evForm.addEventListener('submit', submitEvent);
    evForm.addEventListener('change', e => {
      if (e.target === F.start_date || e.target === F.start_time) onStartChange();
      syncEventForm();
    });
    $('#evDelete').onclick = deleteEvent;

    setDlg.addEventListener('click', onSettingsClick);
    setDlg.addEventListener('submit', onSettingsSubmit);

    $('#impFile').addEventListener('change', onImportFile);
    impForm.addEventListener('change', renderImportPreview);
    impForm.addEventListener('submit', submitImport);

    for (const dlg of [evDlg, setDlg, impDlg]) {
      dlg.addEventListener('click', e => {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      });
    }

    $('#authTabs').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) setAuthMode(b.dataset.mode); };
    $('#forgotBtn').onclick = () => setAuthMode(authMode === 'forgot' ? 'login' : 'forgot');
    $('#authForm').addEventListener('submit', submitAuth);

    document.addEventListener('keydown', e => {
      if (evDlg.open || setDlg.open || impDlg.open || $('#app').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't') $('#todayBtn').click();
      else if (e.key === 'n') newEvent();
      else if (e.key === 'a') setView('agenda');
      else if (e.key === 's') setView('week');
      else if (e.key === 'm') setView('month');
    });

    narrowMq.addEventListener('change', () => { if (state.user) load(); });
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || !state.user) return;
      try { await loadProfiles(); } catch { /* hors-ligne */ }
      load();
    });
    setInterval(() => { if (state.user && state.view === 'week' && !document.hidden) render(); }, 60e3);
  }

  /* Démarrage -------------------------------------------------------------------------- */
  async function boot() {
    if (!store) {
      document.body.innerHTML = `<p style="padding:24px">Erreur au démarrage : ${esc(window.PlanningStoreError?.message || 'inconnue')}</p>`;
      return;
    }
    bindUi();
    setAuthMode('login');
    $('#demoBanner').hidden = store.mode !== 'demo';
    store.onAuthChange(async (event, user) => {
      if (event === 'PASSWORD_RECOVERY') {
        const pwd = prompt('Choisis un nouveau mot de passe (6 caractères minimum) :');
        if (pwd) {
          try { await store.updatePassword(pwd); toast('Mot de passe mis à jour'); } catch (err) { toastError(err); }
        }
      }
      if (event === 'SIGNED_OUT') showAuth();
      else if (user && user.id !== state.user?.id) enterApp(user);
    });
    const user = await store.getUser();
    if (!user) showAuth();
    else if (user.id !== state.user?.id) enterApp(user);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})();
