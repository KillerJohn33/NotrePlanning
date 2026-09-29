/* Notre Planning — interface (vues agenda / semaine / mois, filtres, formulaires). */
(() => {
  'use strict';

  // Même numéro que CACHE dans sw.js, à changer à chaque publication.
  const APP_VERSION = 'v28';
  const store = window.PlanningStore;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  // Icône du jeu SVG défini en tête de index.html (#i-<nom>).
  const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATS = {
    pro: { label: 'Pro', icon: 'pro' },
    perso: { label: 'Perso', icon: 'perso' },
    commun: { label: 'Commun', icon: 'commun' },
  };
  // Suggestions proposées à la création d'un événement : titre, type, durée (min) ou journée entière.
  const PRESETS = [
    { title: 'Médecin', icon: 'doctor', cat: 'perso', min: 60 },
    { title: 'Crèche', icon: 'baby', cat: 'commun', min: 30 },
    { title: 'École', icon: 'school', cat: 'commun', min: 30 },
    { title: 'Administratif', icon: 'admin', cat: 'perso', min: 60 },
    { title: 'Loisirs', icon: 'leisure', cat: 'perso', min: 120 },
    { title: 'Repas', icon: 'meal', cat: 'commun', min: 90 },
    { title: 'Sport', icon: 'sport', cat: 'perso', min: 60 },
    { title: 'Courses', icon: 'cart', cat: 'commun', min: 60 },
    { title: 'Famille & amis', icon: 'users', cat: 'commun', min: 180 },
    { title: 'Anniversaire', icon: 'cake', cat: 'commun', allDay: true, yearly: true },
    { title: 'Vacances', icon: 'plane', cat: 'commun', allDay: true },
    { title: 'Réunion', icon: 'pro', cat: 'pro', min: 60 },
  ];
  const normTitle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // Icône d'une suggestion si le titre commence par son nom (« Médecin – Dr X » → stéthoscope).
  const presetIcon = title => PRESETS.find(p => normTitle(title).startsWith(normTitle(p.title)))?.icon;
  const RECUR_LABEL = { daily: 'Tous les jours', weekdays: 'Lun–ven', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
  const HOUR_PX = 48;
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
    const skip = new Set(ev.exdates || []); // dates retirées de la série (modifiées ou supprimées à part)
    const stepDays = { daily: 1, weekdays: 1, weekly: 7 }[ev.recurrence];
    const stepMonths = ev.recurrence === 'yearly' ? 12 : 1;
    let i = 0;
    if (stepDays) i = Math.max(0, Math.floor((from - start - dur) / (stepDays * 864e5)) - 1);
    else {
      const monthsBetween = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
      i = Math.max(0, Math.floor(monthsBetween / stepMonths) - 2);
    }
    const out = [];
    for (let guard = 0; guard < 1000; guard++, i++) {
      let s;
      if (stepDays) s = addDays(start, i * stepDays);
      else {
        s = new Date(start.getFullYear(), start.getMonth() + i * stepMonths, start.getDate(), start.getHours(), start.getMinutes());
        if (s.getDate() !== start.getDate()) continue; // ex. 31 dans un mois de 30 jours, 29 février
      }
      if (s >= to || (until && s >= until)) break;
      if (ev.recurrence === 'weekdays' && (s.getDay() === 0 || s.getDay() === 6)) continue;
      if (skip.has(toDateInput(s))) continue;
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
    remote: { me: new Set(), partner: new Set() },
    events: [], range: null,
  };
  const saveUi = () => {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, who: state.who, cats: state.cats })); } catch { /* ignoré */ }
  };

  const personOf = ev => (ev.is_mine ? 'me' : 'partner');
  const nameOf = ev => (ev.is_mine ? 'Moi' : (state.partner?.display_name || 'Partenaire'));
  // Couleur de la personne (liseré, pastilles, colonnes) — distincte de la couleur de l'événement.
  const personColorOf = ev => (ev.is_mine ? state.me?.color : state.partner?.color) || 'var(--accent)';

  /* Couleurs des événements : par type (Pro, Perso, Commun), personnalisables, ou propres à
     un événement. Une couleur trop proche de celle d'une personne est interdite. */
  const EVENT_PALETTE = [
    ['#475569', 'Ardoise'], ['#6366f1', 'Indigo'], ['#0ea5e9', 'Ciel'], ['#14b8a6', 'Turquoise'],
    ['#16a34a', 'Vert'], ['#84cc16', 'Anis'], ['#d97706', 'Ambre'], ['#f97316', 'Orange'],
    ['#dc2626', 'Rouge'], ['#db2777', 'Framboise'], ['#9333ea', 'Violet'], ['#92400e', 'Brun'],
  ];
  const DEFAULT_EVENT_COLORS = { pro: '#475569', perso: '#16a34a', commun: '#9333ea' };
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  // Deux couleurs se confondent si elles ont presque la même teinte (ou sont deux gris proches).
  function tooClose(a, b) {
    if (!/^#[0-9a-f]{6}$/i.test(a || '') || !/^#[0-9a-f]{6}$/i.test(b || '')) return false;
    const [h1, s1, l1] = hexToHsl(a), [h2, s2, l2] = hexToHsl(b);
    if (s1 < 0.2 || s2 < 0.2) return s1 < 0.2 && s2 < 0.2 && Math.abs(l1 - l2) < 0.15;
    const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
    return dh < 26 && Math.abs(l1 - l2) < 0.3;
  }
  const personColors = () => [state.me?.color, state.partner?.color].filter(Boolean);
  const clashesWithPerson = c => personColors().some(p => tooClose(c, p));
  // Couleurs effectives des types : le choix de chacun, sinon la couleur par défaut ; si elle se
  // confond avec une personne, on bascule sur la première couleur libre de la palette.
  function eventColors() {
    const chosen = { ...DEFAULT_EVENT_COLORS, ...(state.me?.event_colors || {}) };
    const out = {};
    for (const cat of Object.keys(DEFAULT_EVENT_COLORS)) {
      let c = chosen[cat];
      if (clashesWithPerson(c)) {
        c = EVENT_PALETTE.map(([hex]) => hex)
          .find(hex => !clashesWithPerson(hex) && !Object.values(out).includes(hex)) || c;
      }
      out[cat] = c;
    }
    return out;
  }
  // Variables CSS des types (filtres, formulaire, étiquettes) mises à jour avec les réglages.
  function applyEventColorVars() {
    const root = document.documentElement.style;
    const colors = eventColors();
    for (const [cat, c] of Object.entries(colors)) root.setProperty(`--ev-${cat}`, c);
    // Congés : couleur de profil de chacun (la même vue depuis les deux téléphones).
    root.setProperty('--off-me', state.me?.color || '#3b82f6');
    root.setProperty('--off-other', state.partner?.color || state.me?.color || '#ec4899');
  }
  // Couleur d'un événement : la sienne, sinon celle de son type d'horaire, sinon celle de son type.
  function colorOf(ev) {
    if (isMasked(ev)) return eventColors()[ev.category];
    if (ev.color && !clashesWithPerson(ev.color)) return ev.color;
    const shift = ev.is_mine && shiftIdOf(ev) && shiftTypes().find(t => t.id === shiftIdOf(ev));
    return shift?.color || eventColors()[ev.category];
  }
  const canEdit = ev => ev.is_mine || ev.category === 'commun';
  const isMasked = ev => !ev.is_mine && ev.is_private;
  const splitLanes = () => !!state.partner && state.who === 'both';

  // Télétravail : qui (parmi les personnes affichées) télétravaille ce jour-là.
  function remotePeople(date) {
    const key = toDateInput(date);
    const out = [];
    if ((!state.partner || state.who !== 'partner') && state.remote.me.has(key)) {
      out.push({ name: 'Moi', color: state.me?.color });
    }
    if (state.partner && state.who !== 'me' && state.remote.partner.has(key)) {
      out.push({ name: state.partner.display_name, color: state.partner.color });
    }
    return out;
  }
  function remoteBadge(date, withLabel = false) {
    const people = remotePeople(date);
    if (!people.length) return '';
    const title = `Télétravail : ${people.map(p => p.name).join(', ')}`;
    const dots = state.partner ? people.map(p => `<i class="dot" style="--c:${esc(p.color)}"></i>`).join('') : '';
    return withLabel
      ? `<span class="tag tt-tag" title="${esc(title)}">${ic('laptop')} Télétravail ${dots}</span>`
      : `<span class="tt" title="${esc(title)}" aria-label="${esc(title)}">${ic('laptop')}${dots}</span>`;
  }
  // Un créneau pro d'un jour de télétravail prend l'icône ordinateur au lieu de la mallette.
  const isRemoteWork = (ev, start) => ev.category === 'pro' && !ev.all_day
    && state.remote[personOf(ev)].has(toDateInput(start));

  // Permanence : créneau pro intitulé « Permanence… » (import Excel ou saisie manuelle).
  const isPerm = ev => ev.category === 'pro' && /^perm/i.test(ev.title || '');
  function permBadge(date, occ, withLabel = false) {
    const dEnd = addDays(date, 1);
    const who = new Set(occ.filter(o => isPerm(o.ev) && o.start < dEnd && o.end > date).map(o => personOf(o.ev)));
    if (!who.size) return '';
    const people = [...who].map(p => (p === 'me'
      ? { name: 'Moi', color: state.me?.color }
      : { name: state.partner?.display_name, color: state.partner?.color }));
    const title = `Permanence : ${people.map(p => p.name).join(', ')}`;
    const dots = state.partner ? people.map(p => `<i class="dot" style="--c:${esc(p.color)}"></i>`).join('') : '';
    return withLabel
      ? `<span class="tag perm-tag" title="${esc(title)}">${ic('perm')} Permanence ${dots}</span>`
      : `<span class="pm" title="${esc(title)}" aria-label="${esc(title)}">${ic('perm')}${dots}</span>`;
  }
  // Agenda et fiche du jour : la permanence et le télétravail sont indiqués sur les créneaux ;
  // l'étiquette « Télétravail » près de la date ne reste que si aucun créneau ne la porte.
  const dayRemoteNote = (d, items) => (items.some(o => isRemoteWork(o.ev, o.start)) ? '' : remoteBadge(d, true));
  // Congés : événement « journée » intitulé Congés… ou Vacances…
  const isOff = ev => ev.all_day && /^(cong|vacances)/.test(normTitle(ev.title));

  // Jours fériés français (fêtes fixes + fêtes calculées depuis Pâques), mis en cache par année.
  function easterSunday(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
  }
  const holidayCache = new Map();
  function holidayName(date) {
    const y = date.getFullYear();
    if (!holidayCache.has(y)) {
      const p = easterSunday(y);
      holidayCache.set(y, new Map([
        [new Date(y, 0, 1), 'Jour de l’an'], [addDays(p, 1), 'Lundi de Pâques'], [new Date(y, 4, 1), 'Fête du Travail'],
        [new Date(y, 4, 8), 'Victoire 1945'], [addDays(p, 39), 'Ascension'], [addDays(p, 50), 'Lundi de Pentecôte'],
        [new Date(y, 6, 14), 'Fête nationale'], [new Date(y, 7, 15), 'Assomption'], [new Date(y, 10, 1), 'Toussaint'],
        [new Date(y, 10, 11), 'Armistice'], [new Date(y, 11, 25), 'Noël'],
      ].map(([d, name]) => [toDateInput(d), name])));
    }
    return holidayCache.get(y).get(toDateInput(date));
  }
  const holidayTag = d => { const h = holidayName(d); return h ? `<span class="tag hol-tag">${ic('flag')} ${esc(h)}</span>` : ''; };

  // Vacances scolaires de la zone choisie (A, B ou C) : calendrier officiel de l'Éducation
  // nationale (data.education.gouv.fr), mis en cache une semaine sur l'appareil.
  const ZONE_KEY = 'notre-planning-zone';
  let schoolZone = (() => { try { return localStorage.getItem(ZONE_KEY) || ''; } catch { return ''; } })();
  let schoolHolidays = []; // [{ name, from: 'AAAA-MM-JJ', to: 'AAAA-MM-JJ' (exclu) }]
  async function loadSchoolHolidays(force = false) {
    schoolHolidays = [];
    if (!schoolZone) return;
    const cacheKey = `notre-planning-vacances-${schoolZone}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && !force && Date.now() - cached.at < 7 * 864e5) { schoolHolidays = cached.list; return; }
    } catch { /* cache illisible : on recharge */ }
    const where = `zones="Zone ${schoolZone}" and end_date>="${toDateInput(addDays(new Date(), -400))}" and population!="Enseignants"`;
    const url = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records'
      + `?select=description,start_date,end_date&where=${encodeURIComponent(where)}`
      + '&group_by=description,start_date,end_date&order_by=start_date&limit=100';
    try {
      const data = await (await fetch(url)).json();
      schoolHolidays = data.results.map(r => {
        const from = new Date(r.start_date);
        const to = new Date(r.end_date);
        return { name: r.description, from: toDateInput(from), to: toDateInput(to > from ? to : addDays(from, 1)) };
      });
      try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), list: schoolHolidays })); } catch { /* ignoré */ }
    } catch (err) { console.error(err); }
  }
  const schoolHolidayOf = d => { const k = toDateInput(d); return schoolHolidays.find(h => h.from <= k && k < h.to); };
  const schoolTag = d => {
    const h = schoolHolidayOf(d);
    return h ? `<span class="tag school-tag">${ic('school-bag')} ${esc(h.name)} (zone ${schoolZone})</span>` : '';
  };

  // Rappel quand le planning Excel importé arrive à sa fin (dans moins de 14 jours).
  const WORK_ALERT_KEY = 'notre-planning-work-alert';
  function renderWorkAlert() {
    const box = $('#workAlert');
    const until = state.me?.work_until;
    const left = until ? Math.round((fromInputs(until) - startOfDay(new Date())) / 864e5) : null;
    let dismissed = '';
    try { dismissed = localStorage.getItem(WORK_ALERT_KEY) || ''; } catch { /* ignoré */ }
    const show = left !== null && left <= 14 && dismissed !== toDateInput(new Date());
    box.hidden = !show;
    if (!show) return;
    const when = left < 0 ? `s’est terminé le ${fmt(fromInputs(until), { day: 'numeric', month: 'long' })}`
      : `s’arrête le ${fmt(fromInputs(until), { day: 'numeric', month: 'long' })} (dans ${left} jour${left > 1 ? 's' : ''})`;
    box.innerHTML = `${ic('import')}<span>Ton planning de travail importé ${when}.</span>
      <button class="btn" data-act="work-import">Importer le nouveau</button>
      <button class="icon-btn sm" data-act="work-dismiss" aria-label="Masquer pour aujourd’hui">${ic('x')}</button>`;
  }
  // Anciens imports (avant ce rappel) : on retrouve la date de fin et on la mémorise.
  async function ensureWorkUntil() {
    if (store.mode === 'demo' || !state.me || state.me.work_until) return;
    const imported = (await store.listEvents(new Date(1900, 0, 1), new Date(2200, 0, 1)))
      .filter(e => e.is_mine && e.import_key === PlanningImport.IMPORT_KEY);
    if (!imported.length) return;
    const last = imported.reduce((m, e) => (e.start_at > m ? e.start_at : m), '');
    const work_until = toDateInput(new Date(last));
    await store.updateMe({ work_until });
    state.me.work_until = work_until;
  }

  // Types d'horaires (ouverture, milieu, fermeture…) propres à chaque profil ; les jours
  // placés deviennent des créneaux pro marqués import_key = "shift:<id du type>".
  const SHIFT_PREFIX = 'shift:';
  const SHIFT_COLORS = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#64748b', '#ec4899', '#84cc16'];
  const DEFAULT_SHIFTS = [
    { id: 'ouv', name: 'Ouverture', start: '08:00', end: '16:00', color: '#0ea5e9' },
    { id: 'mil', name: 'Milieu', start: '10:00', end: '18:00', color: '#f59e0b' },
    { id: 'fer', name: 'Fermeture', start: '12:00', end: '20:00', color: '#8b5cf6' },
  ];
  const shiftTypes = () => (state.me?.shift_types?.length ? state.me.shift_types : DEFAULT_SHIFTS);
  const shiftIdOf = ev => (ev.import_key?.startsWith(SHIFT_PREFIX) ? ev.import_key.slice(SHIFT_PREFIX.length) : null);
  function shiftEvent(type, dateKey) {
    const start = fromInputs(dateKey, type.start);
    let end = fromInputs(dateKey, type.end);
    if (end <= start) end = addDays(end, 1); // horaire de nuit
    return {
      title: type.name, category: 'pro', all_day: false, start_at: start.toISOString(), end_at: end.toISOString(),
      notes: null, location: null, is_private: false, recurrence: 'none', recurrence_until: null,
      import_key: SHIFT_PREFIX + type.id,
    };
  }
  const iconOf = (ev, start) => (isPerm(ev) ? ic('perm', 'i-perm')
    : ic(isRemoteWork(ev, start) ? 'laptop' : shiftIdOf(ev) ? 'clock'
      : (!isMasked(ev) && presetIcon(ev.title)) || CATS[ev.category].icon));

  function getRange() {
    if (state.view === 'week') {
      // Toujours la semaine complète ; sur téléphone elle défile horizontalement.
      const from = startOfWeek(state.cursor);
      return { from, to: addDays(from, 7), days: 7 };
    }
    if (state.view === 'month') {
      // Mois empilés verticalement, étendus au fil du défilement.
      if (!state.monthStart) initMonths(state.cursor);
      const from = state.monthStart;
      return { from, to: new Date(from.getFullYear(), from.getMonth() + state.monthCount, 1) };
    }
    const from = startOfDay(state.cursor);
    return { from, to: addDays(from, 14), days: 14 };
  }

  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  // Recentre la liste des mois sur `date` (2 mois avant, 12 après) et y fait défiler.
  function initMonths(date) {
    state.monthStart = new Date(date.getFullYear(), date.getMonth() - 2, 1);
    state.monthCount = 15;
    state.monthScrollTo = monthKey(date);
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
    state.remote = await store.getRemoteDays();
    applyEventColorVars();
  }

  function step(dir) {
    if (state.view === 'lists') return;
    if (state.view === 'month') {
      const v = visibleMonth();
      return goToMonth(new Date(v.getFullYear(), v.getMonth() + dir, 1));
    }
    state.cursor = addDays(state.cursor, dir * 7);
    state.weekScrollTo = 'start';
    load();
  }
  function goToday() {
    state.cursor = startOfDay(new Date());
    if (state.view === 'month') return goToMonth(state.cursor);
    state.weekScrollTo = 'cursor';
    load();
  }
  function setView(view) {
    state.view = view;
    if (view === 'month') initMonths(state.cursor);
    if (view === 'week') state.weekScrollTo = 'cursor';
    saveUi();
    load();
  }

  // Vue mois : mois actuellement en haut de l'écran, et défilement fluide vers un mois.
  function visibleMonth() {
    const main = $('#main');
    const top = main.scrollTop + ($('.mo-head', main)?.offsetHeight || 0) + 8;
    let current = null;
    for (const sec of $$('.mo-month', main)) {
      if (sec.offsetTop <= top) current = sec;
      else break;
    }
    const key = current?.dataset.month;
    if (!key) return new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  function goToMonth(date) {
    const main = $('#main');
    const sec = $(`.mo-month[data-month="${monthKey(date)}"]`, main);
    if (!sec) {
      initMonths(date);
      return load();
    }
    main.scrollTo({ top: sec.offsetTop - ($('.mo-head', main)?.offsetHeight || 0), behavior: 'smooth' });
  }
  function updateMonthLabel() {
    $('#period').textContent = cap(fmt(visibleMonth(), { month: 'long', year: 'numeric' }));
  }
  // Charge d'autres mois quand on approche du bas (ou du haut) de la liste.
  let monthExtending = false;
  function onMonthScroll() {
    updateMonthLabel();
    const main = $('#main');
    if (monthExtending) return;
    if (main.scrollTop + main.clientHeight > main.scrollHeight - 900) {
      monthExtending = true;
      state.monthCount += 6;
      load().finally(() => { monthExtending = false; });
    } else if (main.scrollTop < 300) {
      monthExtending = true;
      state.monthStart = new Date(state.monthStart.getFullYear(), state.monthStart.getMonth() - 6, 1);
      state.monthCount += 6;
      state.monthPrepended = true;
      load().finally(() => { monthExtending = false; });
    }
  }

  /* Rendu ------------------------------------------------------------------------- */
  function render() {
    if (!state.range) return;
    renderToolbar();
    const main = $('#main');
    main.className = `main view-${state.view}`;
    $('#app').dataset.view = state.view;
    if (state.view === 'week') renderWeek(main);
    else if (state.view === 'month') renderMonth(main);
    else if (state.view === 'lists') renderLists(main);
    else renderAgenda(main);
    if (dayDlg.open) renderDay(); // la fiche du jour suit les changements (partenaire, filtres…)
  }

  function renderToolbar() {
    const { from, to } = state.range;
    const last = addDays(to, -1);
    let label;
    if (state.view === 'lists') label = 'Listes partagées';
    else if (state.view === 'month') label = cap(fmt(state.cursor, { month: 'long', year: 'numeric' })); // affiné au défilement
    else if (from.getMonth() === last.getMonth()) label = `${from.getDate()} – ${last.getDate()} ${fmt(last, { month: 'long', year: 'numeric' })}`;
    else {
      const year = last.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
      label = `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', ...year })}`;
    }
    $('#period').textContent = label;

    $$('#viewSeg [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    renderWorkAlert();
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
        `<button data-who="${key}" aria-pressed="${state.who === key}" title="${esc(label)}" aria-label="${esc(label)}">${color ? `<span class="dot" style="--c:${esc(color)}"></span>` : ic('users')}<span class="who-label">${esc(label)}</span></button>`
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
    const prev = $('.wk-scroll', main);
    const prevTop = prev?.scrollTop;
    const prevLeft = prev?.scrollLeft;
    const { from, days } = state.range;
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    const split = splitLanes();
    const occ = visibleOccurrences(from, addDays(from, days));
    const now = new Date();
    // --day-min : largeur mini d'un jour (3 jours visibles sur téléphone, le reste défile).
    const cols = `52px repeat(${days}, minmax(var(--day-min), 1fr))`;

    let html = `<div class="wk-scroll"><div class="wk-sticky"><div class="wk-row" style="grid-template-columns:${cols}"><div class="wk-corner"></div>`;
    for (const d of dates) {
      const hol = holidayName(d);
      const school = schoolHolidayOf(d);
      html += `<button class="wk-day ${sameDay(d, now) ? 'is-today' : ''} ${hol ? 'is-holiday' : ''} ${school ? 'is-school' : ''}" data-goto="${toDateInput(d)}" title="${esc(hol || (school && `${school.name} (zone ${schoolZone})`) || 'Détail du jour')}">
        <span>${fmt(d, { weekday: 'short' })} ${remoteBadge(d)}${permBadge(d, occ)}</span><strong>${d.getDate()}</strong>${hol ? `<em class="hol">${esc(hol)}</em>` : ''}</button>`;
    }
    html += '</div>';
    if (split) {
      html += `<div class="wk-row" style="grid-template-columns:${cols}"><div class="wk-corner"></div>`;
      for (let i = 0; i < days; i++) {
        html += `<div class="lane-legend"><span style="--c:${esc(state.me.color)}" title="Moi"></span><span style="--c:${esc(state.partner.color)}" title="${esc(state.partner.display_name)}"></span></div>`;
      }
      html += '</div>';
    }
    const allDay = occ.filter(o => o.ev.all_day);
    if (allDay.length) {
      html += `<div class="wk-row wk-allday" style="grid-template-columns:${cols}"><div class="wk-label wk-corner">Journée</div>`;
      for (const d of dates) {
        const items = allDay.filter(o => o.start < addDays(d, 1) && o.end > d);
        html += `<div>${items.map(o => `<button class="chip-ev ${isOff(o.ev) ? `is-off${offClass(offKindOf(o.ev))}` : ''}" data-ev="${o.ev.id}" data-occ="${o.start.getTime()}" style="--c:${esc(colorOf(o.ev))};--pc:${esc(personColorOf(o.ev))}" title="${esc(o.ev.title)}">${ic(CATS[o.ev.category].icon)} ${esc(o.ev.title)}</button>`).join('')}</div>`;
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

      const offDay = offKind(occ.filter(o => o.start < dayEnd && o.end > d));
      html += `<div class="wk-col ${sameDay(d, now) ? 'is-today' : ''} ${offDay ? `is-off${offClass(offDay)}` : ''}" data-date="${toDateInput(d)}">`;
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
    const scroller = $('.wk-scroll', main);
    scroller.scrollTop = prevTop ?? 7 * HOUR_PX - 8;
    // Horizontal : se placer sur le jour voulu (aujourd'hui, ou lundi après un changement de semaine).
    if (state.weekScrollTo) {
      const col = state.weekScrollTo === 'cursor' && $(`.wk-col[data-date="${toDateInput(state.cursor)}"]`, main);
      scroller.scrollLeft = col ? col.offsetLeft - 52 : 0;
      state.weekScrollTo = null;
    } else if (prevLeft) {
      scroller.scrollLeft = prevLeft;
    }
  }

  function eventBlock(o, g) {
    const ev = o.ev;
    const short = g.height < 34;
    const time = `${fmtTime(o.start)} – ${fmtTime(o.end)}`;
    const tip = `${ev.title} · ${time}${state.partner ? ` · ${nameOf(ev)}` : ''}${ev.location ? ` · ${ev.location}` : ''}`;
    return `<button class="ev ${isMasked(ev) ? 'is-masked' : ''} ${short ? 'is-short' : ''}" data-ev="${ev.id}" data-occ="${o.start.getTime()}"
      style="top:${g.top}px;height:${g.height - 2}px;left:calc(${g.left}% + 2px);width:calc(${g.width}% - 4px);--c:${esc(colorOf(ev))};--pc:${esc(personColorOf(ev))}"
      title="${esc(tip)}"><span class="ev-title">${iconOf(ev, o.start)} ${esc(ev.title)}</span><span class="ev-time">${time}</span></button>`;
  }

  // Congés dans la couleur de profil de la personne concernée (les « commun » : les deux).
  const offKindOf = ev => (ev.category === 'commun' ? 'both' : ev.is_mine ? 'mine' : 'partner');
  // Qui est en congé ce jour-là : 'mine', 'partner', 'both' ou '' (d'après les occurrences du jour).
  function offKind(dayOccs) {
    const kinds = new Set(dayOccs.filter(o => isOff(o.ev)).map(o => offKindOf(o.ev)));
    if (kinds.has('both') || (kinds.has('mine') && kinds.has('partner'))) return 'both';
    return [...kinds][0] || '';
  }
  const offClass = kind => (kind === 'partner' ? ' is-partner' : kind === 'both' ? ' is-both' : '');

  // Ruban des congés, continu d'une case à l'autre : arrondi au début et à la fin de la période,
  // libellé au début de la période, de chaque semaine, ou quand la personne en congé change.
  function offRibbon(kind, prevKind, nextKind, d, lastOfMonth, title) {
    if (!kind) return '';
    const first = !prevKind;
    const last = !nextKind || lastOfMonth || d.getDay() === 0;
    const showLabel = first || d.getDay() === 1 || d.getDate() === 1 || prevKind !== kind;
    const partner = state.partner?.display_name || 'l’autre';
    const label = kind === 'both' ? (state.partner ? 'Congés · vous deux' : title) : kind === 'partner' ? `Congés · ${partner}` : title;
    return `<div class="off-bar${offClass(kind)}${first ? ' is-first' : ''}${last ? ' is-last' : ''}" title="${esc(label)}">`
      + (showLabel ? `${ic('sun')}<span>${esc(label)}</span>` : '') + '</div>';
  }

  // Vue mois : les mois s'enchaînent verticalement (défilement continu, chargement au fil de l'eau).
  function renderMonth(main) {
    const { from, to } = state.range;
    const prevTop = main.scrollTop;
    const prevHeight = main.scrollHeight;
    const occ = visibleOccurrences(from, to);
    const today = new Date();
    const max = narrowMq.matches ? 6 : 3;

    // Occurrences rangées par jour (un événement sur plusieurs jours apparaît chaque jour).
    const byDay = new Map();
    for (const o of occ) {
      for (let d = startOfDay(o.start < from ? from : o.start); d < o.end && d < to; d = addDays(d, 1)) {
        const k = toDateInput(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(o);
      }
    }

    let html = '<div class="month"><div class="mo-head">'
      + ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map(d => `<div>${d}</div>`).join('') + '</div>';
    for (let m = new Date(from); m < to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const lead = (m.getDay() + 6) % 7;
      const nDays = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      html += `<section class="mo-month" data-month="${monthKey(m)}">
        <h2 class="mo-title">${cap(fmt(m, { month: 'long', year: 'numeric' }))}</h2><div class="mo-grid">`;
      html += '<div class="mo-cell is-blank"></div>'.repeat(lead);
      for (let day = 1; day <= nDays; day++) {
        const d = new Date(m.getFullYear(), m.getMonth(), day);
        const all = byDay.get(toDateInput(d)) || [];
        const kindOn = date => offKind(byDay.get(toDateInput(date)) || []);
        const off = kindOn(d);
        const offTitle = all.find(o => isOff(o.ev) && offKindOf(o.ev) !== 'partner')?.ev.title || 'Congés';
        const items = all.filter(o => !isOff(o.ev));
        const hol = holidayName(d);
        // Vacances scolaires : simple trait coloré en bas de la case (sans prendre de place).
        const school = schoolHolidayOf(d);
        const tip = [hol, school && `${school.name} (zone ${schoolZone})`].filter(Boolean).join(' · ');
        html += `<div class="mo-cell ${sameDay(d, today) ? 'is-today' : ''} ${off ? `is-off${offClass(off)}` : ''} ${hol ? 'is-holiday' : ''} ${school ? 'is-school' : ''}" data-goto="${toDateInput(d)}"${tip ? ` title="${esc(tip)}"` : ''}>
          <div class="mo-top"><span class="mo-num">${day}</span>${remoteBadge(d)}${permBadge(d, items)}</div>${hol ? `<span class="hol">${esc(hol)}</span>` : ''}${offRibbon(off, kindOn(addDays(d, -1)), kindOn(addDays(d, 1)), d, day === nDays, offTitle)}<div class="mo-events">`;
        for (const o of items.slice(0, max)) {
          const time = o.ev.all_day || o.start < d ? '' : `<b>${fmtTime(o.start)}</b> `;
          html += `<button class="mo-ev" data-ev="${o.ev.id}" data-occ="${o.start.getTime()}" style="--c:${esc(colorOf(o.ev))}" title="${esc(o.ev.title)}"><i></i><span>${time}${esc(o.ev.title)}</span></button>`;
        }
        html += `</div>${items.length > max ? `<span class="mo-more">+${items.length - max} autre${items.length - max > 1 ? 's' : ''}</span>` : ''}</div>`;
      }
      html += '</div></section>';
    }
    main.innerHTML = html + '</div>';

    if (state.monthScrollTo) {
      const sec = $(`.mo-month[data-month="${state.monthScrollTo}"]`, main);
      main.scrollTop = sec ? sec.offsetTop - $('.mo-head', main).offsetHeight : 0;
      state.monthScrollTo = null;
    } else if (state.monthPrepended) {
      // Des mois ont été ajoutés au-dessus : on compense pour que l'affichage ne saute pas.
      main.scrollTop = prevTop + (main.scrollHeight - prevHeight);
      state.monthPrepended = false;
    } else {
      main.scrollTop = prevTop;
    }
    updateMonthLabel();
  }

  function renderAgenda(main) {
    const { from, to } = state.range;
    const today = new Date();
    const occ = visibleOccurrences(from, to);
    let html = '<div class="agenda">';
    for (let i = 0; i < 14; i++) {
      const d = addDays(from, i);
      const dEnd = addDays(d, 1);
      const items = occ
        .filter(o => o.start < dEnd && o.end > d)
        .sort((a, b) => (b.ev.all_day - a.ev.all_day) || (a.start - b.start));
      html += `<section class="ag-day"><header class="ag-date"><span class="ag-dow">${fmt(d, { weekday: 'long' })}</span>
        <span class="ag-dnum">${fmt(d, { day: 'numeric', month: 'long' })}</span>${sameDay(d, today) ? '<span class="badge">Aujourd’hui</span>' : ''}${holidayTag(d)}${schoolTag(d)}${dayRemoteNote(d, items)}</header>`;
      if (items.length) {
        html += '<div class="ag-list">' + items.map(o => agendaItem(o, d, dEnd)).join('') + '</div>';
      } else {
        html += '<p class="ag-empty">Rien de prévu</p>';
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
    if (state.partner) tags.push(ev.category === 'commun' ? `<span class="tag">${ic('users')} Ensemble</span>` : `<span class="tag"><span class="dot" style="--c:${esc(personColorOf(ev))}"></span>${esc(nameOf(ev))}</span>`);
    const perm = isPerm(ev);
    const remote = isRemoteWork(ev, o.start);
    if (perm) tags.push(`<span class="tag perm-tag">${ic('perm')} Permanence</span>`);
    if (remote) tags.push(`<span class="tag">${ic('laptop')} Télétravail</span>`);
    const shift = !perm && shiftIdOf(ev);
    if (shift) tags.push(`<span class="tag">${ic('clock')} Horaire</span>`);
    if (!perm && !remote && !shift) tags.push(`<span class="tag tag-cat" data-cat="${ev.category}">${ic(CATS[ev.category].icon)} ${CATS[ev.category].label}</span>`);
    if (ev.is_private) tags.push(`<span class="tag">${ic('lock')} Privé</span>`);
    if (ev.recurrence && ev.recurrence !== 'none') tags.push(`<span class="tag">${ic('repeat')} ${RECUR_LABEL[ev.recurrence]}</span>`);
    // Anniversaire saisi avec la date de naissance comme début : âge atteint ce jour-là.
    const age = ev.recurrence === 'yearly' ? o.start.getFullYear() - new Date(ev.start_at).getFullYear() : 0;
    if (age > 0) tags.push(`<span class="tag">${ic('cake')} ${age} ans</span>`);
    if (ev.location) tags.push(`<span class="tag">${ic('pin')} ${esc(ev.location)}</span>`);
    return `<button class="ag-ev ${isMasked(ev) ? 'is-masked' : ''} ${isOff(ev) ? `is-off${offClass(offKindOf(ev))}` : ''}" data-ev="${ev.id}" data-occ="${o.start.getTime()}" style="--c:${esc(colorOf(ev))}">
      <span class="ag-time">${time}</span><span class="ag-bar"></span>
      <span class="ag-body"><strong>${esc(ev.title)}</strong><span class="ag-meta">${tags.join('')}</span></span></button>`;
  }

  /* Formulaire événement ------------------------------------------------------------ */
  const evDlg = $('#eventDlg');
  const evForm = $('#eventForm');
  const F = evForm.elements;
  let editing = null;
  let editingOcc = null;   // date de l'occurrence cliquée (événements répétés)
  let editScope = 'all';
  let formStart = null;
  let formColor = null;    // couleur propre à l'événement (null = couleur de son type)

  // Pastilles de couleur du formulaire : « Auto » (couleur du type) + palette ; les couleurs
  // trop proches de celle d'une personne sont grisées.
  function renderEventColors() {
    const auto = eventColors()[F.category.value];
    $('#evColors').innerHTML = `<button type="button" class="ev-color auto" data-color-ev="" style="--c:${auto}" aria-pressed="${!formColor}" title="Couleur du type ${CATS[F.category.value].label}">Auto</button>`
      + EVENT_PALETTE.map(([hex, name]) => {
        const clash = clashesWithPerson(hex);
        return `<button type="button" class="ev-color" data-color-ev="${hex}" style="--c:${hex}" aria-pressed="${formColor === hex}"${clash ? ' disabled' : ''}
          title="${name}${clash ? ' — trop proche de la couleur d’une personne' : ''}" aria-label="${name}"></button>`;
      }).join('');
  }

  function openEvent(id, occMs) {
    // Hors de la période affichée (résultat de recherche), l'événement vient de la recherche.
    const ev = state.events.find(e => e.id === id) || searchPool.find(e => e.id === id);
    if (ev) fillEventForm(ev, occMs ? new Date(Number(occMs)) : null);
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

  /* Bouton + : menu de bulles colorées (événement, rendez-vous, anniversaire, horaires…) -- */
  const dialItems = () => [
    { act: 'event', label: 'Événement / rendez-vous', icon: 'month', color: '#4f6bed' },
    { act: 'birthday', label: 'Anniversaire', icon: 'cake', color: '#ec4899' },
    ...(usesRemote() ? [{ act: 'remote', label: 'Télétravail', icon: 'laptop', color: '#0ea5e9' }] : []),
    { act: 'shifts', label: 'Horaires', icon: 'clock', color: '#f59e0b' },
  ];
  let dialTimer;
  function toggleDial(open = $('#speedDial').hidden) {
    const dial = $('#speedDial');
    const fab = $('#fab');
    clearTimeout(dialTimer);
    fab.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', String(open));
    $('#dialBackdrop').hidden = !open;
    if (open) {
      const items = dialItems();
      dial.innerHTML = items.map((d, i) => `<button type="button" class="dial-item" role="menuitem" data-dial="${d.act}"
        style="--dc:${d.color};--i:${items.length - 1 - i}"><span class="dial-label">${d.label}</span><span class="dial-bubble">${ic(d.icon)}</span></button>`).join('');
      dial.hidden = false;
      requestAnimationFrame(() => dial.classList.add('is-open'));
    } else {
      dial.classList.remove('is-open');
      dialTimer = setTimeout(() => { dial.hidden = true; }, 200);
    }
  }
  function runDial(act) {
    toggleDial(false);
    if (act === 'remote') return openWork('remote');
    if (act === 'shifts') return openWork(shiftTypes()[0]?.id);
    newEvent();
    if (act === 'birthday') {
      $('#evDlgTitle').textContent = 'Nouvel anniversaire';
      applyPreset(PRESETS.find(p => p.yearly));
    }
  }

  function fillEventForm(ev, occ = null) {
    editing = ev;
    F.title.placeholder = 'Titre';
    const repeated = !!(ev.id && ev.recurrence && ev.recurrence !== 'none');
    editingOcc = repeated ? occ : null;
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
    formColor = ev.color || null;
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
    $('#evImportNote').hidden = ev.import_key !== PlanningImport.IMPORT_KEY;
    $('#privateRow').hidden = !state.partner && !ev.is_private;
    renderPresets(!ev.id);
    // Série ouverte depuis une date : on propose « cette date seulement » par défaut.
    $('#evScope').hidden = !(editingOcc && !readOnly);
    F.recurrence.closest('.row').hidden = false;
    setScope(editingOcc ? 'one' : 'all');
    syncEventForm();
    evDlg.showModal();
    // Sur téléphone, pas de clavier d'emblée : on laisse voir les suggestions.
    if (!ev.id && !narrowMq.matches) F.title.focus();
  }

  /* Listes partagées (courses, tâches) ----------------------------------------------- */
  const LISTS = { courses: { label: 'Courses', icon: 'cart', placeholder: 'Ajouter un article…' },
    taches: { label: 'Tâches', icon: 'list', placeholder: 'Ajouter une tâche…' } };
  let currentList = (() => { try { return localStorage.getItem('notre-planning-list') || 'courses'; } catch { return 'courses'; } })();
  let showDone = false;
  const tsOf = v => v?.toMillis?.() ?? v ?? 0;
  const personName = id => (!id ? '' : id === state.user?.id || id === 'me' ? 'Moi' : state.partner?.display_name || 'Partenaire');
  const personColor = id => (id === state.user?.id || id === 'me' ? state.me?.color : state.partner?.color) || 'var(--muted)';
  const meId = () => state.user?.id;

  function renderLists(main) {
    // Une mise à jour en direct (l'autre coche un article) ne doit pas effacer la saisie en cours.
    const input = $('#listAdd [name=text]', main);
    const draft = input?.value || '';
    const hadFocus = !!input && document.activeElement === input;
    const items = store.getListItems().filter(i => i.list === currentList);
    const todo = items.filter(i => !i.done).sort((a, b) => tsOf(a.created_at) - tsOf(b.created_at));
    const done = items.filter(i => i.done).sort((a, b) => tsOf(b.updated_at || b.created_at) - tsOf(a.updated_at || a.created_at));
    const tasks = currentList === 'taches';
    const partnerId = state.partner?.id;
    const assignOpts = [['', 'Personne'], [meId(), 'Moi'], ...(partnerId ? [[partnerId, state.partner.display_name]] : [])];
    const row = i => {
      const due = i.due ? fromInputs(i.due) : null;
      const late = due && !i.done && due < startOfDay(new Date());
      const meta = [
        i.assignee ? `<span class="tag"><span class="dot" style="--c:${esc(personColor(i.assignee))}"></span>${esc(personName(i.assignee))}</span>` : '',
        due ? `<span class="tag ${late ? 'is-late' : ''}">${ic('month')} ${fmt(due, { weekday: 'short', day: 'numeric', month: 'short' })}</span>` : '',
        state.partner && !i.is_mine && !tasks ? `<span class="tag">ajouté par ${esc(state.partner.display_name)}</span>` : '',
      ].join('');
      return `<li class="li-item ${i.done ? 'is-done' : ''}" data-item="${esc(i.id)}">
        <button class="li-check" data-act="toggle" aria-label="${i.done ? 'Décocher' : 'Cocher'}" aria-pressed="${i.done}"></button>
        <span class="li-body"><span class="li-text">${esc(i.text)}</span>${meta ? `<span class="ag-meta">${meta}</span>` : ''}</span>
        <button class="icon-btn sm li-del" data-act="del" aria-label="Supprimer">${ic('x')}</button></li>`;
    };
    main.innerHTML = `<div class="lists">
      <div class="seg list-seg" role="group" aria-label="Liste">${Object.entries(LISTS).map(([k, l]) =>
        `<button data-list="${k}" aria-pressed="${k === currentList}">${ic(l.icon)}${l.label}</button>`).join('')}</div>
      <form id="listAdd" class="list-add">
        <input class="input" name="text" maxlength="200" placeholder="${LISTS[currentList].placeholder}" autocomplete="off" required aria-label="${LISTS[currentList].placeholder}">
        ${tasks ? `<div class="row list-opts">
          <label class="field">Qui s’en charge<select name="assignee">${assignOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>
          <label class="field">Pour le (optionnel)<input type="date" name="due"></label></div>` : ''}
        <button class="btn primary">${ic('plus')} Ajouter</button>
      </form>
      ${todo.length ? `<ul class="li-list">${todo.map(row).join('')}</ul>`
        : `<p class="ag-empty">${tasks ? 'Aucune tâche en cours.' : 'La liste de courses est vide.'}</p>`}
      ${done.length ? `<div class="li-done-head">
          <button class="link" data-act="show-done">${showDone ? 'Masquer' : 'Afficher'} les éléments cochés (${done.length})</button>
          <button class="link danger" data-act="clear-done">${ic('trash')} Tout effacer</button></div>
        ${showDone ? `<ul class="li-list">${done.map(row).join('')}</ul>` : ''}` : ''}
      ${state.partner ? '' : '<p class="muted list-hint">Relie ton compte à celui de ta moitié (⚙ Réglages) pour partager ces listes.</p>'}
    </div>`;
    const fresh = $('#listAdd [name=text]', main);
    if (draft) fresh.value = draft;
    if (hadFocus) fresh.focus();
  }

  async function onListsClick(e) {
    const seg = e.target.closest('[data-list]');
    if (seg) {
      currentList = seg.dataset.list;
      try { localStorage.setItem('notre-planning-list', currentList); } catch { /* ignoré */ }
      return render();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const items = store.getListItems().filter(i => i.list === currentList);
    try {
      if (act === 'show-done') { showDone = !showDone; return render(); }
      if (act === 'clear-done') {
        const ids = items.filter(i => i.done).map(i => i.id);
        if (ids.length && confirm(`Effacer ${ids.length} élément(s) coché(s) ?`)) await store.deleteListItems(ids);
      } else {
        const item = items.find(i => i.id === e.target.closest('[data-item]')?.dataset.item);
        if (!item) return;
        if (act === 'toggle') await store.saveListItem({ ...item, done: !item.done });
        if (act === 'del') await store.deleteListItems([item.id]);
      }
    } catch (err) { toastError(err); }
    render();
  }

  async function onListAdd(e) {
    if (e.target.id !== 'listAdd') return;
    e.preventDefault();
    const f = e.target.elements;
    const text = f.text.value.trim();
    if (!text) return;
    try {
      await store.saveListItem({ list: currentList, text, done: false, assignee: f.assignee?.value || null, due: f.due?.value || null });
    } catch (err) { return toastError(err); }
    f.text.value = '';
    render();
    $('#listAdd [name=text]')?.focus(); // saisie à la chaîne
  }

  /* Recherche ------------------------------------------------------------------------- */
  const searchDlg = $('#searchDlg');
  let searchPool = [];

  async function openSearch() {
    // Tous les événements accessibles (les tiens et ceux de l'autre), toutes dates confondues.
    try { searchPool = await store.listEvents(new Date(1900, 0, 1), new Date(2200, 0, 1)); } catch (err) { return toastError(err); }
    $('#searchInput').value = '';
    $('#searchResults').innerHTML = '<p class="muted">Tape un mot du titre, du lieu ou des notes.</p>';
    searchDlg.showModal();
    $('#searchInput').focus();
  }

  function runSearch() {
    const q = normTitle($('#searchInput').value);
    const box = $('#searchResults');
    if (q.length < 2) {
      box.innerHTML = '<p class="muted">Tape au moins 2 lettres.</p>';
      return;
    }
    const today = startOfDay(new Date());
    const hits = searchPool
      .filter(ev => !isMasked(ev) && [ev.title, ev.location, ev.notes].some(t => normTitle(t).includes(q)))
      .map(ev => {
        // Prochaine date (ou dernière passée) pour les séries.
        const next = occurrences(ev, today, addDays(today, 800))[0];
        const start = next ? next.start : new Date(ev.start_at);
        return { ev, start, upcoming: start >= today };
      })
      .sort((a, b) => (b.upcoming - a.upcoming) || (a.upcoming ? a.start - b.start : b.start - a.start))
      .slice(0, 60);
    box.innerHTML = hits.length
      ? hits.map(({ ev, start }) => `<button class="search-hit" data-ev="${ev.id}" data-occ="${start.getTime()}" style="--c:${esc(colorOf(ev))}">
          <span class="ag-bar"></span>
          <span><strong>${esc(ev.title)}</strong>
          <small>${cap(fmt(start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}${ev.all_day ? '' : ` · ${fmtTime(start)}`}${ev.recurrence !== 'none' ? ` · ${RECUR_LABEL[ev.recurrence]}` : ''}${ev.location ? ` · ${esc(ev.location)}` : ''}</small></span>
        </button>`).join('')
      : '<p class="muted">Aucun événement trouvé.</p>';
  }

  /* Détail d'une journée -------------------------------------------------------------- */
  const dayDlg = $('#dayDlg');
  let dayDate = null;

  function openDay(date) {
    dayDate = startOfDay(date);
    renderDay();
    if (!dayDlg.open) dayDlg.showModal();
  }

  function renderDay() {
    const d = dayDate;
    const dEnd = addDays(d, 1);
    const occ = visibleOccurrences(d, dEnd);
    const items = occ.sort((a, b) => (b.ev.all_day - a.ev.all_day) || (a.start - b.start));
    const year = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
    $('#dayDlgTitle').textContent = cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long', ...year }));
    const badges = `${sameDay(d, new Date()) ? '<span class="badge">Aujourd’hui</span>' : ''}${holidayTag(d)}${schoolTag(d)}${dayRemoteNote(d, items)}`;
    let html = badges ? `<div class="day-badges">${badges}</div>` : '';
    html += items.length
      ? `<div class="ag-list">${items.map(o => agendaItem(o, d, dEnd)).join('')}</div>`
      : '<p class="ag-empty">Rien de prévu ce jour-là.</p>';
    $('#dayBody').innerHTML = html;
  }

  // Suggestions (nouvel événement seulement) : remplissent titre, type et durée.
  function renderPresets(visible) {
    const box = $('#evPresets');
    box.hidden = !visible;
    if (!visible) return;
    box.innerHTML = PRESETS.map((p, i) =>
      `<button type="button" class="preset" data-preset="${i}" data-cat="${p.cat}">${ic(p.icon)}${esc(p.title)}</button>`).join('');
  }
  function applyPreset(p) {
    // Anniversaire : « Anniversaire de … » répété chaque année ; on place le curseur pour le prénom.
    F.title.value = p.yearly ? `${p.title} de ` : p.title;
    F.recurrence.value = p.yearly ? 'yearly' : 'none';
    if (p.yearly) setTimeout(() => { F.title.focus(); F.title.setSelectionRange(99, 99); }, 0);
    F.category.value = p.cat;
    F.all_day.checked = !!p.allDay;
    const start = fromInputs(F.start_date.value, F.start_time.value || '09:00');
    if (p.allDay) {
      F.end_date.value = F.start_date.value;
    } else {
      const end = new Date(start.getTime() + p.min * 60e3);
      F.end_date.value = toDateInput(end);
      F.end_time.value = toTimeInput(end);
    }
    $$('.preset', evForm).forEach(b => b.setAttribute('aria-pressed', String(PRESETS[b.dataset.preset] === p)));
    syncEventForm();
  }

  function syncEventForm() {
    const allDay = F.all_day.checked;
    $$('.time-field', evForm).forEach(el => { el.hidden = allDay; });
    F.start_time.required = F.end_time.required = !allDay;
    const commun = F.category.value === 'commun';
    if (commun) F.is_private.checked = false;
    F.is_private.disabled = commun;
    $('#untilRow').hidden = F.recurrence.value === 'none';
    renderEventColors(); // « Auto » suit le type choisi
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
      color: formColor,
      recurrence,
      recurrence_until: recurrence !== 'none' && F.recurrence_until.value ? F.recurrence_until.value : null,
    };
    await withBusy($('#evSave'), async () => {
      if (onlyThisDate()) {
        // Cette date seulement : un événement indépendant la remplace, retirée de la série.
        await store.saveEvent({ ...ev, id: null, recurrence: 'none', recurrence_until: null, exdates: null });
        await store.saveEvent(withExdate(editing, editingOcc));
      } else {
        await store.saveEvent({ ...ev, exdates: editing.exdates || null });
      }
      evDlg.close();
      toast(ev.id ? 'Événement modifié' : 'Événement ajouté');
      load();
    });
  }

  async function deleteEvent() {
    if (!editing?.id) return;
    const one = onlyThisDate();
    const series = editing.recurrence && editing.recurrence !== 'none';
    const question = one ? `Supprimer l’événement du ${fmt(editingOcc, { day: 'numeric', month: 'long' })} seulement ?`
      : series ? 'Supprimer toute la série d’événements ?' : 'Supprimer cet événement ?';
    if (!confirm(question)) return;
    await withBusy($('#evDelete'), async () => {
      if (one) await store.saveEvent(withExdate(editing, editingOcc));
      else await store.deleteEvent(editing.id);
      evDlg.close();
      toast('Événement supprimé');
      load();
    });
  }

  // Série répétée ouverte sur une date précise, avec « Cette date seulement » choisi.
  const onlyThisDate = () => !!(editing?.id && editing.recurrence !== 'none' && editingOcc && editScope === 'one');
  const withExdate = (series, occ) => ({ ...series, exdates: [...new Set([...(series.exdates || []), toDateInput(occ)])] });

  // Portée d'une modification de série : cette date seulement, ou toute la série.
  function setScope(scope) {
    editScope = scope;
    $$('#evScope [data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
    const one = scope === 'one' && editingOcc;
    const s = one ? editingOcc : new Date(editing.start_at);
    const e = one ? new Date(editingOcc.getTime() + (new Date(editing.end_at) - new Date(editing.start_at))) : new Date(editing.end_at);
    F.start_date.value = toDateInput(s);
    F.start_time.value = toTimeInput(s);
    F.end_date.value = toDateInput(editing.all_day ? addDays(e, -1) : e);
    F.end_time.value = toTimeInput(e);
    formStart = s;
    F.recurrence.closest('.row').hidden = !!one;
    $('#evSeriesNote').hidden = !!one || !(editing.id && editing.recurrence !== 'none');
  }

  /* Réglages ---------------------------------------------------------------------- */
  const setDlg = $('#settingsDlg');

  async function openSettings() {
    try { await loadProfiles(); } catch (err) { toastError(err); }
    await refreshPushSub();
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
      <section class="set-section">
        <h3>Apparence</h3>
        <div class="seg theme-seg" role="group" aria-label="Thème">
          ${[['auto', 'auto', 'Automatique'], ['light', 'sun', 'Clair'], ['dark', 'moon', 'Sombre']].map(([value, icon, label]) =>
            `<button type="button" data-theme-choice="${value}" aria-pressed="${currentTheme() === value}">${ic(icon)}${label}</button>`).join('')}
        </div>
      </section>
      ${eventColorsSection()}
      <section class="set-section">
        <h3>Vacances scolaires</h3>
        <div class="seg zone-seg" role="group" aria-label="Zone de vacances scolaires">
          ${['', 'A', 'B', 'C'].map(z => `<button type="button" data-zone="${z}" aria-pressed="${schoolZone === z}">${z ? `Zone ${z}` : 'Aucune'}</button>`).join('')}
        </div>
        <p class="muted">Affichées dans l’agenda d’après le calendrier officiel de l’Éducation nationale.</p>
      </section>
      ${notifSection()}
      <section class="set-section"><h3>Planning partagé</h3>${share}</section>
      <section class="set-section">
        <h3>Types d’horaires</h3>
        <p class="muted">Tes horaires habituels (ouverture, fermeture…). Place-les ensuite sur plusieurs jours d’un coup avec le bouton + → Horaires.</p>
        <form id="shiftForm" class="shift-form">
          <div id="shiftRows">${shiftTypes().map(shiftRow).join('')}</div>
          <div class="btn-row">
            <button type="button" class="btn" data-act="shift-add">${ic('plus')} Ajouter un type</button>
            <button class="btn primary">Enregistrer</button>
          </div>
        </form>
      </section>
      <section class="set-section">
        <h3>Planning de travail</h3>
        <p class="muted">Importe le fichier Excel de ton planning pour remplir automatiquement tes journées, permanences et congés.</p>
        <div class="btn-row"><button class="btn" data-act="import">${ic('import')} Importer un fichier Excel</button>
          <button class="btn" data-act="remote">${ic('laptop')} Jours de télétravail</button></div>
      </section>
      ${installSection()}
      <section class="set-section">
        <h3>Sauvegarde et export</h3>
        <p class="muted">Télécharge tes données pour les garder en lieu sûr, ou pour les ouvrir dans Excel.</p>
        <div class="btn-row">
          <button class="btn" data-act="export-json">${ic('save')} Sauvegarde complète</button>
          <button class="btn" data-act="export-xlsx">${ic('save')} Export Excel</button>
        </div>
        <label class="btn restore-btn">${ic('upload')} Restaurer une sauvegarde<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
      </section>
      <section class="set-section">
        <h3>Compte</h3>
        <p class="muted">${esc(state.user?.email)}</p>
        <div>${store.mode === 'demo'
          ? '<button class="btn danger" data-act="reset-demo">Réinitialiser les données de démo</button>'
          : '<button class="btn" data-act="logout">Se déconnecter</button>'}</div>
      </section>`;
  }

  // Thème : « auto » suit le réglage de l'appareil. Mémorisé sur l'appareil, appliqué
  // par window.applyTheme (défini dans index.html pour éviter un flash au chargement).
  const THEME_KEY = 'notre-planning-theme';
  function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
  }
  function setTheme(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignoré */ }
    window.applyTheme(pref);
  }

  /* Notifications : abonnement Web Push de l'appareil + préférences dans le profil.
     L'envoi est fait toutes les 10 min par la tâche GitHub Actions (notifier/notify.js). */
  const DEFAULT_NOTIF = { reminders: true, reminderMin: 30, partner: true, morning: true };
  const notifPrefs = () => ({ ...DEFAULT_NOTIF, ...(state.me?.notif || {}) });
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let pushSub = null;

  async function refreshPushSub() {
    pushSub = null;
    if (store.mode === 'demo' || !pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      pushSub = reg ? await reg.pushManager.getSubscription() : null;
    } catch { /* service worker indisponible */ }
  }
  const b64ToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
  // Identifiant stable d'un abonnement : empreinte de son adresse d'envoi.
  async function subIdOf(sub) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
    return [...new Uint8Array(hash)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function enablePush() {
    // requestPermission doit partir directement du geste de l'utilisateur (exigence d'iOS).
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      throw new Error('Notifications refusées. Autorise-les pour cette app dans les réglages du téléphone.');
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: b64ToBytes(window.PLANNING_CONFIG.vapidPublicKey),
    });
    await store.savePushSub(await subIdOf(sub), sub.toJSON(), navigator.userAgent.slice(0, 200));
    if (!state.me?.notif) await store.updateMe({ notif: DEFAULT_NOTIF });
    pushSub = sub;
  }
  async function disablePush() {
    if (!pushSub) return;
    await store.deletePushSub(await subIdOf(pushSub));
    await pushSub.unsubscribe().catch(() => {});
    pushSub = null;
  }
  async function testPush() {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Notre Planning', { body: 'Les notifications fonctionnent sur cet appareil ✓', icon: 'icon-192.png' });
  }

  function notifSection() {
    let body;
    if (store.mode === 'demo') {
      body = '<p class="muted">Disponibles avec un compte (pas en mode démo).</p>';
    } else if (!pushSupported()) {
      body = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isInstalled()
        ? '<p class="muted">Sur iPhone, installe d’abord l’app sur l’écran d’accueil, puis ouvre-la depuis son icône pour activer les notifications.</p>'
        : '<p class="muted">Ce navigateur ne permet pas les notifications.</p>';
    } else {
      const p = notifPrefs();
      const partner = state.partner?.display_name || 'l’autre personne';
      const device = pushSub
        ? `<p class="notif-on">${ic('bell')} Activées sur cet appareil</p>
           <div class="btn-row"><button class="btn" data-act="push-test">Tester</button><button class="btn danger" data-act="push-off">Désactiver ici</button></div>`
        : `<div><button class="btn primary" data-act="push-on">${ic('bell')} Activer sur cet appareil</button></div>`;
      body = `${device}
        <form id="notifForm" class="notif-form">
          <p class="muted">Ce que je veux recevoir :</p>
          <label class="check"><input type="checkbox" name="reminders" ${p.reminders ? 'checked' : ''}> Rappel avant mes rendez-vous perso et communs</label>
          <label class="field notif-delay">Prévenir
            <select name="reminderMin">${[[15, '15 min avant'], [30, '30 min avant'], [60, '1 h avant']]
              .map(([v, l]) => `<option value="${v}"${Number(p.reminderMin) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          </label>
          <label class="check"><input type="checkbox" name="partner" ${p.partner ? 'checked' : ''}> Quand ${esc(partner)} ajoute ou modifie un événement commun</label>
          <label class="check"><input type="checkbox" name="morning" ${p.morning ? 'checked' : ''}> Résumé de ma journée à 7h</label>
          <div><button class="btn primary">Enregistrer mes choix</button></div>
        </form>`;
    }
    return `<section class="set-section"><h3>Notifications</h3>${body}</section>`;
  }

  // Installation sur l'écran d'accueil : bouton natif sur Android / Chrome, mode d'emploi sur iPhone.
  let installPrompt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  addEventListener('appinstalled', () => { installPrompt = null; toast('Application installée'); });
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function installSection() {
    let install = '';
    if (!isInstalled()) {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      install = '<p class="muted">Installe Notre Planning sur ton écran d’accueil pour l’ouvrir comme une vraie application.</p>'
        + (installPrompt
          ? `<div><button class="btn primary" data-act="install">${ic('import')} Installer l’application</button></div>`
          : ios
            ? '<p class="muted">Dans Safari, touche Partager puis « Sur l’écran d’accueil ».</p>'
            : '<p class="muted">Dans le menu du navigateur (⋮), choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>');
    }
    return `<section class="set-section"><h3>Application</h3>${install}
      <p class="muted">Version ${APP_VERSION}. Les mises à jour s’installent seules ; en cas de doute :</p>
      <div><button class="btn" data-act="reload-app">${ic('repeat')} Recharger l’application</button></div></section>`;
  }

  // Recharge complète : dernière version du service worker, cache vidé, page rechargée.
  async function reloadApp() {
    try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* hors-ligne */ }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignoré */ }
    location.reload();
  }

  // Une ligne éditable de type d'horaire (nom, début, fin).
  function shiftRow(t) {
    return `<div class="shift-row" data-id="${esc(t.id)}" data-color="${esc(t.color)}">
      <span class="dot" style="--c:${esc(t.color)}"></span>
      <input class="input" name="name" value="${esc(t.name)}" maxlength="30" required aria-label="Nom de l’horaire">
      <input class="input" type="time" name="start" value="${esc(t.start)}" required aria-label="Début">
      <input class="input" type="time" name="end" value="${esc(t.end)}" required aria-label="Fin">
      <button type="button" class="icon-btn sm" data-act="shift-del" aria-label="Supprimer ce type">${ic('x')}</button>
    </div>`;
  }

  async function saveShiftTypes(form) {
    const types = $$('.shift-row', form).map(r => ({
      id: r.dataset.id, color: r.dataset.color,
      name: $('[name=name]', r).value.trim(), start: $('[name=start]', r).value, end: $('[name=end]', r).value,
    }));
    if (types.some(t => !t.name || !t.start || !t.end)) return toast('Indique un nom, un début et une fin pour chaque horaire.');
    const before = new Map(shiftTypes().map(t => [t.id, t]));
    await withBusy($('button:not([type])', form), async () => {
      await store.updateMe({ shift_types: types });
      // Les jours déjà planifiés (à partir d'aujourd'hui) suivent les nouveaux horaires.
      const changed = types.filter(t => {
        const o = before.get(t.id);
        return o && (o.name !== t.name || o.start !== t.start || o.end !== t.end);
      });
      if (changed.length) {
        const from = startOfDay(new Date());
        const del = [], add = [];
        for (const ev of await store.listEvents(from, addDays(from, 800))) {
          const t = ev.is_mine && changed.find(c => c.id === shiftIdOf(ev));
          if (!t || new Date(ev.start_at) < from) continue;
          del.push(ev.id);
          add.push(shiftEvent(t, toDateInput(new Date(ev.start_at))));
        }
        if (del.length) await store.applyShifts(del, add);
      }
      await loadProfiles();
      toast('Types d’horaires enregistrés');
      load();
    });
  }

  // Réglages → couleurs des types d'événements (interdites : proches d'une personne ou déjà prises).
  function eventColorsSection() {
    const current = eventColors();
    const partner = state.partner?.display_name;
    const rows = Object.keys(DEFAULT_EVENT_COLORS).map(cat => {
      const swatches = EVENT_PALETTE.map(([hex, name]) => {
        const clash = clashesWithPerson(hex);
        const taken = Object.entries(current).some(([c, v]) => c !== cat && v === hex);
        return `<button type="button" class="ev-color" data-cat-color="${cat}" data-hex="${hex}" style="--c:${hex}"
          aria-pressed="${current[cat] === hex}"${clash || taken ? ' disabled' : ''}
          title="${name}${clash ? ' — trop proche de la couleur d’une personne' : taken ? ' — déjà utilisée par un autre type' : ''}" aria-label="${name}"></button>`;
      }).join('');
      return `<div class="cat-colors" data-cat="${cat}"><span class="cat-colors-label">${ic(CATS[cat].icon)} ${CATS[cat].label}</span>
        <div class="ev-colors">${swatches}</div></div>`;
    }).join('');
    return `<section class="set-section"><h3>Couleurs des événements</h3>
      <p class="muted">La couleur d’un bloc indique son type ; le liseré et la pastille indiquent la personne.
        Les couleurs trop proches de la tienne${partner ? ` ou de celle de ${esc(partner)}` : ''} sont grisées pour éviter toute confusion.</p>
      ${rows}</section>`;
  }

  /* Sauvegarde, export et restauration ------------------------------------------------ */
  const EXPORT_FIELDS = ['title', 'notes', 'location', 'start_at', 'end_at', 'all_day', 'category', 'is_private',
    'recurrence', 'recurrence_until', 'import_key', 'exdates'];
  const allEvents = () => store.listEvents(new Date(1900, 0, 1), new Date(2200, 0, 1));

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // Sauvegarde complète (restaurable) : tes événements, télétravail, listes et réglages.
  async function exportJson() {
    const mine = (await allEvents()).filter(e => e.is_mine);
    const data = {
      app: 'Notre Planning', version: 1, exported_at: new Date().toISOString(),
      profile: {
        display_name: state.me?.display_name, color: state.me?.color,
        shift_types: state.me?.shift_types || null, notif: state.me?.notif || null, work_name: state.me?.work_name || null,
      },
      events: mine.map(e => Object.fromEntries(EXPORT_FIELDS.map(k => [k, e[k] ?? null]))),
      remote_days: [...state.remote.me].sort(),
      list_items: store.getListItems().filter(i => i.is_mine)
        .map(({ list, text, done, due }) => ({ list, text, done, due })),
    };
    download(`notre-planning-${toDateInput(new Date())}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  // Export lisible dans Excel : tous les événements visibles (les tiens et ceux de l'autre) + listes.
  async function exportXlsx() {
    const XLSX = await PlanningImport.loadSheetJs();
    const when = (iso, allDay) => {
      const d = new Date(iso);
      return allDay ? d.toLocaleDateString('fr-FR') : `${d.toLocaleDateString('fr-FR')} ${toTimeInput(d)}`;
    };
    const events = (await allEvents()).sort((a, b) => a.start_at.localeCompare(b.start_at)).map(e => ({
      Titre: e.title, Personne: state.partner ? nameOf(e) : 'Moi', Type: CATS[e.category].label,
      Début: when(e.start_at, e.all_day), Fin: when(e.all_day ? addDays(new Date(e.end_at), -1).toISOString() : e.end_at, e.all_day),
      'Journée entière': e.all_day ? 'Oui' : '', Lieu: e.location || '', Notes: e.notes || '',
      Répétition: RECUR_LABEL[e.recurrence] || '', 'Jusqu’au': e.recurrence_until || '', Privé: e.is_private ? 'Oui' : '',
    }));
    const items = store.getListItems().map(i => ({
      Liste: LISTS[i.list]?.label || i.list, Élément: i.text, Fait: i.done ? 'Oui' : '',
      'Qui s’en charge': personName(i.assignee), Échéance: i.due ? fromInputs(i.due).toLocaleDateString('fr-FR') : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(events), 'Événements');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items.length ? items : [{ Liste: '' }]), 'Listes');
    XLSX.writeFile(wb, `notre-planning-${toDateInput(new Date())}.xlsx`);
  }

  // Restauration : ajoute ce qui manque, sans doublons (même titre et mêmes horaires).
  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { data = null; }
    if (data?.app !== 'Notre Planning' || !Array.isArray(data.events)) throw new Error('Ce fichier n’est pas une sauvegarde de Notre Planning.');
    const sig = e => `${e.title}|${e.start_at}|${e.end_at}`;
    const seen = new Set((await allEvents()).filter(e => e.is_mine).map(sig));
    const fresh = data.events.filter(e => e?.title && e.start_at && e.end_at && CATS[e.category] && !seen.has(sig(e)));
    const items = (data.list_items || []).filter(i => i?.text && LISTS[i.list]);
    const knownItems = new Set(store.getListItems().map(i => `${i.list}|${i.text}`));
    const newItems = items.filter(i => !knownItems.has(`${i.list}|${i.text}`));
    if (!confirm(`Restaurer ${fresh.length} événement(s) et ${newItems.length} élément(s) de liste ? `
      + `(${data.events.length - fresh.length} événement(s) déjà présent(s) seront ignorés.)`)) return;
    if (fresh.length) await store.bulkCreate(fresh);
    for (const i of newItems) await store.saveListItem({ list: i.list, text: i.text, done: !!i.done, due: i.due || null });
    if (data.remote_days?.length) await store.setRemoteDays([...new Set([...state.remote.me, ...data.remote_days])].sort());
    if (data.profile?.shift_types && !state.me?.shift_types) await store.updateMe({ shift_types: data.profile.shift_types });
    await loadProfiles();
    toast(`Sauvegarde restaurée : ${fresh.length} événement(s) ajouté(s)`);
    load();
  }

  async function onSettingsClick(e) {
    const catColor = e.target.closest('[data-cat-color]');
    if (catColor) {
      if (catColor.disabled) return;
      try {
        await store.updateMe({ event_colors: { ...eventColors(), [catColor.dataset.catColor]: catColor.dataset.hex } });
        await loadProfiles();
      } catch (err) { return toastError(err); }
      renderSettings();
      return render();
    }
    const zoneBtn = e.target.closest('[data-zone]');
    if (zoneBtn) {
      schoolZone = zoneBtn.dataset.zone;
      try { localStorage.setItem(ZONE_KEY, schoolZone); } catch { /* ignoré */ }
      $$('[data-zone]', setDlg).forEach(b => b.setAttribute('aria-pressed', String(b === zoneBtn)));
      await loadSchoolHolidays();
      return render();
    }
    const shiftAct = e.target.closest('[data-act="shift-add"], [data-act="shift-del"]');
    if (shiftAct) {
      if (shiftAct.dataset.act === 'shift-del') shiftAct.closest('.shift-row').remove();
      else {
        const rows = $('#shiftRows', setDlg);
        if (rows.children.length >= 12) return toast('12 types d’horaires au maximum.');
        const used = new Set($$('.shift-row', rows).map(r => r.dataset.color));
        const color = SHIFT_COLORS.find(c => !used.has(c)) || SHIFT_COLORS[0];
        rows.insertAdjacentHTML('beforeend', shiftRow({ id: Math.random().toString(36).slice(2, 8), name: '', start: '09:00', end: '17:00', color }));
        $('.shift-row:last-child [name=name]', rows).focus();
      }
      return;
    }
    const themeBtn = e.target.closest('[data-theme-choice]');
    if (themeBtn) {
      setTheme(themeBtn.dataset.themeChoice);
      $$('[data-theme-choice]', setDlg).forEach(b => b.setAttribute('aria-pressed', String(b === themeBtn)));
      return;
    }
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
      } else if (act === 'remote') {
        setDlg.close();
        return openWork('remote');
      } else if (act === 'export-json') {
        return exportJson();
      } else if (act === 'export-xlsx') {
        return exportXlsx();
      } else if (act === 'push-on') {
        await enablePush();
        toast('Notifications activées sur cet appareil');
      } else if (act === 'push-off') {
        await disablePush();
        toast('Notifications désactivées sur cet appareil');
      } else if (act === 'push-test') {
        return testPush();
      } else if (act === 'reload-app') {
        return reloadApp();
      } else if (act === 'install') {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
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
    } else if (form.id === 'shiftForm') {
      await saveShiftTypes(form);
    } else if (form.id === 'notifForm') {
      const f = form.elements;
      await withBusy($('button:not([type])', form), async () => {
        await store.updateMe({ notif: {
          reminders: f.reminders.checked, reminderMin: Number(f.reminderMin.value),
          partner: f.partner.checked, morning: f.morning.checked,
        } });
        await loadProfiles();
        toast('Préférences de notifications enregistrées');
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

  /* Mes horaires : placer types d'horaires et télétravail sur plusieurs jours ---------- */
  const rmDlg = $('#remoteDlg');
  let rmMonth = null;
  let rmMode = null;              // id du type d'horaire en cours, ou 'remote'
  let rmShowRemote = false;
  let rmDraft = new Set();        // jours de télétravail
  let rmShiftOrig = new Map();    // date -> { type, ids } tel qu'enregistré
  let rmShiftDraft = new Map();   // date -> id du type (modifiable)

  // Le télétravail n'est proposé qu'aux profils qui l'utilisent (ou à la demande depuis Réglages).
  const usesRemote = () => !!(state.me?.work_name || state.remote.me.size);

  async function openWork(mode) {
    rmDraft = new Set(state.remote.me);
    rmMonth = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
    rmShowRemote = mode === 'remote' || usesRemote();
    rmMode = mode || shiftTypes()[0]?.id || 'remote';
    try {
      // Créneaux d'horaires déjà placés (une large période autour d'aujourd'hui).
      const from = addDays(startOfDay(new Date()), -400);
      rmShiftOrig = new Map();
      for (const ev of await store.listEvents(from, addDays(from, 1200))) {
        const type = ev.is_mine && shiftIdOf(ev);
        if (!type) continue;
        const k = toDateInput(new Date(ev.start_at));
        const cur = rmShiftOrig.get(k) || { type, ids: [] };
        cur.ids.push(ev.id);
        rmShiftOrig.set(k, cur);
      }
      rmShiftDraft = new Map([...rmShiftOrig].map(([k, v]) => [k, v.type]));
    } catch (err) {
      return toastError(err);
    }
    renderWork();
    rmDlg.showModal();
  }

  function renderWork() {
    const types = shiftTypes();
    const typeById = new Map(types.map(t => [t.id, t]));
    $('#rmModes').innerHTML = types.map(t =>
      `<button type="button" class="rm-mode" data-mode="${esc(t.id)}" style="--sc:${esc(t.color)}" aria-pressed="${rmMode === t.id}">
        <span class="dot" style="--c:${esc(t.color)}"></span><b>${esc(t.name)}</b><small>${fmtHour(t.start)}–${fmtHour(t.end)}</small></button>`).join('')
      + (rmShowRemote ? `<button type="button" class="rm-mode" data-mode="remote" style="--sc:var(--accent)" aria-pressed="${rmMode === 'remote'}">${ic('laptop')}<b>Télétravail</b></button>` : '');

    $('#rmMonth').textContent = cap(fmt(rmMonth, { month: 'long', year: 'numeric' }));
    const from = startOfWeek(rmMonth);
    const today = toDateInput(new Date());
    let html = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map(d => `<span class="rm-dow">${d}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i);
      if (i % 7 === 0 && i > 0 && d.getMonth() !== rmMonth.getMonth()) break;
      const key = toDateInput(d);
      const shift = typeById.get(rmShiftDraft.get(key));
      const remote = rmDraft.has(key);
      const pressed = rmMode === 'remote' ? remote : !!shift && shift.id === rmMode;
      const hol = holidayName(d);
      const cls = ['rm-day', d.getMonth() !== rmMonth.getMonth() && 'is-out', key === today && 'is-today',
        shift && 'has-shift', hol && 'is-holiday'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${key}" aria-pressed="${pressed}"${shift ? ` style="--sc:${esc(shift.color)}"` : ''}
        aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${shift ? ` : ${esc(shift.name)}` : ''}${hol ? ` (${esc(hol)})` : ''}">
        ${d.getDate()}${shift ? `<small>${esc(shift.name.slice(0, 4))}</small>` : ''}${remote ? ic('laptop') : ''}</button>`;
    }
    $('#rmGrid').innerHTML = html;

    const monthPrefix = toDateInput(rmMonth).slice(0, 7);
    if (rmMode === 'remote') {
      const inMonth = [...rmDraft].filter(k => k.startsWith(monthPrefix)).length;
      $('#rmCount').textContent = `Télétravail : ${inMonth} jour${inMonth > 1 ? 's' : ''} ce mois-ci`;
    } else {
      const counts = types.map(t => {
        const n = [...rmShiftDraft].filter(([k, id]) => id === t.id && k.startsWith(monthPrefix)).length;
        return `${t.name} ${n}`;
      });
      $('#rmCount').textContent = `Ce mois-ci : ${counts.join(' · ')}`;
    }
  }

  function toggleWorkDay(key) {
    if (rmMode === 'remote') {
      if (rmDraft.has(key)) rmDraft.delete(key);
      else rmDraft.add(key);
    } else if (rmShiftDraft.get(key) === rmMode) {
      rmShiftDraft.delete(key);
    } else {
      rmShiftDraft.set(key, rmMode); // remplace un autre horaire éventuel ce jour-là
    }
    renderWork();
  }

  async function saveWork() {
    await withBusy($('#rmSave'), async () => {
      // Télétravail (seulement s'il a changé)
      const remoteChanged = rmDraft.size !== state.remote.me.size || [...rmDraft].some(k => !state.remote.me.has(k));
      if (remoteChanged) {
        const cutoff = toDateInput(addDays(new Date(), -400)); // on ne garde pas l'historique ancien
        await store.setRemoteDays([...rmDraft].filter(k => k >= cutoff).sort());
      }
      // Horaires : on supprime/crée uniquement les jours modifiés
      const typeById = new Map(shiftTypes().map(t => [t.id, t]));
      const del = [], add = [];
      for (const k of new Set([...rmShiftOrig.keys(), ...rmShiftDraft.keys()])) {
        const before = rmShiftOrig.get(k);
        const after = rmShiftDraft.get(k);
        if (before?.type === after) continue;
        if (before) del.push(...before.ids);
        if (after && typeById.has(after)) add.push(shiftEvent(typeById.get(after), k));
      }
      if (del.length || add.length) await store.applyShifts(del, add);
      state.remote = await store.getRemoteDays();
      rmDlg.close();
      toast('Horaires enregistrés');
      load();
    });
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
    $('#impSubmit').disabled = true;
    impStatus('');
    impDlg.showModal();
  }

  async function onImportFile() {
    const file = $('#impFile').files[0];
    impForm.hidden = true;
    $('#impSubmit').disabled = true;
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
    // Nom mémorisé dans le profil (tous appareils), sinon sur cet appareil.
    const savedKey = state.me?.work_name ? PlanningImport.nameKey(state.me.work_name) : prefs.person;
    const match = savedKey && workbook.people.find(p => p.key === savedKey);
    I.person.innerHTML = (match ? '' : '<option value="">— Choisis ton nom —</option>')
      + workbook.people.map(p => `<option value="${esc(p.key)}"${p === match ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    I.from.value = toDateInput(new Date());
    const hours = { ...PlanningImport.DEFAULT_HOURS, ...prefs.hours };
    for (const k of Object.keys(PlanningImport.DEFAULT_HOURS)) I[k].value = hours[k];
    if (match) {
      impStatus('');
      showPersonChoice(false, match);
    } else {
      impStatus(savedKey
        ? `Ton nom (${state.me?.work_name || 'mémorisé'}) est introuvable dans ce fichier : choisis-le dans la liste.`
        : 'Choisis ton nom dans la liste : il sera mémorisé pour les prochains imports.');
      showPersonChoice(true);
    }
    impForm.hidden = false;
    renderImportPreview();
  }

  // Nom reconnu : on affiche seulement « Planning de … » ; la liste n'apparaît que sur demande.
  function showPersonChoice(visible, person) {
    $('#impPersonField').hidden = !visible;
    const fixed = $('#impPersonFixed');
    fixed.hidden = visible;
    if (!visible) {
      fixed.innerHTML = `${ic('user')} Planning de <strong>${esc(person.name)}</strong> <button type="button" class="link" id="impChangePerson">Changer</button>`;
      $('#impChangePerson').onclick = () => showPersonChoice(true);
    }
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
        <li>${ic('pro')} ${count('Travail')} jours de travail : ${fmtHour(hours.start)}–${fmtHour(hours.end)} (matin seul : ${fmtHour(hours.start)}–${fmtHour(hours.morningEnd)})</li>
        <li>${ic('clock')} ${count('Permanence')} permanences : ${fmtHour(hours.start)}–${fmtHour(hours.permEnd)}</li>
        <li>${ic('sun')} ${conges.length} période${conges.length > 1 ? 's' : ''} de congés${conges.length ? ' : '
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
    if (state.me && state.me.work_name !== imp.person.name) {
      store.updateMe({ work_name: imp.person.name })
        .then(() => { state.me.work_name = imp.person.name; })
        .catch(err => console.error(err)); // non bloquant : le nom reste mémorisé sur cet appareil
    }
    await withBusy($('#impSubmit'), async () => {
      const { added, removed } = await store.replaceImported(PlanningImport.IMPORT_KEY, imp.from, imp.to, imp.events);
      // Date de fin du planning importé : sert au rappel « pense à importer le nouveau fichier ».
      await store.updateMe({ work_until: imp.plan.last }).catch(err => console.error(err));
      if (state.me) state.me.work_until = imp.plan.last;
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
    loadSchoolHolidays().then(render);
    ensureWorkUntil().then(render, err => console.error(err));
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
    $('#todayBtn').onclick = goToday;
    // Vue mois : titre à jour et mois supplémentaires chargés pendant le défilement.
    let monthTick = false;
    $('#main').addEventListener('scroll', () => {
      if (state.view !== 'month' || monthTick) return;
      monthTick = true;
      requestAnimationFrame(() => { monthTick = false; onMonthScroll(); });
    }, { passive: true });
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
    // « + » ouvre le menu de bulles ; en vue Listes, il sert à ajouter un élément à la liste.
    $('#fab').onclick = () => (state.view === 'lists' ? $('#listAdd [name=text]')?.focus() : toggleDial());
    $('#dialBackdrop').onclick = () => toggleDial(false);
    $('#speedDial').onclick = e => {
      const b = e.target.closest('[data-dial]');
      if (b) runDial(b.dataset.dial);
    };
    $('#settingsBtn').onclick = openSettings;

    $('#main').addEventListener('submit', onListAdd);
    $('#main').addEventListener('click', e => {
      if (state.view === 'lists') return onListsClick(e);
      const evEl = e.target.closest('[data-ev]');
      const go = e.target.closest('[data-goto]');
      // En vue mois sur téléphone, les événements sont de simples pastilles : toute la case ouvre le jour.
      if (evEl && !(go && state.view === 'month' && narrowMq.matches)) return openEvent(evEl.dataset.ev, evEl.dataset.occ);
      if (go) return openDay(fromInputs(go.dataset.goto));
      const col = e.target.closest('.wk-col');
      if (col) {
        const minutes = Math.floor(((e.clientY - col.getBoundingClientRect().top) / HOUR_PX) * 2) * 30;
        const start = fromInputs(col.dataset.date);
        start.setHours(0, Math.max(0, Math.min(minutes, 23 * 60 + 30)));
        newEvent(start);
      }
    });

    // Balayage horizontal sur mobile pour changer de période (vue agenda seulement :
    // la semaine défile horizontalement et le mois verticalement).
    let touch = null;
    $('#main').addEventListener('touchstart', e => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
    $('#main').addEventListener('touchend', e => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (state.view !== 'agenda') return;
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
    setDlg.addEventListener('change', e => {
      if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
      restoreBackup(e.target.files[0]).catch(toastError).finally(() => { e.target.value = ''; });
    });
    $('#workAlert').onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'work-import') openImport();
      if (act === 'work-dismiss') {
        try { localStorage.setItem(WORK_ALERT_KEY, toDateInput(new Date())); } catch { /* ignoré */ }
        renderWorkAlert();
      }
    };

    $('#rmPrev').onclick = () => { rmMonth = new Date(rmMonth.getFullYear(), rmMonth.getMonth() - 1, 1); renderWork(); };
    $('#rmNext').onclick = () => { rmMonth = new Date(rmMonth.getFullYear(), rmMonth.getMonth() + 1, 1); renderWork(); };
    $('#rmModes').onclick = e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      rmMode = b.dataset.mode;
      renderWork();
    };
    $('#rmGrid').onclick = e => {
      const b = e.target.closest('[data-date]');
      if (b) toggleWorkDay(b.dataset.date);
    };
    $('#rmSave').onclick = saveWork;

    $('#impFile').addEventListener('change', onImportFile);
    impForm.addEventListener('change', renderImportPreview);
    impForm.addEventListener('submit', submitImport);

    // Fiche du jour : un créneau ouvre sa fiche, « Ajouter » crée un événement ce jour-là.
    dayDlg.addEventListener('click', e => {
      const evEl = e.target.closest('[data-ev]');
      if (!evEl) return;
      dayDlg.close();
      openEvent(evEl.dataset.ev, evEl.dataset.occ);
    });
    $('#dayAdd').onclick = () => {
      dayDlg.close();
      const now = new Date();
      newEvent(sameDay(dayDate, now)
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
        : new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 9));
    };
    $('#dayAgenda').onclick = () => {
      dayDlg.close();
      state.cursor = dayDate;
      setView('agenda');
    };
    evForm.addEventListener('click', e => {
      const b = e.target.closest('[data-preset]');
      if (b) applyPreset(PRESETS[b.dataset.preset]);
      const col = e.target.closest('[data-color-ev]');
      if (col && !col.disabled) { formColor = col.dataset.colorEv || null; renderEventColors(); }
      const sc = e.target.closest('[data-scope]');
      if (sc) setScope(sc.dataset.scope);
    });

    $('#searchBtn').onclick = openSearch;
    $('#searchInput').addEventListener('input', debounce(runSearch, 150));
    $('#searchResults').onclick = e => {
      const r = e.target.closest('[data-ev]');
      if (!r) return;
      searchDlg.close();
      openEvent(r.dataset.ev, r.dataset.occ);
    };

    for (const dlg of [evDlg, setDlg, impDlg, rmDlg, dayDlg, searchDlg]) {
      dlg.addEventListener('click', e => {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      });
    }

    $('#authTabs').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) setAuthMode(b.dataset.mode); };
    $('#forgotBtn').onclick = () => setAuthMode(authMode === 'forgot' ? 'login' : 'forgot');
    $('#authForm').addEventListener('submit', submitAuth);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#speedDial').hidden) return toggleDial(false);
      if ($$("dialog[open]").length || $("#app").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't') $('#todayBtn').click();
      else if (e.key === 'n') newEvent();
      else if (e.key === '/') { e.preventDefault(); openSearch(); }
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
      navigator.serviceWorker.register('sw.js').then(reg => {
        // À chaque retour dans l'app, on regarde si une nouvelle version a été publiée.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      }).catch(() => {});
      // Nouvelle version installée (le service worker a changé) : bandeau pour recharger.
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; } // toute première installation
        const bar = $('#updateBanner');
        bar.hidden = false;
        bar.innerHTML = `${ic('repeat')}<span>Nouvelle version disponible.</span>
          <button class="btn primary" type="button">Mettre à jour</button>`;
        bar.querySelector('button').onclick = () => location.reload();
      });
    }
  }

  boot();
})();
