/* Notre Planning — calendriers sportifs suivis (⚙ Réglages → Sport à suivre).
   Lancé chaque jour par .github/workflows/sport.yml : écrit sport.json à la racine du site,
   que l'app lit directement (aucune donnée personnelle, aucune clé nécessaire).

   - FC Barcelone (équipe masculine) : calendrier ESPN, toutes compétitions ;
   - Formule 1 : Grands Prix de la saison (API Jolpica, successeur d'Ergast). */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'sport.json');
const BARCA_ESPN_ID = 83;
// Compétitions interrogées (le calendrier ESPN d'une équipe est donné par compétition).
const BARCA_LEAGUES = {
  'esp.1': 'LaLiga', 'uefa.champions': 'Ligue des champions', 'esp.copa_del_rey': 'Coupe du Roi',
  'esp.super_cup': 'Supercoupe d’Espagne', 'club.friendly': 'Match amical',
};
const KEEP_PAST_DAYS = 45;

const HOUR = 3600e3;
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'NotrePlanning (github.com/KillerJohn33/NotrePlanning)' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// Noms d'équipes en français quand ils diffèrent vraiment.
const TEAM_FR = { Barcelona: 'FC Barcelone', 'Real Madrid': 'Real Madrid', 'Atletico Madrid': 'Atlético de Madrid', 'Bayern Munich': 'Bayern Munich' };
const teamName = t => TEAM_FR[t.displayName] || t.displayName || t.name || '?';

async function barca() {
  const events = new Map();
  let ok = 0;
  for (const [league, label] of Object.entries(BARCA_LEAGUES)) {
    let data;
    try {
      data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${BARCA_ESPN_ID}/schedule?fixture=true`);
      ok++;
    } catch (err) {
      console.warn(`Barça ${league} : ${err.message}`);
      continue;
    }
    // ?fixture=true : matchs à venir ; sans : matchs joués (utiles pour revoir les dates passées).
    let played = { events: [] };
    try { played = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${BARCA_ESPN_ID}/schedule`); } catch { /* facultatif */ }
    for (const ev of [...(data.events || []), ...(played.events || [])]) {
      const comp = ev.competitions?.[0];
      const teams = comp?.competitors || [];
      const home = teams.find(c => c.homeAway === 'home')?.team;
      const away = teams.find(c => c.homeAway === 'away')?.team;
      if (!ev.date || !home || !away) continue;
      const start = new Date(ev.date);
      const timeKnown = comp.timeValid !== false;
      const score = teams.every(c => c.score?.displayValue != null) && comp.status?.type?.completed
        ? ` (${teams.find(c => c.homeAway === 'home').score.displayValue}-${teams.find(c => c.homeAway === 'away').score.displayValue})` : '';
      events.set(`barca-${ev.id}`, {
        id: `barca-${ev.id}`, kind: 'barca',
        title: `${teamName(home)} – ${teamName(away)}${score}`,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 2 * HOUR).toISOString(),
        all_day: !timeKnown,
        location: comp.venue?.fullName || null,
        detail: label,
      });
    }
  }
  if (!ok) throw new Error('calendrier du FC Barcelone indisponible');
  return [...events.values()];
}

async function f1() {
  const year = new Date().getFullYear();
  const out = [];
  // Saison en cours, et la suivante dès qu'elle est publiée (fin d'année).
  for (const season of [year, year + 1]) {
    let races;
    try {
      races = (await getJson(`https://api.jolpi.ca/ergast/f1/${season}.json?limit=100`)).MRData.RaceTable.Races;
    } catch (err) {
      if (season === year) throw err;
      continue;
    }
    for (const r of races) {
      const at = s => (s?.date ? new Date(`${s.date}T${s.time || '12:00:00Z'}`) : null);
      const start = at(r);
      const fmt = d => d.toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      const extra = [
        r.Qualifying && `Qualifications : ${fmt(at(r.Qualifying))}`,
        r.Sprint && `Course sprint : ${fmt(at(r.Sprint))}`,
      ].filter(Boolean);
      out.push({
        id: `f1-${r.season}-${r.round}`, kind: 'f1',
        title: `F1 · ${r.raceName}`,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 2 * HOUR).toISOString(),
        all_day: !r.time,
        location: [r.Circuit?.circuitName, r.Circuit?.Location?.locality, r.Circuit?.Location?.country].filter(Boolean).join(', ') || null,
        detail: [`Manche ${r.round} · ${r.raceName}`, ...extra].join('\n'),
      });
    }
  }
  return out;
}

async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { events: [] };
  const limit = new Date(Date.now() - KEEP_PAST_DAYS * 864e5).toISOString();
  const errors = [];
  const results = {};
  for (const [kind, fn] of [['barca', barca], ['f1', f1]]) {
    try {
      results[kind] = await fn();
    } catch (err) {
      console.error(`${kind} : ${err.message}`);
      errors.push(kind);
      results[kind] = prev.events.filter(e => e.kind === kind); // on garde l'ancienne version
    }
  }
  const events = Object.values(results).flat()
    .filter(e => e.end_at >= limit)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const same = JSON.stringify(events) === JSON.stringify(prev.events);
  if (!same) fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), events }, null, 1) + '\n');
  console.log(`Barça : ${results.barca.length} match(s) · F1 : ${results.f1.length} Grand(s) Prix${same ? ' · inchangé' : ''}`);
  if (errors.length === 2) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
