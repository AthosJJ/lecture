/* Compte : création, connexion, mot de passe oublié et déconnexion, par
   e-mail et mot de passe uniquement (Firebase Authentication). Les comptes
   sont ceux d'À tester : mêmes identifiants. */
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { auth } from './firebase.js';

export const MIN_PASSWORD = 8; // comme À tester

export const watchAuth = (fn) => onAuthStateChanged(auth, fn);
export const currentUser = () => auth.currentUser;

const cleanEmail = (s) => String(s || '').trim();

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, cleanEmail(email), password);
}

export async function signUp(email, password) {
  if (String(password || '').length < MIN_PASSWORD) {
    const err = new Error('weak');
    err.code = 'auth/weak-password';
    throw err;
  }
  await createUserWithEmailAndPassword(auth, cleanEmail(email), password);
}

/* L'e-mail contient un lien de retour vers Lecture (domaine autorisé dans
   Firebase) ; si l'adresse de retour est refusée, il part sans ce lien. */
export async function resetPassword(email) {
  const url = new URL('./', location.href).href;
  try {
    await sendPasswordResetEmail(auth, cleanEmail(email), { url });
  } catch (err) {
    if (err?.code !== 'auth/unauthorized-continue-uri' && err?.code !== 'auth/invalid-continue-uri') throw err;
    await sendPasswordResetEmail(auth, cleanEmail(email));
  }
}

export async function signOutUser() {
  await signOut(auth);
}

export function authMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-email': return 'Cette adresse e-mail n’est pas valide.';
    case 'auth/missing-email': return 'Indiquez votre adresse e-mail.';
    case 'auth/missing-password': return 'Indiquez votre mot de passe.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Adresse e-mail ou mot de passe incorrect.';
    case 'auth/email-already-in-use': return 'Un compte existe déjà avec cette adresse : connectez-vous.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements': return `Choisissez un mot de passe d’au moins ${MIN_PASSWORD} caractères.`;
    case 'auth/too-many-requests': return 'Trop d’essais : patientez quelques minutes avant de recommencer.';
    case 'auth/network-request-failed': return 'Pas de connexion : vérifiez le réseau et réessayez.';
    case 'auth/user-disabled': return 'Ce compte a été désactivé.';
    case 'auth/operation-not-allowed': return 'La connexion par e-mail n’est pas activée pour cette app.';
    default: return 'Ça n’a pas marché. Réessayez dans un instant.';
  }
}
