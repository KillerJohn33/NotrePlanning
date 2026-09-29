/* Publie firestore.rules dans Firebase s'il diffère des règles en ligne.
   Lancé par .github/workflows/rules.yml (à chaque modification du fichier, ou à la main). */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const rules = admin.securityRules();
  const norm = s => s.replace(/\r\n/g, '\n').trim();
  let current = '';
  try {
    const ruleset = await rules.getFirestoreRuleset();
    current = ruleset.source.map(f => f.content).join('\n');
  } catch (err) {
    console.log('Règles en ligne illisibles :', err.message);
  }
  if (norm(current) === norm(source)) {
    console.log('Règles Firestore déjà à jour.');
    return;
  }
  await rules.releaseFirestoreRulesetFromSource(source);
  console.log('Règles Firestore publiées : celles en ligne étaient différentes de firestore.rules.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
