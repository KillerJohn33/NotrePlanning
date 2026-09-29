/* Configuration web du projet Firebase (Console Firebase > Paramètres du projet > Vos applications).
   Mettre `firebase: null` repasse l'app en mode démo local.
   Ces valeurs ne sont pas secrètes : la sécurité repose sur firestore.rules. */
window.PLANNING_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBXPx05gGwWfVgDzDMsxogDDhPanXUb10c',
    authDomain: 'notreplanning-1ee70.firebaseapp.com',
    projectId: 'notreplanning-1ee70',
    storageBucket: 'notreplanning-1ee70.firebasestorage.app',
    messagingSenderId: '898356784433',
    appId: '1:898356784433:web:a1fd380650c1a138a09410',
  },
  // Clé publique VAPID des notifications (la clé privée est un secret du dépôt GitHub).
  vapidPublicKey: 'BEWcivnndq5VWyJH1ZTBaZSApExFZrIU6A0mwgNaAPzW11Rc0wdsPbiYX_eGB8gFeMtBnR9yiGQQoKhpN--SoUc',
};
