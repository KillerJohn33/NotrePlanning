/* Couche de données : Firebase si config.js est rempli, sinon mode démo local.
   Les deux implémentations exposent la même interface (window.PlanningStore). */
(() => {
  'use strict';
  const cfg = window.PLANNING_CONFIG || {};
  const EVENT_FIELDS = ['title', 'notes', 'location', 'start_at', 'end_at', 'all_day', 'category',
    'is_private', 'recurrence', 'recurrence_until', 'import_key', 'exdates', 'color', 'reminder'];
  const pick = ev => Object.fromEntries(EVENT_FIELDS.map(k => [k, ev[k] ?? null]));
  // Sport à la télé : réglages par défaut, et programme (tvEvents) présenté comme un événement
  // en lecture seule, de type « tv », visible par son seul propriétaire.
  const TV_DEFAULTS = { keywords: [], channels: [], live_only: true, reminder: 15, hidden: [] };
  const tvRow = t => ({
    id: t.id, owner_id: t.owner_id, is_mine: true, category: 'tv', title: t.title,
    location: t.channel || null, notes: t.desc || null, sport: t.sport || null,
    start_at: t.start_at, end_at: t.end_at, all_day: false, is_private: false,
    recurrence: 'none', recurrence_until: null, import_key: null,
  });

  /* Firebase (Auth + Firestore). Les données des deux personnes sont écoutées en
     temps réel et gardées en mémoire ; listEvents filtre ce cache. Voir firestore.rules. */
  function createFirebaseStore() {
    if (!window.firebase) throw new Error('Impossible de charger Firebase (connexion internet ?).');
    firebase.initializeApp(cfg.firebase);
    const auth = firebase.auth();
    auth.languageCode = 'fr';
    const db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* hors-ligne indisponible : pas grave */ });
    const FieldValue = firebase.firestore.FieldValue;

    const userRef = id => db.collection('users').doc(id);
    const inviteRef = code => db.collection('invites').doc(code);
    const secretRef = id => db.collection('eventSecrets').doc(id);
    const remoteRef = id => db.collection('remoteDays').doc(id);
    const tvPrefsRef = id => db.collection('tvPrefs').doc(id);
    const toMap = snap => new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const onErr = err => console.error(err);

    const listeners = new Set();
    const emit = () => listeners.forEach(fn => fn());

    let uid = null;
    let me = null, partner = null, invite = null;
    let myEvents = new Map(), partnerEvents = new Map(), secrets = new Map();
    let myRemote = [], partnerRemote = [];
    let myItems = new Map(), partnerItems = new Map();
    let tvEvents = new Map(), tvPrefs = null;
    let baseUnsubs = [], partnerUnsub = null, partnerDataUnsubs = null, inviteUnsub = null;
    let watchedPartner = null, watchedInvite = null;
    let pendingName = '';

    const isMutual = () => !!(me?.partner_id && partner && partner.id === me.partner_id && partner.partner_id === uid);

    function stopAll() {
      [...baseUnsubs, partnerUnsub, inviteUnsub].forEach(u => u && u());
      stopPartnerData();
      baseUnsubs = [];
      partnerUnsub = inviteUnsub = null;
      watchedPartner = watchedInvite = null;
      me = partner = invite = null;
      myEvents = new Map(); secrets = new Map(); myRemote = []; myItems = new Map();
      tvEvents = new Map(); tvPrefs = null;
    }

    function watchMine() {
      baseUnsubs.push(
        userRef(uid).onSnapshot(s => { me = s.exists ? { id: s.id, ...s.data() } : null; syncLinks(); emit(); }, onErr),
        db.collection('events').where('owner_id', '==', uid).onSnapshot(s => { myEvents = toMap(s); emit(); }, onErr),
        db.collection('eventSecrets').where('owner_id', '==', uid).onSnapshot(s => { secrets = toMap(s); emit(); }, onErr),
        remoteRef(uid).onSnapshot(s => { myRemote = (s.exists && s.data().dates) || []; emit(); }, onErr),
        db.collection('listItems').where('owner_id', '==', uid).onSnapshot(s => { myItems = toMap(s); emit(); }, onErr),
        db.collection('tvEvents').where('owner_id', '==', uid).onSnapshot(s => { tvEvents = toMap(s); emit(); }, onErr),
        tvPrefsRef(uid).onSnapshot(s => { tvPrefs = s.exists ? s.data() : null; emit(); }, onErr),
      );
    }

    // Suit le profil du partenaire et l'invitation en cours quand ils changent.
    function syncLinks() {
      const pid = me?.partner_id || null;
      if (pid !== watchedPartner) {
        partnerUnsub?.();
        partnerUnsub = null;
        partner = null;
        watchedPartner = pid;
        if (pid) {
          partnerUnsub = userRef(pid).onSnapshot(
            s => { partner = s.exists ? { id: s.id, ...s.data() } : null; syncPartnerEvents(); emit(); },
            () => { partner = null; syncPartnerEvents(); emit(); });
        }
      }
      syncPartnerEvents();

      const code = me?.invite_code || null;
      if (code !== watchedInvite) {
        inviteUnsub?.();
        inviteUnsub = null;
        invite = null;
        watchedInvite = code;
        if (code) {
          inviteUnsub = inviteRef(code).onSnapshot({ includeMetadataChanges: true }, s => {
            invite = s.exists ? s.data() : null;
            if (!s.metadata.fromCache) reconcile();
            emit();
          }, onErr);
        }
      }
    }

    // Le planning (et le télétravail) du partenaire n'est lisible que si la liaison est réciproque.
    function syncPartnerEvents() {
      const ok = isMutual();
      if (ok && !partnerDataUnsubs) {
        const onDenied = () => { stopPartnerData(); emit(); };
        partnerDataUnsubs = [
          db.collection('events').where('owner_id', '==', watchedPartner)
            .onSnapshot(s => { partnerEvents = toMap(s); emit(); }, onDenied),
          remoteRef(watchedPartner)
            .onSnapshot(s => { partnerRemote = (s.exists && s.data().dates) || []; emit(); }, onDenied),
          db.collection('listItems').where('owner_id', '==', watchedPartner)
            .onSnapshot(s => { partnerItems = toMap(s); emit(); }, onDenied),
        ];
      } else if (!ok && partnerDataUnsubs) {
        stopPartnerData();
      }
    }
    function stopPartnerData() {
      partnerDataUnsubs?.forEach(u => u());
      partnerDataUnsubs = null;
      partnerEvents = new Map();
      partnerRemote = [];
      partnerItems = new Map();
    }

    // Finalise ou nettoie la liaison selon l'état (côté serveur) de l'invitation.
    async function reconcile() {
      if (!me || !watchedInvite) return;
      try {
        if (!invite) {
          // Invitation supprimée (l'autre a arrêté le partage) : on se délie aussi.
          if (me.partner_id || me.invite_code) await userRef(uid).update({ partner_id: null, invite_code: null });
        } else if (invite.from === uid && invite.accepted_by && me.partner_id !== invite.accepted_by) {
          await userRef(uid).update({ partner_id: invite.accepted_by });
        }
      } catch (err) { onErr(err); }
    }

    async function ensureProfile(user) {
      const ref = userRef(user.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          display_name: (pendingName || user.email.split('@')[0]).slice(0, 60),
          color: '#3b82f6', partner_id: null, invite_code: null,
        });
      }
    }

    function randomCode() {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % alphabet.length]).join('');
    }

    let resolveFirst;
    const firstAuth = new Promise(res => { resolveFirst = res; });
    const authCallbacks = [];
    auth.onAuthStateChanged(async user => {
      if ((user?.uid ?? null) === uid && uid !== null) return;
      stopAll();
      uid = user?.uid ?? null;
      if (user) {
        try { await ensureProfile(user); } catch (err) { onErr(err); }
        watchMine();
      }
      const u = user ? { id: user.uid, email: user.email } : null;
      resolveFirst(u);
      authCallbacks.forEach(cb => cb(u ? 'SIGNED_IN' : 'SIGNED_OUT', u));
    });

    return {
      mode: 'firebase',
      getUser: () => firstAuth,
      onAuthChange(cb) { authCallbacks.push(cb); },
      async signIn(email, password) { await auth.signInWithEmailAndPassword(email, password); },
      async signUp(email, password, name) {
        pendingName = name;
        await auth.createUserWithEmailAndPassword(email, password);
        return { needsConfirmation: false };
      },
      async resetPassword(email) { await auth.sendPasswordResetEmail(email); },
      async updatePassword(password) { await auth.currentUser.updatePassword(password); },
      async signOut() { await auth.signOut(); },

      async getProfiles() {
        return { me, partner: isMutual() ? partner : null };
      },
      async getHousehold() {
        if (!me?.invite_code && !me?.partner_id) return null;
        const waiting = !isMutual() && !!(me.partner_id || invite?.accepted_by);
        return { invite_code: me.invite_code, waiting };
      },
      async updateMe(patch) { await userRef(uid).update(patch); },

      async createHousehold() {
        if (me?.invite_code) return;
        const code = randomCode();
        await inviteRef(code).set({ from: uid, accepted_by: null, created_at: FieldValue.serverTimestamp() });
        await userRef(uid).update({ invite_code: code });
      },
      async joinHousehold(raw) {
        const code = raw.trim().toUpperCase();
        const snap = code ? await inviteRef(code).get() : null;
        if (!snap?.exists) throw new Error('Code d’invitation invalide');
        const inv = snap.data();
        if (inv.from === uid) throw new Error('C’est ton propre code : envoie-le à l’autre personne.');
        if (inv.accepted_by && inv.accepted_by !== uid) throw new Error('Ce code a déjà été utilisé.');
        // Abandonne sa propre invitation en attente, s'il y en a une.
        if (me?.invite_code && me.invite_code !== code) {
          await inviteRef(me.invite_code).delete().catch(() => {});
        }
        if (!inv.accepted_by) await inviteRef(code).update({ accepted_by: uid });
        await userRef(uid).update({ partner_id: inv.from, invite_code: code });
      },
      async leaveHousehold() {
        const code = me?.invite_code;
        await userRef(uid).update({ partner_id: null, invite_code: null });
        if (code) await inviteRef(code).delete().catch(() => {});
      },

      async listEvents(from, to) {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const rows = [];
        const add = (e, mine) => {
          if (!(e.start_at < toIso && (e.end_at > fromIso || e.recurrence !== 'none'))) return;
          const secret = mine && e.is_private ? secrets.get(e.id) : null;
          rows.push({
            ...e,
            is_mine: mine,
            title: e.is_private ? (mine ? secret?.title || '(privé)' : 'Occupé') : e.title,
            notes: e.is_private ? secret?.notes ?? null : e.notes,
            location: e.is_private ? secret?.location ?? null : e.location,
          });
        };
        myEvents.forEach(e => add(e, true));
        if (isMutual()) partnerEvents.forEach(e => add(e, false));
        tvEvents.forEach(t => { if (t.start_at < toIso && t.end_at > fromIso) rows.push(tvRow(t)); });
        return rows;
      },
      async saveEvent(ev) {
        const row = pick(ev);
        const ref = ev.id ? db.collection('events').doc(ev.id) : db.collection('events').doc();
        const existing = ev.id ? myEvents.get(ev.id) || partnerEvents.get(ev.id) : null;
        const doc = {
          ...row,
          import_key: existing ? existing.import_key ?? null : row.import_key,
          owner_id: existing ? existing.owner_id : uid,
          updated_at: FieldValue.serverTimestamp(), updated_by: uid,
        };
        const batch = db.batch();
        if (row.is_private) {
          // Le titre, le lieu et les notes partent dans eventSecrets, invisible pour l'autre.
          batch.set(secretRef(ref.id), { owner_id: uid, title: row.title, notes: row.notes, location: row.location });
          Object.assign(doc, { title: '', notes: null, location: null });
        } else if (secrets.has(ref.id)) {
          batch.delete(secretRef(ref.id));
        }
        batch.set(ref, doc);
        await batch.commit();
      },
      async deleteEvent(id) {
        const batch = db.batch();
        batch.delete(db.collection('events').doc(id));
        if (secrets.has(id)) batch.delete(secretRef(id));
        await batch.commit();
      },
      // Jours de télétravail : liste de dates "AAAA-MM-JJ" par personne.
      async getRemoteDays() {
        return { me: new Set(myRemote), partner: new Set(isMutual() ? partnerRemote : []) };
      },
      // Sport à la télé (tvPrefs/{uid}) : les programmes sont cherchés par notifier/sport-tv.js.
      getTvPrefs() {
        const p = { ...TV_DEFAULTS, ...(tvPrefs || {}) };
        return { ...p, last_run: tvPrefs?.last_run?.toDate?.() || null, saved: !!tvPrefs };
      },
      async saveTvPrefs({ keywords, channels, live_only, reminder }) {
        await tvPrefsRef(uid).set({
          keywords, channels, live_only, reminder, updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      },
      // Masquer un programme : il est effacé et ne sera pas réimporté.
      async hideTvEvent(id) {
        const batch = db.batch();
        batch.set(tvPrefsRef(uid), { ...TV_DEFAULTS, ...(tvPrefs || {}), hidden: FieldValue.arrayUnion(id) }, { merge: true });
        batch.delete(db.collection('tvEvents').doc(id));
        await batch.commit();
      },
      async setRemoteDays(dates) { await remoteRef(uid).set({ dates }); },
      // Abonnement aux notifications de cet appareil (lu par la tâche d'envoi GitHub Actions).
      async savePushSub(id, subscription, ua) {
        await db.collection('pushSubs').doc(id).set({ owner_id: uid, subscription, ua, created_at: FieldValue.serverTimestamp() });
      },
      async deletePushSub(id) { await db.collection('pushSubs').doc(id).delete().catch(() => {}); },
      countImported(key, from, to) {
        const [a, b] = [from.toISOString(), to.toISOString()];
        return [...myEvents.values()].filter(e => e.import_key === key && e.start_at >= a && e.start_at < b).length;
      },
      // Horaires placés sur plusieurs jours : supprime puis crée des créneaux en lots.
      async applyShifts(deleteIds, events) {
        const ops = [
          ...deleteIds.filter(id => myEvents.has(id)).map(id => batch => batch.delete(db.collection('events').doc(id))),
          ...events.map(ev => batch => batch.set(db.collection('events').doc(), {
            ...pick(ev), owner_id: uid, updated_at: FieldValue.serverTimestamp(), updated_by: uid,
          })),
        ];
        for (let i = 0; i < ops.length; i += 400) {
          const batch = db.batch();
          ops.slice(i, i + 400).forEach(op => op(batch));
          await batch.commit();
        }
      },
      // Restauration d'une sauvegarde : création groupée (les privés gardent leurs détails à part).
      async bulkCreate(events) {
        for (let i = 0; i < events.length; i += 200) {
          const batch = db.batch();
          for (const ev of events.slice(i, i + 200)) {
            const ref = db.collection('events').doc();
            const doc = { ...pick(ev), owner_id: uid, updated_at: FieldValue.serverTimestamp(), updated_by: uid };
            if (doc.is_private) {
              batch.set(secretRef(ref.id), { owner_id: uid, title: doc.title, notes: doc.notes, location: doc.location });
              Object.assign(doc, { title: '', notes: null, location: null });
            }
            batch.set(ref, doc);
          }
          await batch.commit();
        }
      },
      // Liste partagée (courses, tâches) : les éléments des deux membres reliés.
      getListItems() {
        const all = [...myItems.values()].map(i => ({ ...i, is_mine: true }));
        if (isMutual()) partnerItems.forEach(i => all.push({ ...i, is_mine: false }));
        return all;
      },
      async saveListItem(item) {
        const ref = item.id ? db.collection('listItems').doc(item.id) : db.collection('listItems').doc();
        const existing = item.id ? myItems.get(item.id) || partnerItems.get(item.id) : null;
        await ref.set({
          owner_id: existing ? existing.owner_id : uid,
          list: item.list, text: item.text, done: !!item.done,
          assignee: item.assignee || null, due: item.due || null,
          created_at: existing?.created_at || FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(), updated_by: uid,
        });
      },
      async deleteListItems(ids) {
        const batch = db.batch();
        ids.forEach(id => batch.delete(db.collection('listItems').doc(id)));
        await batch.commit();
      },
      // Remplace les événements importés de la période par la nouvelle liste (lots de 400 écritures max).
      async replaceImported(key, from, to, events) {
        const [a, b] = [from.toISOString(), to.toISOString()];
        const stale = [...myEvents.values()].filter(e => e.import_key === key && e.start_at >= a && e.start_at < b);
        const ops = [
          ...stale.map(e => batch => batch.delete(db.collection('events').doc(e.id))),
          ...events.map(ev => batch => batch.set(db.collection('events').doc(), {
            ...pick(ev), import_key: key, owner_id: uid, updated_at: FieldValue.serverTimestamp(), updated_by: uid,
          })),
        ];
        for (let i = 0; i < ops.length; i += 400) {
          const batch = db.batch();
          ops.slice(i, i + 400).forEach(op => op(batch));
          await batch.commit();
        }
        return { removed: stale.length, added: events.length };
      },
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
  }

  function createDemoStore() {
    const KEY = 'notre-planning-demo-v1';
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    let db = load();

    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch { /* stockage indisponible : on repart des données d'exemple */ }
      return seed();
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* mode privé */ }
    }
    function seed() {
      const now = new Date();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      const at = (d, h, m = 0) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, h, m).toISOString();
      const day = d => {
        const x = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d);
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      };
      const ev = (owner, o) => ({
        id: uid(), owner_id: owner, notes: null, location: null, all_day: false, is_private: false,
        recurrence: 'none', recurrence_until: null, ...o,
      });
      return {
        profiles: {
          me: { id: 'me', display_name: 'Moi', color: '#3b82f6', household_id: 'demo' },
          partner: { id: 'partner', display_name: 'Ma compagne', color: '#e8590c', household_id: 'demo' },
        },
        household: { id: 'demo', invite_code: 'DEMO2026' },
        tv: {
          prefs: { ...TV_DEFAULTS, keywords: ['Ligue des champions', 'Top 14'], last_count: 2 },
          events: [
            { id: uid(), owner_id: 'me', title: 'Football — Ligue des champions : PSG / Arsenal', channel: 'Canal+',
              sport: 'Football', start_at: at(2, 21), end_at: at(2, 23) },
            { id: uid(), owner_id: 'me', title: 'Rugby — Top 14 : Toulouse / La Rochelle', channel: 'Canal+ Sport',
              sport: 'Rugby', start_at: at(5, 21, 5), end_at: at(5, 23) },
          ],
        },
        remote: { me: [day(2), day(9)], partner: [day(4)] },
        items: [
          { id: uid(), owner_id: 'me', list: 'courses', text: 'Lait', done: false, assignee: null, due: null, created_at: 1 },
          { id: uid(), owner_id: 'partner', list: 'courses', text: 'Pain', done: false, assignee: null, due: null, created_at: 2 },
          { id: uid(), owner_id: 'me', list: 'courses', text: 'Tomates', done: true, assignee: null, due: null, created_at: 3 },
          { id: uid(), owner_id: 'partner', list: 'taches', text: 'Réserver le restaurant', done: false, assignee: 'me', due: day(4), created_at: 4 },
          { id: uid(), owner_id: 'me', list: 'taches', text: 'Payer la crèche', done: false, assignee: 'partner', due: day(8), created_at: 5 },
        ],
        events: [
          ev('me', { title: 'Travail', category: 'pro', start_at: at(0, 9), end_at: at(0, 17, 30), recurrence: 'weekdays', location: 'Bureau' }),
          ev('me', { title: 'Réunion d’équipe', category: 'pro', start_at: at(1, 14), end_at: at(1, 15), recurrence: 'weekly' }),
          ev('me', { title: 'Congés', category: 'pro', all_day: true, start_at: at(16, 0), end_at: at(19, 0) }),
          ev('partner', { title: 'Congés', category: 'pro', all_day: true, start_at: at(14, 0), end_at: at(18, 0) }),
          ev('me', { title: 'Permanence', category: 'pro', start_at: at(3, 8, 30), end_at: at(3, 18), recurrence: 'weekly' }),
          ev('me', { title: 'Sport', category: 'perso', start_at: at(1, 18, 30), end_at: at(1, 20), recurrence: 'weekly' }),
          ev('partner', { title: 'Travail', category: 'pro', start_at: at(0, 7), end_at: at(0, 15), recurrence: 'weekly' }),
          ev('partner', { title: 'Travail', category: 'pro', start_at: at(2, 13), end_at: at(2, 21), recurrence: 'weekly' }),
          ev('partner', { title: 'Travail', category: 'pro', start_at: at(3, 7), end_at: at(3, 15), recurrence: 'weekly' }),
          ev('partner', { title: 'Garde de nuit', category: 'pro', start_at: at(4, 20), end_at: at(5, 8), recurrence: 'weekly' }),
          ev('partner', { title: 'Yoga', category: 'perso', start_at: at(3, 18, 30), end_at: at(3, 19, 30), recurrence: 'weekly' }),
          ev('partner', { title: 'Rendez-vous médical', category: 'perso', is_private: true, start_at: at(1, 12, 30), end_at: at(1, 13, 30) }),
          ev('me', { title: 'Courses', category: 'commun', start_at: at(6, 10), end_at: at(6, 11), recurrence: 'weekly' }),
          ev('partner', { title: 'Dîner en famille', category: 'commun', start_at: at(5, 19, 30), end_at: at(5, 23), location: 'Chez les parents' }),
          ev('me', { title: 'Week-end à la mer', category: 'commun', all_day: true, start_at: at(12, 0), end_at: at(14, 0) }),
        ],
      };
    }
    const partnerLinked = () => !!db.household && db.profiles.partner.household_id === db.household.id;

    return {
      mode: 'demo',
      async getUser() { return { id: 'me', email: 'démo (données locales)' }; },
      onAuthChange() {},
      async signOut() {},
      async resetDemo() { db = seed(); persist(); },

      async getProfiles() {
        return { me: db.profiles.me, partner: partnerLinked() ? db.profiles.partner : null };
      },
      async getHousehold() { return db.household; },
      async updateMe(patch) { Object.assign(db.profiles.me, patch); persist(); },
      async createHousehold() {
        db.household ||= { id: 'demo', invite_code: 'DEMO2026' };
        persist();
        return db.household;
      },
      async joinHousehold(code) {
        if (!code.trim()) throw new Error('Code d’invitation invalide');
        db.household = { id: 'demo', invite_code: code.trim().toUpperCase() };
        db.profiles.partner.household_id = 'demo';
        persist();
      },
      async leaveHousehold() {
        db.household = null;
        db.profiles.partner.household_id = null;
        persist();
      },

      async listEvents(from, to) {
        const linked = partnerLinked();
        return db.events
          .filter(e => (e.owner_id === 'me' || linked) && new Date(e.start_at) < to
            && (new Date(e.end_at) > from || e.recurrence !== 'none'))
          .map(e => {
            const mine = e.owner_id === 'me';
            const hide = !mine && e.is_private;
            return {
              ...e, is_mine: mine,
              title: hide ? 'Occupé' : e.title,
              notes: hide ? null : e.notes,
              location: hide ? null : e.location,
            };
          })
          .concat((db.tv?.events || []).filter(t => new Date(t.start_at) < to && new Date(t.end_at) > from).map(tvRow));
      },
      async saveEvent(ev) {
        if (ev.id) {
          const i = db.events.findIndex(e => e.id === ev.id);
          if (i < 0) throw new Error('Événement introuvable');
          const cur = db.events[i];
          if (cur.owner_id !== 'me' && cur.category !== 'commun') throw new Error('Action non autorisée');
          db.events[i] = { ...cur, ...pick(ev), import_key: cur.import_key ?? null };
        } else {
          db.events.push({ id: uid(), owner_id: 'me', ...pick(ev) });
        }
        persist();
      },
      async deleteEvent(id) {
        db.events = db.events.filter(e => e.id !== id);
        persist();
      },
      async getRemoteDays() {
        return {
          me: new Set(db.remote?.me || []),
          partner: new Set(partnerLinked() ? db.remote?.partner || [] : []),
        };
      },
      async setRemoteDays(dates) {
        db.remote = { ...db.remote, me: dates };
        persist();
      },
      getTvPrefs() {
        return { ...TV_DEFAULTS, ...(db.tv?.prefs || {}), last_run: null, saved: !!db.tv?.prefs, demo: true };
      },
      async saveTvPrefs(p) {
        db.tv ||= { events: [] };
        db.tv.prefs = { ...TV_DEFAULTS, ...db.tv.prefs, ...p };
        persist();
      },
      async hideTvEvent(id) {
        if (!db.tv) return;
        db.tv.events = db.tv.events.filter(t => t.id !== id);
        persist();
      },
      countImported(key, from, to) {
        return db.events.filter(e => e.owner_id === 'me' && e.import_key === key
          && new Date(e.start_at) >= from && new Date(e.start_at) < to).length;
      },
      async applyShifts(deleteIds, events) {
        const del = new Set(deleteIds);
        db.events = db.events.filter(e => !(e.owner_id === 'me' && del.has(e.id)));
        events.forEach(ev => db.events.push({ id: uid(), owner_id: 'me', ...pick(ev) }));
        persist();
      },
      async bulkCreate(events) {
        events.forEach(ev => db.events.push({ id: uid(), owner_id: 'me', ...pick(ev) }));
        persist();
      },
      getListItems() {
        const linked = partnerLinked();
        return (db.items || [])
          .filter(i => i.owner_id === 'me' || linked)
          .map(i => ({ ...i, is_mine: i.owner_id === 'me' }));
      },
      async saveListItem(item) {
        db.items ||= [];
        const i = item.id ? db.items.findIndex(x => x.id === item.id) : -1;
        const row = { list: item.list, text: item.text, done: !!item.done, assignee: item.assignee || null, due: item.due || null };
        if (i >= 0) Object.assign(db.items[i], row);
        else db.items.push({ id: uid(), owner_id: 'me', created_at: Date.now(), ...row });
        persist();
      },
      async deleteListItems(ids) {
        const del = new Set(ids);
        db.items = (db.items || []).filter(x => !del.has(x.id));
        persist();
      },
      async replaceImported(key, from, to, events) {
        const stale = e => e.owner_id === 'me' && e.import_key === key
          && new Date(e.start_at) >= from && new Date(e.start_at) < to;
        const removed = db.events.filter(stale).length;
        db.events = db.events.filter(e => !stale(e));
        events.forEach(ev => db.events.push({ id: uid(), owner_id: 'me', ...pick(ev), import_key: key }));
        persist();
        return { removed, added: events.length };
      },
      subscribe(cb) {
        const onStorage = e => { if (e.key === KEY) { db = load(); cb(); } };
        addEventListener('storage', onStorage);
        return () => removeEventListener('storage', onStorage);
      },
    };
  }

  const useFirebase = !!cfg.firebase?.apiKey;
  try {
    window.PlanningStore = useFirebase ? createFirebaseStore() : createDemoStore();
  } catch (err) {
    window.PlanningStoreError = err;
  }
})();
