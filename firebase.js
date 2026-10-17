/* Firebase, forfait gratuit Spark : comptes (Authentication, e-mail et mot de
   passe) et données (Cloud Firestore, cache local persistant pour le hors
   ligne). Projet « athos-apps », partagé avec À tester : mêmes comptes, même
   base, mêmes règles de sécurité.

   Le SDK modulaire vient du CDN officiel, à la même version qu'À tester ; le
   service worker garde ces trois fichiers pour que l'app s'ouvre sans réseau
   (liste SDK de sw.js, à changer en même temps).

   Instance nommée « lecture » : À tester est servie sur le même domaine
   (athosjj.github.io) avec l'instance par défaut. Un nom à part donne à
   chaque app sa propre session et son propre cache Firestore : se
   déconnecter de l'une ne déconnecte pas l'autre et n'efface rien de ses
   données en attente d'envoi.

   La configuration web est publique par nature : ce sont les règles de
   sécurité Firestore qui protègent les données de chacun. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCjyLBNqjRcoesW6PYQSywUaNUSIGTpRZs',
  authDomain: 'athos-apps.firebaseapp.com',
  projectId: 'athos-apps',
  storageBucket: 'athos-apps.firebasestorage.app',
  messagingSenderId: '204338794492',
  appId: '1:204338794492:web:6a9c60749b4ff3ea3dec79'
};

export const app = initializeApp(firebaseConfig, 'lecture');

/* La session reste ouverte d'une ouverture à l'autre (IndexedDB, repli
   localStorage). Ni lien magique ni Google : sur iPhone, ils s'ouvrent dans
   Safari et ne connectent pas l'app installée sur l'écran d'accueil. */
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
auth.languageCode = 'fr';

export const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true
});

/* Tests automatisés uniquement : émulateurs Firebase sur la machine locale. */
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  try {
    const emu = JSON.parse(localStorage.getItem('lecture:emulateurs') || 'null');
    if (emu) {
      connectAuthEmulator(auth, `http://127.0.0.1:${emu.auth}`, { disableWarnings: true });
      connectFirestoreEmulator(firestore, '127.0.0.1', emu.firestore);
    }
  } catch { /* pas d'émulateur */ }
}
