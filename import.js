/* Import d'un planning de travail Excel : une ligne par collaborateur, par jour et par
   demi-journée (colonnes Date, Collaborateur, Demi-journée, Planification).
   Le fichier est lu dans le navigateur ; seuls les créneaux de la personne choisie en sortent. */
(() => {
  'use strict';
  const SHEETJS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const IMPORT_KEY = 'planning-travail';

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  // "LEPIC Jonathan", "Jonathan Lepic" et "lepic  jonathan" donnent la même clé.
  const nameKey = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
  const pad = n => String(n).padStart(2, '0');
  const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const noon = date => new Date(`${date}T12:00:00`);
  const weekday = date => noon(date).getDay();
  const addDaysIso = (date, n) => {
    const d = noon(date);
    d.setDate(d.getDate() + n);
    return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  const localDateTime = (date, hhmm = '00:00') => {
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi);
  };

  let sheetJs = null;
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    sheetJs ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SHEETJS_URL;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { sheetJs = null; reject(new Error('Impossible de charger le lecteur Excel (connexion internet ?).')); };
      document.head.appendChild(s);
    });
    return sheetJs;
  }

  function toIsoDate(XLSX, v) {
    if (typeof v === 'number') {
      const p = XLSX.SSF.parse_date_code(v);
      return p ? isoDate(p.y, p.m, p.d) : null;
    }
    if (v instanceof Date) return isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return isoDate(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? isoDate(+m[1], +m[2], +m[3]) : null;
  }

  // Cherche, dans chaque feuille, une ligne d'en-têtes contenant les 4 colonnes utiles.
  function findTable(XLSX, wb) {
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
      for (let h = 0; h < Math.min(rows.length, 10); h++) {
        const head = rows[h].map(norm);
        const col = {
          name: head.findIndex(c => c.includes('collaborateur')),
          date: head.findIndex(c => c === 'date'),
          half: head.findIndex(c => c.startsWith('demi')),
          status: head.findIndex(c => c.startsWith('planification')),
        };
        if (Object.values(col).every(i => i >= 0)) return { sheetName, rows, headerRow: h, col };
      }
    }
    return null;
  }

  async function readWorkbook(file) {
    const XLSX = await loadSheetJs();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });
    const table = findTable(XLSX, wb);
    if (!table) {
      throw new Error('Format non reconnu : le fichier doit contenir les colonnes « Date », « Collaborateur », « Demi-journée » et « Planification ».');
    }
    const { rows, headerRow, col } = table;
    const people = new Map();
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[col.name] ?? '').trim();
      const date = name && toIsoDate(XLSX, r[col.date]);
      if (!date) continue;
      const key = nameKey(name);
      if (!people.has(key)) people.set(key, { key, name, rows: [] });
      people.get(key).rows.push({
        date,
        half: norm(r[col.half]).startsWith('mat') ? 'am' : 'pm',
        status: String(r[col.status] ?? '').trim(),
      });
    }
    return {
      fileName: file.name,
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    };
  }

  const isAbsent = s => norm(s) === 'absent';
  const isPerm = s => norm(s).startsWith('perm');
  const isWork = s => !!norm(s) && !isAbsent(s);

  // Transforme les demi-journées d'une personne en jours travaillés et périodes de congés.
  function buildPlan(person) {
    const days = new Map();
    for (const r of person.rows) {
      const d = days.get(r.date) || { date: r.date, am: '', pm: '' };
      d[r.half] = r.status;
      days.set(r.date, d);
    }
    const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const work = [];
    const absent = new Set();
    const perWeekday = Array.from({ length: 7 }, () => ({ total: 0, absent: 0 }));
    for (const d of list) {
      const am = isWork(d.am);
      const pm = isWork(d.pm);
      const stats = perWeekday[weekday(d.date)];
      stats.total++;
      if (am || pm) {
        const perm = isPerm(d.am) || isPerm(d.pm);
        const kind = am && pm ? (perm ? 'perm' : 'full') : am ? 'morning' : perm ? 'afternoonPerm' : 'afternoon';
        work.push({ date: d.date, kind });
      } else if (isAbsent(d.am) || isAbsent(d.pm)) {
        stats.absent++;
        absent.add(d.date);
      }
    }
    // Jour de repos habituel : absent au moins 80 % du temps (ex. tous les lundis).
    const restDays = perWeekday
      .map((w, i) => (w.total >= 4 && w.absent / w.total >= 0.8 ? i : -1))
      .filter(i => i >= 0);
    const isRest = date => restDays.includes(weekday(date)) || weekday(date) === 0;

    // Congés : suite de jours d'absence sans jour travaillé entre eux, débarrassée des jours
    // de repos en bordure, et contenant au moins un jour ouvré qui n'est pas un repos habituel.
    const workDates = new Set(work.map(w => w.date));
    const conges = [];
    let run = [];
    const flush = () => {
      while (run.length && isRest(run[0])) run.shift();
      while (run.length && isRest(run[run.length - 1])) run.pop();
      if (run.some(date => weekday(date) >= 1 && weekday(date) <= 5 && !isRest(date))) {
        conges.push({ from: run[0], to: run[run.length - 1] });
      }
      run = [];
    };
    for (const d of list) {
      if (absent.has(d.date)) run.push(d.date);
      else if (workDates.has(d.date)) flush();
    }
    flush();

    return { work, conges, restDays, first: list[0]?.date, last: list[list.length - 1]?.date };
  }

  const KIND = {
    perm: { title: 'Permanence', start: 'start', end: 'permEnd' },
    full: { title: 'Travail', start: 'start', end: 'end' },
    morning: { title: 'Travail', start: 'start', end: 'morningEnd' },
    afternoon: { title: 'Travail', start: 'afternoonStart', end: 'end' },
    afternoonPerm: { title: 'Permanence', start: 'afternoonStart', end: 'permEnd' },
  };

  function planToEvents(plan, hours, fromDate) {
    const base = {
      category: 'pro', notes: null, location: null, is_private: false,
      recurrence: 'none', recurrence_until: null, import_key: IMPORT_KEY,
    };
    const events = [];
    for (const w of plan.work) {
      if (w.date < fromDate) continue;
      const k = KIND[w.kind];
      events.push({
        ...base, title: k.title, all_day: false,
        start_at: localDateTime(w.date, hours[k.start]).toISOString(),
        end_at: localDateTime(w.date, hours[k.end]).toISOString(),
      });
    }
    for (const c of plan.conges) {
      if (c.to < fromDate) continue;
      const from = c.from < fromDate ? fromDate : c.from;
      events.push({
        ...base, title: 'Congés', all_day: true,
        start_at: localDateTime(from).toISOString(),
        end_at: localDateTime(addDaysIso(c.to, 1)).toISOString(),
      });
    }
    return events;
  }

  window.PlanningImport = {
    IMPORT_KEY,
    DEFAULT_HOURS: { start: '08:30', end: '17:00', permEnd: '18:00', morningEnd: '12:00', afternoonStart: '13:30' },
    nameKey,
    readWorkbook,
    buildPlan,
    planToEvents,
    localDateTime,
    addDaysIso,
  };
})();
