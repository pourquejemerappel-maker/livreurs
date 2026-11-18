// Première version : connexion + test en direct (Firebase).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, doc, getDoc, onSnapshot, writeBatch, setDoc, increment, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: '__API_KEY__',
  authDomain: 'livreurs-app-6dafd.firebaseapp.com',
  projectId: 'livreurs-app-6dafd',
  storageBucket: 'livreurs-app-6dafd.firebasestorage.app',
  messagingSenderId: '279678565038',
  appId: '1:279678565038:web:d1155d66ea0abaee450b3f'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Cache local : l'app reste utilisable quelques minutes sans signal et renvoie les actions au retour.
const db = initializeFirestore(app, { localCache: persistentLocalCache() });
setPersistence(auth, browserLocalPersistence).catch(() => {});

const $ = (id) => document.getElementById(id);
const ROLES = { proprio: 'Propriétaire', complet: 'Dispatch', limite: 'Dispatch (limité)', livreur: 'Livreur' };

// Les noms deviennent des adresses internes (les livreurs n'ont pas besoin de courriel).
export function emailFor(nom) {
  const slug = String(nom || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return slug ? slug + '@livreurs-app-6dafd.firebaseapp.com' : '';
}

function show(id) { ['loading', 'login', 'home'].forEach((x) => $(x).classList.toggle('hide', x !== id)); $('logout').classList.toggle('hide', id !== 'home'); }
function msg(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'Nom ou mot de passe incorrect.';
  if (c.includes('too-many-requests')) return 'Trop d’essais. Réessaie dans quelques minutes.';
  if (c.includes('weak-password')) return 'Le mot de passe doit avoir au moins 6 caractères.';
  if (c.includes('email-already-in-use')) return 'Ce compte existe déjà.';
  if (c.includes('network')) return 'Pas de connexion Internet.';
  return (e && e.message) || 'Erreur.';
}

let stopCount = null;
let creating = false; // pendant la création du compte propriétaire

onAuthStateChanged(auth, async (user) => {
  if (creating) return;
  if (stopCount) { stopCount(); stopCount = null; }
  if (!user) {
    show('login');
    try { const s = await getDoc(doc(db, 'public', 'setup')); $('setupCard').classList.toggle('hide', s.exists()); }
    catch (e) { $('setupCard').classList.add('hide'); }
    return;
  }
  const u = await getDoc(doc(db, 'users', user.uid)).catch(() => null);
  const data = u && u.exists() ? u.data() : null;
  if (!data || data.actif === false) { $('lErr').textContent = 'Ce compte n’est pas actif.'; await signOut(auth); return; }
  $('who').textContent = data.nom;
  $('role').textContent = ROLES[data.role] || data.role;
  $('hello').textContent = 'Salut ' + data.nom + ' !';
  show('home');
  stopCount = onSnapshot(doc(db, 'test', 'compteur'), (s) => { $('count').textContent = s.exists() ? s.data().n : 0; });
});

$('lGo').onclick = async () => {
  $('lErr').textContent = '';
  const email = emailFor($('lName').value);
  if (!email || !$('lPwd').value) { $('lErr').textContent = 'Écris ton nom et ton mot de passe.'; return; }
  $('lGo').disabled = true;
  try { await signInWithEmailAndPassword(auth, email, $('lPwd').value); $('lPwd').value = ''; }
  catch (e) { $('lErr').textContent = msg(e); }
  $('lGo').disabled = false;
};
$('lPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lGo').click(); });

$('sGo').onclick = async () => {
  $('sErr').textContent = '';
  if ($('sPwd').value.length < 6) { $('sErr').textContent = 'Au moins 6 caractères.'; return; }
  if ($('sPwd').value !== $('sPwd2').value) { $('sErr').textContent = 'Les deux mots de passe ne sont pas pareils.'; return; }
  $('sGo').disabled = true;
  creating = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, emailFor('proprietaire'), $('sPwd').value);
    const b = writeBatch(db);
    b.set(doc(db, 'users', cred.user.uid), { nom: 'Propriétaire', login: 'proprietaire', role: 'proprio', actif: true, creeLe: serverTimestamp() });
    b.set(doc(db, 'public', 'setup'), { ownerUid: cred.user.uid, le: serverTimestamp() });
    await b.commit();
    location.reload();
  } catch (e) { creating = false; $('sErr').textContent = msg(e); $('sGo').disabled = false; if (auth.currentUser) signOut(auth); }
};

$('plus').onclick = () => setDoc(doc(db, 'test', 'compteur'), { n: increment(1) }, { merge: true });
$('logout').onclick = () => signOut(auth);
