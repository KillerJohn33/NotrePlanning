/* Notre Planning — programmes de sport à la télé.
   Lancé par .github/workflows/sport-tv.yml (deux fois par jour) et, avec --if-changed, par la
   tâche des notifications toutes les 10 min (seulement si quelqu'un vient de changer ses choix).

   Pour chaque personne ayant enregistré des mots-clés (tvPrefs/{uid} : keywords, channels,
   live_only, hidden), le guide des programmes XMLTV (xmltvfr.fr, chaînes françaises, ~5 jours)
   est parcouru et les programmes sportifs correspondants sont écrits dans tvEvents, visibles
   par leur seul propriétaire. Les programmes disparus du guide sont retirés ; ceux masqués
   dans l'app (hidden) ne reviennent pas. */
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const admin = require('firebase-admin');

const XMLTV_URL = process.env.XMLTV_URL || 'https://xmltvfr.fr/xmltv/xmltv.xml.gz';
const MIN_MINUTES = 20;          // ignore les brèves (« Tout le sport »…)
const KEEP_PAST_DAYS = 30;       // les programmes passés sont effacés au-delà
const MAX_PER_USER = 300;

const onlyIfChanged = process.argv.includes('--if-changed');

/* Texte ------------------------------------------------------------------------------ */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ENTITIES[e] ?? m))
  .trim();
// Minuscules sans accents ni ponctuation, entourées d'espaces : « PSG » trouve « Paris - PSG ».
const norm = s => ` ${String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim()} `;
const has = (text, kw) => text.includes(` ${norm(kw).trim()} `);

const SPORT = /\b(sports?|sportif|sportive|football|foot|rugby|tennis|cyclisme|velo|basket\w*|handball|volley\w*|formule|f1|automobile|moto\w*|rallye|golf|athletisme|natation|ski|biathlon|boxe|judo|lutte|equitation|hippisme|voile|olympiques?|paralympiques?|hockey|patinage|escrime|triathlon|nfl|nba|mma|ufc|catch|flechettes|snooker|petanque|marathon|tour de france|ligue|coupe du monde|championnat|grand prix|match)\b/;
const REPLAY = /\b(rediffusion|rediff|replay|resume|resumes|best of|highlights|temps forts)\b/;

// « 20260930203000 +0200 » -> Date
function parseTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(s || '');
  if (!m) return null;
  const tz = m[7] || '+0000';
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}${tz.slice(0, 3)}:${tz.slice(3)}`);
}
const attr = (tag, name) => decode((new RegExp(`\\b${name}="([^"]*)"`).exec(tag) || [])[1] || '');
const inner = (xml, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decode(m[1]) : ''; };
const inners = (xml, name) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map(m => decode(m[1]));

/* Guide XMLTV, lu au fil de l'eau (le fichier complet fait plusieurs centaines de Mo) ----- */
async function readGuide(onChannel, onProgramme) {
  const res = await fetch(XMLTV_URL, { headers: { 'User-Agent': 'NotrePlanning (github.com/killerjohn33/NotrePlanning)' } });
  if (!res.ok) throw new Error(`Guide TV indisponible (${res.status})`);
  let stream = Readable.fromWeb(res.body);
  if (/\.gz($|\?)/.test(XMLTV_URL)) stream = stream.pipe(zlib.createGunzip());
  stream.setEncoding('utf8');
  let buf = '';
  const ELEMENT = /<(channel|programme)\b[\s\S]*?<\/\1>/g;
  for await (const chunk of stream) {
    buf += chunk;
    let m, last = 0;
    ELEMENT.lastIndex = 0;
    while ((m = ELEMENT.exec(buf))) {
      (m[1] === 'channel' ? onChannel : onProgramme)(m[0]);
      last = ELEMENT.lastIndex;
    }
    buf = buf.slice(last);
    // Garde-fou : un élément mal fermé ne doit pas faire grossir le tampon sans fin.
    if (buf.length > 5e6) buf = buf.slice(buf.lastIndexOf('<'));
  }
}

/* Firestore ---------------------------------------------------------------------------- */
async function commitAll(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}

let db;
async function main() {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  db = admin.firestore();
  const now = new Date();

  const prefs = (await db.collection('tvPrefs').get()).docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const changed = p => !p.last_run || (p.updated_at && p.updated_at.toMillis() > p.last_run.toMillis());
  const todo = prefs.filter(p => !onlyIfChanged || changed(p));
  if (!todo.length) return console.log('Sport TV : rien à mettre à jour');

  const users = todo.map(p => ({
    ...p,
    keywords: (p.keywords || []).filter(k => norm(k).trim()),
    channels: (p.channels || []).map(c => norm(c).trim()).filter(Boolean),
    hidden: new Set(p.hidden || []),
    found: new Map(),
  }));
  const active = users.filter(u => u.keywords.length);

  let coverageEnd = now;
  let error = null;
  if (active.length) {
    const channels = new Map();
    try {
      await readGuide(
        xml => { const id = attr(xml, 'id'); channels.set(id, inner(xml, 'display-name') || id); },
        xml => {
          const start = parseTime(attr(xml, 'start'));
          const end = parseTime(attr(xml, 'stop'));
          if (!start || !end || end <= now || end - start < MIN_MINUTES * 60e3) return;
          if (start > coverageEnd) coverageEnd = start;
          const title = inner(xml, 'title');
          const sub = inner(xml, 'sub-title');
          const cats = inners(xml, 'category');
          const text = norm(`${title} ${sub}`);
          if (!SPORT.test(norm(`${title} ${sub} ${cats.join(' ')}`))) return;
          const replay = /<previously-shown\b/.test(xml) || REPLAY.test(text);
          const channel = channels.get(attr(xml, 'channel')) || attr(xml, 'channel').replace(/\.\w+$/, '');
          for (const u of active) {
            if (u.live_only !== false && replay) continue;
            if (u.channels.length && !u.channels.some(c => has(norm(channel), c))) continue;
            const kw = u.keywords.find(k => has(text, k));
            if (!kw) continue;
            // Même programme sur plusieurs chaînes à la même heure : un seul événement.
            const id = crypto.createHash('sha1').update(`${u.id}|${start.toISOString()}|${text}`).digest('hex').slice(0, 20);
            if (u.hidden.has(id)) continue;
            const prev = u.found.get(id);
            if (prev) { if (!prev.channels.includes(channel)) prev.channels.push(channel); continue; }
            u.found.set(id, {
              title: (sub && !norm(title).includes(norm(sub)) ? `${title} — ${sub}` : title).slice(0, 200),
              channels: [channel], start, end, keyword: kw,
              sport: cats.find(c => !/^sports?$/i.test(c)) || cats[0] || 'Sport',
              desc: inner(xml, 'desc').slice(0, 600) || null,
            });
          }
        });
    } catch (err) {
      error = err.message;
      console.error(err);
    }
  }

  const ts = admin.firestore.Timestamp;
  for (const u of users) {
    const existing = (await db.collection('tvEvents').where('owner_id', '==', u.id).get()).docs;
    const ops = [];
    const oldLimit = new Date(now.getTime() - KEEP_PAST_DAYS * 864e5).toISOString();
    if (!error) {
      const keep = new Set([...u.found.keys()]);
      for (const d of existing) {
        const s = d.data().start_at;
        // Futur et couvert par le guide mais plus trouvé (mots-clés changés, programme retiré) ;
        // ou trop ancien : on efface.
        const covered = !u.keywords.length || s <= coverageEnd.toISOString();
        if ((s >= now.toISOString() && covered && !keep.has(d.id)) || s < oldLimit) {
          ops.push(b => b.delete(d.ref));
        }
      }
      const found = [...u.found.entries()].sort((a, b) => a[1].start - b[1].start).slice(0, MAX_PER_USER);
      for (const [id, p] of found) {
        ops.push(b => b.set(db.collection('tvEvents').doc(id), {
          owner_id: u.id, title: p.title, channel: p.channels.join(' · ').slice(0, 200),
          start_at: p.start.toISOString(), end_at: p.end.toISOString(),
          sport: String(p.sport).slice(0, 60), keyword: p.keyword, desc: p.desc,
          updated_at: ts.fromDate(now),
        }));
      }
      const status = { last_run: ts.fromDate(now), last_count: found.length, last_error: null };
      // Programmes masqués : seuls les plus récents restent utiles.
      if (u.hidden.size > 300) status.hidden = [...u.hidden].slice(-300);
      ops.push(b => b.set(u.ref, status, { merge: true }));
    } else {
      ops.push(b => b.set(u.ref, { last_run: ts.fromDate(now), last_error: error.slice(0, 200) }, { merge: true }));
    }
    await commitAll(ops);
    console.log(`Sport TV : ${u.id.slice(0, 6)}… ${error ? 'échec' : `${u.found.size} programme(s)`}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
