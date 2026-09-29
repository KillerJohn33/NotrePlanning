/* Couche de données : Supabase si config.js est rempli, sinon mode démo local.
   Les deux implémentations exposent la même interface (window.PlanningStore). */
(() => {
  'use strict';
  const cfg = window.PLANNING_CONFIG || {};
  const EVENT_FIELDS = ['title', 'notes', 'location', 'start_at', 'end_at', 'all_day', 'category',
    'is_private', 'recurrence', 'recurrence_until'];
  const pick = ev => Object.fromEntries(EVENT_FIELDS.map(k => [k, ev[k] ?? null]));

  function createSupabaseStore() {
    if (!window.supabase) throw new Error('Impossible de charger Supabase (connexion internet ?).');
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const redirectTo = location.origin + location.pathname;
    let userId = null;
    const check = ({ data, error }) => { if (error) throw error; return data; };

    return {
      mode: 'supabase',
      async getUser() {
        const { data } = await sb.auth.getSession();
        const user = data.session?.user ?? null;
        userId = user?.id ?? null;
        return user;
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event, session) => {
          userId = session?.user?.id ?? null;
          // Ne pas appeler Supabase directement dans ce callback (risque de blocage).
          setTimeout(() => cb(event, session?.user ?? null), 0);
        });
      },
      async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password, name) {
        const data = check(await sb.auth.signUp({
          email, password, options: { data: { display_name: name }, emailRedirectTo: redirectTo },
        }));
        return { needsConfirmation: !data.session };
      },
      async resetPassword(email) { check(await sb.auth.resetPasswordForEmail(email, { redirectTo })); },
      async updatePassword(password) { check(await sb.auth.updateUser({ password })); },
      async signOut() { await sb.auth.signOut(); },

      async getProfiles() {
        const rows = check(await sb.from('profiles').select('id, display_name, color, household_id'));
        return {
          me: rows.find(r => r.id === userId) || null,
          partner: rows.find(r => r.id !== userId) || null,
        };
      },
      async getHousehold() {
        const rows = check(await sb.from('households').select('id, invite_code'));
        return rows[0] || null;
      },
      async updateMe(patch) { check(await sb.from('profiles').update(patch).eq('id', userId)); },
      async createHousehold() { return check(await sb.rpc('create_household')); },
      async joinHousehold(code) { check(await sb.rpc('join_household', { p_code: code.trim().toUpperCase() })); },
      async leaveHousehold() { check(await sb.rpc('leave_household')); },

      async listEvents(from, to) {
        return check(await sb.rpc('list_events', { p_from: from.toISOString(), p_to: to.toISOString() }));
      },
      async saveEvent(ev) {
        const row = pick(ev);
        if (ev.id) check(await sb.from('events').update(row).eq('id', ev.id));
        else check(await sb.from('events').insert(row));
      },
      async deleteEvent(id) { check(await sb.from('events').delete().eq('id', id)); },
      subscribe(cb) {
        const channel = sb.channel('events-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, cb)
          .subscribe();
        return () => sb.removeChannel(channel);
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
        events: [
          ev('me', { title: 'Travail', category: 'pro', start_at: at(0, 9), end_at: at(0, 17, 30), recurrence: 'weekdays', location: 'Bureau' }),
          ev('me', { title: 'Réunion d’équipe', category: 'pro', start_at: at(1, 14), end_at: at(1, 15), recurrence: 'weekly' }),
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
          });
      },
      async saveEvent(ev) {
        if (ev.id) {
          const i = db.events.findIndex(e => e.id === ev.id);
          if (i < 0) throw new Error('Événement introuvable');
          const cur = db.events[i];
          if (cur.owner_id !== 'me' && cur.category !== 'commun') throw new Error('Action non autorisée');
          db.events[i] = { ...cur, ...pick(ev) };
        } else {
          db.events.push({ id: uid(), owner_id: 'me', ...pick(ev) });
        }
        persist();
      },
      async deleteEvent(id) {
        db.events = db.events.filter(e => e.id !== id);
        persist();
      },
      subscribe(cb) {
        const onStorage = e => { if (e.key === KEY) { db = load(); cb(); } };
        addEventListener('storage', onStorage);
        return () => removeEventListener('storage', onStorage);
      },
    };
  }

  const useSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  try {
    window.PlanningStore = useSupabase ? createSupabaseStore() : createDemoStore();
  } catch (err) {
    window.PlanningStoreError = err;
  }
})();
