/* Notre Planning — envoi des notifications.
   Lancé toutes les 10 min par .github/workflows/notifications.yml, avec TZ=Europe/Paris
   (les dates « locales » ci-dessous sont donc à l'heure de Paris).

   Trois types, selon les préférences de chacun (users/{uid}.notif) :
   - reminders   : rappel `reminderMin` minutes avant ses rendez-vous perso et communs ;
   - partner     : quand l'autre ajoute ou modifie un événement commun ;
   - morning     : résumé de la journée à 7h.
   Les notifications partent vers chaque appareil abonné (pushSubs), en Web Push (VAPID).
   Pour ne rien envoyer deux fois, notifMeta/state mémorise le dernier passage. */
'use strict';

const admin = require('firebase-admin');
const webpush = require('web-push');

const APP_URL = 'https://killerjohn33.github.io/NotrePlanning/';
const MAX_CATCH_UP = 30 * 60e3;   // on ne rattrape pas plus de 30 min de retard (évite les rafales)
const MORNING_HOUR = 7;
const MORNING_LAST_HOUR = 10;     // si GitHub a pris du retard, le résumé part quand même avant 10h
const FREE_WINDOW = [7 * 60, 23 * 60];
const FREE_MIN = 60;

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
webpush.setVapidDetails(APP_URL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

/* Dates (heure de Paris grâce à TZ) ----------------------------------------------- */
const pad = n => String(n).padStart(2, '0');
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => `${d.getHours()}h${d.getMinutes() ? pad(d.getMinutes()) : ''}`;
const fmtMin = m => `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`;
const fmtDay = d => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const clockMin = (date, day) => (date <= day ? 0 : date >= addDays(day, 1) ? 1440 : date.getHours() * 60 + date.getMinutes());

// Mêmes règles de répétition que l'application (app.js › occurrences).
function occurrences(ev, from, to) {
  const start = new Date(ev.start_at);
  const end = new Date(ev.end_at);
  const dur = end - start;
  if (!ev.recurrence || ev.recurrence === 'none') return end > from && start < to ? [{ ev, start, end }] : [];
  const until = ev.recurrence_until ? addDays(new Date(`${ev.recurrence_until}T00:00:00`), 1) : null;
  const stepDays = { daily: 1, weekdays: 1, weekly: 7 }[ev.recurrence];
  let i = stepDays
    ? Math.max(0, Math.floor((from - start - dur) / (stepDays * 864e5)) - 1)
    : Math.max(0, (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth() - 2);
  const out = [];
  for (let guard = 0; guard < 1000; guard++, i++) {
    let s;
    if (stepDays) s = addDays(start, i * stepDays);
    else {
      s = new Date(start.getFullYear(), start.getMonth() + i, start.getDate(), start.getHours(), start.getMinutes());
      if (s.getDate() !== start.getDate()) continue;
    }
    if (s >= to || (until && s >= until)) break;
    if (ev.recurrence === 'weekdays' && (s.getDay() === 0 || s.getDay() === 6)) continue;
    const e = new Date(s.getTime() + dur);
    if (e > from) out.push({ ev, start: s, end: e });
  }
  return out;
}

function freeTogether(occ, day) {
  const busy = occ
    .filter(o => !o.ev.all_day && o.start < addDays(day, 1) && o.end > day)
    .map(o => [clockMin(o.start, day), clockMin(o.end, day)])
    .sort((a, b) => a[0] - b[0]);
  let [cur, windowEnd] = FREE_WINDOW;
  const free = [];
  for (const [s, e] of busy) {
    if (s >= windowEnd) break;
    if (s - cur >= FREE_MIN) free.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (windowEnd - cur >= FREE_MIN) free.push([cur, windowEnd]);
  return free;
}

async function main() {
  const now = new Date();
  const metaRef = db.doc('notifMeta/state');
  const meta = (await metaRef.get()).data() || {};
  const last = new Date(Math.max(meta.lastRun ? meta.lastRun.toMillis() : now - 10 * 60e3, now - MAX_CATCH_UP));

  const users = new Map((await db.collection('users').get()).docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const subs = new Map();
  for (const d of (await db.collection('pushSubs').get()).docs) {
    const s = d.data();
    if (!subs.has(s.owner_id)) subs.set(s.owner_id, []);
    subs.get(s.owner_id).push({ ref: d.ref, subscription: s.subscription });
  }
  const wants = (u, key) => subs.has(u.id) && u.notif && u.notif[key] === true;
  const partnerOf = u => {
    const p = u.partner_id && users.get(u.partner_id);
    return p && p.partner_id === u.id ? p : null;
  };

  // Événements utiles : ceux qui commencent entre hier et demain, plus tous les répétés.
  const today = startOfDay(now);
  const horizon = addDays(today, 2);
  const events = new Map();
  const [near, repeated] = await Promise.all([
    db.collection('events').where('start_at', '>=', addDays(today, -1).toISOString()).where('start_at', '<', horizon.toISOString()).get(),
    db.collection('events').where('recurrence', '!=', 'none').get(),
  ]);
  for (const d of [...near.docs, ...repeated.docs]) events.set(d.id, { id: d.id, ...d.data() });

  // Titres des événements privés (connus seulement de leur auteur, à qui on les envoie).
  const secretTitle = new Map();
  const privateIds = [...events.values()].filter(e => e.is_private).map(e => e.id);
  if (privateIds.length) {
    const refs = privateIds.map(id => db.doc(`eventSecrets/${id}`));
    for (const s of await db.getAll(...refs)) if (s.exists) secretTitle.set(s.id, s.data().title);
  }
  const titleOf = ev => (ev.is_private ? secretTitle.get(ev.id) || 'Événement privé' : ev.title);

  const outbox = [];
  const occ = [...events.values()].flatMap(ev => occurrences(ev, addDays(today, -1), horizon));

  // 1. Rappels avant les rendez-vous perso et communs (pas les créneaux de travail).
  for (const u of users.values()) {
    if (!wants(u, 'reminders')) continue;
    const lead = (Number(u.notif.reminderMin) || 30) * 60e3;
    const partner = partnerOf(u);
    for (const o of occ) {
      const ev = o.ev;
      if (ev.all_day || ev.category === 'pro') continue;
      const concerns = ev.owner_id === u.id || (ev.category === 'commun' && partner && ev.owner_id === partner.id);
      if (!concerns) continue;
      const at = o.start.getTime() - lead;
      if (at <= last.getTime() || at > now.getTime()) continue;
      outbox.push({
        uid: u.id,
        title: titleOf(ev),
        body: `À ${fmtTime(o.start)}${ev.location && !ev.is_private ? ` · ${ev.location}` : ''} (dans ${Math.round(lead / 60e3)} min)`,
        tag: `rappel-${ev.id}-${o.start.getTime()}`,
      });
    }
  }

  // 2. L'autre a ajouté ou modifié un événement commun.
  const changed = await db.collection('events')
    .where('updated_at', '>', admin.firestore.Timestamp.fromDate(last))
    .where('updated_at', '<=', admin.firestore.Timestamp.fromDate(now)).get();
  for (const d of changed.docs) {
    const ev = { id: d.id, ...d.data() };
    if (ev.category !== 'commun' || !ev.updated_by) continue;
    const editor = users.get(ev.updated_by);
    const other = editor && partnerOf(editor);
    if (!other || !wants(other, 'partner')) continue;
    const added = d.createTime.toMillis() >= d.updateTime.toMillis() - 3000;
    const start = new Date(ev.start_at);
    outbox.push({
      uid: other.id,
      title: `${editor.display_name || 'Ton/ta partenaire'} a ${added ? 'ajouté' : 'modifié'} un événement commun`,
      body: `${ev.title} — ${fmtDay(start)}${ev.all_day ? '' : ` à ${fmtTime(start)}`}`,
      tag: `commun-${ev.id}`,
    });
  }

  // 3. Résumé du matin, une fois par jour à partir de 7h.
  const morningSent = { ...(meta.morningSent || {}) };
  const hour = now.getHours();
  if (hour >= MORNING_HOUR && hour < MORNING_LAST_HOUR) {
    for (const u of users.values()) {
      if (!wants(u, 'morning') || morningSent[u.id] === dayKey(today)) continue;
      const partner = partnerOf(u);
      const mine = occ
        .filter(o => o.start < addDays(today, 1) && o.end > today)
        .filter(o => o.ev.owner_id === u.id || (o.ev.category === 'commun' && partner && o.ev.owner_id === partner.id))
        .sort((a, b) => (b.ev.all_day - a.ev.all_day) || (a.start - b.start));
      const lines = mine.slice(0, 5).map(o => (o.ev.all_day
        ? `• ${titleOf(o.ev)} (journée)`
        : `• ${o.start < today ? '…' : fmtTime(o.start)}–${fmtTime(o.end)} ${titleOf(o.ev)}`));
      if (mine.length > 5) lines.push(`• … et ${mine.length - 5} autre(s)`);
      if (!lines.length) lines.push('Rien de prévu aujourd’hui.');
      if (partner) {
        const both = occ.filter(o => o.ev.owner_id === u.id || o.ev.owner_id === partner.id);
        const free = freeTogether(both, today);
        if (free.length) lines.push(`Libres ensemble : ${free.map(([a, b]) => `${fmtMin(a)}–${fmtMin(b)}`).join(', ')}`);
      }
      outbox.push({ uid: u.id, title: `Bonjour ${u.display_name || ''} ☀️ Ta journée`.replace('  ', ' '), body: lines.join('\n'), tag: `matin-${dayKey(today)}` });
      morningSent[u.id] = dayKey(today);
    }
  }

  // Envoi à tous les appareils ; les abonnements expirés sont supprimés.
  let sent = 0;
  for (const n of outbox) {
    for (const s of subs.get(n.uid) || []) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: n.title, body: n.body, tag: n.tag, url: APP_URL }), { TTL: 3600 });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await s.ref.delete();
        else console.error('Échec d’envoi', err.statusCode || '', err.body || err.message);
      }
    }
  }

  await metaRef.set({ lastRun: admin.firestore.Timestamp.fromDate(now), morningSent }, { merge: true });
  console.log(`${now.toISOString()} — ${outbox.length} notification(s), ${sent} envoi(s), ${subs.size} utilisateur(s) abonné(s)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
