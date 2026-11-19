// Version 20 : connexion, équipe, stock, check-in, commandes, notifications, lien client, résumé, messages, remises de cash, dettes, mode focus, fin de soirée, historique, pastille sur l'icône (Firebase) — app « Gotham ».
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, doc, getDoc, getDocs, getDocFromServer, onSnapshot, writeBatch, setDoc, increment, serverTimestamp, collection, query, where, orderBy, limit, deleteDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getMessaging, getToken, isSupported as msgSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAn12YxRVuAgkyQDx056TVErnKyYzVIOLI',
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

// Deuxième connexion, seulement en mémoire : sert au propriétaire à créer les comptes des autres
// sans se déconnecter lui-même.
const app2 = initializeApp(firebaseConfig, 'creation');
const auth2 = initializeAuth(app2, { persistence: inMemoryPersistence });

const $ = (id) => document.getElementById(id);
const OWNER = 'Wayne'; // v33 : nom affiché du propriétaire
const dispName = (n) => (n === 'Propriétaire' ? OWNER : n);
// v56 : personnes cachées d'office pour le dispatch limité (Lost) : jamais visibles nulle part.
const CACHES = ['jabari'];
const hidId = (x) => !!(me && me.role === 'limite' && x && CACHES.includes(x));
const hidDoc = (r) => !!(me && me.role === 'limite' && r && ['livreur', 'mid', 'de', 'vers', 'par', 'responsable'].some((k) => CACHES.includes(r[k])));
const ROLES = { proprio: 'Propriétaire', complet: 'Dispatch complet', limite: 'Dispatch limité', livreur: 'Livreur' };
const DESC = {
  complet: 'Tout sauf les prix, les paies, les mots de passe, l’équipe et les ajouts à la réserve.',
  limite: 'Check-in et loads, commandes, EMT, messages. Pas l’argent des livreurs, pas la fermeture.',
  livreur: 'Sa soirée seulement. Ne voit jamais les montants EMT.'
};
const DOMAINE = '@livreurs-app-6dafd.firebaseapp.com';
const LIEN = 'https://pourquejemerappel-maker.github.io/livreurs/';

// Le nom devient un identifiant simple : « Mickey Mouse » → « mickey.mouse ».
export function slugFor(nom) {
  return String(nom || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}
export function emailFor(nom) { const s = slugFor(nom); return s ? s + DOMAINE : ''; }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(id) { ['loading', 'login', 'home'].forEach((x) => $(x).classList.toggle('hide', x !== id)); $('logout').classList.toggle('hide', id !== 'home'); }
function msg(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'Nom ou mot de passe incorrect.';
  if (c.includes('too-many-requests')) return 'Trop d’essais. Réessaie dans quelques minutes.';
  if (c.includes('weak-password')) return 'Le mot de passe doit avoir au moins 6 caractères.';
  if (c.includes('email-already-in-use')) return 'Ce nom est déjà utilisé.';
  if (c.includes('permission-denied')) return 'Tu n’as pas la permission.';
  if (c.includes('network') || c.includes('unavailable')) return 'Pas de connexion Internet.';
  return (e && e.message) || 'Erreur.';
}

let stops = [];
let creating = false; // pendant la création du compte propriétaire
let me = null;        // { uid, nom, role, ... }
const ss = { list: null, ask: null, busy: false, err: '' }; // sessions (v21)
let lastPing = 0;

function stopAll() { stops.forEach((f) => f()); stops = []; }

onAuthStateChanged(auth, async (user) => {
  if (creating) return;
  stopAll(); me = null;
  if (!user) {
    show('login');
    try { const s = await getDoc(doc(db, 'public', 'setup')); $('setupCard').classList.toggle('hide', s.exists()); }
    catch (e) { $('setupCard').classList.add('hide'); }
    return;
  }
  const u = await getDocFromServer(doc(db, 'users', user.uid)).catch(() => getDoc(doc(db, 'users', user.uid)).catch(() => null));
  const data = u && u.exists() ? u.data() : null;
  if (!data || data.actif === false) { $('lErr').textContent = 'Ce compte n’est pas actif.'; await signOut(auth); return; }
  me = Object.assign({ uid: user.uid }, data);
  if (me.role === 'proprio') me.nom = OWNER; // v33 : le propriétaire s'appelle Wayne
  me.mid = data.mid || 'proprietaire';
  $('who').textContent = data.nom;
  // lost (dispatch limité) : on lit sa soirée avant tout, pour savoir s'il fait le dispatch ce soir (les règles le vérifient aussi).
  if (me.role === 'limite') {
    mySoiree = null;
    try { const qs = await getDocs(query(collection(db, 'soirees'), where('mid', '==', me.mid), where('statut', 'in', ACTIVES))); qs.forEach((d) => { mySoiree = Object.assign({ id: d.id }, d.data()); }); } catch (e) {}
  }
  buildTabs();
  show('home');
  // Si le compte est désactivé ou son mot de passe changé, il est déconnecté tout de suite.
  // Le propriétaire peut aussi déconnecter quelqu'un à distance (Équipe → Sessions) : « forceOut ».
  stops.push(onSnapshot(doc(db, 'users', user.uid), (s) => {
    if (!s.exists() || s.data().actif === false) { $('lErr').textContent = 'Ce compte n’est plus actif.'; signOut(auth); return; }
    const fo = s.data().forceOut, depuis = Date.parse((user.metadata && user.metadata.lastSignInTime) || '') || 0;
    if (fo && fo > depuis) { $('lErr').textContent = 'Tu as été déconnecté. Reconnecte-toi.'; signOut(auth); }
  }, () => {}));
  // v53 : livreur Uber déconnecté par le dispatch → il doit être accepté pour revenir.
  if (me.mid) { const depuis2 = Date.parse((user.metadata && user.metadata.lastSignInTime) || '') || 0;
    stops.push(onSnapshot(doc(db, 'sortis', me.mid), (s) => {
      const x = s.exists() ? s.data() : null;
      if (!x) return sortiGate(null);
      if (x.etat === 'dehors') {
        if ((Number(x.le) || 0) > depuis2) { $('lErr').textContent = 'Tu as été déconnecté par le dispatch. Reconnecte-toi : le dispatch devra accepter ton retour.'; signOut(auth); return; }
        sortiGate({ etat: 'attente' });
        writeBatch(db).update(doc(db, 'sortis', me.mid), { etat: 'attente', demandeLe: Date.now() }).commit().then(() => notifyDispatch('🔒 ' + me.nom + ' veut revenir — à accepter')).catch(() => {});
        return;
      }
      sortiGate(x);
    }, () => {})); }
  startLive();
});

// ---------- Connexion ----------
$('lGo').onclick = async () => {
  $('lErr').textContent = '';
  const slug = slugFor($('lName').value);
  if (!slug || !$('lPwd').value) { $('lErr').textContent = 'Écris ton nom et ton mot de passe.'; return; }
  $('lGo').disabled = true;
  try {
    let email = slug + DOMAINE;
    try { const l = await getDoc(doc(db, 'logins', slug)); if (l.exists() && l.data().email) email = l.data().email; } catch (e) {}
    await signInWithEmailAndPassword(auth, email, $('lPwd').value);
    $('lPwd').value = '';
  } catch (e) { $('lErr').textContent = msg(e); }
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

$('logout').onclick = () => signOut(auth);

// ---------- Onglets (selon le rôle) ----------
const isOwner = () => me && me.role === 'proprio';
// lost (limité) compte comme dispatch seulement quand MOUSSE ou le propriétaire a ouvert sa soirée « Dispatch » ou « Les deux ».
const isStaff = () => me && (me.role === 'complet' || (me.role === 'limite' && !locked()));
const delivers = () => me && (me.role === 'livreur' || me.livre || me.role === 'limite');
// Le dispatch limité doit être autorisé (par MOUSSE ou le propriétaire) avant de pouvoir travailler.
const isDispMode = (s) => !!(s && s.mode === 'dispatch');
const working = (s) => s.statut === 'ouverte' && !isDispMode(s); // en service comme livreur
const doesDisp = (s) => !!(s && (s.mode === 'dispatch' || s.mode === 'les2')); // lost : dispatch seul, ou livreur + dispatch
const locked = () => me && me.role === 'limite' && !(mySoiree && mySoiree.statut === 'ouverte' && doesDisp(mySoiree));
function buildTabs() {
  const t = [];
  if (me.role === 'limite') t.push(['soiree', 'Ma soirée']);
  if (isOwner() || isStaff()) t.push(['direct', 'En direct'], ['stock', 'Stock']);
  if (delivers() && me.role !== 'limite') t.push(['soiree', 'Ma soirée']);
  if (isOwner() || isStaff()) t.push(['histo', 'Historique']); // v36 : lost aussi quand il fait le dispatch
  if (isOwner() || isStaff()) t.push(['cash', '💵 Cash']); // v44
  if (isOwner()) t.push(['equipe', 'Équipe']);
  $('tabs').innerHTML = t.map((x) => '<button data-t="' + x[0] + '">' + x[1] + '</button>').join('');
  $('tabs').classList.toggle('hide', t.length < 2);
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
  setTab(t[0][0]);
  try { nrBadge(); } catch (e) {}
}
let curTab = '';
function setTab(t) {
  if (t === 'histo' && typeof drawHisto === 'function') setTimeout(drawHisto, 0);
  if (t === 'cash') setTimeout(() => loadCash(), 0);
  if (typeof fx !== 'undefined' && fx.id && t !== 'direct') closeFocus();
  if (locked() && (t === 'direct' || t === 'stock' || t === 'cash')) t = 'soiree';
  curTab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  ['direct', 'stock', 'soiree', 'equipe', 'histo', 'cash'].forEach((x) => { const el = $('tab' + x[0].toUpperCase() + x.slice(1)); if (el) el.classList.toggle('hide', x !== t); });
}

// ---------- Équipe (propriétaire seulement) ----------
// members/{id} : nom, rôle, fait aussi des livraisons, actif, compte de connexion actuel.
// paies/{id}   : paie par livraison (seulement le propriétaire et la personne elle-même la voient).
let team = {}, paies = {};
const paieTxt = (p) => (p == null ? 'paie à entrer' : p + ' $ / livraison');
// v48 : Alpha = compte de test (seulement lui). Le robot efface ses traces 1 h après chaque action.
const isAlpha = (id) => id === 'alpha';
const alphaTag = (id) => isAlpha(id) ? ' <span style="font-size:11px;font-weight:700;background:#7c3aed;color:#fff;border-radius:6px;padding:2px 6px;vertical-align:middle">🧪 TEST</span>' : '';
function renderTeam() {
  const ids = Object.keys(team).sort((a, b) => (team[a].nom || '').localeCompare(team[b].nom || '', 'fr'));
  let d = '', l = '';
  ids.forEach((id) => {
    const p = team[id];
    const sub = isAlpha(id) ? '🧪 Compte de test · effacé 1 h après chaque action' : p.role === 'livreur' ? (p.uber ? '🚕 Uber / pick-up · ' : '') + paieTxt(paies[id]) : (p.livre ? 'Fait aussi des livraisons · ' + paieTxt(paies[id]) : 'Ne livre pas');
    const h = '<div class="row' + (p.actif ? '' : ' off') + '" data-id="' + esc(id) + '"><div><div class="n">' + esc(p.nom) + alphaTag(id) +
      '<span class="pill p-' + (p.actif ? p.role : 'off') + '">' + (p.actif ? ROLES[p.role] : 'Désactivé') + '</span></div><div class="s">' + sub + '</div></div><span class="small">›</span></div>';
    if (p.role === 'livreur') l += h; else d += h;
  });
  $('lDisp').innerHTML = d || '<div class="small">Personne pour l’instant</div>';
  $('lLiv').innerHTML = l || '<div class="small">Personne pour l’instant</div>';
  document.querySelectorAll('#tabEquipe .row').forEach((r) => { r.onclick = () => openMember(r.dataset.id); });
}

let F = null; // fiche ouverte
function closeSheet() { $('sheet').classList.add('hide'); F = null; }
$('sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
$('addBtn').onclick = () => { F = { mode: 'add', nom: '', role: 'livreur', livre: false, paie: null, pwd: '' }; drawSheet(); $('sheet').classList.remove('hide'); };
function openMember(id) {
  const p = team[id]; if (!p) return;
  F = { mode: 'edit', id, nom: p.nom, role: p.role, livre: !!p.livre, uber: !!p.uber, paie: paies[id] == null ? null : paies[id], pwd: '' };
  drawSheet(); $('sheet').classList.remove('hide');
}
const needPaie = () => F.role === 'livreur' || F.livre;

function roleBlock() {
  return '<div class="label">Rôle</div><div class="seg">' + ['livreur', 'limite', 'complet'].map((r) =>
    '<button data-r="' + r + '" class="' + (F.role === r ? 'on' : '') + '">' + ROLES[r] + '</button>').join('') + '</div>' +
    '<p class="small" style="margin-top:0">' + DESC[F.role] + '</p>' +
    (F.role !== 'livreur' ? '<label class="chk"><input type="checkbox" id="fLivre" ' + (F.livre ? 'checked' : '') + '> Fait aussi des livraisons</label>' : '') +
    (F.role === 'livreur' ? '<label class="chk"><input type="checkbox" id="fUber" ' + (F.uber ? 'checked' : '') + '> 🚕 Fait seulement Uber et pick-up</label>' +
      (F.uber ? '<p class="small" style="margin-top:0">Il ne reçoit jamais de commande automatique : le dispatch lui envoie avec « 🚕 Uber » ou « 📍 Pick-up ».</p>' : '') : '') +
    (needPaie() ? '<div class="label">Paie par livraison ($)</div><input id="fPaie" type="number" inputmode="numeric" min="0" value="' + (F.paie == null ? '' : F.paie) + '">' : '');
}
function drawSheet() {
  let h = '';
  if (F.mode === 'add') {
    h = '<div class="label">Ajouter quelqu’un</div>' +
      '<input id="fNom" placeholder="Nom (ex. FMJ)" autocapitalize="words" value="' + esc(F.nom) + '">' + '<div class="small" id="fAlpha" style="color:#c4b5fd;margin:4px 0 8px' + (isAlpha(slugFor(F.nom)) ? '' : ';display:none') + '">🧪 Compte de test activé tout seul (nom « Alpha »). Le robot effacera ses affaires 1 h après chaque action et remettra le stock d’où il vient.</div>' + roleBlock() +
      '<div class="label">Mot de passe (tu le choisis, 6 caractères min.)</div><input id="fPwd" type="text" autocomplete="off" autocapitalize="none" value="' + esc(F.pwd) + '">' +
      '<div class="err" id="fErr"></div>' +
      '<div class="two"><button class="btn ghost" id="fCancel">Annuler</button><button class="btn ok" id="fSave">Ajouter</button></div>';
  } else if (F.mode === 'edit') {
    const p = team[F.id];
    h = '<div class="label">' + esc(p.nom) + '</div>' +
      (p.actif && ['livreur', 'limite'].includes(p.role) ? '<button class="btn" id="fMsg" style="margin-bottom:10px">💬 Envoyer un message à ' + esc(p.nom) + '</button>' : '') +
      roleBlock() + '<div class="err" id="fErr"></div>' +
      '<button class="btn ok" id="fSave" style="margin-bottom:8px">Enregistrer</button>' +
      '<button class="btn ghost" id="fPwdBtn" style="margin-bottom:8px">🔑 Nouveau mot de passe</button>' +
      (p.actif ? '<button class="btn red" id="fToggle" style="margin-bottom:8px">Désactiver (ne peut plus se connecter)</button>'
               : '<button class="btn ghost" id="fToggle" style="margin-bottom:8px">Réactiver</button>') +
      '<button class="btn ghost" id="fCancel">Fermer</button>';
  } else if (F.mode === 'pwd') {
    h = '<div class="label">Nouveau mot de passe pour ' + esc(team[F.id].nom) + '</div>' +
      '<input id="fPwd" type="text" autocomplete="off" autocapitalize="none" placeholder="6 caractères min.">' +
      '<p class="small" style="margin-top:0">Il sera déconnecté de ses téléphones et devra utiliser le nouveau.</p><div class="err" id="fErr"></div>' +
      '<div class="two"><button class="btn ghost" id="fBack">Retour</button><button class="btn ok" id="fSave">Changer</button></div>';
  } else if (F.mode === 'give') {
    h = '<div class="label">✅ C’est fait. À envoyer à ' + esc(F.nom) + '</div>' +
      '<div class="give" id="give">Lien : ' + LIEN + '\nNom : ' + esc(F.nom) + '\nMot de passe : ' + esc(F.pwd) + '</div>' +
      '<p class="small" style="margin-top:0">Envoie-le par Signal. Le mot de passe n’est montré qu’une seule fois ici.</p>' +
      '<div class="two"><button class="btn ghost" id="fCopy">Copier</button><button class="btn ok" id="fCancel">OK</button></div>';
  }
  $('sheetBody').innerHTML = h;
  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('fNom', 'oninput', (e) => { F.nom = e.target.value; const a = $('fAlpha'); if (a) a.style.display = isAlpha(slugFor(F.nom)) ? '' : 'none'; });
  on('fPwd', 'oninput', (e) => { F.pwd = e.target.value; });
  on('fPaie', 'oninput', (e) => { F.paie = e.target.value === '' ? null : Number(e.target.value); });
  on('fLivre', 'onchange', (e) => { F.livre = e.target.checked; drawSheet(); });
  on('fUber', 'onchange', (e) => { F.uber = e.target.checked; if (F.uber && F.paie == null) F.paie = 25; drawSheet(); });
  document.querySelectorAll('#sheetBody .seg button').forEach((b) => { b.onclick = () => { F.role = b.dataset.r; drawSheet(); }; });
  on('fCancel', 'onclick', closeSheet);
  on('fBack', 'onclick', () => { F.mode = 'edit'; drawSheet(); });
  on('fPwdBtn', 'onclick', () => { F.mode = 'pwd'; F.pwd = ''; drawSheet(); });
  on('fMsg', 'onclick', () => { const id = F.id; closeSheet(); openDmWith(id); });
  on('fToggle', 'onclick', () => busy(toggleMember));
  on('fCopy', 'onclick', () => { try { navigator.clipboard.writeText($('give').textContent).catch(() => {}); $('fCopy').textContent = 'Copié ✓'; } catch (e) {} });
  on('fSave', 'onclick', () => busy(F.mode === 'add' ? addMember : F.mode === 'edit' ? saveMember : changePwd));
}
const err = (t) => { if ($('fErr')) $('fErr').textContent = t; };
async function busy(fn) {
  const btns = document.querySelectorAll('#sheetBody button'); btns.forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (e) { err(msg(e)); }
  document.querySelectorAll('#sheetBody button').forEach((b) => { b.disabled = false; });
}

// Crée un compte de connexion sans déconnecter le propriétaire.
async function newLogin(email, pwd) {
  const cred = await createUserWithEmailAndPassword(auth2, email, pwd);
  const uid = cred.user.uid;
  await signOut(auth2);
  return uid;
}

async function addMember() {
  const nom = F.nom.trim().replace(/\s+/g, ' ');
  const id = slugFor(nom);
  if (!id) return err('Écris un nom.');
  if (id === 'proprietaire' || team[id]) return err('Ce nom existe déjà.');
  if (needPaie() && (F.paie == null || isNaN(F.paie) || F.paie < 0)) return err('Écris la paie par livraison.');
  if (F.pwd.length < 6) return err('Mot de passe : au moins 6 caractères.');
  const ex = await getDoc(doc(db, 'logins', id));
  if (ex.exists()) return err('Ce nom existe déjà.');
  const email = id + DOMAINE;
  const uid = await newLogin(email, F.pwd);
  const livre = F.role !== 'livreur' && F.livre, uber = F.role === 'livreur' && !!F.uber;
  const b = writeBatch(db);
  b.set(doc(db, 'members', id), { nom, role: F.role, livre, uber, actif: true, uid, creeLe: serverTimestamp(), ...(isAlpha(id) ? { test: true } : {}) });
  b.set(doc(db, 'paies', id), { paie: needPaie() ? Number(F.paie) : 0 });
  b.set(doc(db, 'users', uid), { nom, mid: id, role: F.role, livre, uber, actif: true });
  b.set(doc(db, 'logins', id), { email });
  await b.commit();
  F.nom = nom; F.mode = 'give'; drawSheet();
}

async function saveMember() {
  if (needPaie() && (F.paie == null || isNaN(F.paie) || F.paie < 0)) return err('Écris la paie par livraison.');
  const p = team[F.id];
  const livre = F.role !== 'livreur' && F.livre, uber = F.role === 'livreur' && !!F.uber;
  const b = writeBatch(db);
  b.update(doc(db, 'members', F.id), { role: F.role, livre, uber });
  b.set(doc(db, 'paies', F.id), { paie: needPaie() ? Number(F.paie) : 0 });
  if (p.uid) b.update(doc(db, 'users', p.uid), { role: F.role, livre, uber });
  await b.commit();
  closeSheet();
}

async function toggleMember() {
  const p = team[F.id];
  const actif = !p.actif;
  const b = writeBatch(db);
  b.update(doc(db, 'members', F.id), { actif });
  if (p.uid) b.update(doc(db, 'users', p.uid), { actif });
  await b.commit();
  closeSheet();
}

// Nouveau mot de passe : on crée un nouveau compte de connexion pour la même personne
// et on supprime l'ancien accès (la personne est déconnectée partout).
async function changePwd() {
  if (F.pwd.length < 6) return err('Au moins 6 caractères.');
  const p = team[F.id];
  const email = F.id + '.' + Date.now().toString(36) + DOMAINE;
  const uid = await newLogin(email, F.pwd);
  const b = writeBatch(db);
  b.set(doc(db, 'users', uid), { nom: p.nom, mid: F.id, role: p.role, livre: !!p.livre, uber: !!p.uber, actif: !!p.actif });
  if (p.uid) b.delete(doc(db, 'users', p.uid));
  b.update(doc(db, 'members', F.id), { uid });
  b.set(doc(db, 'logins', F.id), { email });
  await b.commit();
  F.nom = p.nom; F.mode = 'give'; drawSheet();
}

// =====================================================================
// Version 3 : stock des dispatchs + check-in
// =====================================================================
// stocks/{id}     : { L, XL } ce que chaque personne a sur elle (id = nom simplifié).
// mouvements/{…}  : historique : de → vers, quantités, par qui.
// soirees/{…}     : la soirée d'un livreur : demande → load → ouverte (ou refusée / annulée).

const RESERVE = 'reserve';
// Le dispatch complet (MOUSSE) a deux piles : ce qu'il a sur lui, et son dépôt (ce qu'il garde ailleurs).
const DEP = (id) => id + '-depot';
const isDep = (id) => /-depot$/.test(id || '');
const ACTIVES = ['demande', 'load', 'ouverte'];
let stocks = {}, soirees = {}, mySoiree = null, mvts = [];
const nomDe = (id) => (id === RESERVE ? 'Réserve' : id === 'proprietaire' ? OWNER : isDep(id) ? 'Dépôt de ' + nomDe(id.replace(/-depot$/, '')) : (team[id] && team[id].nom) || id);
const hhmm = (ts) => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d ? d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') : ''; };
const qty = (o) => (o.L || 0) + ' L · ' + (o.XL || 0) + ' XL';

function startLive() {
  finState.team = null; finState.me = null; setTimeout(initFin, 0);
  dm.all = []; dm.lus = {}; dm.mine = []; dm.open = null; dm.ready = false; setTimeout(startDm, 0);
  rm.mine = []; rm.toMe = []; rm.dispos = {}; dispoOn = null; setTimeout(startRemises, 0);
  dt.all = []; dt.mine = []; dt.okRappel = false; setTimeout(startDettes, 0);
  ret.toMe = []; ret.mine = []; ret.f = null; setTimeout(startRetours, 0);
  dons.list = []; setTimeout(startDons, 0);
  ss.list = null; ss.ask = null; lastPing = 0; setTimeout(startSessions, 0);
  sortis = {}; setTimeout(startSortis, 0);
  stops.push(onSnapshot(collection(db, 'members'), (qs) => { team = {}; qs.forEach((d) => { if (!hidId(d.id)) team[d.id] = d.data(); }); renderTeam(); limStocks(); renderAll(); }, () => {}));
  if (isOwner()) stops.push(onSnapshot(collection(db, 'paies'), (qs) => { paies = {}; qs.forEach((d) => { paies[d.id] = d.data().paie; }); renderTeam(); }, () => {}));
  else if (me.mid) stops.push(onSnapshot(doc(db, 'paies', me.mid), (s) => { if (s.exists()) paies[me.mid] = s.data().paie; }, () => {}));
  // Stock : le propriétaire et le dispatch complet voient tout ; les autres seulement le leur.
  if (isOwner() || me.role === 'complet') {
    stops.push(onSnapshot(collection(db, 'stocks'), (qs) => { stocks = {}; qs.forEach((d) => { stocks[d.id] = d.data(); }); renderAll(); }, () => {}));
  } else {
    stops.push(onSnapshot(doc(db, 'stocks', me.mid), (s) => { if (s.exists()) stocks[me.mid] = s.data(); else delete stocks[me.mid]; renderAll(); }, () => {}));
    stops.push(() => { Object.keys(limSt).forEach((k) => { limSt[k](); delete limSt[k]; }); stocks = {}; });
  }
  if (isOwner() || isStaff()) {
    stops.push(onSnapshot(query(collection(db, 'soirees'), where('statut', 'in', ACTIVES)), (qs) => { soirees = {}; qs.forEach((d) => { if (!hidDoc(d.data())) soirees[d.id] = d.data(); }); renderAll(); }, (e) => console.warn(e)));
    stops.push(onSnapshot(query(collection(db, 'mouvements'), orderBy('le', 'desc'), limit(15)), (qs) => { mvts = []; qs.forEach((d) => { if (!hidDoc(d.data())) mvts.push(d.data()); }); renderAll(); }, () => {}));
  }
  if (delivers()) {
    stops.push(onSnapshot(query(collection(db, 'soirees'), where('mid', '==', me.mid), where('statut', 'in', ACTIVES)), (qs) => {
      const wasLocked = locked();
      mySoiree = null; qs.forEach((d) => { mySoiree = Object.assign({ id: d.id }, d.data()); }); renderSoiree();
      // lost : quand il commence ou arrête le dispatch, on recharge pour ouvrir (ou fermer) l'accès aux données du dispatch.
      if (me.role === 'limite' && wasLocked !== locked()) { setTimeout(() => location.reload(), 300); return; }
      document.querySelectorAll('#tabs button').forEach((b) => { b.disabled = locked() && (b.dataset.t === 'direct' || b.dataset.t === 'stock'); });
      if (locked()) setTab('soiree'); else if (wasLocked) setTab('direct');
      drawDm(); drawMine(); drawCashBtn(); syncDispo();
    }, (e) => console.warn(e)));
  }
  startOrders();
  renderAll(); renderSoiree();
  if (delivers() || isStaff()) saveToken(false);
}
function renderAll() { if (!me) return; if (isOwner() || isStaff()) { renderDirect(); renderStock(); } if (typeof drawDm === 'function') drawDm(); }
const st = (id) => stocks[id] || { L: 0, XL: 0 };

// ---------- En direct (dispatch) ----------
const drafts = {}; // load en cours de préparation par demande
function renderDirect() {
  const mine = st(me.mid);
  $('myStockCard').classList.toggle('hide', isOwner());
  $('msL').textContent = mine.L || 0; $('msXL').textContent = mine.XL || 0;
  const dep = st(DEP(me.mid));
  $('msDep').classList.toggle('hide', me.role !== 'complet');
  $('msDep').textContent = 'Au dépôt : ' + qty(dep);
  // v26 : en haut d'En direct, ce qui reste à MOUSSE (sur lui) et dans son dépôt — pour le propriétaire et MOUSSE.
  const bar = $('stockBar');
  if (bar) {
    const cid = me.role === 'complet' ? me.mid : Object.keys(team).find((id) => team[id].actif && team[id].role === 'complet');
    if ((isOwner() || me.role === 'complet') && cid) {
      const a = st(cid), d = st(DEP(cid)), moi = cid === me.mid;
      bar.innerHTML = '<div class="sbx"><span class="small">' + (moi ? 'Sur moi' : esc(nomDe(cid)) + ' (sur lui)') + '</span><b>' + (a.L || 0) + ' L · ' + (a.XL || 0) + ' XL</b></div>' +
        '<div class="sbx"><span class="small">' + (moi ? 'Mon dépôt' : 'Dépôt de ' + esc(nomDe(cid))) + '</span><b>' + (d.L || 0) + ' L · ' + (d.XL || 0) + ' XL</b></div>';
      bar.classList.remove('hide');
    } else bar.classList.add('hide');
  }
  const list = Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).sort((a, b) => ((a.demandeLe && a.demandeLe.seconds) || 0) - ((b.demandeLe && b.demandeLe.seconds) || 0));
  const todo = list.filter((s) => s.statut === 'demande');
  const att = list.filter((s) => s.statut === 'load');
  const srv = list.filter((s) => s.statut === 'ouverte');
  $('todoN').textContent = todo.length; $('todoN').classList.toggle('hide', !todo.length);
  if ($('todoCard')) $('todoCard').classList.toggle('hide', !todo.length && !att.length);
  // Ne pas redessiner une demande pendant qu'on tape dedans.
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#todo');
  if (!focused) {
    $('todo').innerHTML = (todo.map(reqHtml).join('') + att.map((s) => '<div class="item"><div class="wait"><span class="dot"></span><b>' + esc(s.nom) + '</b>&nbsp;vérifie son load…</div><div class="small">' + qty(s.load || {}) + ' de ' + esc(nomDe(s.load && s.load.de)) + '</div></div>').join('')) ||
      '<div class="small">Rien pour l’instant. Les demandes de check-in apparaissent ici toutes seules.</div>';
    todo.forEach(bindReq);
  }
  if (!NF) renderNew();
  renderQueues();
}
function loadSrc(d) { return isOwner() ? RESERVE : me.role === 'complet' && d.src === DEP(me.mid) ? DEP(me.mid) : me.mid; }
function canAuthorize(s) { return isOwner() || me.role === 'complet' || s.mid !== me.mid; }
function reqHtml(s) {
  const d = drafts[s.id] || (drafts[s.id] = { L: (s.load && s.load.L) || 0, XL: (s.load && s.load.XL) || 0, adr: s.adresse || '' });
  if (isDispMode(s)) { d.L = 0; d.XL = 0; }
  const self = s.mid === me.mid;
  if (isDispMode(s) && !self) return '<div class="item" data-sid="' + s.id + '"><b>' + esc(s.nom) + ' veut faire le 🧭 DISPATCH</b> <span class="small">· ' + hhmm(s.demandeLe) + '</span>' +
    '<input class="rAdr hide" value="' + esc(d.adr) + '"><p class="small">Il pourra voir les commandes, les messages et faire des loads de son stock.</p>' +
    '<div class="two"><button class="btn red rNo">Refuser</button><button class="btn ok rYes">Autoriser</button></div><div class="err rErr"></div></div>';
  if (self && !canAuthorize(s)) return '<div class="item"><div class="wait"><span class="dot"></span><b>Ta soirée</b>&nbsp;attend MOUSSE ou Wayne.</div></div>';
  const src = loadSrc(d);
  const have = st(src);
  const over = !isOwner() && (d.L > (have.L || 0) || d.XL > (have.XL || 0));
  const gard = st(s.mid);
  return '<div class="item" data-sid="' + s.id + '"><b>' + esc(s.nom) + (s.mode === 'les2' ? ' veut LIVRER + faire le 🧭 DISPATCH' : ' veut commencer') + '</b> <span class="small">· ' + hhmm(s.demandeLe) + '</span>' +
    (s.refusLe ? '<div class="small" style="color:var(--danger)">A refusé le dernier load (pas le bon compte).</div>' : '') +
    '<div class="label" style="margin-top:10px">Adresse de départ (tu peux corriger)</div><input class="rAdr" value="' + esc(d.adr) + '">' +
    ((isOwner() || me.role === 'complet') && (gard.L || gard.XL) ? '<div class="small" style="margin:-2px 0 8px">Il a déjà sur lui : ' + qty(gard) + '</div>' : '') +
    (self ? '<div class="small" style="margin-bottom:8px">C’est toi : ta soirée s’ouvre avec ton stock.</div>' :
      '<div class="label">Load à lui envoyer' + (isOwner() ? ' (de la réserve)' : me.role === 'limite' ? ' (de ton stock)' : '') + '</div>' +
      (me.role === 'complet' ? '<div class="who">' + [[me.mid, 'De moi (' + qty(st(me.mid)) + ')'], [DEP(me.mid), 'Du dépôt (' + qty(st(DEP(me.mid))) + ')']].map((x) =>
        '<button class="rSrc ' + (src === x[0] ? 'on' : '') + '" data-src="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' : '') +
      '<div class="step"><span>L</span><button data-k="L" data-d="-1">−</button><div class="v">' + d.L + '</div><button data-k="L" data-d="1">+</button></div>' +
      '<div class="step"><span>XL</span><button data-k="XL" data-d="-1">−</button><div class="v">' + d.XL + '</div><button data-k="XL" data-d="1">+</button></div>' +
      (over ? '<div class="err">Tu n’as que ' + qty(have) + '.</div>' : '') +
      (!d.L && !d.XL ? '<div class="small" style="margin-bottom:8px">Sans load, il part avec ce qu’il a déjà.</div>' : '')) +
    (canAuthorize(s) ? '<div class="two"><button class="btn red rNo">Refuser</button><button class="btn ok rYes" ' + (over ? 'disabled' : '') + '>' + (self ? 'Ouvrir ma soirée' : 'Autoriser + envoyer') + '</button></div>'
      : '<div class="small">MOUSSE ou Wayne doit autoriser ta propre soirée.</div>') +
    '<div class="err rErr"></div></div>';
}
function bindReq(s) {
  const el = document.querySelector('#todo [data-sid="' + s.id + '"]'); if (!el || !el.querySelector('.rAdr')) return;
  const d = drafts[s.id];
  el.querySelector('.rAdr').oninput = (e) => { d.adr = e.target.value; };
  el.querySelectorAll('.rSrc').forEach((b) => { b.onclick = () => { d.src = b.dataset.src; renderDirect(); }; });
  el.querySelectorAll('.step button').forEach((b) => { b.onclick = () => { d[b.dataset.k] = Math.max(0, d[b.dataset.k] + Number(b.dataset.d)); document.activeElement.blur(); renderDirect(); }; });
  const yes = el.querySelector('.rYes'), no = el.querySelector('.rNo');
  if (yes) yes.onclick = () => run(el, () => authorize(s, d));
  if (no) no.onclick = () => run(el, () => refuseReq(s));
}
async function run(el, fn) {
  el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (e) { const er = el.querySelector('.rErr'); if (er) er.textContent = msg(e); el.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
}
async function authorize(s, d) {
  const b = writeBatch(db);
  const ref = doc(db, 'soirees', s.id);
  if (s.mid === me.mid || (!d.L && !d.XL)) {
    // Sa propre soirée, ou aucun load à envoyer (il part avec ce qu'il a déjà) : ouverte tout de suite.
    b.update(ref, { statut: 'ouverte', adresse: d.adr, autorisePar: me.mid, ouverteLe: serverTimestamp() });
  } else {
    const src = loadSrc(d);
    b.update(ref, { statut: 'load', adresse: d.adr, autorisePar: me.mid, autoriseLe: serverTimestamp(), load: { L: d.L, XL: d.XL, de: src } });
    if (src !== RESERVE && (d.L || d.XL)) b.set(doc(db, 'stocks', src), { L: increment(-d.L), XL: increment(-d.XL) }, { merge: true });
  }
  // lost fait le dispatch ce soir : la permission (vérifiée par les règles) pointe vers cette soirée.
  if (team[s.mid] && team[s.mid].role === 'limite' && doesDisp(s)) b.set(doc(db, 'dispatchOk', s.mid), { sid: s.id, par: me.mid, le: serverTimestamp() });
  await b.commit();
  delete drafts[s.id];
}
async function refuseReq(s) {
  await writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'refusee', refuseePar: me.mid, finLe: serverTimestamp() }).commit();
  delete drafts[s.id];
}

// ---------- Stock (propriétaire et dispatchs) ----------
const give = { to: null, from: null, L: 0, XL: 0 };
const livreursIds = () => Object.keys(team).filter((id) => team[id].actif && team[id].role === 'livreur');
function giveSources() {
  if (isOwner()) return [RESERVE].concat(Object.keys(team).filter((id) => team[id].actif && team[id].role === 'complet').map(DEP));
  if (me.role === 'complet') return [me.mid, DEP(me.mid)];
  return [me.mid];
}
function giveTargets(from) {
  const disp = Object.keys(team).filter((id) => team[id].actif && (team[id].role === 'complet' || team[id].role === 'limite'));
  const complets = disp.filter((id) => team[id].role === 'complet');
  if (isOwner()) return from === RESERVE ? disp.concat(complets.map(DEP)).concat(livreursIds()) : disp.concat(livreursIds()); // propriétaire → MOUSSE, son dépôt, lost, ou un livreur (de la réserve ou du dépôt)
  if (me.role === 'complet') {                                                               // MOUSSE : entre lui et son dépôt, ou à lost
    const other = from === DEP(me.mid) ? me.mid : DEP(me.mid);
    return [other].concat(disp.filter((id) => id !== me.mid)).concat(livreursIds());    // + n'importe quel livreur (il accepte)
  }
  return complets.concat(complets.map(DEP));                                                // lost : seulement retourner à MOUSSE ou à son dépôt
}
// v56 : Lost voit le stock des livreurs (jamais ceux de CACHES), un document à la fois (permis par les règles).
const limSt = {};
const limIds = () => Object.keys(team).filter((id) => id !== me.mid && team[id].role === 'livreur' && !hidId(id) && (team[id].actif || (stocks[id] && (stocks[id].L || stocks[id].XL))))
  .sort((a, b) => team[a].nom.localeCompare(team[b].nom, 'fr'));
function limStocks() {
  if (!me || me.role !== 'limite') return;
  const want = Object.keys(team).filter((id) => id !== me.mid && team[id].role === 'livreur' && !hidId(id));
  Object.keys(limSt).forEach((id) => { if (!want.includes(id)) { limSt[id](); delete limSt[id]; delete stocks[id]; } });
  want.forEach((id) => { if (!limSt[id]) limSt[id] = onSnapshot(doc(db, 'stocks', id), (s) => { if (s.exists()) stocks[id] = s.data(); else delete stocks[id]; renderAll(); }, () => {}); });
}
function renderStock() {
  const all = isOwner() || me.role === 'complet';
  const ids = all ? [].concat(...Object.keys(team).filter((id) => team[id].actif || (stocks[id] && (stocks[id].L || stocks[id].XL)))
    .sort((a, b) => ({ complet: 0, limite: 1, livreur: 2 }[team[a].role] - { complet: 0, limite: 1, livreur: 2 }[team[b].role]) || team[a].nom.localeCompare(team[b].nom, 'fr'))
    .map((id) => (team[id].role === 'complet' ? [id, DEP(id)] : [id]))) : me.role === 'limite' ? [me.mid].concat(limIds()) : [me.mid];
  $('stockList').innerHTML = ids.map((id) => '<div class="srow"><span>' + (isDep(id) ? '&nbsp;&nbsp;↳ ' : '') + esc(isDep(id) ? 'au dépôt' : nomDe(id) + (team[id] && team[id].role === 'complet' ? ' (sur lui)' : '')) + (id === me.mid ? ' · moi' : '') + '</span><b>' + qty(st(id)) + (isOwner() ? ' <button class="linkbtn" data-fix="' + id + '" style="padding:0 0 0 8px">✏️</button>' : '') + '</b></div>' + (isOwner() && fixS.id === id ? fixForm(id) : '')).join('') +
    (isOwner() ? '<button class="linkbtn" id="fixAll" style="margin-top:8px;color:var(--danger)">' + (fixS.all ? 'Appuie encore : tout le monde à 0 L · 0 XL' : '🔄 Remettre tout le monde à 0') + '</button><div class="err" id="fixErr"></div>' : '');
  bindFix(ids);
  const srcs = giveSources();
  if (srcs.indexOf(give.from) < 0) give.from = srcs[0];
  const tg = giveTargets(give.from);
  $('giveCard').classList.toggle('hide', !tg.length);
  if (give.to && tg.indexOf(give.to) < 0) give.to = null;
  if (!give.to && tg.length === 1) give.to = tg[0];
  const lbl = (id) => (me.role === 'complet' && id === me.mid ? 'Sur moi' : me.role === 'complet' && id === DEP(me.mid) ? 'Mon dépôt' : nomDe(id));
  $('giveTitle').textContent = isOwner() ? 'Donner du stock' : me.role === 'complet' ? 'Déplacer / donner du stock' : 'Retourner du stock';
  $('giveWho').innerHTML = (srcs.length > 1 ? '<div class="small" style="margin-bottom:6px">De :</div><div class="who" id="giveFrom">' + srcs.map((id) => '<button data-id="' + id + '" class="' + (give.from === id ? 'on' : '') + '">' + esc(id === RESERVE ? 'Réserve' : lbl(id)) + (id === RESERVE ? '' : ' (' + qty(st(id)) + ')') + '</button>').join('') + '</div><div class="small" style="margin-bottom:6px">Vers :</div>' : '') +
    '<div class="who" id="giveTo">' + tg.map((id) => '<button data-id="' + id + '" class="' + (give.to === id ? 'on' : '') + '">' + esc(lbl(id)) + '</button>').join('') + '</div>';
  document.querySelectorAll('#giveFrom button').forEach((b) => { b.onclick = () => { give.from = b.dataset.id; give.to = null; renderStock(); }; });
  document.querySelectorAll('#giveTo button').forEach((b) => { b.onclick = () => { give.to = b.dataset.id; renderStock(); }; });
  $('gL').textContent = give.L; $('gXL').textContent = give.XL;
  $('gGo').textContent = (me.role === 'limite' ? 'Retourner' : me.role === 'complet' && (give.to === me.mid || give.to === DEP(me.mid)) ? 'Déplacer' : 'Donner') + (give.to ? ' → ' + lbl(give.to) : '');
  $('mvts').innerHTML = mvts.map((m) => m.type === 'correction' ? hhmm(m.le) + ' · ✏️ ' + esc(nomDe(m.de)) + ' corrigé : ' + qty(m.avant || {}) + ' → ' + qty(m.apres || {}) + ' · par ' + esc(nomDe(m.par)) : hhmm(m.le) + ' · ' + esc(nomDe(m.de)) + ' → ' + esc(nomDe(m.vers)) + ' : ' + qty(m) + (m.type === 'load' ? ' (load)' : m.type === 'recharge' ? ' (recharge)' : m.type === 'annulation' ? ' (livraison annulée' + (m.client ? ' : ' + esc(m.client) : '') + ')' : m.type === 'ajustement' ? ' (livraison ajustée' + (m.client ? ' : ' + esc(m.client) : '') + ')' : '') + (m.par && m.par !== m.de ? ' · par ' + esc(nomDe(m.par)) : '')).join('<br>') || 'Aucun mouvement pour l’instant.';
}
document.querySelectorAll('#giveCard .step button').forEach((b) => { b.onclick = () => { give[b.dataset.k] = Math.max(0, give[b.dataset.k] + Number(b.dataset.d)); $('gErr').textContent = ''; renderStock(); }; });
$('gGo').onclick = async () => {
  $('gErr').textContent = '';
  if (!give.to) return ($('gErr').textContent = 'Choisis à qui.');
  if (!give.L && !give.XL) return ($('gErr').textContent = 'Mets une quantité.');
  const src = give.from || giveSources()[0];
  if (src !== RESERVE && (give.L > (st(src).L || 0) || give.XL > (st(src).XL || 0))) return ($('gErr').textContent = 'Tu n’as que ' + qty(st(src)) + '.');
  $('gGo').disabled = true;
  try {
    // v24 : à un livreur → il doit accepter. Le stock sort tout de suite de la source (il y retourne s'il refuse).
    if (team[give.to] && team[give.to].role === 'livreur') {
      const w = writeBatch(db);
      w.set(doc(collection(db, 'dons')), { de: src, vers: give.to, L: give.L, XL: give.XL, par: me.mid, statut: 'attente', le: serverTimestamp() });
      if (src !== RESERVE) w.set(doc(db, 'stocks', src), { L: increment(-give.L), XL: increment(-give.XL) }, { merge: true });
      await w.commit();
      notifyMsg(give.to, '📦 ' + nomDe(me.mid) + ' te donne ' + qty(give) + ' — accepte dans Gotham');
      give.L = 0; give.XL = 0; renderStock(); $('gGo').disabled = false; return;
    }
    // v23 : ce que le propriétaire donne à MOUSSE (sur lui ou au dépôt) attend que MOUSSE l'accepte.
    const toComplet = isOwner() && (isDep(give.to) || (team[give.to] && team[give.to].role === 'complet'));
    if (toComplet) {
      const w0 = writeBatch(db);
      w0.set(doc(collection(db, 'dons')), { de: src, vers: give.to, L: give.L, XL: give.XL, par: me.mid, statut: 'attente', le: serverTimestamp() });
      if (src !== RESERVE) w0.set(doc(db, 'stocks', src), { L: increment(-give.L), XL: increment(-give.XL) }, { merge: true }); // ex. du dépôt de MOUSSE vers MOUSSE
      await w0.commit();
      const qui = isDep(give.to) ? give.to.replace(/-depot$/, '') : give.to;
      notifyDispatch('📦 Le propriétaire te donne ' + qty(give) + (isDep(give.to) ? ' (au dépôt)' : isDep(src) ? ' (pris de ton dépôt)' : '') + ' — accepte dans Gotham', qui);
      give.L = 0; give.XL = 0; renderStock(); $('gGo').disabled = false; return;
    }
    const b = writeBatch(db);
    if (src !== RESERVE) b.set(doc(db, 'stocks', src), { L: increment(-give.L), XL: increment(-give.XL) }, { merge: true });
    b.set(doc(db, 'stocks', give.to), { L: increment(give.L), XL: increment(give.XL) }, { merge: true });
    b.set(doc(collection(db, 'mouvements')), { de: src, vers: give.to, L: give.L, XL: give.XL, type: me.role === 'limite' ? 'retour' : (isDep(src) || isDep(give.to)) && !isOwner() ? 'depot' : 'don', par: me.mid, le: serverTimestamp() });
    await b.commit();
    give.L = 0; give.XL = 0; renderStock();
  } catch (e) { $('gErr').textContent = msg(e); }
  $('gGo').disabled = false;
};

// ---------- Ma soirée (livreur) ----------
const ci = { q: '', pick: null, sugs: [], timer: null, seq: 0 };
function renderSoiree() {
  if (!me || !delivers()) return;
  if (document.activeElement && (['mcCash', 'chatTxt', 'dtAmt', 'dtNote', 'lvMix', 'ciPick', 'lvPayTxt'].includes(document.activeElement.id) || (document.activeElement.tagName === 'INPUT' && /^ub/.test(document.activeElement.id || '')))) return;
  if (typeof ret !== 'undefined' && ret.busy) return; // ne pas effacer ce qu'il tape
  const s = mySoiree, mine = st(me.mid);
  let h = '';
  if (!s) {
    const dmode = me.role === 'limite' && ci.mode === 'dispatch';
    h = '<div class="card"><div class="label">Commencer ma soirée</div>' +
      (me.role === 'limite' ? '<p class="small" style="margin-top:0">Ce soir je fais :</p><div class="seg" id="ciMode">' + [['livreur', '🚗 Livreur'], ['dispatch', '🧭 Dispatch'], ['les2', '🚗+🧭 Les deux']].map((x) =>
        '<button data-m="' + x[0] + '" class="' + ((ci.mode || 'livreur') === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' : '') +
      (dmode ? '' : (me.uber ? ciUberPre() + '<p class="small" style="margin-top:0"><b style="color:var(--text)">1. D’où tu envoies les Uber ?</b><br>Le dispatch s’en sert pour savoir où tu es.</p>' : '<p class="small" style="margin-top:0">Où es-tu en ce moment ?</p>') +
      '<input id="ciAdr" placeholder="Ex. 1400 Sainte-Catherine" autocomplete="off" value="' + esc(ci.q) + '">' +
      '<div id="ciSugs"></div>' +
      '<p class="small" style="margin-top:0">Tu peux aussi écrire une adresse qui n’est pas dans la liste.</p>' + (me.uber ? ciPickHtml() : '')) +
      ((mine.L || mine.XL) ? '<p class="small">Tu as déjà sur toi : <b style="color:var(--text)">' + qty(mine) + '</b></p>' : '') +
      (me.role === 'limite' ? '<p class="small">MOUSSE ou Wayne doit t’autoriser' + (ci.mode === 'dispatch' || ci.mode === 'les2' ? ' avant que tu puisses faire le dispatch.' : '.') + '</p>' : '') +
      '<div class="err" id="ciErr"></div><button class="btn ok" id="ciGo">Envoyer la demande</button></div>';
  } else if (s.statut === 'demande') {
    h = '<div class="card"><div class="wait"><span class="dot"></span><b>' + (me.role === 'limite' ? 'En attente de MOUSSE ou de Wayne…' : 'En attente du dispatch…') + '</b></div>' +
      '<p class="small">Adresse envoyée : ' + esc(s.adresse) + '</p><div class="err" id="ciErr"></div><button class="btn ghost" id="ciCancel">Annuler ma demande</button></div>';
  } else if (s.statut === 'load') {
    const L = s.load || {};
    h = '<div class="card alert"><div class="label">Ton load est arrivé</div>' +
      '<p style="margin:0 0 10px">' + esc(nomDe(L.de)) + ' t’envoie <b>' + (L.L || 0) + ' L</b> et <b>' + (L.XL || 0) + ' XL</b>.</p>' +
      '<p class="small" style="margin-top:0">Compte avant d’accepter. Avec ce que tu as déjà, tu auras ' + ((L.L || 0) + (mine.L || 0)) + ' L · ' + ((L.XL || 0) + (mine.XL || 0)) + ' XL.</p>' +
      '<div class="err" id="ciErr"></div><div class="two"><button class="btn red" id="ciRefuse">Pas le bon compte</button><button class="btn ok" id="ciAccept">J’accepte</button></div></div>';
  } else if (s.statut === 'ouverte' && isDispMode(s)) {
    h = '<div class="card"><div class="label">🧭 Tu fais le dispatch ce soir</div><p class="small" style="margin-top:0">Va dans En direct. Tu ne reçois pas de commandes à livrer.</p>' +
      '<div class="err" id="ciErr"></div><button class="btn ghost" id="ciEnd">' + (ci.endAsk ? 'Appuie encore pour confirmer' : 'Terminer mon dispatch') + '</button></div>';
  } else if (s.statut === 'ouverte') {
    h = rcLivreur(s) + (me.uber ? uberHtml(s) : myOrdersHtml(s));
  }
  const keepFocus = document.activeElement && document.activeElement.id === 'ciAdr';
  const pos = keepFocus ? document.activeElement.selectionStart : null;
  $('soiree').innerHTML = notifCard() + donsLivreur() + h;
  bindDonsLivreur();
  if ($('notifGo')) $('notifGo').onclick = () => { if (notifBusy) return; notifBusy = true; saveToken(true).finally(() => { notifBusy = false; }); };
  document.querySelectorAll('#ciMode button').forEach((b) => { b.onclick = () => { ci.mode = b.dataset.m; renderSoiree(); }; });
  if ($('ciEnd')) $('ciEnd').onclick = () => { if (!ci.endAsk) { ci.endAsk = true; renderSoiree(); return; } ci.endAsk = false; soirAct(() => writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'terminee', finLe: serverTimestamp() }).commit()); };
  if (!$('ciAdr') && $('ciGo')) $('ciGo').onclick = () => soirAct(requestStart);
  if ($('ciAdr')) {
    $('ciAdr').oninput = (e) => { ci.q = e.target.value; ci.pick = null; lookup(); };
    if (keepFocus) { $('ciAdr').focus(); try { $('ciAdr').setSelectionRange(pos, pos); } catch (e) {} }
    drawSugs();
    $('ciGo').onclick = () => soirAct(requestStart);
  }
  if ($('ciSame')) $('ciSame').onchange = (e) => { ci.same = e.target.checked; renderSoiree(); };
  if ($('ciPick')) $('ciPick').oninput = (e) => { ci.pickQ = e.target.value; };
  if ($('ciCancel')) $('ciCancel').onclick = () => soirAct(() => writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'annulee', finLe: serverTimestamp() }).commit());
  if ($('ciAccept')) $('ciAccept').onclick = () => soirAct(() => acceptLoad(s));
  if ($('ciRefuse')) $('ciRefuse').onclick = () => soirAct(() => refuseLoad(s));
  if (s && s.statut === 'ouverte') { if (me.uber) bindUber(s); else bindMyOrders(s); bindFinCard(s); bindRcLivreur(s); }
}
async function soirAct(fn) {
  document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (e) { if ($('ciErr')) $('ciErr').textContent = msg(e); }
  document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = false; });
}
// Suggestions d'adresses (Photon / OpenStreetMap, gratuit) : on attend que la personne arrête de taper.
function lookup() {
  clearTimeout(ci.timer);
  const q = ci.q.trim();
  if (q.length < 4) { ci.sugs = []; drawSugs(); return; }
  ci.timer = setTimeout(async () => {
    const my = ++ci.seq;
    const sg = await photon(q);
    if (my !== ci.seq) return;
    ci.sugs = sg;
    drawSugs();
  }, 250);
}
function drawSugs() {
  const box = $('ciSugs'); if (!box) return;
  box.innerHTML = ci.sugs.length && !ci.pick ? '<div class="sugs">' + ci.sugs.map((x, i) => '<div data-i="' + i + '">' + esc(x.l1) + '<div class="s2">' + esc(x.l2) + '</div></div>').join('') + '</div>' : '';
  box.querySelectorAll('[data-i]').forEach((d) => { d.onclick = () => { const x = ci.sugs[+d.dataset.i]; ci.pick = x; ci.q = x.l1 + ', ' + x.l2; $('ciAdr').value = ci.q; drawSugs(); }; });
}
async function requestStart() {
  const mode = me.role === 'limite' && (ci.mode === 'dispatch' || ci.mode === 'les2') ? ci.mode : 'livreur';
  const adr = mode === 'dispatch' ? 'Dispatch' : ci.q.trim();
  if (adr.length < 4) { $('ciErr').textContent = me.uber ? 'Écris d’où tu envoies les Uber.' : 'Écris où tu es.'; return; }
  if (me.uber) { // v31 : Samuel donne aussi son adresse de pick-up (gardée pour la prochaine fois)
    const pk = (ci.same ? adr : String(ci.pickQ || '')).trim();
    if (pk.length < 6) { $('ciErr').textContent = 'Écris l’adresse de pick-up (où les clients viennent chercher).'; return; }
    await setDoc(doc(db, 'reglages', me.mid), { pickAdr: pk.slice(0, 200), uberAdr: adr.slice(0, 200) });
  }
  const data = { mid: me.mid, nom: me.nom, statut: 'demande', mode, adresse: adr, demandeLe: serverTimestamp() };
  if (ci.pick && ci.pick.lat) { data.lat = ci.pick.lat; data.lon = ci.pick.lon; }
  await setDoc(doc(collection(db, 'soirees')), data);
  notifyDispatch('🙋 ' + me.nom + ' veut commencer' + (mode === 'dispatch' ? ' (dispatch)' : mode === 'les2' ? ' (livrer + dispatch)' : ' sa soirée'));
  ci.q = ''; ci.pick = null; ci.sugs = []; ci.pre = false;
}
async function acceptLoad(s) {
  const L = s.load || {};
  const b = writeBatch(db);
  b.update(doc(db, 'soirees', s.id), { statut: 'ouverte', ouverteLe: serverTimestamp() });
  b.set(doc(db, 'stocks', me.mid), { L: increment(L.L || 0), XL: increment(L.XL || 0), via: s.id }, { merge: true });
  b.set(doc(collection(db, 'mouvements')), { de: L.de || RESERVE, vers: me.mid, L: L.L || 0, XL: L.XL || 0, type: 'load', par: me.mid, soiree: s.id, le: serverTimestamp() });
  await b.commit();
}
async function refuseLoad(s) {
  const L = s.load || {};
  const b = writeBatch(db);
  b.update(doc(db, 'soirees', s.id), { statut: 'demande', refusLe: serverTimestamp() });
  if (L.de && L.de !== RESERVE && (L.L || L.XL)) b.set(doc(db, 'stocks', L.de), { L: increment(L.L || 0), XL: increment(L.XL || 0), via: s.id }, { merge: true });
  await b.commit();
}

// =====================================================================
// Version 5 : commandes, file 1-2-3, temps de route (Google Maps)
// =====================================================================
// commandes/{id}   : ce que le livreur a besoin de voir (client, adresse, L/XL, ce qu'il doit encaisser, bloqué ou non).
// cmdPrive/{id}    : montants et paiement complet (EMT) : propriétaire et dispatchs seulement.
// config/app       : prix et clé Google Maps (entrés par le propriétaire).
// Règles de temps (décidées par le propriétaire) : 4 min de marge pour partir sur la 1re commande,
// 2 min pour chacune des suivantes, 7 min sur place. Retard : gris jusqu'à 10 min, rouge après.
// « Sur son chemin » : proposé si le détour est de 10 min ou moins, jamais avant la commande où il s'en va.

const SUR_PLACE = 7, MARGE1 = 4, MARGE = 2, DETOUR_MAX = 10;
let cfg = { prixL: 150, prixXL: 220, mapsKey: '' };
let cmds = {}, prive = {}, myCmds = [], myDone = 0;
const ttMem = {}; // mémoire des temps de route (15 min)

function startOrders() {
  startTestSweep();
  stops.push(onSnapshot(doc(db, 'config', 'app'), (s) => { if (s.exists()) cfg = Object.assign({ prixL: 150, prixXL: 220, mapsKey: '' }, s.data()); renderAll(); renderSoiree(); renderCfg(); }, () => {}));
  if (isOwner() || isStaff()) {
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('statut', 'in', ['attente', 'assignee', 'ici'])), (qs) => {
      cmds = {}; qs.forEach((d) => { if (!hidDoc(d.data())) cmds[d.id] = Object.assign({ id: d.id }, d.data()); }); renderAll(); qtySync();
    }, (e) => console.warn(e)));
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('nonRecu', '==', true)), (qs) => { // v41
      nr.list = []; qs.forEach((d) => nr.list.push(Object.assign({ id: d.id }, d.data()))); nr.list = nr.list.filter((c) => c.statut === 'livree' && !hidDoc(c)).sort((a, b) => tsMs(a.livreeLe) - tsMs(b.livreeLe));
      nrPrv(); nrBadge(); if (curTab === 'histo') drawHisto();
    }, (e) => console.warn(e)));
    { const k0 = dayKey(soirStart()), k1 = dayKey(new Date(soirStart().getTime() - 86400000)); // v42 : ventes des livreurs
      stops.push(onSnapshot(query(collection(db, 'commandes'), where('venteJour', 'in', [k0, k1])), (qs) => {
        qs.forEach((d) => { const c = Object.assign({ id: d.id }, d.data()); if (c.vente && !hidDoc(c)) ventePop(c); }); }, (e) => console.warn(e))); }
    stops.push(onSnapshot(collection(db, 'reglages'), (qs) => { regs = {}; qs.forEach((d) => { if (!hidId(d.id)) regs[d.id] = d.data(); }); }, () => {}));
    stops.push(onSnapshot(query(collection(db, 'cmdPrive'), where('actif', '==', true)), (qs) => {
      prive = {}; qs.forEach((d) => { prive[d.id] = d.data(); }); renderAll();
    }, (e) => console.warn(e)));
  }
  if (delivers() && me.uber) stops.push(onSnapshot(doc(db, 'reglages', me.mid), (s) => { myReg = s.exists() ? s.data() : {}; renderSoiree(); }, () => {}));
  if (delivers()) {
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', 'in', ['assignee', 'ici'])), (qs) => {
      myCmds = []; qs.forEach((d) => myCmds.push(Object.assign({ id: d.id }, d.data()))); myCmds.sort((a, b) => a.ordre - b.ordre); renderSoiree();
    }, (e) => console.warn(e)));
    // v40 : commandes ajoutées et changements vers cash à approuver
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('aValider', '==', true)), (qs) => {
      av.list = []; qs.forEach((d) => av.list.push(Object.assign({ id: d.id }, d.data()))); av.list.sort((a, b) => tsMs(a.livreeLe) - tsMs(b.livreeLe)); drawVal();
    }, (e) => console.warn(e)));
  }
}

// ---------- Temps de route ----------
function km(a, b) {
  const R = 6371, dl = (b.lat - a.lat) * Math.PI / 180, dg = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const rive = (p) => (p.lon > -73.52 ? 's' : p.lat > 45.55 && p.lon < -73.66 ? 'l' : 'm'); // Rive-Sud / Laval / Montréal (ponts)
function estime(a, b) { if (!a || !b || a.lat == null || b.lat == null) return 15; return Math.round(km(a, b) * 2.2 + 3 + (rive(a) !== rive(b) ? 8 : 0)); }
const kOf = (a, b) => [a.lat, a.lon, b.lat, b.lon].map((x) => Number(x).toFixed(3)).join(',');
// Demande à Google le temps de route de plusieurs départs vers une arrivée (avec ou sans trafic).
async function googleTimes(origins, dest, trafic) {
  const out = origins.map((o) => { const m = ttMem[kOf(o, dest)]; return m && Date.now() - m.t < 15 * 60000 ? m.min : null; });
  const need = origins.map((o, i) => (out[i] == null && o && o.lat != null ? i : -1)).filter((i) => i >= 0);
  if (!need.length || !cfg.mapsKey || dest.lat == null) return out.map((v, i) => (v == null ? estime(origins[i], dest) : v));
  try {
    const body = {
      origins: need.map((i) => ({ waypoint: { location: { latLng: { latitude: origins[i].lat, longitude: origins[i].lon } } } })),
      destinations: [{ waypoint: { location: { latLng: { latitude: dest.lat, longitude: dest.lon } } } }],
      travelMode: 'DRIVE', routingPreference: trafic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE', regionCode: 'CA'
    };
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.mapsKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    (Array.isArray(j) ? j : []).forEach((e) => {
      const i = need[e.originIndex || 0];
      if (e.condition === 'ROUTE_EXISTS' && e.duration) { const min = Math.max(1, Math.round(parseInt(e.duration, 10) / 60)); out[i] = min; ttMem[kOf(origins[i], dest)] = { min, t: Date.now() }; }
    });
  } catch (e) { console.warn('Google Maps', e); }
  return out.map((v, i) => (v == null ? estime(origins[i], dest) : v));
}

// ---------- Plan d'un livreur : heures d'arrivée ----------
const pos = (c) => (c && c.lat != null ? { lat: c.lat, lon: c.lon } : null);
const tsMs = (t) => (t && t.toMillis ? t.toMillis() : t || Date.now());
function queueOf(mid) { return Object.values(cmds).filter((c) => c.livreur === mid && (c.statut === 'assignee' || c.statut === 'ici')).sort((a, b) => a.ordre - b.ordre); }
function soireeOf(mid) { return Object.values(soirees).find((s) => s.mid === mid && working(s)); }
// trajet = minutes depuis l'arrêt d'avant (enregistré à l'assignation) ; depart = quand la 1re commande a commencé.
function planOf(list) {
  const out = []; let t = null;
  list.forEach((c, i) => {
    if (c.statut === 'ici') { t = tsMs(c.iciLe); out.push(t); t += SUR_PLACE * 60000; return; }
    if (i === 0) t = tsMs(c.depart) + MARGE1 * 60000;
    else t += MARGE * 60000;
    t += ((c.trajet || 15) + (c.retard || 0)) * 60000;
    out.push(t); t += SUR_PLACE * 60000;
  });
  return out;
}
const hm = (ms) => { const d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const lateTag = (m) => (m > 10 ? '<span class="late">+' + m + ' min retard</span>' : '<span class="small">+' + m + ' min</span>');

// ---------- Prix et paiement ----------
const totalOf = (o) => (o.L || 0) * cfg.prixL + (o.XL || 0) * cfg.prixXL + (o.frais || 0);
function payTag(c) {
  const p = prive[c.id] || {};
  if (c.bloque) return '<span class="pay p-no">' + (p.mode === 'mix' ? p.cash + ' $ cash + EMT pas reçu' : p.mode === 'mixc' ? p.cash + ' $ cash + crypto pas reçu' : p.mode === 'cry' ? 'Crypto pas reçu' : 'EMT pas reçu') + '</span>';
  if (p.mode === 'mixc') return '<span class="pay p-cash">' + p.cash + ' $ cash</span><span class="pay p-int" style="background:#3b2350;color:#c4b5fd">+ crypto reçu' + (c.crypto ? ' · ' + esc(c.crypto) : '') + '</span>';
  if (p.mode === 'cry') return '<span class="pay p-int" style="background:#3b2350;color:#c4b5fd">🟣 Crypto reçu' + (c.crypto ? ' · ' + esc(c.crypto) : '') + '</span>';
  if (p.mode === 'mix') return '<span class="pay p-cash">' + p.cash + ' $ cash</span><span class="pay p-int">+ EMT reçu</span>';
  if (p.mode === 'int') return '<span class="pay p-int">EMT reçu</span>';
  return '<span class="pay p-cash">Cash ' + (c.encaisser || 0) + ' $</span>';
}

// ---------- Créer une commande (dispatch) ----------
let NF = null; // formulaire en cours
const nf = { timer: null, seq: 0, sugs: [] };
function newOrder() { NF = { client: '', tel: '', q: '', pick: null, L: 1, XL: 0, frais: 0, meth: 'cash', recu: false, cashPart: 0, note: '', plus: false, more: false, opts: null, busy: false }; renderNew(); }
function renderNew() {
  const box = $('cmdNew'); if (!box) return;
  if (!NF) { box.innerHTML = '<button class="fab" id="nfOpen" aria-label="Créer une commande">＋</button>'; $('nfOpen').onclick = () => { newOrder(); setTimeout(() => { const el = $('cmdNew'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); }; return; }
  const f = NF, tot = totalOf(f);
  const focusId = document.activeElement && document.activeElement.id;
  box.innerHTML = '<div class="card"><div class="label">Nouvelle commande</div>' +
    (f.pasted ? '<div class="small" style="margin:-4px 0 8px;color:var(--cash)">✓ Rempli à partir du message. Vérifie l’adresse et les quantités, puis choisis le paiement.</div>' : '') +
    '<input id="nfClient" placeholder="Nom du client" value="' + esc(f.client) + '">' +
    '<input id="nfAdr" placeholder="Adresse (ex. 5000 jean-talon)" autocomplete="off" value="' + esc(f.q) + '"><div id="nfSugs"></div>' +
    '<div class="step"><span>L</span><button data-k="L" data-d="-1">−</button><div class="v">' + f.L + '</div><button data-k="L" data-d="1">+</button>' +
    '<span style="margin-left:10px">XL</span><button data-k="XL" data-d="-1">−</button><div class="v">' + f.XL + '</div><button data-k="XL" data-d="1">+</button></div>' +
    '<div class="small" style="margin-bottom:4px">Comment le client paie ?</div><div class="seg" id="nfMeth">' + [['cash', '🔵 Cash'], ['int', '🟡 EMT'], ['cry', '🟣 Crypto'], ['mix', '🔵🟡 Les deux']].map((x) => '<button data-m="' + x[0] + '" class="' + (f.meth === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
    (f.meth === 'mix' ? '<div class="mixbox"><div class="two"><div><div class="small">Partie cash ($)</div><input id="nfCash" type="number" inputmode="numeric" value="' + f.cashPart + '"></div><div><div class="small">Partie EMT</div><div class="mixv" id="nfInt">' + Math.max(0, tot - f.cashPart) + ' $</div></div></div></div>' : '') +
    (f.meth !== 'cash' ? '<label class="chk"><input type="checkbox" id="nfRecu" ' + (f.recu ? 'checked' : '') + '> ' + (f.meth === 'cry' ? 'Crypto' : 'EMT') + ' déjà reçu' + (f.recu ? '' : ' <span class="small">(sinon le livreur attend ta confirmation)</span>') + '</label>' : '') +
    (f.meth === 'cry' && f.recu ? '<div class="small" style="margin:2px 0 4px"><b style="color:var(--text)">Quelle crypto ?</b> (obligatoire)</div><div class="seg" id="nfCoin">' + COINS.map((x) => '<button data-k="' + x[0] + '" class="' + (f.coin === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
      (f.coin === 'autre' ? '<input id="nfCoinA" placeholder="Laquelle ? (ex. LTC)" value="' + esc(f.coinA || '') + '">' : '') : '') +
    (f.plus ? '<input id="nfTel" placeholder="Téléphone du client (optionnel)" inputmode="tel" value="' + esc(f.tel) + '">' +
      '<div class="small" style="margin-bottom:4px">Frais de livraison</div><div class="seg" id="nfFee">' + [0, 20, 30, 40].map((v) => '<button data-v="' + v + '" class="' + (f.frais === v ? 'on' : '') + '">' + (v ? '+' + v + ' $' : 'Aucun') + '</button>').join('') + '</div>' +
      '<input id="nfNote" placeholder="Note pour le livreur (optionnel)" value="' + esc(f.note) + '">'
      : '<button class="linkbtn" id="nfPlus">+ Téléphone, frais, note</button>') +
    '<div class="small" style="margin-bottom:8px">Total : <b style="color:var(--text)">' + tot + ' $</b></div>' +
    '<div id="nfAssign"></div><div class="err" id="nfErr"></div>' +
    '<div class="two"><button class="btn ghost" id="nfCancel">Annuler</button><button class="btn ghost" id="nfKeep">Garder sans assigner</button></div></div>';
  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('nfClient', 'oninput', (e) => { f.client = e.target.value; });
  on('nfPaste', 'oninput', (e) => { clearTimeout(nf.pt); const v = e.target.value; if (v.trim().length > 8) nf.pt = setTimeout(() => applyPaste(v), 400); });
  on('nfAdr', 'oninput', (e) => { f.q = e.target.value; f.pick = null; f.opts = null; drawAssign(); nfLookup(); });
  on('nfTel', 'oninput', (e) => { f.tel = e.target.value; });
  on('nfNote', 'oninput', (e) => { f.note = e.target.value; });
  on('nfCash', 'oninput', (e) => { f.cashPart = Math.max(0, Math.min(totalOf(f), Number(e.target.value) || 0)); $('nfInt').textContent = (totalOf(f) - f.cashPart) + ' $'; });
  on('nfRecu', 'onchange', (e) => { f.recu = e.target.checked; renderNew(); });
  on('nfPlus', 'onclick', () => { f.plus = true; renderNew(); });
  on('nfCancel', 'onclick', () => { NF = null; renderNew(); });
  on('nfKeep', 'onclick', () => saveOrder(null));
  document.querySelectorAll('#cmdNew .step button').forEach((b) => { b.onclick = () => { f[b.dataset.k] = Math.max(0, f[b.dataset.k] + Number(b.dataset.d)); f.opts = null; renderNew(); computeOpts(); }; });
  document.querySelectorAll('#nfCoin button').forEach((b) => { b.onclick = () => { f.coin = b.dataset.k; renderNew(); }; });
  if ($('nfCoinA')) $('nfCoinA').oninput = (e) => { f.coinA = e.target.value; };
  document.querySelectorAll('#nfMeth button').forEach((b) => { b.onclick = () => { f.meth = b.dataset.m; if (f.meth === 'mix' && !f.cashPart) f.cashPart = Math.round(totalOf(f) / 20) * 10; renderNew(); }; });
  document.querySelectorAll('#nfFee button').forEach((b) => { b.onclick = () => { f.frais = Number(b.dataset.v); renderNew(); }; });
  if (focusId && $(focusId) && focusId.indexOf('nf') === 0) { const el = $(focusId); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
  drawNfSugs(); drawAssign();
}
function nfLookup() {
  clearTimeout(nf.timer);
  const q = NF.q.trim();
  if (q.length < 4) { nf.sugs = []; drawNfSugs(); return; }
  nf.timer = setTimeout(async () => { const my = ++nf.seq; const s = await photon(q); if (my === nf.seq) { nf.sugs = s; drawNfSugs(); } }, 250);
}
// Adresses : Adresses Québec (gouvernement, gratuit, toutes les adresses civiques) d'abord ;
// Photon / OpenStreetMap seulement en secours. Les adresses du Grand Montréal passent en premier.
const MTL = [45.508, -73.587];
function kmMtl(lat, lon) { const dx = (lon - MTL[1]) * 78.7, dy = (lat - MTL[0]) * 111.2; return Math.sqrt(dx * dx + dy * dy); }
function fmtCp(c) { c = (c || '').toUpperCase().replace(/\s/g, ''); return c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c; }
async function icherche(q) {
  try {
    const r = await fetch('https://geoegl.msp.gouv.qc.ca/apis/icherche/geocode?type=adresses&geometry=true&limit=8&q=' + encodeURIComponent(q));
    const j = await r.json();
    return (j.features || []).map((f) => {
      const nom = String((f.properties || {}).nom || ''); const i = nom.lastIndexOf(',');
      const l1 = (i > 0 ? nom.slice(0, i) : nom).trim();
      const rest = i > 0 ? nom.slice(i + 1).trim() : '';
      const m = rest.match(/^(.*?)\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)?$/i);
      const ville = m ? m[1].trim() : rest; const cp = m && m[2] ? fmtCp(m[2]) : '';
      const c = f.geometry && f.geometry.coordinates;
      return { l1, l2: [ville, 'QC'].filter(Boolean).join(', ') + (cp ? ' ' + cp : ''), lat: c && c[1], lon: c && c[0] };
    }).filter((x) => x.l1);
  } catch (e) { return []; }
}
async function photon(q) {
  const ville = /montr[ée]al|laval|longueuil|brossard|[a-z]\d[a-z]\s?\d[a-z]\d/i.test(q);
  const [a, b] = await Promise.all([icherche(q), ville ? Promise.resolve([]) : icherche(q + ' Montréal')]);
  const near = (x) => !!(x.lat && kmMtl(x.lat, x.lon) < 40);
  let all = b.concat(a);
  if (!all.some(near)) all = all.concat(await photonRaw(q)); // secours seulement
  const seen = {};
  all = all.filter((x) => { const k = (x.l1 + '|' + x.l2).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  // Classement : les mots tapés retrouvés dans la rue, puis Montréal, puis le Grand Montréal, puis l'ordre reçu.
  const nrm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mots = nrm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
  all.forEach((x, i) => {
    const l1 = nrm(x.l1);
    x._i = i; x._m = mots.filter((w) => l1.indexOf(w) >= 0).length;
    x._n = /montreal/.test(nrm(x.l2)) ? 2 : near(x) ? 1 : 0;
  });
  all.sort((x, y) => (y._m - x._m) || (y._n - x._n) || (x._i - y._i));
  return all.slice(0, 5).map((x) => ({ l1: x.l1, l2: x.l2, lat: x.lat, lon: x.lon }));
}
async function photonRaw(q) {
  try {
    const r = await fetch('https://photon.komoot.io/api/?limit=6&lang=fr&lat=45.52&lon=-73.6&bbox=-79.8,44.9,-57.1,62.6&q=' + encodeURIComponent(q));
    const j = await r.json(); const seen = {};
    return (j.features || []).map((f) => {
      const p = f.properties || {};
      const l1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
      const l2 = [p.city || p.town || p.village || p.district, 'QC', p.postcode].filter(Boolean).join(' ').replace(' QC ', ', QC ');
      return { l1, l2, lat: f.geometry && f.geometry.coordinates[1], lon: f.geometry && f.geometry.coordinates[0], st: p.state };
    }).filter((x) => x.l1 && (!x.st || /qu[ée]bec/i.test(x.st))).filter((x) => { const k = x.l1 + x.l2; if (seen[k]) return false; seen[k] = 1; return true; })
  } catch (e) { return []; }
}
function drawNfSugs() {
  const box = $('nfSugs'); if (!box || !NF) return;
  box.innerHTML = nf.sugs.length && !NF.pick ? '<div class="sugs">' + nf.sugs.map((x, i) => '<div data-i="' + i + '">' + esc(x.l1) + '<div class="s2">' + esc(x.l2) + '</div></div>').join('') + '</div>' : '';
  box.querySelectorAll('[data-i]').forEach((d) => { d.onclick = () => { const x = nf.sugs[+d.dataset.i]; NF.pick = x; NF.q = x.l1 + ', ' + x.l2; $('nfAdr').value = NF.q; drawNfSugs(); computeOpts(); }; });
}

// Options : pour chaque livreur en service, à la fin de sa file, ou « sur son chemin » (détour ≤ 10 min).
function stockLeft(mid) { const s = st(mid); const q = queueOf(mid); return { L: (s.L || 0) - q.reduce((a, c) => a + (c.L || 0), 0), XL: (s.XL || 0) - q.reduce((a, c) => a + (c.XL || 0), 0) }; }
async function optionsFor(o, skipId) {
  const X = pos(o);
  const people = Object.values(soirees).filter((s) => working(s) && !isUberMid(s.mid));
  const cand = [];
  people.forEach((s) => {
    const q = queueOf(s.mid).filter((c) => c.id !== skipId), plan = planOf(q);
    const left = stockLeft(s.mid); if (skipId && cmds[skipId] && cmds[skipId].livreur === s.mid) { left.L += cmds[skipId].L || 0; left.XL += cmds[skipId].XL || 0; }
    const ok = left.L >= (o.L || 0) && left.XL >= (o.XL || 0);
    const start = pos(s.dernier) || pos(s) || X; // v45 : file vide = part de sa dernière livraison (sinon du check-in)
    const lastPos = q.length ? pos(q[q.length - 1]) : start;
    const endBase = q.length ? plan[plan.length - 1] + SUR_PLACE * 60000 + MARGE * 60000 : Date.now() + MARGE1 * 60000;
    cand.push({ mid: s.mid, nom: s.nom, kind: 'fin', idx: q.length, from: lastPos, base: endBase, est: estime(lastPos, X), ok, left, avant: q.length });
    for (let k = 1; k < q.length; k++) {
      const A = pos(q[k - 1]), B = pos(q[k]); if (!A || !B || !X) continue;
      const det = estime(A, X) + estime(X, B) - estime(A, B);
      if (det <= DETOUR_MAX) cand.push({ mid: s.mid, nom: s.nom, kind: 'chemin', idx: k, from: A, to: B, base: plan[k - 1] + SUR_PLACE * 60000 + MARGE * 60000, est: estime(A, X), detour: det, apres: q[k - 1].client, avantDe: q[k].client, ok, left, prevOrdre: q[k - 1].ordre, nextOrdre: q[k].ordre, nextId: q[k].id });
    }
  });
  cand.forEach((c) => { c.arr = c.base + c.est * 60000; });
  cand.sort((a, b) => (b.ok - a.ok) || (a.arr - b.arr));
  // Google (avec trafic) seulement pour les 2 meilleurs choix.
  const top = cand.filter((c) => c.ok).slice(0, 2);
  if (top.length && X) {
    const g = await googleTimes(top.map((c) => c.from), X, true);
    top.forEach((c, i) => { c.trajet = g[i]; c.arr = c.base + g[i] * 60000; });
    cand.sort((a, b) => (b.ok - a.ok) || (a.arr - b.arr));
  }
  cand.forEach((c) => { if (c.trajet == null) c.trajet = c.est; });
  return cand;
}
async function computeOpts() {
  if (!NF || !NF.pick || !(NF.L || NF.XL)) { if (NF) { NF.opts = null; drawAssign(); } return; }
  const f = NF; f.opts = 'calc'; drawAssign();
  const o = await optionsFor({ lat: f.pick.lat, lon: f.pick.lon, L: f.L, XL: f.XL });
  if (NF === f) { f.opts = o; drawAssign(); }
}
function optLine(c, best, i) {
  const title = c.kind === 'chemin' ? '🛣️ ' + esc(c.nom) + ' — sur son chemin' : esc(c.nom) + (c.avant ? ' — à la fin de sa file' : ' — libre');
  const det = !c.ok ? 'pas assez de stock (' + c.left.L + ' L, ' + c.left.XL + ' XL)' : c.kind === 'chemin' ? 'entre ' + esc(c.apres) + ' et ' + esc(c.avantDe) + ' · détour +' + c.detour + ' min · arriverait ~' + hm(c.arr) : 'arriverait ~' + hm(c.arr) + (c.avant ? ' · après ' + c.avant + ' commande' + (c.avant > 1 ? 's' : '') : '');
  return '<div class="sugg' + (best ? ' best' : '') + (c.kind === 'chemin' ? ' road' : '') + '"><div><b>' + title + '</b><div class="t">' + det + '</div></div><button class="btn ' + (best ? 'ok' : 'ghost') + ' sm" data-o="' + i + '" ' + (c.ok ? '' : 'disabled') + '>' + (c.kind === 'chemin' ? 'Insérer' : 'Assigner') + '</button></div>';
}
function drawAssign() {
  const box = $('nfAssign'); if (!box || !NF) return;
  const f = NF;
  const ubH = uberBtns({ L: f.L, XL: f.XL, int: f.meth === 'int' || f.meth === 'cry', adr: !!f.q.trim() });
  if (ubH) { let a = $('nfUber'); if (!a) { a = document.createElement('div'); a.id = 'nfUber'; box.parentNode.insertBefore(a, box); } a.innerHTML = ubH; a.querySelectorAll('[data-ub]').forEach((el) => { el.onclick = () => saveOrder(uberOpt(el.dataset.ub)); }); }
  else if ($('nfUber')) $('nfUber').remove();
  if (!f.pick) { box.innerHTML = '<div class="small" style="margin-bottom:8px">Choisis une adresse dans la liste : l’app trouve le livreur qui arrive le plus vite.</div>'; return; }
  if (f.opts === 'calc') { box.innerHTML = '<div class="small" style="margin-bottom:8px">Calcul des temps de route…</div>'; return; }
  const o = f.opts || [];
  if (!o.length) { box.innerHTML = '<div class="small" style="margin-bottom:8px">Aucun livreur en service. Tu peux garder la commande sans l’assigner.</div>'; return; }
  const b = o[0];
  if (!b.ok) { box.innerHTML = '<div class="small" style="color:var(--danger);margin-bottom:8px">Aucun livreur n’a assez de stock.</div>' + o.map((c, i) => optLine(c, false, i)).join(''); }
  else {
    const why = b.kind === 'chemin' ? '🛣️ sur son chemin, entre ' + esc(b.apres) + ' et ' + esc(b.avantDe) + ' (détour +' + b.detour + ' min)' : b.avant ? 'après ses ' + b.avant + ' commande' + (b.avant > 1 ? 's' : '') : 'il est libre';
    box.innerHTML = '<button class="btn ok big" data-o="0" style="margin-bottom:6px">Assigner à ' + esc(b.nom) + ' · arrivée ~' + hm(b.arr) + '</button>' +
      '<div class="small" style="margin-bottom:8px">Le plus rapide : ' + why + '.</div>' +
      (f.more ? '<div class="label">Autres choix</div>' + o.slice(1).map((c, i) => optLine(c, false, i + 1)).join('') : (o.length > 1 ? '<button class="linkbtn" id="nfMore">Autre livreur ▾</button>' : ''));
  }
  box.querySelectorAll('[data-o]').forEach((el) => { el.onclick = () => saveOrder(o[+el.dataset.o]); });
  if ($('nfMore')) $('nfMore').onclick = () => { f.more = true; drawAssign(); };
}
// Enregistre la commande (et l'assigne si un choix est donné).
async function saveOrder(opt) {
  const f = NF; if (!f || f.busy) return;
  $('nfErr').textContent = '';
  if (!f.q.trim() && !(opt && opt.type === 'pickup')) return ($('nfErr').textContent = 'Écris l’adresse.');
  if (!f.L && !f.XL) return ($('nfErr').textContent = 'Mets au moins 1 L ou 1 XL.');
  f.busy = true;
  try {
    const tot = totalOf(f);
    const mode = f.meth, recu = f.meth === 'cash' ? true : f.recu;
    const coin = mode === 'cry' && recu ? coinOf(f.coin, f.coinA) : '';
    if (mode === 'cry' && recu && !coin) { f.busy = false; return ($('nfErr').textContent = 'Choisis la crypto (BTC, ETH…).'); }
    const encaisser = mode === 'cash' ? tot : mode === 'mix' ? f.cashPart : 0;
    const ref = doc(collection(db, 'commandes'));
    const code = newCode();
    const data = { test: isTestName(f.client), suivi: code, client: f.client.trim() || 'Client', tel: f.tel.trim(), adresse: f.q.trim() || 'Pick-up', L: f.L, XL: f.XL, frais: f.frais, note: f.note.trim(),
      encaisser, paye: recu && (mode === 'int' || mode === 'cry'), bloque: !recu, statut: 'attente', livreur: null, retard: 0, creeLe: serverTimestamp(), creePar: myMid(), paieMode: mode };
    if (mode !== 'cash' && recu) Object.assign(data, { confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() }, coin ? { crypto: coin } : {});
    if (f.pick && f.pick.lat != null) { data.lat = f.pick.lat; data.lon = f.pick.lon; }
    const b = writeBatch(db);
    if (opt) Object.assign(data, await assignFields(opt, data));
    b.set(ref, data);
    b.set(doc(db, 'suivi', code), { actif: true, statut: opt ? 'assignee' : 'attente', eta: opt && !opt.type ? Math.round(opt.arr) : null, luid: opt ? uidOf(opt.mid) : null, prenom: prenom(data.client), le: serverTimestamp() });
    b.set(doc(db, 'cmdPrive', ref.id), { actif: true, total: tot, mode, cash: encaisser, interac: tot - encaisser, recu, prixL: cfg.prixL, prixXL: cfg.prixXL, le: serverTimestamp() });
    if (opt) await nextFix(b, opt, data);
    await b.commit();
    if (opt) notifyOrder(ref.id);
    NF = null; nf.sugs = []; renderNew();
  } catch (e) { $('nfErr').textContent = msg(e); f.busy = false; }
}
// Champs d'assignation : ordre dans la file, temps de route depuis l'arrêt d'avant, départ si c'est la 1re.
async function assignFields(opt, c) {
  const q = queueOf(opt.mid);
  const ordre = opt.kind === 'chemin' ? (opt.prevOrdre + opt.nextOrdre) / 2 : (q.length ? q[q.length - 1].ordre + 1 : 1);
  const out = { livreur: opt.mid, livreurNom: opt.nom, statut: 'assignee', ordre, trajet: opt.trajet, assigneLe: serverTimestamp(), assignePar: me.mid };
  if (!q.length) out.depart = Date.now();
  if (opt.type) { out.type = opt.type; out.accepte = false; out.uberLien = null; out.uberEta = null; out.pickAdr = opt.type === 'pickup' ? ((regs[opt.mid] && regs[opt.mid].pickAdr) || '') : null; }
  return out;
}
// Quand on insère « sur le chemin », la commande d'après part maintenant du nouvel arrêt.
async function nextFix(b, opt, c) {
  if (opt.kind !== 'chemin' || !opt.nextId) return;
  const g = await googleTimes([pos(c)], opt.to, false);
  b.update(doc(db, 'commandes', opt.nextId), { trajet: g[0] });
}

// ---------- Files des livreurs (dispatch) ----------
let menuOpen = null, msgOpen = null, reassign = null;
// v22 : en haut les livreurs en pastilles (toucher = sa file), « Maintenant » = ce qui se passe chez les livreurs,
// « À assigner » = nouvelles commandes. Au plus 2 cartes visibles dans chaque bloc ; le reste attend derrière.
// Couleurs : rouge = urgent, orange = à assigner, vert = ça va, gris = le reste.
let svcSel = null, nowMore = false, freeMore = false;
const minDe = (t) => Math.max(0, Math.floor((Date.now() - tsMs(t)) / 60000));
const attendPaie = (c) => !!(c.bloque || c.demandePaie);
// v53 : 🔒 retour d'un livreur Uber déconnecté par le dispatch
let sortis = {}; const sx = { busy: null, ask: null };
function sortiGate(x) {
  let ov = $('sortiOv');
  if (!x || x.etat !== 'attente') { if (ov) ov.remove(); return; }
  if (!ov) { ov = document.createElement('div'); ov.id = 'sortiOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:70;background:#0b0d11;color:#e8eaed;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px'; document.body.appendChild(ov); }
  ov.innerHTML = '<div style="font-size:54px">⏳</div><div style="font-size:22px;font-weight:800;margin:10px 0 6px">En attente du dispatch…</div><div style="color:#9aa0a6">Le dispatch doit accepter ton retour.</div><button id="sortiOut" style="margin-top:28px;background:none;border:1px solid #3a414d;color:#cbd5e1;border-radius:12px;padding:10px 16px">Se déconnecter</button>';
  $('sortiOut').onclick = () => signOut(auth);
}
function startSortis() {
  if (!(isOwner() || isStaff())) return;
  stops.push(onSnapshot(collection(db, 'sortis'), (qs) => { sortis = {}; qs.forEach((d) => { if (!hidId(d.id)) sortis[d.id] = d.data(); }); renderQueues(); }, () => {}));
}
function sortisHtml() {
  const L = Object.entries(sortis).filter(([, x]) => x.etat === 'attente');
  return L.map(([mid, x]) => '<div class="item" style="border:1px solid #f5c518"><b>🔒 ' + esc(x.nom || nomDe(mid)) + ' veut revenir</b><div class="small" style="margin:2px 0 8px">Déconnecté par ' + esc(x.parNom || 'le dispatch') + '</div>' +
    '<div class="two"><button class="btn ok sm" data-srt="ok|' + esc(mid) + '"' + (sx.busy ? ' disabled' : '') + '>✅ Accepter</button><button class="btn ghost sm" data-srt="no|' + esc(mid) + '"' + (sx.busy ? ' disabled' : '') + '>❌ Refuser</button></div></div>').join('');
}
function uberAdmin(s) { // ⋯ du dispatch sur un livreur Uber : pas disponible / déconnecter
  const open = sx.ask && sx.ask.mid === s.mid;
  let h = '<div style="display:flex;justify-content:flex-end;margin:-2px 0 6px"><button class="btn ghost sm" style="width:auto;padding:4px 12px;margin:0" data-srt="menu|' + esc(s.mid) + '">⋯</button></div>';
  if (!open) return h;
  const k = sx.ask.k;
  return h + '<div class="msgc" style="margin-bottom:8px">' +
    '<button class="btn ' + (k === 'pause' ? 'red' : 'ghost') + ' sm" style="margin-bottom:6px" data-srt="pause|' + esc(s.mid) + '">' + (s.pause ? '🟢 Mettre disponible' : k === 'pause' ? 'Sûr ? Appuie encore : pas disponible' : '🔴 Mettre pas disponible') + '</button>' +
    '<button class="btn ' + (k === 'kick' ? 'red' : 'ghost') + ' sm" data-srt="kick|' + esc(s.mid) + '">' + (k === 'kick' ? 'Sûr ? Appuie encore : déconnecter' : '🔒 Déconnecter ' + esc(s.nom)) + '</button>' +
    '<div class="small" style="margin-top:6px">Déconnecté : son app se ferme et il devra être accepté pour revenir. Ses commandes restent.</div></div>';
}
async function sortiAct(a, mid) {
  const s = Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).find((x) => x.mid === mid && working(x));
  if (a === 'menu') { sx.ask = sx.ask && sx.ask.mid === mid ? null : { mid, k: null }; return renderQueues(); }
  if ((a === 'pause' || a === 'kick') && s) {
    if (a === 'pause' && s.pause) { sx.ask = null; await writeBatch(db).update(doc(db, 'soirees', s.id), { pause: false }).commit(); notifyMsg(mid, '🟢 Le dispatch t’a mis disponible'); return renderQueues(); }
    if (!sx.ask || sx.ask.k !== a) { sx.ask = { mid, k: a }; return renderQueues(); }
    sx.ask = null; sx.busy = mid; renderQueues();
    try {
      const b = writeBatch(db); b.update(doc(db, 'soirees', s.id), { pause: true });
      if (a === 'kick') b.set(doc(db, 'sortis', mid), { etat: 'dehors', le: Date.now(), par: myMid(), parNom: me.nom || OWNER, nom: s.nom || nomDe(mid) });
      await b.commit();
      notifyMsg(mid, a === 'kick' ? '🔒 Tu as été déconnecté par le dispatch' : '🔴 Le dispatch t’a mis pas disponible');
    } catch (e) { alertErr(e); }
    sx.busy = null; return renderQueues();
  }
  if (a === 'ok' || a === 'no') {
    sx.busy = mid; renderQueues();
    try {
      if (a === 'ok') { await deleteDoc(doc(db, 'sortis', mid)); notifyMsg(mid, '✅ Le dispatch a accepté ton retour. Mets-toi disponible quand tu es prêt.'); }
      else await writeBatch(db).update(doc(db, 'sortis', mid), { etat: 'dehors', le: Date.now() }).commit();
    } catch (e) { alertErr(e); }
    sx.busy = null; renderQueues();
  }
}
function alertErr(e) { console.error('sortiAct', e); const b = $('service'); if (b) { const d = document.createElement('div'); d.className = 'err'; d.textContent = msg(e); b.prepend(d); } }
function pillOf(s) {
  const q = queueOf(s.mid), q0 = q[0], plan = planOf(q), left = stockLeft(s.mid);
  let dot = '#8b8b94', st = 'en route';
  if (!q0) { dot = 'var(--cash)'; st = 'libre'; }
  else if (q0.statut === 'ici') { st = 'chez ' + q0.client; dot = attendPaie(q0) || minDe(q0.iciLe) >= 8 ? 'var(--danger)' : 'var(--cash)'; }
  let nx = '';
  if (q0 && q0.statut !== 'ici') {
    const m = Math.round((plan[0] - Date.now()) / 60000);
    nx = '<div style="margin-top:3px">→ ' + esc(q0.client) + ' ~' + hm(plan[0]) + (m <= 3 && m >= 0 ? ' <span style="color:#fcd34d">● proche</span>' : '') + (m < -10 ? ' <span style="color:var(--danger)">+' + (-m) + '</span>' : '') + '</div>';
  }
  if (s.recharge) nx += '<div style="margin-top:3px">📦 recharge en attente</div>';
  if (isUberMid(s.mid)) { nx = ''; st = sortis[s.mid] ? '🔒 déconnecté' : s.pause ? '🔴 pas disponible' : q.length ? q.length + ' en cours' : 'dispo'; dot = s.pause ? '#8b8b94' : q.some((c) => !c.accepte || attendPaie(c)) ? '#f5b301' : 'var(--cash)'; if (q.some((c) => !c.accepte)) nx = '<div style="margin-top:3px">⏳ doit accepter</div>'; }
  return '<div class="lvp' + (svcSel === s.mid ? ' on' : '') + '" data-pill="' + s.mid + '"><b>' + (isUberMid(s.mid) ? '🚕 ' : '') + esc(s.nom) + '</b><span class="dt" style="background:' + dot + '"></span>' + esc(st) + nx +
    '<div class="small" style="margin-top:3px">' + q.length + ' cmd' + ((isOwner() || me.role === 'complet') ? ' · reste ' + left.L + ' L ' + left.XL + ' XL' : '') + '</div></div>';
}
function cardsWithMore(list, more, key) {
  let h = list.slice(0, 2).map((x) => x.h).join('');
  const rest = list.slice(2);
  if (rest.length) {
    h += '<div class="dc more" data-more="' + key + '"><b>+ ' + rest.length + ' en attente</b><span class="small">' + (more ? '▴ cacher' : '▾ voir') + '</span></div>';
    h += more ? rest.map((x) => x.h).join('') : '<div class="small" style="margin:-2px 4px 8px">' + rest.map((x) => esc(x.s)).join(' · ') + '</div>';
  }
  return h;
}
function renderQueues() {
  const box = $('service'); if (!box) return;
  const rk = (s) => { const q0 = queueOf(s.mid)[0]; return q0 ? urgOf(q0).r : 9; };
  const people = Object.values(soirees).filter(working).sort((a, b) => rk(a) - rk(b) || a.nom.localeCompare(b.nom, 'fr'));
  if (svcSel && !people.some((s) => s.mid === svcSel)) svcSel = null;
  const seeStock = isOwner() || me.role === 'complet';
  if ($('pills')) $('pills').innerHTML = people.map(pillOf).join('') || '<div class="small">Personne en service pour l’instant.</div>';
  let h = '';
  h += sortisHtml();
  people.filter((s) => s.mid === svcSel).forEach((s) => {
    const q = queueOf(s.mid), plan = planOf(q), left = stockLeft(s.mid);
    const low = seeStock && (left.L <= 2 && left.XL <= 1);
    h += '<div class="item"><div class="qhead"><b>' + esc(s.nom) + '</b><span class="small">' + (seeStock ? qty(st(s.mid)) + ' sur lui' : '') + (low ? ' <span class="pay p-int">stock bas</span>' : '') + '</span></div>';
    if (isUberMid(s.mid) && (isOwner() || isStaff())) h += uberAdmin(s);
    if (!q.length) h += '<div class="small">Libre · ' + esc(s.adresse || '') + '</div>';
    q.forEach((c, i) => {
      h += '<div class="q"><span class="qtap" data-focus="' + c.id + '"><span class="num">' + (i + 1) + '</span><b>' + esc(c.client) + '</b>' + payTag(c) + (i === 0 ? urgChip(c) : '') + ' <span class="small">⤢</span></span>' +
        '<div class="small" style="margin:3px 0 6px">' + esc(c.adresse) + ' · ' + c.L + ' L ' + c.XL + ' XL · ' + (c.statut === 'ici' ? '<b style="color:var(--cash)">sur place</b>' : c.type ? '' : 'arrivée ~' + hm(plan[i])) + (c.retard ? ' ' + lateTag(c.retard) : '') + (c.note ? '<br>📝 ' + esc(c.note) : '') + '</div>' + (c.type ? uberInfo(c) : '') +
        '<div class="seg" style="margin:0">' + (c.bloque ? '<button class="on" data-a="paid" data-id="' + c.id + '">✓ ' + payWord(c) + ' reçu</button>' : '') +
        '<button data-a="msg" data-id="' + c.id + '">💬 Client</button>' +
        (menuOpen === c.id ? (!c.dette && canDette() ? '<button data-a="dette" data-id="' + c.id + '">📒 Dette</button>' : '') + '<button data-a="unassign" data-id="' + c.id + '">Retirer</button><button data-a="cancel" data-id="' + c.id + '">Annuler</button>' : '<button data-a="menu" data-id="' + c.id + '" style="flex:0 0 46px">⋯</button>') + '</div>' +
        (msgOpen === c.id && !fx.id ? msgBox(c, plan[i]) : '') + (dt.disp && dt.disp.id === c.id && !fx.id ? detteDispForm(c) : '') + '</div>';
    });
    h += '</div>';
  });
  if (svcSel) h = rcBlock(Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).find((x) => x.mid === svcSel && working(x))) + h;
  box.innerHTML = h;
  bindRc();
  // Maintenant : chez les livreurs
  const now = [];
  Object.values(cmds).filter((c) => c.statut === 'ici' || (c.statut === 'assignee' && c.demandePaie)).forEach((c) => {
    const nom = c.livreurNom || nomDe(c.livreur), m = c.statut === 'ici' ? minDe(c.iciLe) : 0, dp = c.demandePaie;
    const t = c.statut === 'ici' ? tsMs(c.iciLe) : tsMs(dp && dp.le);
    if (dp) now.push({ red: 1, t, s: nom + ' · ' + c.client, h: '<div class="dc red" data-focus="' + c.id + '"><b>💳 ' + esc(nom) + ' · ' + esc(c.client) + ' : paiement à confirmer</b><small>' + esc(demPaieTxt(dp, c)) + '</small></div>' });
    else if (c.bloque) now.push({ red: 1, t, s: nom + ' chez ' + c.client, h: '<div class="dc red" data-focus="' + c.id + '"><b>💳 ' + esc(nom) + ' est chez ' + esc(c.client) + '</b> · depuis ' + m + ' min<small>EMT pas reçu — il attend</small></div>' });
    else if (m >= 8) now.push({ red: 1, t, s: nom + ' chez ' + c.client + ' ' + m + ' min', h: '<div class="dc red" data-focus="' + c.id + '"><b>⏳ ' + esc(nom) + ' chez ' + esc(c.client) + ' depuis ' + m + ' min</b><small>Ça prend du temps</small></div>' });
    else if (c.type) now.push({ red: 0, t, s: c.client + ' chez ' + nom, h: '<div class="dc grn" data-focus="' + c.id + '"><b>📍 ' + esc(c.client) + ' est chez ' + esc(nom) + '</b>' + (c.type === 'uber' ? ' (Uber)' : ' (pick-up)') + '<small>' + (c.encaisser > 0 ? 'encaisse ' + c.encaisser + ' $ cash' : 'déjà payé ✓') + '</small></div>' });
    else now.push({ red: 0, t, s: nom + ' chez ' + c.client, h: '<div class="dc grn" data-focus="' + c.id + '"><b>📍 ' + esc(nom) + ' est chez ' + esc(c.client) + '</b> · depuis ' + m + ' min<small>' + (c.encaisser > 0 ? 'encaisse ' + c.encaisser + ' $ cash' : 'déjà payé ✓') + '</small></div>' });
  });
  now.sort((a, b) => (b.red - a.red) || (a.t - b.t));
  if ($('nowBox')) $('nowBox').innerHTML = now.length ? cardsWithMore(now, nowMore, 'now') : '<div class="small" style="margin:0 2px 8px">Aucun livreur ne t’attend 👌</div>';
  // À assigner : nouvelles commandes (orange ; rouge après 5 min d'attente)
  const free = Object.values(cmds).filter((c) => c.statut === 'attente').map((c) => {
    const w = minDe(c.creeLe), old = w >= 5;
    return { red: old ? 1 : 0, t: tsMs(c.creeLe), s: c.client + ' · ' + qtyTxt(c) + (old ? ' · ' + w + ' min' : ''),
      h: '<div class="dc ' + (old ? 'red' : 'org') + '" data-focus="' + c.id + '"><b>' + (old ? '⚠️ ' : '') + 'Nouvelle : ' + esc(c.client) + '</b> · ' + esc(qtyTxt(c)) + (old ? ' · attend depuis ' + w + ' min' : '') +
        '<small>' + esc(c.adresse) + ' · ' + esc(c.bloque ? 'EMT pas reçu' : c.encaisser > 0 ? 'cash ' + c.encaisser + ' $' : 'EMT reçu ✓') + '</small></div>' };
  }).sort((a, b) => (b.red - a.red) || (a.t - b.t));
  if ($('freeLbl')) $('freeLbl').textContent = 'À assigner' + (free.length ? ' (' + free.length + ')' : '');
  $('freeList').innerHTML = free.length ? cardsWithMore(free, freeMore, 'free') : '<div class="small" style="margin:0 2px 8px">Tout est assigné ✓</div>';
  // Rond rouge sur l'onglet En direct = ce qui est urgent
  const nRed = now.filter((x) => x.red).length + free.filter((x) => x.red).length;
  const tb = document.querySelector('#tabs button[data-t="direct"]');
  if (tb) tb.dataset.n = nRed ? String(nRed) : '';
  livreesSoir = Object.values(soirees).reduce((a, x) => a + (x.livrees || 0), 0);
  if ($('doneLine')) $('doneLine').textContent = livreesSoir ? '✓ ' + livreesSoir + ' livrée' + (livreesSoir > 1 ? 's' : '') + ' ce soir' : '';
  document.querySelectorAll('#pills [data-pill]').forEach((el) => { el.onclick = () => { svcSel = svcSel === el.dataset.pill ? null : el.dataset.pill; renderQueues(); }; });
  document.querySelectorAll('[data-more]').forEach((el) => { el.onclick = () => { if (el.dataset.more === 'now') nowMore = !nowMore; else freeMore = !freeMore; renderQueues(); }; });
  document.querySelectorAll('#service [data-a]').forEach((el) => { el.onclick = () => qAct(el.dataset.a, el.dataset.id); });
  document.querySelectorAll('#service [data-srt]').forEach((el) => { el.onclick = () => { const [a, mid] = el.dataset.srt.split('|'); sortiAct(a, mid); }; });
  bindDetteDisp();
  document.querySelectorAll('#service [data-copy]').forEach((el) => { el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.copy).catch(() => {}); } catch (e) {} el.textContent = 'Copié ✓'; }; });
  document.querySelectorAll('#service [data-focus], #nowBox [data-focus], #freeList [data-focus]').forEach((el) => { el.onclick = () => openFocus(el.dataset.focus); });
  renderFocus();
  if (NF && $('nfAssign')) drawAssign(); // v27 : les boutons Uber / pick-up suivent la pause
}
const qtyTxt = (c) => [c.L ? c.L + ' L' : '', c.XL ? c.XL + ' XL' : ''].filter(Boolean).join(' · ');
let livreesSoir = 0;
setInterval(() => { if (me && (isOwner() || isStaff()) && curTab === 'direct' && !fx.id) renderQueues(); }, 30000);
function msgBox(c, eta) {
  if (c.type === 'uber' && c.uberLien) eta = c.uberEta || eta;
  const t = c.type === 'pickup' ? 'Salut ' + prenom(c.client) + ' ! Tu peux venir chercher ta commande ici : ' + (c.pickAdr || '(adresse pas encore entrée)') + '. Écris-moi quand tu arrives.'
    : c.type === 'uber' ? (c.uberLien ? 'Salut ' + prenom(c.client) + ' ! Ta commande est en route en Uber, arrivée vers ' + hm(eta) + '. Suis-la ici : ' + c.uberLien : 'Salut ' + prenom(c.client) + ' ! On commande ton Uber dès que l’EMT est confirmé.') : 'Salut ' + prenom(c.client) + ' ! Ton livreur arrive dans environ ' + Math.max(1, Math.round((eta - Date.now()) / 60000)) + ' minutes.' + (c.suivi ? ' Suis ta livraison ici : ' + SUIVI + c.suivi : '');
  return '<div class="msgc">' + esc(t) + '<div class="two" style="margin-top:8px"><button class="btn ghost sm" data-copy="' + esc(t) + '">Copier</button>' +
    (c.tel ? '<a class="btn ok sm" style="text-align:center;text-decoration:none" href="sms:' + encodeURIComponent(c.tel) + '?&body=' + encodeURIComponent(t) + '">Texto à ' + esc(c.tel) + '</a>' : '<span class="small" style="align-self:center">Pas de téléphone : copie-le où tu parles au client.</span>') + '</div></div>';
}
async function qAct(a, id) {
  const c = cmds[id]; if (!c) return;
  try {
    if (a === 'menu') { menuOpen = id; return renderQueues(); }
    if (a === 'dette') { menuOpen = null; dt.disp = { id, resp: (cmds[id] && cmds[id].livreur) || myMid(), note: '' }; return renderQueues(); }
    if (a === 'msg') { msgOpen = msgOpen === id ? null : id; return renderQueues(); }
    if (a === 'paid') {
      if (needCoin(c) && !cry.ok) { cry.id = id; cry.kind = 'paid'; cry.coin = null; cry.autre = ''; cry.err = ''; return fx.id === id ? renderFocus() : openFocus(id); }
      const coin = cry.ok || ''; cry.ok = null; cry.id = null;
      const b = writeBatch(db);
      b.update(doc(db, 'commandes', id), Object.assign({ bloque: false, paye: !(c.encaisser > 0), confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() }, coin ? { crypto: coin, paieMode: c.paieMode === 'mixc' ? 'mixc' : 'cry' } : {}));
      b.update(doc(db, 'cmdPrive', id), Object.assign({ recu: true }, coin ? { crypto: coin } : {}));
      await b.commit();
      if (c.type === 'uber' && c.livreur) notifyMsg(c.livreur, '✓ Paiement reçu pour ' + c.client + ' — tu peux commander le Uber');
      return;
    }
    if (a === 'unassign') {
      menuOpen = null;
      const b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { statut: 'attente', livreur: null, livreurNom: null, retard: 0 });
      if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'attente', eta: null, luid: null });
      return await b.commit();
    }
    if (a === 'cancel') {
      menuOpen = null;
      const b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { statut: 'annulee', annuleePar: me.mid, finLe: serverTimestamp() });
      b.update(doc(db, 'cmdPrive', id), { actif: false });
      if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { actif: false, statut: 'annulee' });
      return await b.commit();
    }
    if (a === 'assign') {
      reassign = { id, opts: 'calc' }; renderQueues();
      const o = await optionsFor(c, id);
      if (reassign && reassign.id === id) { reassign.opts = o; renderQueues(); }
    }
  } catch (e) { alertBar(msg(e)); }
}
async function assignExisting(id, opt) {
  const c = cmds[id]; if (!c || !opt || !opt.ok) return;
  try {
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', id), await assignFields(opt, c));
    if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'assignee', eta: Math.round(opt.arr), luid: uidOf(opt.mid) });
    await nextFix(b, opt, c);
    await b.commit(); reassign = null;
    notifyOrder(id);
  } catch (e) { alertBar(msg(e)); }
}
function alertBar(t) { const el = $('dErr'); if (el) { el.textContent = t; setTimeout(() => { el.textContent = ''; }, 6000); } }

// ---------- Ma file (livreur) ----------
const mapsUrl = (c) => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(c.lat != null ? c.lat + ',' + c.lon : c.adresse);
// v52 : écran livreur plein écran, une étape à la fois.
//  1. Reçue : adresse en gros (Google Maps), client en petit, 📦 Commande, « 🚗 Je suis en route » (avertit le dispatch).
//  2. En route : l'heure d'arrivée en gros, la commande en petit, « ⏱ +5 min » (sans alerte) et « 📍 Je suis arrivé ».
//  3. Sur place : « Le client veut quoi ? » (+ / −, bloqué au stock) → OK → « Le client paie comment ? » (il écrit : 150 emt reste cash).
//  4. « 💵 X $ cash reçu ? » + l'EMT / crypto que le dispatch confirme (Reçu · Pas reçu · Dette) → « Tu peux donner » → Commande suivante.
const lv = { panel: null, for: null, step: 'cmd', L: 0, XL: 0, pay: '', p: null, cashOk: false, ok: false, err: '', busy: false, waitDig: false };
const LV_KEY = 'gothamLv';
function lvSave() { try { localStorage.setItem(LV_KEY, JSON.stringify({ for: lv.for, step: lv.step, p: lv.p, cashOk: lv.cashOk, ok: lv.ok, L: lv.L, XL: lv.XL })); } catch (e) {} }
function lvLoad(id) { try { const x = JSON.parse(localStorage.getItem(LV_KEY) || 'null'); if (x && x.for === id) return x; } catch (e) {} return null; }
const totNow = (c, L, XL) => L * cfg.prixL + XL * cfg.prixXL + (Number(c.frais) || 0);
const dueOf = (c) => (c.bloque ? totNow(c, c.L || 0, c.XL || 0) : Math.max(0, Number(c.encaisser) || 0));
// « 150 emt reste cash », « 100 cash 80 crypto reste emt », « tout cash », « crypto » → { cash, emt, cry } ; null si on ne comprend pas.
function parsePaie(t, tot) {
  t = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const key = (w) => (/^(emt|imt|interac|int|virement|etransfer|e-transfer)$/.test(w) ? 'emt' : /^(crypto|btc|usdt|bitcoin)$/.test(w) ? 'cry' : /^(cash|comptant|cache|cach)$/.test(w) ? 'cash' : null);
  const r = { cash: 0, emt: 0, cry: 0 }; let ok = false, rest = null, m;
  const re = /(\d+)\s*\$?\s*(?:en\s+)?([a-z-]+)/g;
  while ((m = re.exec(t))) { const k = key(m[2]); if (k) { r[k] += Number(m[1]); ok = true; } }
  const rm = t.match(/(reste|tout)\s+(?:en\s+)?([a-z-]+)/); if (rm && key(rm[2])) { rest = key(rm[2]); ok = true; }
  if (!ok && key(t.trim())) { rest = key(t.trim()); ok = true; }
  if (/\d/.test(t.replace(/(\d+)\s*\$?\s*(?:en\s+)?([a-z-]+)/g, (a, n, w) => (key(w) ? '' : a)))) return null; // un chiffre sans « cash / emt / crypto »
  if (rest) r[rest] += Math.max(tot - r.cash - r.emt - r.cry, 0);
  return ok ? r : null;
}
const payLine = (p) => [p.cash ? '💵 ' + p.cash + ' $ cash' : '', p.emt ? '📲 ' + p.emt + ' $ EMT' : '', p.cry ? '🟣 ' + p.cry + ' $ crypto' : ''].filter(Boolean).join('<br>');
function lvFx(k) { // ✅ vert 2 secondes + vibration + petit son
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  try { const A = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.18].forEach((d, i) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = i ? 1320 : 880; g.gain.setValueAtTime(0.0001, A.currentTime + d); g.gain.exponentialRampToValueAtTime(0.3, A.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + d + 0.3); o.connect(g); g.connect(A.destination); o.start(A.currentTime + d); o.stop(A.currentTime + d + 0.32); }); } catch (e) {}
  const c = myCmds[0], ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:80;background:#16a34a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px';
  ov.innerHTML = '<div style="font-size:84px">✅</div><div style="font-size:34px;font-weight:900">' + esc(k) + ' REÇU</div><div style="font-size:21px;margin-top:10px">Tu peux donner<br><b>' + esc(c ? qtyTxt(c).replace(' · ', ' + ') : '') + '</b></div>';
  ov.onclick = () => ov.remove(); document.body.appendChild(ov); setTimeout(() => ov.remove(), 2200);
}
function myOrdersHtml(s) {
  const mine = st(me.mid);
  const plan = myCmds.length ? planOf(myCmds) : [];
  const soir = '<details class="card" style="margin-top:4px"><summary class="small" style="cursor:pointer">Ma soirée ▾ · ' + (mine.L || 0) + ' L · ' + (mine.XL || 0) + ' XL sur toi · ' + (s.livrees || 0) + ' livraison' + ((s.livrees || 0) > 1 ? 's' : '') + '</summary>' +
    (myCmds.length > 1 ? '<div class="label" style="margin-top:10px">Ensuite</div>' + myCmds.slice(1).map((d, i) => '<div class="q"><span class="num">' + (i + 2) + '</span><b>' + esc(d.client) + '</b> <span class="small">~' + hm(plan[i + 1]) + ' · ' + esc(qtyTxt(d)) + '</span><div class="small" style="margin-top:3px">📍 ' + esc(d.adresse) + '</div></div>').join('') : '<div class="small" style="margin-top:8px">Rien d’autre en attente.</div>') +
    '<p class="small" style="margin-bottom:0">Départ : ' + esc(s.adresse || '') + '</p></details>';
  if (!myCmds.length) return '<div class="card center" style="padding:28px 14px"><div style="font-size:38px">🌙</div><div style="font-size:18px;font-weight:700;margin:8px 0 4px">Pas de commande pour l’instant</div><div class="small">Le dispatch t’en enverra une ici.</div></div>' + soir + venteHtml(s) + finCard(s);
  const c = myCmds[0];
  if (lv.for !== c.id) { const x = lvLoad(c.id); Object.assign(lv, { for: c.id, panel: null, step: 'cmd', L: c.L || 0, XL: c.XL || 0, pay: '', p: null, cashOk: false, ok: false, err: '', busy: false, waitDig: false }, x || {}); }
  const dp = c.demandePaie;
  // Le dispatch vient de répondre à l'EMT / crypto ?
  if (dp) lv.waitDig = true;
  else if (lv.waitDig) { lv.waitDig = false; if (!c.bloque) { lv.ok = true; lvSave(); const k = lv.p && lv.p.emt ? 'EMT' : 'CRYPTO'; setTimeout(() => lvFx(k), 50); } }
  const top = '<div class="small" style="display:flex;justify-content:space-between"><span>Commande 1 sur ' + myCmds.length + '</span>' + (myCmds[1] ? '<span>ensuite : ' + esc(myCmds[1].client) + '</span>' : '') + '</div>';
  const addr = '<a class="lvAddr" href="' + mapsUrl(c) + '" target="_blank" rel="noopener">' + esc(c.adresse) + '<small>touche pour ouvrir Google Maps ↗</small></a><div class="lvCli">' + esc(c.client) + '</div>' + testTag(c) + (c.note ? '<div class="note2">📝 ' + esc(c.note) + '</div>' : '');
  const more = '<div class="lvMore"><button class="linkbtn" id="lvMore">⋯ Autre</button></div>' + lvPanel(c);
  let h = '<div class="card now lvFull">' + top;
  if (c.statut !== 'ici' && !c.enRouteLe) {
    h += '<div class="lvLbl">Nouvelle commande</div>' + addr + '<div class="lvGrow"></div><div class="lvCmd"><div class="lvCmdT">📦 Commande</div><div class="lvTiles"><div><b>' + (c.L || 0) + '</b><span>L</span></div><div><b>' + (c.XL || 0) + '</b><span>XL</span></div></div></div><div class="lvGrow"></div>' +
      '<div class="err" id="mcErr"></div><button class="btn lvBig lvGo" id="lvRoute">🚗 Je suis en route</button>' + more;
  } else if (c.statut !== 'ici') {
    h += '<span class="lvState">🚗 En route</span>' + addr + '<div class="lvGrow"></div><div class="lvEta">' + hm(plan[0]) + '<small>arrivée prévue' + (c.retard ? ' · <b style="color:#fbbf24">+' + c.retard + ' min</b>' : '') + '</small></div><div class="lvGrow"></div>' +
      '<div class="lvCmdLine">📦 Commande : <b>' + esc(qtyTxt(c).replace(' · ', ' + ')) + '</b></div><div class="err" id="mcErr"></div>' +
      '<button class="btn lvBig lvGrey" id="mcLate">⏱ +5 min</button><button class="btn lvBig ok" id="mcHere">📍 Je suis arrivé</button>' + more;
  } else if (!dp && lv.step === 'cmd') {
    const others = myCmds.slice(1), maxL = (mine.L || 0) - others.reduce((a, x) => a + (x.L || 0), 0), maxXL = (mine.XL || 0) - others.reduce((a, x) => a + (x.XL || 0), 0);
    const row = (k, mx) => '<div class="lvCtr"><button data-lq="' + k + '|-1">−</button><div><span>' + lv[k] + '</span> ' + k + '</div><button data-lq="' + k + '|1"' + (!c.test && lv[k] >= mx ? ' style="opacity:.3"' : '') + '>+</button></div>';
    const tot = totNow(c, lv.L, lv.XL);
    h += '<span class="lvState lvSt2">📍 Sur place · ' + esc(c.client) + '</span><div class="lvQ">Le client veut quoi ?</div>' + row('L', maxL) + row('XL', maxXL) +
      '<div class="small" style="text-align:center">Sur toi : ' + esc(qty(mine)) + '</div><div class="err" id="mcErr" style="text-align:center">' + esc(lv.err) + '</div>' +
      '<div class="lvPrice">Prix<b>' + (lv.L + lv.XL ? money(tot) : '—') + '</b></div><div class="lvGrow"></div>' +
      '<button class="btn lvBig lvGrey" id="lvCmdOk"' + (lv.L + lv.XL && !lv.busy ? '' : ' disabled') + '>' + (lv.busy ? '…' : 'OK') + '</button>' + more;
  } else if (!dp && lv.step === 'pay') {
    const due = dueOf(c), p = parsePaie(lv.pay, due), sum = p ? p.cash + p.emt + p.cry : 0, diff = due - sum;
    h += '<span class="lvState lvSt2">📍 Sur place · ' + esc(c.client) + '</span><div class="lvOkBar"><span>✓ ' + esc(qtyTxt(c).replace(' · ', ' + ')) + '</span><b>' + (due < totNow(c, c.L || 0, c.XL || 0) ? 'À payer ' : 'Total ') + money(due) + '</b></div>' +
      '<div class="lvQ">Le client paie comment ?</div><input id="lvPayTxt" class="lvTxt" autocomplete="off" autocapitalize="none" value="' + esc(lv.pay) + '">' +
      '<div id="lvPayRead">' + lvPayRead(p, due, diff) + '</div><div class="err" id="mcErr">' + esc(lv.err) + '</div><div class="lvGrow"></div>' +
      '<button class="btn lvBack" id="lvBack">↩️ Le client change d’avis (retour à la commande)</button><button class="btn lvBig ok" id="lvPayOk"' + (lv.busy ? ' disabled' : '') + '>' + (lv.busy ? '…' : 'OK') + '</button>';
  } else {
    const p = dp ? { cash: Number(dp.cashDonne != null ? dp.cashDonne : dp.cash) || 0, emt: Number(dp.emt) || 0, cry: Number(dp.cry) || 0 } : (lv.p || { cash: 0, emt: 0, cry: 0 });
    const dig = p.emt + p.cry, digOk = !dig || (!dp && !c.bloque), cashOk = !p.cash || lv.cashOk, all = digOk && cashOk && !c.bloque;
    const dl = [p.emt ? p.emt + ' $ EMT' : '', p.cry ? p.cry + ' $ crypto' : ''].filter(Boolean).join(' + ');
    h += '<div class="lvLbl">Paiement · ' + esc(c.client) + ' · ' + money(p.cash + dig) + '</div><div class="lvCli" style="margin-bottom:6px">' + esc(qtyTxt(c).replace(' · ', ' + ')) + '</div>' +
      (p.cash ? (lv.cashOk ? '<div class="lvPay lvDone">✅ ' + p.cash + ' $ cash reçu</div>' : '<button class="btn lvPay" id="lvCash">💵 ' + p.cash + ' $ cash reçu ?<small>appuie quand tu as l’argent en main</small></button>') : '') +
      (dig ? (digOk ? '<div class="lvPay lvDone">✅ ' + dl + ' reçu<small>confirmé par le dispatch</small></div>'
        : '<div class="lvPay lvWait">⏳ ' + dl + '<small' + (dp && dp.pasRecu ? ' style="color:#fca5a5">pas encore reçu — en attente, ne pas donner' : '>attends que le dispatch confirme') + '</small></div>') : '') +
      (!dig && !p.cash ? '<div class="lvPay lvDone">✅ Déjà payé</div>' : '') +
      '<div class="lvGrow"></div><div class="err" id="mcErr"></div>' + (all ? '<div class="lvGive">✅ Tu peux donner <b>' + esc(qtyTxt(c).replace(' · ', ' + ')) + '</b></div>' : '<div class="lvWarn">⚠️ Ne donne rien tant que tout n’est pas ✅</div>') +
      '<button class="btn lvBig lvGo" id="mcDone"' + (all ? '' : ' disabled') + '>➡️ Commande suivante</button>';
  }
  h += '</div>' + soir + venteHtml(s);
  return h;
}
function lvPayRead(p, due, diff) {
  if (!lv.pay.trim()) return '';
  if (!p) return '<div class="err">⛔ Je comprends pas — écris le montant avec EMT, cash ou crypto.</div>';
  return '<div class="lvRead">' + payLine(p) + '<div style="margin-top:4px;font-weight:700;color:' + (diff > 0 ? '#fbbf24' : '#4ade80') + '">' + (diff === 0 ? '✓ ' + money(due) : diff > 0 ? 'Il manque ' + money(diff) : '+' + money(-diff) + ' de pourboire pour toi 🎉') + '</div></div>';
}
function lvPanel(c) {
  if (lv.panel === 'more') return '<div class="msgc" style="margin-bottom:8px"><a class="btn ghost sm" style="display:block;text-align:center;text-decoration:none;margin-bottom:6px" href="' + mapsUrl(c) + '" target="_blank" rel="noopener">🗺️ Ouvrir dans Google Maps</a>' +
    '<button class="btn ghost sm" style="margin-bottom:6px" data-lm="rep">📞 Le client répond pas</button><button class="btn ghost sm" style="margin-bottom:6px" data-lm="no">↩️ Je ne peux pas livrer</button><button class="linkbtn" data-lp="x">Fermer</button></div>';
  return '';
}
function bindMyOrders(s) {
  const c = myCmds[0];
  watchChat(null); syncEtas();
  if (!c) return;
  const act = async (fn) => { document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = true; }); try { await fn(); } catch (e) { if ($('mcErr')) $('mcErr').textContent = msg(e); } document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = false; }); };
  if ($('lvMore')) $('lvMore').onclick = () => { lv.panel = lv.panel === 'more' ? null : 'more'; renderSoiree(); };
  document.querySelectorAll('#soiree [data-lp]').forEach((b) => { b.onclick = () => { lv.panel = null; renderSoiree(); }; });
  document.querySelectorAll('#soiree [data-lm]').forEach((b) => { b.onclick = () => { lv.panel = null; const t = b.dataset.lm === 'rep' ? c.client + ' répond pas à la porte' : 'Je ne peux pas livrer ' + c.client; act(() => sendMsg(me.mid, 'livreur', t)); }; });
  // 1 → 2
  if ($('lvRoute')) $('lvRoute').onclick = () => act(() => writeBatch(db).update(doc(db, 'commandes', c.id), { enRouteLe: serverTimestamp() }).commit().then(() => notifyDispatch('🚗 ' + me.nom + ' est en route chez ' + c.client)));
  // 2 : +5 min (le dispatch voit juste la nouvelle heure) · arrivé (le dispatch est averti)
  if ($('mcLate')) $('mcLate').onclick = () => act(() => writeBatch(db).update(doc(db, 'commandes', c.id), { retard: (c.retard || 0) + 5 }).commit());
  if ($('mcHere')) $('mcHere').onclick = () => act(() => { const b = writeBatch(db); b.update(doc(db, 'commandes', c.id), { statut: 'ici', iciLe: serverTimestamp() }); if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'ici' }); return b.commit().then(() => notifyDispatch('📍 ' + me.nom + ' est arrivé chez ' + c.client)); });
  // 3 : la commande
  document.querySelectorAll('#soiree [data-lq]').forEach((b) => { b.onclick = () => {
    const [k, d] = b.dataset.lq.split('|'), n = lv[k] + Number(d), mine = st(me.mid);
    const mx = (mine[k] || 0) - myCmds.slice(1).reduce((a, x) => a + (x[k] || 0), 0);
    if (Number(d) > 0 && !c.test && n > mx) { lv.err = '⛔ Tu as seulement ' + Math.max(0, mx) + ' ' + k + ' sur toi'; return renderSoiree(); }
    lv.err = ''; lv[k] = Math.max(0, n); renderSoiree();
  }; });
  if ($('lvCmdOk')) $('lvCmdOk').onclick = async () => {
    const L = lv.L, XL = lv.XL, dL = L - (c.L || 0), dXL = XL - (c.XL || 0);
    if (L + XL <= 0) return;
    if (dL || dXL) {
      const d = dL * cfg.prixL + dXL * cfg.prixXL, enc = (Number(c.encaisser) || 0) + d;
      if (enc < 0) { lv.err = 'Le client a déjà payé plus que ça : écris au dispatch.'; return renderSoiree(); }
      const pm = c.paieMode || payOld(c), nm = d > 0 && pm === 'int' ? 'mix' : d > 0 && pm === 'cry' ? 'mixc' : pm;
      lv.busy = true; renderSoiree();
      try {
        await writeBatch(db).update(doc(db, 'commandes', c.id), Object.assign({ L, XL, encaisser: enc, qtyDelta: (c.qtyDelta || 0) + d, qtyAvant: c.qtyAvant || { L: c.L || 0, XL: c.XL || 0 }, qtyLe: serverTimestamp(), qtyPorte: true },
          c.paieMode && nm !== c.paieMode ? { paieMode: nm } : {}, enc > 0 && c.paye ? { paye: false } : {})).commit();
      } catch (e) { lv.busy = false; lv.err = msg(e); return renderSoiree(); }
      lv.busy = false;
    }
    const enc2 = (Number(c.encaisser) || 0) + dL * cfg.prixL + dXL * cfg.prixXL;
    lv.err = ''; lv.pay = '';
    if (!c.bloque && enc2 <= 0) { lv.p = { cash: 0, emt: 0, cry: 0 }; lv.step = 'wait'; } // déjà payé : rien à demander
    else lv.step = 'pay';
    lvSave(); renderSoiree();
  };
  // 3b : le paiement
  if ($('lvPayTxt')) {
    $('lvPayTxt').oninput = (e) => { lv.pay = e.target.value; lv.err = ''; const due = dueOf(c), p = parsePaie(lv.pay, due); $('lvPayRead').innerHTML = lvPayRead(p, due, due - (p ? p.cash + p.emt + p.cry : 0)); if ($('mcErr')) $('mcErr').textContent = ''; };
  }
  if ($('lvBack')) $('lvBack').onclick = () => { if ($('lvPayTxt')) $('lvPayTxt').blur(); lv.step = 'cmd'; lv.L = c.L || 0; lv.XL = c.XL || 0; lv.err = ''; lvSave(); renderSoiree(); };
  if ($('lvPayOk')) $('lvPayOk').onclick = async () => {
    if ($('lvPayTxt')) { lv.pay = $('lvPayTxt').value; $('lvPayTxt').blur(); }
    const due = dueOf(c), p = parsePaie(lv.pay, due);
    if (!p) { lv.err = '⛔ Je comprends pas — écris le montant avec EMT, cash ou crypto.'; return renderSoiree(); }
    const sum = p.cash + p.emt + p.cry;
    if (sum < due) { lv.err = '⛔ Il manque ' + money(due - sum) + ' — le total doit être payé.'; return renderSoiree(); }
    if (p.emt && p.cry) { lv.err = '⛔ EMT et crypto ensemble : pas possible. Garde un des deux (avec du cash si tu veux).'; return renderSoiree(); }
    const dig = p.emt + p.cry;
    lv.busy = true; renderSoiree();
    try {
      if (dig) {
        const mode = p.cash ? (p.emt ? 'mix' : 'mixc') : (p.emt ? 'int' : 'cry');
        const cashPart = Math.max(0, due - dig); // le cash qui compte pour la commande (le reste = pourboire)
        await writeBatch(db).update(doc(db, 'commandes', c.id), { demandePaie: { mode, cash: cashPart, emt: p.emt, cry: p.cry, cashDonne: p.cash, le: Date.now() } }).commit();
        notifyDispatch('💳 ' + me.nom + ' · ' + c.client + ' : ' + [p.emt ? p.emt + ' $ EMT' : '', p.cry ? p.cry + ' $ crypto' : ''].filter(Boolean).join(' + ') + ' à confirmer' + (p.cash ? ' · ' + p.cash + ' $ cash' : ''));
      } else if (c.bloque) {
        await writeBatch(db).update(doc(db, 'commandes', c.id), { bloque: false, encaisser: totNow(c, c.L || 0, c.XL || 0), paieMode: 'cash', paye: false, porteLe: serverTimestamp() }).commit();
      }
      lv.p = p; lv.step = 'wait'; lv.cashOk = false; lv.ok = false; lv.err = ''; lvSave();
    } catch (e) { lv.err = msg(e); }
    lv.busy = false; renderSoiree();
  };
  // 4
  if ($('lvCash')) $('lvCash').onclick = () => { lv.cashOk = true; lvSave(); renderSoiree(); };
  if ($('mcDone')) $('mcDone').onclick = () => act(async () => {
    const dp = c.demandePaie, p = lv.p || { cash: 0 }, cash = Math.max(0, Number(dp ? dp.cashDonne || dp.cash : p.cash) || 0);
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', c.id), { statut: 'livree', livreeLe: serverTimestamp(), cashRecu: cash, soiree: s.id, ...(paies[me.mid] != null && !c.test ? { paie: paies[me.mid] } : {}) });
    const der = c.lat != null ? { dernier: { lat: c.lat, lon: c.lon, adresse: c.adresse || '', le: Date.now() } } : {}; // v45 : sa position = la dernière livraison
    if (!c.test) { // v30 : une commande test ne touche pas au stock ni au compteur
      b.set(doc(db, 'stocks', me.mid), { L: increment(-(c.L || 0)), XL: increment(-(c.XL || 0)), cmd: c.id }, { merge: true });
      b.update(doc(db, 'soirees', s.id), Object.assign({ livrees: increment(1) }, der));
    } else if (c.lat != null) b.update(doc(db, 'soirees', s.id), der);
    const nx = myCmds[1];
    if (nx) b.update(doc(db, 'commandes', nx.id), { depart: Date.now() - (MARGE1 - MARGE) * 60000 }); // la suivante part maintenant (2 min de marge)
    await b.commit();
    try { localStorage.removeItem(LV_KEY); } catch (e) {}
    closeSuivi(c.suivi, 'livree');
  });
}

// v52 : styles de l'écran livreur plein écran
(function () { if (document.getElementById('lvCss')) return; const st2 = document.createElement('style'); st2.id = 'lvCss'; st2.textContent =
  '.lvFull{display:flex;flex-direction:column;min-height:calc(100dvh - 170px)}' +
  '.lvGrow{flex:1;min-height:10px}' +
  '.lvLbl{font-size:12px;color:#9aa0a6;text-transform:uppercase;letter-spacing:.04em;margin-top:8px}' +
  '.lvAddr{display:block;color:#fff;text-decoration:none;font-size:27px;font-weight:800;line-height:1.15;margin:6px 0 4px}' +
  '.lvAddr small{display:block;font-size:13px;color:#7fa8ff;font-weight:600;margin-top:4px}' +
  '.lvCli{font-size:15px;color:#b6bcc6}' +
  '.lvCmd{background:linear-gradient(180deg,#1f2a44,#182033);border:2px solid #3b82f6;border-radius:20px;padding:14px;text-align:center}' +
  '.lvCmdT{font-size:22px;font-weight:900;color:#60a5fa;margin-bottom:10px}' +
  '.lvTiles{display:flex;gap:10px;justify-content:center}.lvTiles div{flex:1;max-width:150px;background:#0f1626;border-radius:16px;padding:10px 0}' +
  '.lvTiles b{display:block;font-size:52px;line-height:1;color:#fff;font-weight:900}.lvTiles span{font-size:20px;font-weight:800;color:#93c5fd}' +
  '.lvBig{width:100%;padding:20px!important;font-size:20px!important;font-weight:800;border-radius:18px!important;margin-top:10px}' +
  '.lvGo{background:#3b82f6!important;color:#fff!important}.lvGrey{background:#2a303a!important;color:#fff!important}' +
  '.lvBig:disabled{opacity:.35}' +
  '.lvState{align-self:flex-start;background:#1e3a8a;color:#bfdbfe;border-radius:999px;padding:4px 10px;font-size:13px;font-weight:700;margin:8px 0 4px}.lvSt2{background:#14532d;color:#bbf7d0}' +
  '.lvEta{font-size:68px;font-weight:900;text-align:center;line-height:1}.lvEta small{display:block;font-size:15px;color:#9aa0a6;font-weight:500;margin-top:6px}' +
  '.lvCmdLine{text-align:center;font-size:17px;color:#93c5fd;background:#141b29;border:1px solid #24324d;border-radius:12px;padding:9px}.lvCmdLine b{color:#dbeafe}' +
  '.lvQ{font-size:22px;font-weight:800;margin:10px 0}' +
  '.lvCtr{display:flex;align-items:center;justify-content:space-between;background:#1b2029;border-radius:14px;padding:12px 14px;margin-bottom:8px;font-size:18px}' +
  '.lvCtr span{font-size:30px;font-weight:900}.lvCtr button{width:56px;height:56px;border-radius:14px;border:0;background:#2a303a;color:#fff;font-size:28px;font-weight:800}' +
  '.lvPrice{text-align:center;font-size:16px;margin-top:8px;color:#cbd5e1}.lvPrice b{display:block;font-size:46px;color:#fff}' +
  '.lvOkBar{display:flex;justify-content:space-between;gap:8px;background:#0f2a1a;border:1px solid #166534;border-radius:12px;padding:10px 12px;font-size:15px;color:#bbf7d0}.lvOkBar b{color:#fff;font-size:17px}' +
  '.lvTxt{width:100%;background:#1b2029!important;border:2px solid #3a414d!important;border-radius:14px!important;color:#fff;font-size:22px!important;font-weight:700;padding:14px!important}' +
  '.lvRead{background:#1b2029;border-radius:14px;padding:12px 14px;margin-top:10px;font-size:16px;line-height:1.6}' +
  '.lvBack{width:100%;background:transparent!important;border:1px solid #3a414d!important;color:#cbd5e1!important;border-radius:14px!important;padding:12px!important;font-size:14.5px!important;font-weight:700}' +
  '.lvPay{display:block;width:100%;border:0;border-radius:18px;padding:18px;font-size:20px;font-weight:800;margin-top:10px;text-align:center;background:#f5c518;color:#111}' +
  '.lvPay small{display:block;font-size:13px;font-weight:600;margin-top:3px}.lvDone{background:#14532d;color:#bbf7d0}.lvWait{background:#2a2410;color:#fcd34d;border:2px dashed #b45309}' +
  '.lvGive{text-align:center;font-size:18px;color:#86efac;margin-bottom:4px}.lvGive b{color:#fff}.lvWarn{text-align:center;font-size:14px;color:#fbbf24}' +
  '.lvMore{text-align:center;margin-top:8px}';
  document.head.appendChild(st2); })();
// Le livreur dit comment le client paie vraiment ; le dispatch confirme (carte rouge chez lui).
async function askPaie(c, d) {
  await writeBatch(db).update(doc(db, 'commandes', c.id), { demandePaie: Object.assign({ le: Date.now() }, d) }).commit();
  notifyDispatch('💳 ' + me.nom + ' · ' + c.client + ' : ' + (d.mode === 'cash' ? 'tout en cash' : d.mode === 'int' ? 'tout en EMT' : d.mode === 'cry' ? 'tout en crypto' : d.cash + ' $ cash + reste EMT') + ' — à confirmer');
}
// ---------- Réglages (propriétaire) : prix + clé Google Maps ----------
function renderCfg() {
  if (!isOwner() || !$('cfgCard')) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#cfgCard')) return;
  $('cfgL').value = cfg.prixL; $('cfgXL').value = cfg.prixXL;
  $('cfgKeyState').textContent = cfg.mapsKey ? '✓ Clé Google Maps enregistrée (temps de route avec trafic).' : 'Pas encore de clé : les temps de route sont estimés.';
}
if ($('cfgSave')) $('cfgSave').onclick = async () => {
  $('cfgErr').textContent = '';
  const d = { prixL: Number($('cfgL').value) || 0, prixXL: Number($('cfgXL').value) || 0 };
  const k = $('cfgKey').value.trim(); if (k) d.mapsKey = k;
  try { await setDoc(doc(db, 'config', 'app'), d, { merge: true }); $('cfgKey').value = ''; $('cfgErr').textContent = 'Enregistré ✓'; if (k) $('cfgKeyState').textContent = '✓ Clé Google Maps enregistrée (temps de route avec trafic).'; } catch (e) { $('cfgErr').textContent = msg(e); }
};

// =====================================================================
// Version 6 : notifications (livreurs : nouvelle commande ; plus tard : messages du dispatch)
// =====================================================================
// tokens/{jeton} : un par téléphone ({ mid }). Le programme « notifier » (Google Cloud Run, Montréal)
// vérifie que l'appel vient d'un dispatch / du propriétaire connecté, puis envoie la notification.
const NOTIFIER = 'https://notifier-279678565038.northamerica-northeast1.run.app';
const VAPID = 'BKNZDBuUNQgPklKK0vtk_AlQH7eapf1NSdowusdoSsYW1frQp8_Q0pYNk_iGkgedZG3zSFn2gGgmUVVT0cy2YTo';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let notifState = 'inconnu', notifBusy = false;

async function pushOk() { try { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (await msgSupported()); } catch (e) { return false; } }
async function saveToken(ask) {
  if (!me || !(delivers() || isStaff())) return;
  if (!(await pushOk())) { notifState = isIOS() && !isStandalone() ? 'installer' : 'impossible'; return notifRedraw(); }
  if (Notification.permission === 'denied') { notifState = 'refuse'; return notifRedraw(); }
  if (Notification.permission !== 'granted') {
    if (!ask) { notifState = 'a-activer'; return notifRedraw(); }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { notifState = p === 'denied' ? 'refuse' : 'a-activer'; return notifRedraw(); }
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const tok = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (tok) { await setDoc(doc(db, 'tokens', tok), { mid: me.mid, le: serverTimestamp(), appareil: isIOS() ? 'iphone' : 'autre' }, { merge: true }); notifState = 'ok'; }
  } catch (e) { console.warn('notif', e); notifState = 'erreur'; }
  notifRedraw();
}
function notifRedraw() { renderSoiree(); if (typeof drawNotifD === 'function') drawNotifD(); }
function notifCard(forDisp) {
  if (!delivers() && !isStaff()) return '';
  if (notifState === 'ok' || notifState === 'inconnu') return '';
  if (notifState === 'installer') return '<div class="card notif"><b>🔔 Pour recevoir les notifications sur iPhone</b><p class="small" style="margin:6px 0 0">1. Dans Safari, touche Partager → « Sur l’écran d’accueil ».<br>2. Ouvre l’app avec la nouvelle icône, puis active les notifications ici.</p></div>';
  if (notifState === 'refuse') return '<div class="card notif"><b>🔕 Notifications bloquées</b><p class="small" style="margin:6px 0 0">Va dans Réglages du téléphone → Notifications → Gotham, et autorise-les.</p></div>';
  if (notifState === 'impossible') return '<div class="card notif"><b>🔕 Ce téléphone ne peut pas recevoir les notifications de l’app.</b><p class="small" style="margin:6px 0 0">Mets à jour le téléphone (iPhone : iOS 16.4 ou plus).</p></div>';
  if (forDisp) return '<div class="card notif"><b>🔔 Reçois les messages des livreurs, les check-ins et les « arrivé » même téléphone verrouillé</b><button class="btn ok" id="notifGoD" style="margin-top:10px">Activer les notifications</button>' + (notifState === 'erreur' ? '<div class="err">Ça n’a pas marché, réessaie.</div>' : '') + '</div>';
  return '<div class="card notif"><b>🔔 Reçois tes nouvelles commandes même téléphone verrouillé</b><button class="btn ok" id="notifGo" style="margin-top:10px">Activer les notifications</button>' + (notifState === 'erreur' ? '<div class="err">Ça n’a pas marché, réessaie.</div>' : '') + '</div>';
}
// Prévenir le livreur qu'une commande vient de lui être assignée.
async function notifyOrder(cid) {
  try {
    const t = await auth.currentUser.getIdToken();
    fetch(NOTIFIER, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ type: 'commande', cid }) }).catch(() => {});
  } catch (e) {}
}

// « commande: 2 L 1 XL », « 2L », « 1 xl », « xl x2 », « 2 larges et 1 extra-large »…
function parseQty(t) {
  let s = ' ' + String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' ';
  let XL = null, L = null;
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(m); return ' '; }); };
  take(/(\d+)\s*(?:x\s*)?(?:xl|x-?large|extra[- ]?large|extra)\b/g, (m) => { XL = (XL || 0) + Number(m[1]); });
  take(/\b(?:xl|x-?large|extra[- ]?large)\s*[x×*]\s*(\d+)/g, (m) => { XL = (XL || 0) + Number(m[1]); });
  take(/\b(?:xl|x-?large|extra[- ]?large)\b/g, () => { XL = (XL || 0) + 1; });
  take(/(\d+)\s*(?:x\s*)?(?:l|large|larges|grand|grands|grande|grandes)\b/g, (m) => { L = (L || 0) + Number(m[1]); });
  take(/\b(?:l|large)\s*[x×*]\s*(\d+)/g, (m) => { L = (L || 0) + Number(m[1]); });
  take(/\b(?:large|larges|grand|grande)\b/g, () => { L = (L || 0) + 1; });
  take(/(^|\s)l(\s|$)/g, () => { L = (L || 0) + 1; });
  return (L == null && XL == null) ? {} : { L: L || 0, XL: XL || 0 };
}
// ---------- « Coller une commande » : le client a rempli « nom: / numero: / adresse avec code postal: » ----------
function parsePaste(txt) {
  const out = { nom: '', tel: '', adr: '', cmd: '' };
  const lines = String(txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rest = [];
  lines.forEach((l) => {
    const m = l.match(/^([^:：]{2,40})[:：]\s*(.*)$/);
    const k = m ? m[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    const v = m ? m[2].trim() : l;
    if (m && /nom|name|client/.test(k)) out.nom = v;
    else if (m && /num|tel|phone|cell/.test(k)) out.tel = v;
    else if (m && /adr|address|code postal/.test(k)) out.adr = v;
    else if (m && /commande|order|qte|quantite/.test(k)) out.cmd = v;
    else rest.push(v);
  });
  // Si le client n'a pas mis les titres : on devine (téléphone, code postal = adresse, le reste = nom).
  rest.forEach((v) => {
    if (!out.tel && /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(v) && v.replace(/\D/g, '').length <= 11) out.tel = v;
    else if (!out.adr && (/[a-z]\d[a-z]\s?\d[a-z]\d/i.test(v) || /^\d+\s+\S/.test(v))) out.adr = v;
    else if (!out.nom) out.nom = v;
  });
  Object.assign(out, parseQty(out.cmd));
  out.cp = ((out.adr.match(/[a-z]\d[a-z]\s?\d[a-z]\d/i) || [''])[0]).toUpperCase().replace(/\s/g, '');
  return out;
}
async function applyPaste(txt) {
  const f = NF; if (!f) return;
  const p = parsePaste(txt);
  if (!p.nom && !p.tel && !p.adr && p.L == null) return;
  if (p.nom) f.client = p.nom;
  if (p.tel) { f.tel = p.tel; f.plus = true; }
  if (p.adr) { f.q = p.adr; f.pick = null; }
  if (p.L != null) { f.L = p.L; f.XL = p.XL; }
  f.pasted = true; f.opts = null;
  renderNew();
  if (!p.adr) return;
  // Cherche l'adresse ; si le code postal correspond, on la choisit tout seul.
  const q = p.adr.replace(/[a-z]\d[a-z]\s?\d[a-z]\d/i, '').replace(/,\s*$/, '').trim() || p.adr;
  const sugs = await photon(q);
  if (NF !== f) return;
  nf.sugs = sugs;
  const cp3 = p.cp.slice(0, 3);
  const hit = sugs.find((x) => cp3 && (x.l2 || '').toUpperCase().replace(/\s/g, '').indexOf(cp3) >= 0) || (sugs.length === 1 ? sugs[0] : null);
  if (hit) { f.pick = hit; f.q = hit.l1 + ', ' + hit.l2; renderNew(); computeOpts(); }
  else drawNfSugs();
}

// =====================================================================
// Version 8 : lien de suivi pour le client (suivi.html#code) — heure d'arrivée, chat anonyme, photos
// =====================================================================
// suivi/{code}        : { actif, statut, eta, luid (compte du livreur), prenom } — lisible par qui a le lien.
// suivi/{code}/msgs   : messages { de: 'client' | 'livreur', txt, img? } — effacés quand la commande est livrée.
const SUIVI = 'https://pourquejemerappel-maker.github.io/livreurs/suivi.html#';
function newCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(22)); return Array.from(r, (x) => a[x % a.length]).join(''); }
const uidOf = (mid) => (team[mid] && team[mid].uid) || null;
const prenom = (n) => String(n || '').trim().split(/\s+/)[0] || 'Client';

// ----- Côté livreur : heure d'arrivée envoyée au client + chat -----
const etaSent = {};
function syncEtas() {
  if (!myCmds.length) return;
  const plan = planOf(myCmds);
  myCmds.forEach((c, i) => {
    if (!c.suivi || c.statut !== 'assignee') return;
    if (etaSent[c.id] && Math.abs(etaSent[c.id] - plan[i]) < 60000) return;
    etaSent[c.id] = plan[i];
    writeBatch(db).update(doc(db, 'suivi', c.suivi), { eta: Math.round(plan[i]), statut: 'assignee' }).commit().catch(() => {});
  });
}
let chatSub = null, chatFor = null, chatMsgs = [];
function watchChat(c) {
  const code = c && c.suivi;
  if (code === chatFor) return;
  if (chatSub) { chatSub(); chatSub = null; } chatMsgs = []; chatFor = code;
  if (!code) return;
  chatSub = onSnapshot(query(collection(db, 'suivi', code, 'msgs'), orderBy('le', 'asc'), limit(60)), (qs) => {
    const before = chatMsgs.length; chatMsgs = []; qs.forEach((d) => chatMsgs.push(d.data()));
    if (chatMsgs.length > before && chatMsgs.length && chatMsgs[chatMsgs.length - 1].de === 'client') bip();
    drawChat();
  }, () => {});
}
function bip() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.value = 0.15; o.start(); o.stop(a.currentTime + 0.25); if (navigator.vibrate) navigator.vibrate(200); } catch (e) {} }
function chatHtml(c) {
  if (!c || !c.suivi) return '';
  return '<div class="chatbox"><div class="label" style="margin-bottom:6px">💬 Client (anonyme)</div><div id="chatFeed" class="cfeed"></div>' +
    '<div class="seg" style="margin:6px 0">' + [['🚗 En route', 'Je suis en route 🚗'], ['📍 Devant', 'Je suis arrivé, je suis devant'], ['📍 Derrière', 'Je suis arrivé, je suis derrière'], ['📍 À côté', 'Je suis arrivé, je suis à côté'], ['⏱ 5 min', 'Petit retard, environ 5 minutes']]
      .map((x) => '<button data-say="' + esc(x[1]) + '">' + x[0] + '</button>').join('') + '</div>' +
    '<div class="crow"><input id="chatTxt" maxlength="300" placeholder="Écrire au client…"><label class="cpic">📷<input type="file" id="chatPic" accept="image/*" class="hide"></label><button class="btn sm" id="chatSend">➤</button></div></div>';
}
function drawChat() {
  const box = $('chatFeed'); if (!box) return;
  box.innerHTML = chatMsgs.map((m) => { const t = m.le && m.le.toDate ? m.le.toDate() : new Date();
    return '<div class="cm ' + (m.de === 'client' ? 'cthem' : 'cme') + '">' + esc(m.txt || '') + (m.img ? '<img src="' + esc(m.img) + '" alt="photo">' : '') + '<div class="ct">' + (m.de === 'client' ? 'Client' : 'Moi') + ' · ' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') + '</div></div>'; }).join('') ||
    '<div class="small">Le client voit ici tes messages. Il peut te répondre ou envoyer une photo.</div>';
  box.scrollTop = box.scrollHeight;
}
async function chatSend(txt, img) {
  if (!chatFor || (!txt && !img)) return;
  const d = { de: 'livreur', txt: String(txt || '').slice(0, 300), le: serverTimestamp() }; if (img) d.img = img;
  try { await setDoc(doc(collection(db, 'suivi', chatFor, 'msgs')), d); } catch (e) { if ($('mcErr')) $('mcErr').textContent = msg(e); }
}
function bindChat() {
  drawChat();
  document.querySelectorAll('#soiree [data-say]').forEach((b) => { b.onclick = () => chatSend(b.dataset.say); });
  if ($('chatSend')) $('chatSend').onclick = () => { const v = $('chatTxt').value.trim(); if (v) { chatSend(v); $('chatTxt').value = ''; } };
  if ($('chatTxt')) $('chatTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chatSend').click(); });
  if ($('chatPic')) $('chatPic').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { chatSend('📷 Photo', await shrinkImg(f)); } catch (x) {} } };
}
function shrinkImg(file) {
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); let q = 0.7, out = c.toDataURL('image/jpeg', q); while (out.length > 350000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); } ok(out); };
    img.onerror = ko; img.src = url;
  });
}
// À la livraison : on ferme la page du client et on efface les messages et photos.
async function closeSuivi(code, statut) {
  if (!code) return;
  try {
    await writeBatch(db).update(doc(db, 'suivi', code), { actif: false, statut }).commit();
    const qs = await getDocs(collection(db, 'suivi', code, 'msgs'));
    const b = writeBatch(db); let n = 0; qs.forEach((d) => { b.delete(d.ref); n++; }); if (n) await b.commit();
  } catch (e) { console.warn('suivi', e); }
}

// =====================================================================
// Version 9 : résumé de fin de soirée à partager (Signal, etc.)
// =====================================================================
// Soirée = de 6 h à 6 h. Par livreur : cash reçu, livraisons, reste.
// reste = cash − livraisons × salaire − frais − pourboires. Pourboire = cash reçu − à encaisser (si plus) ; un manque est seulement noté.
function soirStart() { const d = new Date(); if (d.getHours() < 6) d.setDate(d.getDate() - 1); d.setHours(6, 0, 0, 0); return d; }
const money = (n) => Math.round(n).toLocaleString('fr-CA').replace(/\u202f|\u00a0/g, ' ') + ' $';
function sumUp(list, remis) {
  const by = {};
  list.forEach((c) => {
    if (c.test) return; // v30 : les commandes test ne comptent nulle part
    const k = c.livreur || '?';
    const r = by[k] || (by[k] = { mid: k, nom: c.livreurNom || nomDe(k), n: 0, cash: 0, frais: 0, tips: 0, manque: 0, paie: 0, paieOk: true });
    const cash = Number(c.cashRecu) || 0, enc = Number(c.encaisser) || 0;
    const p = c.paie != null ? c.paie : paies[k];
    r.n++; r.cash += cash; r.frais += Number(c.frais) || 0;
    if (cash > enc) r.tips += cash - enc; else if (cash < enc) r.manque += enc - cash;
    if (p == null) r.paieOk = false; else r.paie += Number(p);
  });
  remis = remis || {};
  return Object.values(by).map((r) => Object.assign(r, { remis: remis[r.mid] || 0, reste: r.cash - r.paie - r.frais - r.tips - (remis[r.mid] || 0) })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
const jourTxt = (d) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
function teamText(rows, d) {
  let t = 'Soirée du ' + jourTxt(d) + '\n';
  const T = { cash: 0, n: 0, reste: 0 };
  rows.forEach((r) => { T.cash += r.cash; T.n += r.n; T.reste += r.reste;
    t += '\n' + r.nom + ' : cash ' + money(r.cash) + ' · ' + r.n + ' livraison' + (r.n > 1 ? 's' : '') + ' · reste ' + (r.paieOk ? money(r.reste) : '? (paie inconnue)') +
      (r.tips ? ' (pourboires ' + money(r.tips) + ')' : '') + (r.manque ? ' ⚠️ manque ' + money(r.manque) : '') + (r.dette ? ' 📒 dette ' + money(r.dette) : ''); });
  t += '\n\nTOTAL : cash ' + money(T.cash) + ' · ' + T.n + ' livraison' + (T.n > 1 ? 's' : '') + ' · reste ' + money(T.reste);
  return t;
}
function myText(r, d) {
  if (!r) return 'Soirée du ' + jourTxt(d) + '\nAucune livraison.';
  return 'Ma soirée du ' + jourTxt(d) + '\n\nTotal cash : ' + money(r.cash) + '\nLivraisons : ' + r.n + (r.paieOk ? ' (paie ' + money(r.paie) + ')' : '') +
    (r.frais ? '\nFrais : ' + money(r.frais) : '') + (r.tips ? '\nPourboires : ' + money(r.tips) : '') + (r.manque ? '\n⚠️ Manque : ' + money(r.manque) : '') + (r.dette ? '\n📒 Dette (paie plus tard) : ' + money(r.dette) : '') +
    '\nReste à remettre : ' + (r.paieOk ? money(r.reste) : '?');
}
const finState = { team: null, me: null };
async function loadFin(which) {
  const d = soirStart();
  try {
    let list = [];
    if (which === 'team') {
      const qs = await getDocs(query(collection(db, 'commandes'), where('livreeLe', '>=', d)));
      qs.forEach((x) => { const c = x.data(); if (c.statut === 'livree') list.push(c); });
      const dts = await dettesDepuis(d);
      finState.team = teamText(withDettes(sumUp(list, await remisDepuis(d)), dts), d);
    } else {
      const qs = await getDocs(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', '==', 'livree')));
      qs.forEach((x) => { const c = x.data(); const t = c.livreeLe && c.livreeLe.toDate ? c.livreeLe.toDate() : null; if (t && t >= d) list.push(c); });
      finState.me = myText(withDettes(sumUp(list, await remisDepuis(d, me.mid)), await dettesDepuis(d, me.mid))[0], d);
    }
  } catch (e) { finState[which] = 'Erreur : ' + msg(e); }
  drawFin(which);
}
function drawFin(which) {
  const box = $(which === 'team' ? 'finTeam' : 'finMe'); if (!box) return;
  const t = finState[which];
  box.innerHTML = '<div class="card"><div class="label">🌙 ' + (which === 'team' ? 'Résumé de la soirée (équipe)' : 'Mon résumé de la soirée') + '</div>' +
    (t == null ? '<button class="btn ghost" data-fin="load">Voir le résumé</button>' :
      '<pre class="fin">' + esc(t) + '</pre><div class="two"><button class="btn ghost sm" data-fin="load">↻ Actualiser</button><button class="btn ok sm" data-fin="share">Partager</button></div>') + '</div>';
  box.querySelectorAll('[data-fin]').forEach((b) => { b.onclick = async () => {
    if (b.dataset.fin === 'load') { b.textContent = 'Calcul…'; return loadFin(which); }
    try { if (navigator.share) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); b.textContent = 'Copié ✓'; } }
    catch (e) { try { await navigator.clipboard.writeText(t); b.textContent = 'Copié ✓'; } catch (x) {} }
  }; });
}
function initFin() {
  if (!me) return;
  if ($('finTeam')) { if (isOwner() || me.role === 'complet') drawFin('team'); else $('finTeam').innerHTML = ''; }
  if ($('finMe')) { if (delivers()) drawFin('me'); else $('finMe').innerHTML = ''; }
}

// =====================================================================
// Version 10 : messages dispatch ↔ livreur, « À tous », copie pour le propriétaire, bouton 💰
// =====================================================================
// messages/{id} : { mid (le livreur de la conversation), de: 'dispatch' | 'livreur', par, nom, txt, img?, le, tous? }
// lus/{mid}     : { dispatch: ms, livreur: ms } (dernière lecture de chaque côté, pour le rond rouge)
// archives/{id} : copie des messages effacés par le dispatch, lue et effacée seulement par le propriétaire.
const dm = { all: [], lus: {}, mine: [], open: null, eraseAsk: false, busy: false, arch: null, archAsk: false };
const isDispatcher = () => me && (isOwner() || me.role === 'complet' || (me.role === 'limite' && !locked()));
const chatsDriver = () => me && (me.role === 'livreur' || (me.role === 'limite' && mySoiree && mySoiree.statut === 'ouverte' && !doesDisp(mySoiree)));
const isDispPerson = (s) => (team[s.mid] && team[s.mid].role === 'complet') || s.mode === 'les2';
const DQ = ['Appelle-moi', 'Prends ton temps', 'Dépêche, client attend'];
const LQ = [['👍 OK', '👍 OK'], ['Recharge', 'Besoin d’une recharge'], ['Pause 10 min', 'Pause 10 min'], ['Client répond pas', 'Client répond pas']];
function startDm() {
  if (!me) return;
  if (isOwner() || isStaff()) {
    stops.push(onSnapshot(query(collection(db, 'messages'), orderBy('le', 'desc'), limit(400)), (qs) => {
      const seen = new Set(dm.all.map((m) => m.id)), had = dm.all.length > 0 || dm.ready;
      dm.all = []; qs.forEach((d) => { if (!hidDoc(d.data())) dm.all.push(Object.assign({ id: d.id }, d.data())); }); dm.all.reverse(); drawDm();
      const nw = dm.all.filter((m) => !seen.has(m.id) && m.de === 'livreur');
      if (had && nw.length) { const m = nw[nw.length - 1]; bulle(nomDe(m.mid), m.txt, () => { dm.open = m.mid; setTab('direct'); drawDm(); const el = $('dmCard'); if (el) el.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('dmTxt') && $('dmTxt').focus(), 400); }); }
      dm.ready = true;
    }, () => {}));
    stops.push(onSnapshot(collection(db, 'lus'), (qs) => { dm.lus = {}; qs.forEach((d) => { if (!hidId(d.id)) dm.lus[d.id] = d.data(); }); drawDm(); }, () => {}));
  }
  if (me.role === 'livreur' || me.role === 'limite') {
    let first = true;
    stops.push(onSnapshot(query(collection(db, 'messages'), where('mid', '==', me.mid)), (qs) => {
      const before = dm.mine.length; dm.mine = [];
      qs.forEach((d) => dm.mine.push(Object.assign({ id: d.id }, d.data())));
      dm.mine.sort((a, b) => tsMs(a.le) - tsMs(b.le));
      if (!first && dm.mine.length > before && dm.mine[dm.mine.length - 1].de === 'dispatch' && chatsDriver()) bip();
      if (!first && dm.mine.length > before && dm.mine[dm.mine.length - 1].de === 'dispatch' && chatsDriver()) { const m = dm.mine[dm.mine.length - 1]; bulle((m.tous ? '📣 ' : '') + dispName(m.nom || 'Dispatch'), m.txt, () => { setTab('soiree'); const el = $('dmMe'); if (el) el.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('lmTxt') && $('lmTxt').focus(), 400); }); }
      first = false; drawMine();
    }, () => {}));
    stops.push(onSnapshot(doc(db, 'lus', me.mid), (s) => { dm.myLu = s.exists() ? s.data() : {}; drawMine(); }, () => {}));
  }
  drawDm(); drawMine(); drawCashBtn(); drawArch();
}
function bubbles(list, mine) {
  return list.map((m) => { const t = new Date(tsMs(m.le));
    const who = m.par && m.par === myMid() ? 'Toi' : dispName(m.nom || (m.de === 'livreur' ? nomDe(m.mid) : 'Dispatch'));
    return '<div class="cm ' + (m.tous ? 'call' : m.de === mine ? 'cme' : 'cthem') + '"><div style="font-size:11px;font-weight:700;opacity:.85;margin-bottom:2px">' + esc(who) + '</div>' + (m.tous ? '📣 ' : '') + esc(m.txt || '') + (m.img ? '<img src="' + esc(m.img) + '" alt="photo">' : '') +
      '<div class="ct">' + (m.tous ? 'À tous · ' : '') + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') + '</div></div>'; }).join('');
}
async function sendMsg(mid, de, txt, img, tous) {
  txt = String(txt || '').trim().slice(0, 300); if (!txt && !img) return;
  const d = { mid, de, par: me.mid, nom: me.nom || 'Dispatch', txt: txt || '📷 Photo', le: serverTimestamp() };
  if (img) d.img = img; if (tous) d.tous = true;
  await setDoc(doc(collection(db, 'messages')), d);
  if (de === 'dispatch') notifyMsg(mid, (me.nom || 'Dispatch') + ' : ' + d.txt); else notifyDispatch('💬 ' + me.nom + ' : ' + d.txt);
}
async function notifyMsg(mid, texte) {
  try { const t = await auth.currentUser.getIdToken();
    fetch(NOTIFIER, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ type: 'message', mid, texte }) }).catch(() => {}); } catch (e) {}
}
const luMem = {};
function markRead(mid, side) { const k = mid + side; if (Date.now() - (luMem[k] || 0) < 3000) return; luMem[k] = Date.now(); setDoc(doc(db, 'lus', mid), { [side]: Date.now() }, { merge: true }).catch(() => {}); }
function unreadFor(mid) { const lu = (dm.lus[mid] && dm.lus[mid].dispatch) || 0; return dm.all.filter((m) => m.mid === mid && m.de === 'livreur' && tsMs(m.le) > lu).length; }
const typing = (box) => document.activeElement && document.activeElement.closest && document.activeElement.closest('#' + box) && document.activeElement.tagName === 'INPUT';

// ----- Côté dispatch (propriétaire, MOUSSE, lost quand il est autorisé comme dispatch) -----
function drawDm() {
  if (typeof fx !== 'undefined' && fx.id) renderFocus();
  const box = $('dmCard'); if (!box || !me) return;
  if (!isDispatcher()) { box.innerHTML = ''; return; }
  const ids = new Set(Object.values(soirees).filter((s) => working(s) && !isDispPerson(s)).map((s) => s.mid));
  dm.all.forEach((m) => ids.add(m.mid));
  // v29 : tous les livreurs actifs de l'équipe, en service ou pas (on peut leur écrire n'importe quand).
  Object.keys(team).forEach((id) => { const p = team[id]; if (p.actif && ['livreur', 'limite'].includes(p.role) && id !== myMid()) ids.add(id); });
  const enSvc = (id) => Object.values(soirees).some((s) => s.mid === id && working(s));
  const total = [...ids].reduce((a, id) => a + unreadFor(id), 0);
  const tb = document.querySelector('#tabs button[data-t="direct"]'); if (tb) tb.textContent = 'En direct' + (total ? ' 🔴' + total : '');
  if (dm.open) {
    const mid = dm.open, list = dm.all.filter((m) => m.mid === mid);
    if (unreadFor(mid)) markRead(mid, 'dispatch');
    if (typing('dmCard') && $('dmFeed')) { $('dmFeed').innerHTML = bubbles(list, 'dispatch') || '<div class="small">Pas encore de message.</div>'; $('dmFeed').scrollTop = 1e6; return; }
    box.innerHTML = '<div class="card"><div class="dmhead"><button class="linkbtn" id="dmBack" style="font-size:17px">‹ Tous les livreurs</button></div><div class="label" style="margin-top:6px">💬 ' + esc(nomDe(mid)) + '</div>' +
      '<div class="cfeed" id="dmFeed">' + (bubbles(list, 'dispatch') || '<div class="small">Pas encore de message.</div>') + '</div>' +
      '<div class="seg" style="margin:6px 0">' + DQ.map((q) => '<button data-dq="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
      '<div class="crow"><input id="dmTxt" maxlength="300" placeholder="Écrire à ' + esc(nomDe(mid)) + '…"><label class="cpic">📷<input type="file" id="dmPic" accept="image/*" class="hide"></label><button class="btn sm" id="dmSend">➤</button></div><div class="err" id="dmErr"></div><button class="fback" id="dmBack2">‹ Fermer la conversation</button></div>';
    $('dmFeed').scrollTop = 1e6;
    $('dmBack2').onclick = () => { dm.open = null; drawDm(); };
    const go = (t, img) => sendMsg(mid, 'dispatch', t, img).catch((e) => { $('dmErr').textContent = msg(e); });
    $('dmBack').onclick = () => { dm.open = null; drawDm(); };
    box.querySelectorAll('[data-dq]').forEach((b) => { b.onclick = () => { $('dmTxt').value = b.dataset.dq; $('dmTxt').focus(); }; });
    $('dmSend').onclick = () => { const v = $('dmTxt').value; $('dmTxt').value = ''; go(v); };
    $('dmTxt').onkeydown = (e) => { if (e.key === 'Enter') $('dmSend').click(); };
    $('dmPic').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { go('', await shrinkImg(f)); } catch (x) {} } };
    return;
  }
  if (typing('dmCard')) return;
  const rows = [...ids].sort((a, b) => (enSvc(b) - enSvc(a)) || (unreadFor(b) - unreadFor(a)) || nomDe(a).localeCompare(nomDe(b), 'fr')).map((id) => {
    const list = dm.all.filter((m) => m.mid === id), last = list[list.length - 1], n = unreadFor(id);
    return '<div class="q dmrow" data-mid="' + id + '" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center"><div><b>' + esc(nomDe(id)) + '</b> <span class="small">' + (enSvc(id) ? '🟢 en service' : '⚪ pas en service') + '</span><div class="small">' +
      (last ? esc((last.de === 'dispatch' ? 'Toi : ' : '') + (last.txt || '')).slice(0, 60) : 'Aucun message') + '</div></div>' + (n ? '<span class="badge">' + n + '</span>' : '') + '</div>';
  }).join('');
  box.innerHTML = '<div class="card"><div class="label">💬 Messages' + (total ? ' <span class="badge">' + total + '</span>' : '') + '</div>' +
    (rows || '<div class="small">Personne en service pour l’instant.</div>') +
    '<div class="label" style="margin-top:12px">📣 À tous les livreurs en service</div>' +
    '<div class="crow"><input id="dmAll" maxlength="300" placeholder="Message à tous…"><button class="btn sm" id="dmAllGo">➤</button></div>' +
    (dm.all.length ? '<button class="linkbtn" id="dmErase" style="margin-top:10px;color:var(--danger)">' + (dm.eraseAsk ? 'Appuie encore : effacer les ' + dm.all.length + ' messages (une copie va au propriétaire)' : '🧹 Effacer les messages de la soirée') + '</button>' : '') +
    '<div class="err" id="dmErr"></div></div>';
  box.querySelectorAll('.dmrow').forEach((r) => { r.onclick = () => { dm.open = r.dataset.mid; dm.eraseAsk = false; drawDm(); }; });
  $('dmAllGo').onclick = async () => {
    const v = $('dmAll').value.trim(); if (!v) return;
    const to = Object.values(soirees).filter((s) => working(s) && !isDispPerson(s)).map((s) => s.mid);
    if (!to.length) { $('dmErr').textContent = 'Personne en service.'; return; }
    $('dmAll').value = '';
    try { for (const mid of to) await sendMsg(mid, 'dispatch', v, null, true); } catch (e) { $('dmErr').textContent = msg(e); }
  };
  $('dmAll').onkeydown = (e) => { if (e.key === 'Enter') $('dmAllGo').click(); };
  if ($('dmErase')) $('dmErase').onclick = () => { if (!dm.eraseAsk) { dm.eraseAsk = true; drawDm(); return; } dm.eraseAsk = false; eraseAll(); };
}
// Effacer : copie dans archives (pour le propriétaire), puis on efface les messages.
async function eraseAll() {
  if (dm.busy) return; dm.busy = true;
  try {
    const qs = await getDocs(collection(db, 'messages'));
    const docs = []; qs.forEach((d) => docs.push(d));
    for (let i = 0; i < docs.length; i += 200) {
      const b = writeBatch(db);
      docs.slice(i, i + 200).forEach((d) => { b.set(doc(db, 'archives', d.id), Object.assign({}, d.data(), { archiveLe: serverTimestamp(), archivePar: me.mid })); b.delete(d.ref); });
      await b.commit();
    }
  } catch (e) { if ($('dmErr')) $('dmErr').textContent = msg(e); }
  dm.busy = false; dm.arch = null; drawArch();
}

// ----- Côté livreur -----
function drawMine() {
  const box = $('dmMe'); if (!box || !me) return;
  if (!chatsDriver()) { box.innerHTML = ''; return; }
  const lu = (dm.myLu && dm.myLu.livreur) || 0;
  const n = dm.mine.filter((m) => m.de === 'dispatch' && tsMs(m.le) > lu).length;
  if (n && curTab === 'soiree' && document.visibilityState === 'visible') markRead(me.mid, 'livreur');
  const tb = document.querySelector('#tabs button[data-t="soiree"]'); if (tb) tb.textContent = 'Ma soirée' + (n ? ' 🔴' + n : '');
  if (typing('dmMe') && $('lmFeed')) { $('lmFeed').innerHTML = bubbles(dm.mine, 'livreur') || '<div class="small">Pas encore de message.</div>'; $('lmFeed').scrollTop = 1e6; return; }
  box.innerHTML = '<div class="card"><div class="label">💬 Dispatch' + (n ? ' <span class="badge">' + n + '</span>' : '') + '</div>' +
    '<div class="cfeed" id="lmFeed">' + (bubbles(dm.mine, 'livreur') || '<div class="small">Pas encore de message. Le dispatch peut t’écrire ici.</div>') + '</div>' +
    '<div class="seg" style="margin:6px 0">' + LQ.map((q) => '<button data-lq="' + esc(q[1]) + '">' + esc(q[0]) + '</button>').join('') + '</div>' +
    '<div class="crow"><input id="lmTxt" maxlength="300" placeholder="Écrire au dispatch…"><label class="cpic">📷<input type="file" id="lmPic" accept="image/*" class="hide"></label><button class="btn sm" id="lmSend">➤</button></div><div class="err" id="lmErr"></div></div>';
  $('lmFeed').scrollTop = 1e6;
  const go = (t, img) => sendMsg(me.mid, 'livreur', t, img).catch((e) => { $('lmErr').textContent = msg(e); });
  box.querySelectorAll('[data-lq]').forEach((b) => { b.onclick = () => { $('lmTxt').value = b.dataset.lq; $('lmTxt').focus(); }; });
  $('lmSend').onclick = () => { const v = $('lmTxt').value; $('lmTxt').value = ''; go(v); };
  $('lmTxt').onkeydown = (e) => { if (e.key === 'Enter') $('lmSend').click(); };
  $('lmPic').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { go('', await shrinkImg(f)); } catch (x) {} } };
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') drawMine(); });
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#tabs button[data-t="soiree"]')) setTimeout(drawMine, 0); }, true);

// ----- Copie des messages : propriétaire seulement (Équipe) -----
async function drawArch() {
  const box = $('archCard'); if (!box) return;
  if (!isOwner()) { box.innerHTML = ''; return; }
  const a = dm.arch;
  let h = '<div class="card"><div class="label">🗂 Copie des messages effacés</div>';
  if (a == null) h += '<button class="btn ghost" id="arLoad">Voir la copie</button>';
  else if (!a.length) h += '<div class="small">Aucune copie.</div><button class="linkbtn" id="arLoad">↻ Actualiser</button>';
  else {
    const by = {}; a.forEach((m) => { (by[m.mid] = by[m.mid] || []).push(m); });
    h += Object.keys(by).sort((x, y) => nomDe(x).localeCompare(nomDe(y), 'fr')).map((mid) => '<details class="q"><summary><b>' + esc(nomDe(mid)) + '</b> <span class="small">· ' + by[mid].length + ' messages</span></summary>' +
      '<div class="cfeed" style="max-height:300px">' + bubbles(by[mid].sort((x, y) => tsMs(x.le) - tsMs(y.le)), 'dispatch') + '</div></details>').join('') +
      '<div class="two" style="margin-top:8px"><button class="btn ghost sm" id="arLoad">↻ Actualiser</button><button class="btn red sm" id="arDel">' + (dm.archAsk ? 'Appuie encore pour tout effacer' : '🗑 Effacer ma copie') + '</button></div>';
  }
  box.innerHTML = h + '<div class="err" id="arErr"></div></div>';
  if ($('arLoad')) $('arLoad').onclick = async () => { try { const qs = await getDocs(collection(db, 'archives')); dm.arch = []; qs.forEach((d) => dm.arch.push(Object.assign({ ref: d.ref }, d.data()))); } catch (e) { $('arErr').textContent = msg(e); return; } drawArch(); };
  if ($('arDel')) $('arDel').onclick = async () => {
    if (!dm.archAsk) { dm.archAsk = true; return drawArch(); }
    dm.archAsk = false;
    try { for (let i = 0; i < a.length; i += 400) { const b = writeBatch(db); a.slice(i, i + 400).forEach((m) => b.delete(m.ref)); await b.commit(); } dm.arch = []; } catch (e) { $('arErr').textContent = msg(e); return; }
    drawArch();
  };
}

// ----- Bouton 💰 discret (livreur) : cash sur lui + livraisons de la soirée -----
function drawCashBtn() {
  const b = $('cashBtn'); if (!b) return;
  b.classList.toggle('hide', !((delivers() && mySoiree && working(mySoiree)) || isDispatcher()));
  b.onclick = (e) => { if (e) e.stopPropagation(); const pop = $('cashPop'); if (!pop.classList.contains('hide')) { closePop(); return; } pop.classList.remove('hide'); try { pop.style.top = Math.round(b.getBoundingClientRect().bottom + 8) + 'px'; } catch (x) {} rm.open = false; rm.form = false; drawPop(); }; // v34 : la bulle s'ouvre juste sous le bouton 💰
  if (!drawCashBtn.outside) { drawCashBtn.outside = true;
    // v28 : toucher ailleurs ferme la bulle 💰
    document.addEventListener('click', (e) => { const pop = $('cashPop'); if (!pop || pop.classList.contains('hide')) return; if (pop.contains(e.target) || e.target === $('cashBtn')) return; closePop(); }, true); }
}

// =====================================================================
// Version 11 : remettre du cash au dispatch pendant la soirée (💰 → « Donner au dispatch »)
// =====================================================================
// remises/{id} : { de, deNom, vers, versNom, montant, statut: 'attente' | 'recue' | 'refusee', le, recueLe? }
// Le dispatch confirme « Reçu ✓ » : alors c'est enlevé du cash du livreur et ajouté à celui du dispatch.
// dispos/{mid} : les dispatchs qui ont l'app ouverte ce soir (pour que le livreur choisisse à qui donner).
const myMid = () => (me && me.mid) || 'proprietaire';
const rm = { mine: [], toMe: [], dispos: {}, open: false, form: false, to: null, err: '' };
async function remisDepuis(d, mid) {
  const out = {};
  try {
    const qs = await getDocs(mid ? query(collection(db, 'remises'), where('de', '==', mid)) : query(collection(db, 'remises'), where('le', '>=', d)));
    qs.forEach((x) => { const r = x.data(); const t = r.le && r.le.toDate ? r.le.toDate() : null; if (!hidDoc(r) && r.statut === 'recue' && t && t >= d) out[r.de] = (out[r.de] || 0) + (Number(r.montant) || 0); });
  } catch (e) {}
  return out;
}
const tonight = (r) => { const t = r.le && r.le.toDate ? r.le.toDate() : null; return !t || t >= soirStart(); };
function startRemises() {
  if (!me) return;
  stops.push(onSnapshot(query(collection(db, 'remises'), where('de', '==', myMid())), (qs) => { rm.mine = []; qs.forEach((d) => rm.mine.push(Object.assign({ id: d.id }, d.data()))); rm.mine = rm.mine.filter(tonight); drawPop(); }, () => {}));
  { // v54 : le livreur aussi (le dispatch lui rend de l'argent → il confirme « Reçu »)
    let n0 = -1;
    stops.push(onSnapshot(query(collection(db, 'remises'), where('vers', '==', myMid())), (qs) => {
      rm.toMe = []; qs.forEach((d) => rm.toMe.push(Object.assign({ id: d.id }, d.data()))); rm.toMe = rm.toMe.filter(tonight);
      const n = rm.toMe.filter((r) => r.statut === 'attente').length; if (n0 >= 0 && n > n0) bip(); n0 = n;
      if (isOwner() || isStaff()) drawRemCard(); else drawRemDrv();
      drawPop();
    }, () => {}));
  }
  stops.push(onSnapshot(collection(db, 'dispos'), (qs) => { rm.dispos = {}; qs.forEach((d) => { if (!hidId(d.id)) rm.dispos[d.id] = d.data(); }); drawPop(); }, () => {}));
  syncDispo();
}
// Le dispatch s'annonce (pour apparaître dans la liste « Donner à… » des livreurs).
let dispoOn = null;
function syncDispo() {
  if (!me || !isStaff()) return; // le propriétaire ne reçoit pas de cash ici : seulement MOUSSE et lost
  const on = isDispatcher();
  if (on === dispoOn) return; dispoOn = on;
  setDoc(doc(db, 'dispos', myMid()), { nom: me.nom, role: me.role, actif: on, le: serverTimestamp() }).catch(() => {});
}
function closePop() { const pop = $('cashPop'); if (pop) pop.classList.add('hide'); rm.open = false; rm.form = false; }
const popX = '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="popClose" aria-label="Fermer" style="width:40px;height:40px;border-radius:50%;border:1px solid #4a5363;background:#2b3240;color:#fff;font-size:18px;line-height:1;cursor:pointer">✕</button></div>';
function cashNow() {
  const remis = rm.mine.filter((r) => r.statut === 'recue').reduce((a, r) => a + r.montant, 0);
  const recu = rm.toMe.filter((r) => r.statut === 'recue').reduce((a, r) => a + r.montant, 0);
  return { remis, recu };
}
async function drawPop() {
  const pop = $('cashPop'); if (!pop || pop.classList.contains('hide')) return;
  if (pop.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const livre = delivers() && mySoiree && working(mySoiree);
  let base = { cash: 0, n: 0 };
  if (livre) {
    try {
      const d = soirStart(), list = [];
      const qs = await getDocs(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', '==', 'livree')));
      qs.forEach((x) => { const c = x.data(); const t = c.livreeLe && c.livreeLe.toDate ? c.livreeLe.toDate() : null; if (t && t >= d) list.push(c); });
      base = sumUp(list)[0] || base;
    } catch (e) {}
  }
  const k = cashNow(); let sur = base.cash - k.remis + k.recu, so = null;
  if (!isOwner()) { try { so = await soldeMoi(); sur = so.tot; } catch (e) {} } // v44 : le solde continue d'un jour à l'autre
  if (isOwner()) {
    pop.innerHTML = '💰 <b>' + money(k.recu) + '</b> reçus de MOUSSE ce soir' + rm.toMe.filter((r) => r.statut === 'recue').slice(-4).map((r) => '<div class="small">✓ ' + money(r.montant) + ' de ' + esc(r.deNom) + '</div>').join('') + popX;
    $('popClose').onclick = (e) => { e.stopPropagation(); closePop(); };
    return;
  }
  const att = rm.mine.filter((r) => r.statut === 'attente');
  // v54 : il peut donner tout son cash (sa paye comprise) ; s'il donne plus que ce qu'il doit, le dispatch lui doit la différence.
  const garde = livre && !isStaff() ? Math.max(0, (base.paie || 0) + (base.frais || 0) + (base.tips || 0)) : 0, maxCash = Math.max(0, sur + garde);
  let h;
  if (!isStaff() && sur < 0) h = '<div style="cursor:pointer" id="popTop"><div style="font-size:22px;font-weight:900;color:#c4b5fd">' + money(sur) + '</div><b style="color:#c4b5fd">💜 Le dispatch te doit ' + money(-sur) + '</b>' + (livre ? '<div class="small">' + base.n + ' livraison' + (base.n > 1 ? 's' : '') + ' ce soir</div>' : '') + '</div>';
  else if (!isStaff()) h = '<div style="cursor:pointer" id="popTop">💰 <b>' + money(sur) + '</b> à remettre' + (livre ? ' · <b>' + base.n + '</b> livraison' + (base.n > 1 ? 's' : '') + ' ce soir' : '') + (garde ? '<div class="small">💵 ' + money(maxCash) + ' cash sur toi, dont ' + money(garde) + ' ta paye</div>' : '') + '</div>';
  else h = '<div style="cursor:pointer" id="popTop">💰 <b>' + money(sur) + '</b> sur toi' + (livre ? ' · <b>' + base.n + '</b> livraison' + (base.n > 1 ? 's' : '') + ' ce soir' : '') + '</div>';
  if (so && Math.round(so.avant)) h += '<div class="small">' + money(so.avant) + ' d’avant + ' + money(so.ceSoir) + ' ce soir</div>';
  if (k.recu && isStaff()) h += '<div class="small">dont ' + money(k.recu) + ' reçus des livreurs</div>';
  dt.mine.filter((x) => x.statut === 'ouverte' && x.responsable === myMid()).forEach((x) => { h += '<div class="small">📒 Ta dette : ' + money(x.montant) + ' (' + esc(x.client) + ')</div>'; });
  att.forEach((r) => { h += '<div class="small" style="margin-top:4px">⏳ ' + money(r.montant) + ' → ' + esc(r.versNom) + ' : en attente <button class="linkbtn" data-ann="' + r.id + '">Annuler</button></div>'; });
  rm.mine.filter((r) => r.statut !== 'attente').slice(-3).forEach((r) => { h += '<div class="small">' + (r.statut === 'recue' ? '✓ ' : '✗ ') + money(r.montant) + ' → ' + esc(r.versNom) + (r.statut === 'recue' ? ' (reçu)' : ' (pas reçu)') + '</div>'; });
  if (!rm.form) h += '<button class="linkbtn" id="popGive" style="margin-top:6px">↗ Donner du cash ' + (me.role === 'complet' ? 'à ' + OWNER : me.role === 'limite' ? 'à MOUSSE' : 'au dispatch') + '</button>';
  else {
    // MOUSSE donne seulement au propriétaire ; lost seulement à MOUSSE ; un livreur à MOUSSE d'abord, puis lost.
    const on = Object.entries(rm.dispos).filter(([id, d]) => d.actif && id !== myMid() && id !== 'proprietaire');
    const ds = me.role === 'complet' ? [['proprietaire', { nom: OWNER }]]
      : me.role === 'limite' ? on.filter(([id, d]) => d.role === 'complet')
      : on.sort((a, b) => (a[1].role === 'complet' ? 0 : 1) - (b[1].role === 'complet' ? 0 : 1));
    h += '<div style="margin-top:8px;min-width:230px"><div class="small">À qui :</div><div class="seg" style="margin:4px 0">' +
      (ds.map(([id, d]) => '<button data-to="' + id + '" class="' + (rm.to === id ? 'on' : '') + '">' + esc(d.nom) + '</button>').join('') || '<span class="small">Aucun dispatch en ligne.</span>') + '</div>' +
      '<div class="crow"><input id="popAmt" type="number" inputmode="numeric" placeholder="Montant $"><button class="btn sm" id="popSend">Donner</button></div>' +
      (!isStaff() ? '<div class="small" id="popPlus" style="color:#c4b5fd"></div>' : '') +
      '<div class="err" id="popErr">' + esc(rm.err) + '</div><button class="linkbtn" id="popX">Fermer</button></div>';
  }
  pop.innerHTML = h + popX;
  if ($('popClose')) $('popClose').onclick = (e) => { e.stopPropagation(); closePop(); };
  if ($('popGive')) $('popGive').onclick = (e) => { e.stopPropagation(); rm.form = true; rm.err = ''; drawPop(); };
  if ($('popTop')) $('popTop').onclick = () => { if (!rm.form) { rm.form = true; drawPop(); } };
  if ($('popX')) $('popX').onclick = () => { rm.form = false; drawPop(); };
  if ($('popAmt') && $('popPlus')) $('popAmt').oninput = () => { const m = Math.round(Number($('popAmt').value) || 0), x = m - Math.max(0, sur); $('popPlus').textContent = x > 0 && m <= maxCash ? 'Tu donnes ' + money(x) + ' de plus que ce que tu dois → le dispatch te devra ' + money(x) + '.' : ''; };
  pop.querySelectorAll('[data-to]').forEach((b) => { b.onclick = () => { const v = $('popAmt') && $('popAmt').value; rm.to = b.dataset.to; drawPop().then(() => { if (v && $('popAmt')) $('popAmt').value = v; }); }; });
  pop.querySelectorAll('[data-ann]').forEach((b) => { b.onclick = () => deleteDoc(doc(db, 'remises', b.dataset.ann)).catch(() => {}); });
  if ($('popSend')) $('popSend').onclick = async () => {
    const m = Math.round(Number($('popAmt').value) || 0);
    if (!rm.to || (!rm.dispos[rm.to] && rm.to !== 'proprietaire')) { rm.err = 'Choisis à qui.'; return drawPop(); }
    if (m <= 0) { rm.err = 'Écris le montant.'; return drawPop(); }
    if (m > (isStaff() ? sur : maxCash)) { rm.err = 'Tu as seulement ' + money(isStaff() ? sur : maxCash) + ' sur toi.'; return drawPop(); }
    try {
      await setDoc(doc(collection(db, 'remises')), { de: myMid(), deNom: me.nom || OWNER, vers: rm.to, versNom: rm.to === 'proprietaire' ? OWNER : rm.dispos[rm.to].nom, montant: m, statut: 'attente', le: serverTimestamp() });
      if (rm.to !== 'proprietaire') notifyDispatch('💵 ' + me.nom + ' te donne ' + money(m) + ' cash', rm.to);
      rm.form = false; rm.err = ''; drawPop();
    } catch (e) { rm.err = msg(e); drawPop(); }
  };
}
// Côté dispatch : « Fmj te donne 500 $ » → Reçu ✓ / Pas reçu
function drawRemCard() {
  const box = $('remCard'); if (!box) return;
  const att = rm.toMe.filter((r) => r.statut === 'attente');
  box.innerHTML = att.length ? '<div class="card alert"><div class="label">💵 Cash qu’on te donne</div>' + att.map((r) =>
    '<div class="item"><b>' + esc(r.deNom) + '</b> te donne <b>' + money(r.montant) + '</b> cash<div class="two" style="margin-top:8px"><button class="btn red sm" data-rno="' + r.id + '">Pas reçu</button><button class="btn ok sm" data-ryes="' + r.id + '">Reçu ✓</button></div></div>').join('') + '</div>' : '';
  box.querySelectorAll('[data-ryes]').forEach((b) => { b.onclick = () => updRemise(b.dataset.ryes, 'recue'); });
  box.querySelectorAll('[data-rno]').forEach((b) => { b.onclick = () => updRemise(b.dataset.rno, 'refusee'); });
}
function updRemise(id, statut) { writeBatch(db).update(doc(db, 'remises', id), { statut, recueLe: serverTimestamp() }).commit().catch((e) => alertBar(msg(e))); }
// v54 : le livreur a donné plus que ce qu'il devait (sa paye comprise) → le dispatch lui doit la différence.
function drawRemDrv() {
  let box = $('remDrv');
  const att = rm.toMe.filter((r) => r.statut === 'attente');
  if (!att.length) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'remDrv'; box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:60;max-width:460px;margin:0 auto'; document.body.appendChild(box); }
  box.innerHTML = '<div class="card alert" style="box-shadow:0 10px 30px rgba(0,0,0,.6)"><div class="label">💵 Le dispatch te rend de l’argent</div>' + att.map((r) =>
    '<div class="item"><b>' + esc(r.deNom) + '</b> dit qu’il t’a donné <b>' + money(r.montant) + '</b><div class="two" style="margin-top:8px"><button class="btn red sm" data-rno="' + r.id + '">Pas reçu</button><button class="btn ok sm" data-ryes="' + r.id + '">Reçu ✓</button></div></div>').join('') + '</div>';
  box.querySelectorAll('[data-ryes]').forEach((b) => { b.onclick = () => updRemise(b.dataset.ryes, 'recue'); });
  box.querySelectorAll('[data-rno]').forEach((b) => { b.onclick = () => updRemise(b.dataset.rno, 'refusee'); });
}
async function rendreA(mid, nom, m) {
  await setDoc(doc(collection(db, 'remises')), { de: myMid(), deNom: me.nom || OWNER, vers: mid, versNom: nom || nomDe(mid), montant: Math.round(m), statut: 'attente', le: serverTimestamp(), rend: true });
  notifyMsg(mid, '💵 ' + (me.nom || OWNER) + ' te rend ' + money(Math.round(m)) + ' — confirme « Reçu »');
}

// =====================================================================
// Version 12 : dettes (« le client paie plus tard »), surtout pour les EMT pas reçus
// =====================================================================
// dettes/{id} : { client, montant, responsable (mid du livreur, ou du dispatch ; 'dispatch' tant que pas accepté), livreur, livreurNom, cmd, note,
//                 statut: 'demande' | 'ouverte' | 'refusee' | 'reglee', creePar, creeParNom, creeLe, ... }
// Le livreur la demande à la porte → MOUSSE ou le propriétaire accepte. Eux deux voient toutes les dettes ;
// les autres voient seulement les leurs. Rappel au livreur responsable à chaque ouverture de l'app ; revue le lundi.
const dt = { all: [], mine: [], door: {}, disp: null, page: false, okRappel: false, lundiVu: false };
const canDette = () => me && (isOwner() || me.role === 'complet');
function startDettes() {
  if (!me) return;
  if (canDette()) stops.push(onSnapshot(query(collection(db, 'dettes'), where('statut', 'in', ['demande', 'ouverte', 'attente_livreur'])), (qs) => {
    const n0 = dt.all.filter((x) => x.statut === 'demande').length;
    dt.all = []; qs.forEach((d) => dt.all.push(Object.assign({ id: d.id }, d.data())));
    if (dt.all.filter((x) => x.statut === 'demande').length > n0) bip();
    drawDettes();
  }, () => {}));
  // Les miennes : celles dont je suis responsable, et celles que j'ai demandées.
  const mine = {};
  const upd = () => { dt.mine = Object.values(mine); drawDettes(); drawPop(); if (typeof renderSoiree === 'function' && delivers()) renderSoiree(); };
  stops.push(onSnapshot(query(collection(db, 'dettes'), where('responsable', '==', myMid())), (qs) => { Object.keys(mine).forEach((k) => { if (mine[k]._r) delete mine[k]; }); qs.forEach((d) => { mine[d.id] = Object.assign({ id: d.id, _r: 1 }, d.data()); }); upd(); }, () => {}));
  stops.push(onSnapshot(query(collection(db, 'dettes'), where('creePar', '==', myMid())), (qs) => { qs.forEach((d) => { mine[d.id] = Object.assign({ id: d.id }, mine[d.id], d.data()); }); upd(); }, () => {}));
  if (!canDette()) stops.push(onSnapshot(query(collection(db, 'dettes'), where('livreur', '==', myMid())), (qs) => { qs.forEach((d) => { mine[d.id] = Object.assign({ id: d.id }, mine[d.id], d.data()); }); upd(); }, () => {}));
  drawDettes();
}
const dDate = (t) => { const x = t && t.toDate ? t.toDate() : t ? new Date(t) : null; return x ? x.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) : ''; };
const respNom = (x) => (x.responsable === 'dispatch' ? 'le dispatch' : x.responsable === 'proprietaire' ? OWNER : nomDe(x.responsable) || x.livreurNom);
function detteSur(c) { const x = dt.mine.find((y) => y.cmd === c.id && y.statut !== 'refusee'); return x && x.montant ? x.montant : 0; }
async function dettesDepuis(d, mid) {
  const out = {};
  try {
    const qs = await getDocs(mid ? query(collection(db, 'dettes'), where('livreur', '==', mid)) : query(collection(db, 'dettes'), where('creeLe', '>=', d)));
    qs.forEach((x) => { const r = x.data(); const t = r.creeLe && r.creeLe.toDate ? r.creeLe.toDate() : null; if (r.statut !== 'refusee' && t && t >= d) out[r.livreur] = (out[r.livreur] || 0) + (Number(r.montant) || 0); });
  } catch (e) {}
  return out;
}
function withDettes(rows, dts) { rows.forEach((r) => { r.dette = dts[r.mid] || 0; r.manque = Math.max(0, r.manque - r.dette); }); return rows; }

// ----- Livreur à la porte : « 📒 Le client paie plus tard » -----
function detteDoor(c) {
  const ex = dt.mine.find((y) => y.cmd === c.id && y.statut !== 'refusee');
  if (ex) return '<div class="small" style="margin-top:8px">📒 Dette ' + (ex.montant ? money(ex.montant) + ' ' : '') + '— ' + (ex.statut === 'demande' ? 'en attente du dispatch…' : 'acceptée ✓') + ' (responsable : ' + (ex.responsable === myMid() ? 'toi' : 'le dispatch') + ')</div>';
  const f = dt.door[c.id];
  if (!f) return '<button class="linkbtn" id="dtOpen" style="margin-top:8px">📒 Le client paie plus tard</button>';
  return '<div class="msgc" style="margin-top:8px"><div class="small">Qui est responsable ?</div><div class="seg" id="dtResp" style="margin:4px 0">' +
    [['moi', 'Moi'], ['dispatch', 'Le dispatch']].map((x) => '<button data-r="' + x[0] + '" class="' + (f.resp === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
    (c.bloque ? '<div class="small">Montant : l’EMT pas reçu (le dispatch le connaît).</div>' : '<div class="small">Montant pas payé</div><input id="dtAmt" type="number" inputmode="numeric" value="' + esc(f.amt) + '">') +
    '<input id="dtNote" maxlength="120" placeholder="Note (ex. paie demain)" value="' + esc(f.note) + '">' +
    '<div class="two"><button class="btn ghost sm" id="dtCancel">Annuler</button><button class="btn sm" id="dtSend">Envoyer au dispatch</button></div><div class="err" id="dtErr"></div></div>';
}
function bindDetteDoor(c) {
  if (!c) return;
  if ($('dtOpen')) $('dtOpen').onclick = () => { dt.door[c.id] = { resp: 'moi', amt: c.encaisser || '', note: '' }; renderSoiree(); };
  const f = dt.door[c.id]; if (!f) return;
  document.querySelectorAll('#dtResp button').forEach((b) => { b.onclick = () => { f.resp = b.dataset.r; renderSoiree(); }; });
  if ($('dtAmt')) $('dtAmt').oninput = (e) => { f.amt = e.target.value; };
  if ($('dtNote')) $('dtNote').oninput = (e) => { f.note = e.target.value; };
  if ($('dtCancel')) $('dtCancel').onclick = () => { delete dt.door[c.id]; lv.panel = null; renderSoiree(); };
  if ($('dtSend')) $('dtSend').onclick = async () => {
    const m = c.bloque ? 0 : Math.round(Number(f.amt) || 0);
    if (!c.bloque && (m <= 0 || m > c.encaisser)) { $('dtErr').textContent = 'Montant entre 1 et ' + c.encaisser + ' $.'; return; }
    try {
      await setDoc(doc(collection(db, 'dettes')), { client: c.client || 'Client', montant: m, responsable: f.resp === 'moi' ? me.mid : 'dispatch', livreur: me.mid, livreurNom: me.nom,
        cmd: c.id, note: String(f.note || '').slice(0, 120), statut: 'demande', creePar: me.mid, creeParNom: me.nom, creeLe: serverTimestamp() });
      notifyDispatch('📒 ' + me.nom + ' : dette demandée (' + (c.client || 'client') + ')');
      delete dt.door[c.id]; lv.panel = null; renderSoiree();
    } catch (e) { $('dtErr').textContent = msg(e); }
  };
}
// ----- Dispatch (⋯ sur une commande 🔴 EMT pas reçu) : 📒 Dette → débloque la commande -----
function detteDispForm(c) {
  const f = dt.disp;
  const def = c.bloque ? Math.round((prive[c.id] && prive[c.id].interac) || 0) : (c.encaisser || 0);
  if (f.amt == null) f.amt = def;
  return '<div class="msgc"><div class="small">📒 Dette' + (c.bloque ? ' (EMT pas reçu)' : '') + ' · montant</div><input id="ddAmt" type="number" inputmode="numeric" value="' + esc(f.amt) + '"><div class="small">Qui est responsable ?</div><div class="seg" id="ddResp" style="margin:4px 0">' +
    (c.livreur ? [[c.livreur, esc(c.livreurNom || nomDe(c.livreur))]] : []).concat([[myMid(), 'Moi (dispatch)']]).map((x) => '<button data-r="' + x[0] + '" class="' + (f.resp === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
    '<input id="ddNote" maxlength="120" placeholder="Note (ex. paie demain)" value="' + esc(f.note) + '"><div class="two"><button class="btn ghost sm" id="ddCancel">Annuler</button><button class="btn sm" id="ddGo">Créer la dette</button></div><div class="err" id="ddErr"></div></div>';
}
function bindDetteDisp() {
  const f = dt.disp; if (!f || !$('ddGo')) return;
  const c = cmds[f.id]; if (!c) return;
  document.querySelectorAll('#ddResp button').forEach((b) => { b.onclick = () => { f.resp = b.dataset.r; renderQueues(); }; });
  $('ddNote').oninput = (e) => { f.note = e.target.value; };
  $('ddAmt').oninput = (e) => { f.amt = e.target.value; };
  $('ddCancel').onclick = () => { dt.disp = null; renderQueues(); };
  $('ddGo').onclick = async () => {
    try {
      const ref = doc(collection(db, 'dettes'));
      const b = writeBatch(db);
      const m = Math.round(Number(f.amt) || 0);
      if (m <= 0) { $('ddErr').textContent = 'Écris le montant.'; return; }
      // Si le livreur est nommé responsable, il doit confirmer.
      b.set(ref, { client: c.client || 'Client', montant: m, responsable: f.resp, livreur: c.livreur || '', livreurNom: c.livreurNom || '',
        cmd: c.id, note: String(f.note || '').slice(0, 120), statut: f.resp === myMid() ? 'ouverte' : 'attente_livreur', creePar: myMid(), creeParNom: me.nom || 'Propriétaire', creeLe: serverTimestamp() });
      b.update(doc(db, 'commandes', c.id), c.bloque ? { bloque: false, paye: !(c.encaisser > 0), dette: ref.id } : { dette: ref.id });
      b.update(doc(db, 'cmdPrive', c.id), { dette: ref.id });
      await b.commit(); dt.disp = null; renderQueues();
    } catch (e) { $('ddErr').textContent = msg(e); }
  };
}
// Accepter / refuser une demande du livreur. Si la commande était bloquée (EMT pas reçu), elle se débloque.
async function detteDecide(x, ok) {
  try {
    const b = writeBatch(db);
    if (!ok) b.update(doc(db, 'dettes', x.id), { statut: 'refusee', decidePar: myMid(), decideLe: serverTimestamp() });
    else {
      const c = cmds[x.cmd], p = prive[x.cmd];
      const m = x.montant || Math.round((p && p.interac) || 0);
      b.update(doc(db, 'dettes', x.id), Object.assign({ statut: 'ouverte', montant: m, decidePar: myMid(), decideLe: serverTimestamp() }, x.responsable === 'dispatch' ? { responsable: myMid() } : {}));
      if (c && c.bloque) { b.update(doc(db, 'commandes', x.cmd), { bloque: false, paye: !(c.encaisser > 0), dette: x.id }); b.update(doc(db, 'cmdPrive', x.cmd), { dette: x.id }); }
    }
    await b.commit();
  } catch (e) { alertBar(msg(e)); }
}
async function detteRegler(x, mode) {
  try { await writeBatch(db).update(doc(db, 'dettes', x.id), { statut: 'reglee', regleMode: mode, reglePar: myMid(), regleParNom: me.nom || OWNER, regleLe: serverTimestamp() }).commit(); }
  catch (e) { alertBar(msg(e)); }
}
// Le livreur nommé responsable par le dispatch : « Je confirme » ou « Pas moi » (alors ça revient au dispatch qui l'a créée).
async function detteConfirm(x, ok) {
  if (!x) return;
  try {
    await writeBatch(db).update(doc(db, 'dettes', x.id), ok ? { statut: 'ouverte', confirmeLe: serverTimestamp() }
      : { statut: 'ouverte', responsable: x.creePar, note: ((x.note ? x.note + ' · ' : '') + (me.nom || '') + ' a dit « pas moi »').slice(0, 160), confirmeLe: serverTimestamp() }).commit();
  } catch (e) { alertBar(msg(e)); }
}
const isMonday = () => new Date().getDay() === 1;
function drawDettes() {
  // 1) Dispatch : demandes à accepter (carte jaune en haut d'En direct) + revue du lundi
  const top = $('detteCard');
  if (top) {
    let h = '';
    if (canDette()) {
      const dem = dt.all.filter((x) => x.statut === 'demande');
      if (dem.length) h += '<div class="card alert"><div class="label">📒 Dette demandée</div>' + dem.map((x) => '<div class="item"><b>' + esc(x.livreurNom) + '</b> : ' + esc(x.client) + ' paie plus tard' +
        (x.montant ? ' · <b>' + money(x.montant) + '</b>' : ' · EMT pas reçu (' + money((prive[x.cmd] && prive[x.cmd].interac) || 0) + ')') +
        '<div class="small">Responsable : ' + (x.responsable === 'dispatch' ? 'le dispatch (toi si tu acceptes)' : esc(x.livreurNom)) + (x.note ? ' · 📝 ' + esc(x.note) : '') + '</div>' +
        '<div class="two" style="margin-top:8px"><button class="btn red sm" data-dno="' + x.id + '">Refuser</button><button class="btn ok sm" data-dyes="' + x.id + '">' + (x.responsable === 'dispatch' ? 'Je confirme (responsable)' : 'Accepter') + '</button></div></div>').join('') + '</div>';
      const open = dt.all.filter((x) => x.statut === 'ouverte');
      let vu = ''; try { vu = localStorage.getItem('dettesLundi') || ''; } catch (e) {}
      if (isMonday() && open.length && vu !== new Date().toDateString()) h += '<div class="card"><div class="label">📒 Lundi : on vérifie les dettes</div><div class="small">' + open.length + ' dette' + (open.length > 1 ? 's' : '') + ' pas réglée' + (open.length > 1 ? 's' : '') + ' · ' + money(open.reduce((a, x) => a + (x.montant || 0), 0)) + '</div>' +
        '<div class="two" style="margin-top:8px"><button class="btn ghost sm" id="dlVu">Vu</button><button class="btn sm" id="dlGo">Voir les dettes</button></div></div>';
    }
    top.innerHTML = h;
    top.querySelectorAll('[data-dyes]').forEach((b) => { b.onclick = () => detteDecide(dt.all.find((x) => x.id === b.dataset.dyes), true); });
    top.querySelectorAll('[data-dno]').forEach((b) => { b.onclick = () => detteDecide(dt.all.find((x) => x.id === b.dataset.dno), false); });
    if ($('dlVu')) $('dlVu').onclick = () => { try { localStorage.setItem('dettesLundi', new Date().toDateString()); } catch (e) {} drawDettes(); };
    if ($('dlGo')) $('dlGo').onclick = () => { try { localStorage.setItem('dettesLundi', new Date().toDateString()); } catch (e) {} dt.page = true; setTab('stock'); drawDettes(); };
  }
  // 2) Rappel au livreur responsable, à chaque ouverture de l'app (bouton OK)
  const rp = $(isOwner() || isStaff() ? 'detteRappelD' : 'detteRappel');
  if (rp) {
    const conf = dt.mine.filter((x) => x.statut === 'attente_livreur' && x.responsable === myMid());
    const mineOpen = dt.mine.filter((x) => x.statut === 'ouverte' && x.responsable === myMid());
    rp.innerHTML = conf.map((x) => '<div class="card alert"><div class="label">📒 À confirmer</div>' + esc(x.creeParNom || 'Le dispatch') + ' dit que tu es responsable de <b>' + money(x.montant) + '</b> (' + esc(x.client) + ')' +
      (x.note ? '<div class="small">📝 ' + esc(x.note) + '</div>' : '') + '<div class="two" style="margin-top:8px"><button class="btn red sm" data-cno="' + x.id + '">Pas moi</button><button class="btn ok sm" data-cyes="' + x.id + '">Je confirme</button></div></div>').join('') +
      (mineOpen.length && !dt.okRappel ? '<div class="card alert"><div class="label">📒 Rappel</div>' + mineOpen.map((x) => '<div>Tu es responsable de <b>' + money(x.montant) + '</b> (' + esc(x.client) + ', depuis le ' + dDate(x.creeLe) + '). À régler.</div>').join('') +
      '<button class="btn sm" id="drOk" style="margin-top:8px">OK</button></div>' : '');
    rp.querySelectorAll('[data-cyes]').forEach((b) => { b.onclick = () => detteConfirm(dt.mine.find((x) => x.id === b.dataset.cyes), true); });
    rp.querySelectorAll('[data-cno]').forEach((b) => { b.onclick = () => detteConfirm(dt.mine.find((x) => x.id === b.dataset.cno), false); });
    if ($('drOk')) $('drOk').onclick = () => { dt.okRappel = true; drawDettes(); };
  }
  // 3) Page 📒 Dettes (petit lien en bas de Stock) : tout pour toi et MOUSSE, seulement les siennes pour les autres
  if (!me) return;
  const pg = $(isOwner() || isStaff() ? 'dettePage' : 'dettePageMe'); if (!pg) return;
  const list = (canDette() ? dt.all : dt.mine.filter((x) => x.responsable === myMid() || x.creePar === myMid())).filter((x) => x.statut === 'ouverte' || x.statut === 'attente_livreur' || (x.statut === 'demande' && !canDette()));
  const tot = list.filter((x) => x.statut === 'ouverte').reduce((a, x) => a + (x.montant || 0), 0);
  if (!list.length && !dt.page) { pg.innerHTML = '<button class="linkbtn small" id="dpOpen" style="opacity:.6">📒 Dettes</button>'; }
  else if (!dt.page) pg.innerHTML = '<button class="linkbtn small" id="dpOpen" style="opacity:.75">📒 ' + list.length + ' dette' + (list.length > 1 ? 's' : '') + ' · ' + money(tot) + '</button>';
  else pg.innerHTML = '<div class="card"><div class="label">📒 Dettes pas réglées <button class="linkbtn" id="dpClose" style="float:right">Fermer</button></div>' +
    (list.map((x) => '<div class="item"><b>' + esc(x.client) + '</b> · ' + (x.montant ? money(x.montant) : '?') + (x.statut === 'demande' ? ' <span class="small">(en attente du dispatch)</span>' : x.statut === 'attente_livreur' ? ' <span class="small">(à confirmer par ' + esc(respNom(x)) + ')</span>' : '') +
      '<div class="small">Depuis le ' + dDate(x.creeLe) + ' · responsable : ' + esc(respNom(x)) + ' · livreur : ' + esc(x.livreurNom || '—') + ' · créée par ' + esc(x.creeParNom || '') + (x.note ? '<br>📝 ' + esc(x.note) : '') + '</div>' +
      (canDette() && x.statut === 'ouverte' ? '<div class="seg" style="margin-top:6px">' + (dt.ask === x.id ? '<button data-reg="int" data-id="' + x.id + '">Réglé par EMT ✓</button><button data-reg="cash" data-id="' + x.id + '">Réglé en cash ✓</button>' : '<button data-ask="' + x.id + '">Réglé…</button>') + '</div>' : '') + '</div>').join('') ||
      '<div class="small">Aucune dette. 👍</div>') + (list.length ? '<div class="small" style="margin-top:6px">Total : ' + money(tot) + '</div>' : '') + '</div>';
  if ($('dpOpen')) $('dpOpen').onclick = () => { dt.page = true; drawDettes(); };
  if ($('dpClose')) $('dpClose').onclick = () => { dt.page = false; dt.ask = null; drawDettes(); };
  pg.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { dt.ask = b.dataset.ask; drawDettes(); }; });
  pg.querySelectorAll('[data-reg]').forEach((b) => { b.onclick = () => { dt.ask = null; detteRegler(dt.all.find((x) => x.id === b.dataset.id), b.dataset.reg); }; });
}

// =====================================================================
// Version 13 : dispatch en mode focus — une commande en plein écran, le reste en petites pastilles en bas
// =====================================================================
// Ordre d'urgence : 🔴 livreur sur place chez le client → 🟠 proche (≤ 3 min) → 🟢 nouvelle commande pas assignée → 🔵 en route.
const fx = { id: null, opts: null, alt: false, cl: [], clSub: null, clFor: null, ask: null, client: false };
function urgOf(c) {
  if (c.statut === 'attente') return { k: 'new', r: 2 };
  if (c.statut === 'ici') return { k: 'ici', r: 0, min: Math.max(0, Math.floor((Date.now() - tsMs(c.iciLe)) / 60000)) };
  const q = queueOf(c.livreur), i = q.findIndex((x) => x.id === c.id), plan = planOf(q);
  const eta = i >= 0 ? Math.max(0, Math.round((plan[i] - Date.now()) / 60000)) : 0;
  return i === 0 && eta <= 3 ? { k: 'proche', r: 1, eta } : { k: 'route', r: 3, eta };
}
const UI = { ici: ['s-ici', '🔴', 'Sur place'], proche: ['s-proche', '🟠', 'Proche'], new: ['s-new', '🟢', 'Nouvelle'], route: ['s-route', '🔵', 'En route'] };
function urgChip(c) { const u = urgOf(c); if (u.k === 'route') return ''; return ' <span class="st ' + UI[u.k][0] + '">' + UI[u.k][1] + ' ' + UI[u.k][2] + (u.k === 'ici' ? ' · ' + u.min + ' min' : u.k === 'proche' ? ' · ~' + u.eta + ' min' : '') + '</span>'; }
function focusList() {
  const out = [];
  Object.values(soirees).filter(working).forEach((s) => { const q0 = queueOf(s.mid)[0]; if (q0) out.push(q0); });
  Object.values(cmds).filter((c) => c.statut === 'attente').forEach((c) => out.push(c));
  return out.map((c) => Object.assign({ c }, urgOf(c))).sort((a, b) => a.r - b.r || (a.k === 'ici' ? tsMs(a.c.iciLe) - tsMs(b.c.iciLe) : 0));
}
function openFocus(id) {
  if (fx.id !== id) { fx.opts = null; fx.alt = false; fx.ask = null; fx.client = false; dt.disp = null; }
  fx.id = id; menuOpen = null; msgOpen = null;
  document.body.classList.add('focusing');
  renderFocus();
  const c = cmds[id];
  if (c && c.statut === 'attente' && !fx.opts) { fx.opts = 'calc'; renderFocus(); optionsFor(c, id).then((o) => { if (fx.id === id) { fx.opts = o; renderFocus(); } }).catch(() => { fx.opts = []; renderFocus(); }); }
}
function closeFocus() {
  fx.id = null; dt.disp = null; if (fx.clSub) { fx.clSub(); fx.clSub = null; fx.clFor = null; }
  document.body.classList.remove('focusing');
  const v = $('focusView'); if (v) v.innerHTML = '';
  if (typeof renderQueues === 'function') renderQueues();
}
// Après une action finie : la prochaine chose urgente, ou retour à la liste.
function focusNext() {
  const n = focusList().find((x) => x.c.id !== fx.id && x.r <= 2);
  if (n) openFocus(n.c.id); else closeFocus();
}
function watchClient(c) {
  const code = c && c.suivi;
  if (code === fx.clFor) return;
  if (fx.clSub) { fx.clSub(); fx.clSub = null; } fx.cl = []; fx.clFor = code;
  if (!code) return;
  fx.clSub = onSnapshot(query(collection(db, 'suivi', code, 'msgs'), orderBy('le', 'asc'), limit(60)), (qs) => { fx.cl = []; qs.forEach((d) => fx.cl.push(d.data())); renderFocus(); }, () => {});
}
const fBtn = (a, l, cls) => '<button class="btn ' + (cls || 'ghost') + '" data-fa="' + a + '">' + l + '</button>';
function renderFocus() {
  const v = $('focusView'); if (!v) return;
  if (!fx.id) { v.innerHTML = ''; return; }
  if (v.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { drawFocusDock(); return; }
  const c = cmds[fx.id];
  if (!c || !['attente', 'assignee', 'ici'].includes(c.statut)) { return focusNext(); }
  const u = urgOf(c);
  let h = '<div class="fhead"><button class="linkbtn" id="fxBack">‹ Retour</button><span class="st ' + UI[u.k][0] + '">' + UI[u.k][1] + ' ' + UI[u.k][2] + '</span></div><div class="fbody">';
  if (u.k === 'new') {
    h += '<div class="small">Nouvelle commande</div><div class="fclient">' + esc(c.client) + '</div>' + testTag(c) + '<div class="faddr">📍 ' + esc(c.adresse) + ' · ' + c.L + ' L ' + c.XL + ' XL</div>' + '<div style="margin:6px 0">' + payTag(c) + '</div>';
    if (fx.opts === 'calc' || fx.opts == null) h += '<div class="small" style="margin:10px 0">Calcul du meilleur livreur…</div>';
    else if (!fx.opts.length) h += '<div class="small" style="margin:10px 0">Aucun livreur en service.</div>';
    else {
      const b = fx.opts[0];
      h += b.ok ? '<button class="btn ok big" data-fo="0">Assigner à ' + esc(b.nom) + ' · arrivée ~' + hm(b.arr) + '</button>' : '<div class="small">Personne n’a assez de stock.</div>';
      h += fx.alt ? fx.opts.slice(1).map((o, i) => optLine(o, false, i + 1)).join('') : (fx.opts.length > 1 ? '<button class="linkbtn" id="fxAlt">Autre livreur ▾</button>' : '');
    }
    h += uberBtns({ L: c.L, XL: c.XL, int: !(c.encaisser > 0), adr: c.adresse && c.adresse !== 'Pick-up' });
    h += (lp.id === c.id ? lpBox(c) : fBtn('chpay', '💳 Changer le paiement'));
    h += (cry.id === c.id ? cryBox() : c.bloque ? fBtn('paid', '✓ ' + payWord(c) + ' reçu') : '') + '<div class="two">' + fBtn('msg', '💬 Client') + fBtn('cancel', fx.ask === 'cancel' ? 'Sûr ? Appuie encore pour supprimer' : '🗑 Supprimer la commande', 'red') + '</div>';
  } else {
    const q = queueOf(c.livreur), plan = planOf(q), nx = q[1];
    h += '<div class="small">' + (c.type === 'uber' ? '🚕' : c.type === 'pickup' ? '📍' : '🚗') + ' <b style="color:var(--text)">' + esc(c.livreurNom || nomDe(c.livreur)) + '</b> ' + (c.type === 'uber' ? 'envoie un Uber à' : c.type === 'pickup' ? 'attend au pick-up' : u.k === 'ici' ? 'est chez' : 's’en va chez') + '</div><div class="fclient">' + esc(c.client) + '</div>' + testTag(c) +
      '<div class="faddr">📍 ' + esc(c.adresse) + ' · ' + c.L + ' L ' + c.XL + ' XL</div>' +
      (c.type ? uberInfo(c) : '<div class="fban ' + UI[u.k][0] + '">' + UI[u.k][1] + ' ' + (u.k === 'ici' ? 'Sur place depuis ' + u.min + ' min' : u.k === 'proche' ? 'Arrive dans ~' + u.eta + ' min' : 'En route · arrivée ~' + hm(plan[0])) + (c.retard ? ' · ' + lateTag(c.retard) : '') + '</div>') +
      '<div style="margin:6px 0">Paiement : ' + payTag(c) + (c.note ? '<div class="small">📝 ' + esc(c.note) + '</div>' : '') + '</div>';
    if (false && fx.cl.length) h += '<div class="fchat"><div class="small">Livreur ↔ client</div>' + fx.cl.slice(-3).map((m) => '<div><b>' + (m.de === 'client' ? esc(prenom(c.client)) : esc(c.livreurNom || '')) + ' :</b> ' + esc(m.txt || '') + (m.img ? '<img class="thumb" src="' + esc(m.img) + '" alt="photo">' : '') + '</div>').join('') + '</div>';
    // Chat avec le livreur, directement ici
    const dl = dm.all.filter((m) => m.mid === c.livreur);
    if (unreadFor(c.livreur)) markRead(c.livreur, 'dispatch');
    h += '<div class="fchat"><div class="small">💬 ' + esc(c.livreurNom || '') + '</div>' + (dl.slice(-3).map((m) => '<div><b>' + (m.de === 'livreur' ? esc(c.livreurNom || '') : 'Toi') + ' :</b> ' + esc(m.txt || '') + (m.img ? '<img class="thumb" src="' + esc(m.img) + '" alt="photo">' : '') + '</div>').join('') || '<div class="small">Pas de message.</div>') +
      '<div class="crow" style="margin-top:6px"><input id="fxTxt" maxlength="300" placeholder="Écrire à ' + esc(c.livreurNom || '') + '…"><button class="btn sm" id="fxSend">➤</button></div></div>';
    if (c.demandePaie) { const dq = c.demandePaie, neuf = dq.emt != null || dq.cry != null;
      h += '<div class="fban s-ici">💳 ' + esc(c.livreurNom || '') + ' : ' + esc(demPaieTxt(dq, c)) + '</div>' + (dq.pasRecu ? '<div class="small" style="color:#fca5a5;margin:4px 0">❌ Marqué pas reçu — ' + esc(c.livreurNom || 'le livreur') + ' attend (il ne donne pas)</div>' : '');
      if (cry.id === c.id) h += cryBox();
      else if (!neuf) h += fBtn('dpOk', dq.mode === 'cash' ? '✓ OK, il encaisse en cash' : dq.mode === 'cry' ? '✓ J’ai reçu la crypto' : '✓ J’ai reçu l’EMT', 'ok') + fBtn('dpNo0', 'Refuser (on garde comme avant)');
      else h += fBtn('dpOk', '✅ Reçu', 'ok') + '<div class="two">' + fBtn('dpNo', '❌ Pas reçu') + (canDette() ? fBtn('dpDette', '📒 Dette') : '') + '</div>' + (dpd.id === c.id ? dpdForm(c) : ''); }
    h += confLine(c) + (c.paieModLe ? '<div class="small">✏️ paiement changé par ' + esc(dispName(c.paieModNom || '')) + '</div>' : '');
    if (!c.demandePaie) h += lp.id === c.id ? lpBox(c) : fBtn('chpay', '💳 Changer le paiement');
    h += (c.bloque && !c.demandePaie ? (cry.id === c.id ? cryBox() : fBtn('paid', '✓ ' + payWord(c) + ' reçu', 'ok')) : '') +
      '<div class="two">' + fBtn('msg', '💬 Client') + (canDette() && !c.dette && !c.demandePaie ? fBtn('dette', '📒 Dette') : '') + '</div>' +
      (fx.client ? msgBox(c, plan[0]) : '') + (dt.disp && dt.disp.id === c.id ? detteDispForm(c) : '') +
      '<div class="two">' + fBtn('unassign', fx.ask === 'unassign' ? 'Confirmer : retirer' : 'Retirer') + fBtn('cancel', fx.ask === 'cancel' ? 'Sûr ? Appuie encore pour supprimer' : '🗑 Supprimer la commande', 'red') + '</div>' +
      (nx ? '<div class="small" style="margin-top:12px">Ensuite pour ' + esc(c.livreurNom || '') + ' : ' + esc(nx.client) + ' · ~' + hm(plan[1]) + '</div>' : '');
  }
  if (u.k === 'new' && fx.client) h += msgBox(c, Date.now() + 20 * 60000);
  h += '<div class="err" id="fxErr"></div></div><div id="focusDock" class="fdock"></div>';
  v.innerHTML = h;
  drawFocusDock();
  $('fxBack').onclick = closeFocus;
  if ($('fxAlt')) $('fxAlt').onclick = () => { fx.alt = true; renderFocus(); };
  v.querySelectorAll('[data-fo]').forEach((el) => { el.onclick = () => focusAssign(c, fx.opts[+el.dataset.fo]); });
  v.querySelectorAll('[data-ub]').forEach((el) => { el.onclick = () => focusAssign(c, uberOpt(el.dataset.ub)); });
  v.querySelectorAll('[data-o]').forEach((el) => { el.onclick = () => focusAssign(c, fx.opts[+el.dataset.o]); });
  v.querySelectorAll('[data-fa]').forEach((el) => { el.onclick = () => focusAct(c, el.dataset.fa); });
  if ($('dpdTxt')) $('dpdTxt').oninput = (e) => { dpd.txt = e.target.value; dpd.err = ''; if ($('dpdV')) $('dpdV').innerHTML = dpd.txt.trim() ? (raisonOk(dpd.txt) ? '<span style="color:#86efac">✓ Raison acceptée</span>' : '<span style="color:#fca5a5">⛔ Raison pas acceptée. Utilise un des mots ci-dessous.</span>') : ''; };
  bindLp();
  v.querySelectorAll('[data-ck]').forEach((el) => { el.onclick = () => { cry.coin = el.dataset.ck; cry.err = ''; renderFocus(); }; });
  if ($('cryA')) $('cryA').oninput = (e) => { cry.autre = e.target.value; };
  v.querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.copy).catch(() => {}); } catch (e) {} el.textContent = 'Copié ✓'; }; });
  if ($('fxSend')) { const go = () => { const t = $('fxTxt').value.trim(); if (!t) return; $('fxTxt').value = ''; sendMsg(c.livreur, 'dispatch', t).catch((e) => { $('fxErr').textContent = msg(e); }); }; $('fxSend').onclick = go; $('fxTxt').onkeydown = (e) => { if (e.key === 'Enter') go(); }; }
  bindDetteDisp();
}
function drawFocusDock() {
  const d = $('focusDock'); if (!d) return;
  const rest = focusList().filter((x) => x.c.id !== fx.id);
  d.innerHTML = '<div class="small" style="margin:0 4px 6px">En attente (' + rest.length + ')</div><div class="fchips">' + (rest.map((x) =>
    '<span class="fchip ' + UI[x.k][0] + '" data-fk="' + x.c.id + '">' + UI[x.k][1] + ' <b>' + esc(x.k === 'new' ? x.c.client : (x.c.livreurNom || nomDe(x.c.livreur)) + ' · ' + x.c.client) + '</b>' + (x.k === 'ici' ? ' ' + x.min + 'm' : '') + '</span>').join('') || '<span class="small">Rien d’autre. 👍</span>') + '</div><button class="fback" id="fxBack2">‹ Retour à la liste</button>';
  d.querySelectorAll('[data-fk]').forEach((el) => { el.onclick = () => openFocus(el.dataset.fk); });
  if ($('fxBack2')) $('fxBack2').onclick = closeFocus;
}
async function focusAssign(c, opt) {
  if (!opt || !opt.ok) return;
  try {
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', c.id), await assignFields(opt, c));
    if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'assignee', eta: opt.type ? null : Math.round(opt.arr), luid: uidOf(opt.mid) });
    await nextFix(b, opt, c);
    await b.commit(); notifyOrder(c.id); focusNext();
  } catch (e) { if ($('fxErr')) $('fxErr').textContent = msg(e); }
}

// Demande de paiement du livreur (« le client paie autrement ») : texte pour le dispatch, et confirmation.
function demPaieTxt(dp, c) {
  if (dp.emt != null || dp.cry != null) { // v52 : écrit par le livreur à la porte
    const a = []; if (dp.cashDonne || dp.cash) a.push((dp.cashDonne || dp.cash) + ' $ cash ✓'); if (dp.emt) a.push(dp.emt + ' $ EMT à confirmer'); if (dp.cry) a.push(dp.cry + ' $ crypto à confirmer');
    return a.join(' · ');
  }
  const tot = (prive[c.id] && prive[c.id].total) || 0;
  if (dp.mode === 'cash') return 'Tout en cash' + (tot ? ' (' + tot + ' $)' : '');
  if (dp.mode === 'int') return 'Tout en EMT' + (tot ? ' · ' + tot + ' $ à confirmer' : '');
  if (dp.mode === 'cry') return 'Tout en crypto' + (tot ? ' · ' + tot + ' $ à confirmer' : '');
  return dp.cash + ' $ cash + ' + (tot ? Math.max(0, tot - dp.cash) + ' $ ' : 'le reste en ') + 'EMT à confirmer';
}
async function paieOk(c, ok) {
  const dp = c.demandePaie; if (!dp) return;
  const b = writeBatch(db);
  if (!ok) { b.update(doc(db, 'commandes', c.id), { demandePaie: null }); await b.commit(); notifyMsg(c.livreur, 'Paiement refusé pour ' + c.client + ' : on garde comme avant'); return; }
  const tot = (prive[c.id] && prive[c.id].total) || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0));
  const cash = dp.mode === 'cash' ? tot : (dp.mode === 'mix' || dp.mode === 'mixc') ? Math.min(tot, dp.cash) : 0;
  const coin = (dp.mode === 'cry' || dp.mode === 'mixc') ? (cry.ok || '') : ''; cry.ok = null;
  b.update(doc(db, 'commandes', c.id), Object.assign({ demandePaie: null, bloque: false, encaisser: cash, paye: cash === 0, paieMode: dp.mode, confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() }, coin ? { crypto: coin } : {}));
  b.set(doc(db, 'cmdPrive', c.id), Object.assign({ mode: dp.mode, cash, interac: tot - cash, recu: true }, coin ? { crypto: coin } : {}), { merge: true });
  await b.commit();
  notifyMsg(c.livreur, dp.emt != null || dp.cry != null ? '✅ ' + (dp.cry ? 'Crypto' : 'EMT') + ' de ' + c.client + ' reçu — tu peux donner' : '✓ Paiement confirmé pour ' + c.client + (cash ? ' : encaisse ' + cash + ' $ cash' : ' : déjà payé'));
}
// v52 : 📒 Dette au lieu de « reçu » — le livreur voit exactement comme si c'était reçu. Raison obligatoire (mots acceptés seulement).
const DETTE_RAISONS = ['EMT envoyé mais pas rentré', 'Crédit'];
const dpd = { id: null, txt: '', err: '' };
function raisonOk(t) { const n = String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return /credit/.test(n) || (/(emt|imt|interac|virement)/.test(n) && /(envoy|rentr|pas recu|arrive)/.test(n)); }
function dpdForm(c) {
  const dp = c.demandePaie, m = (Number(dp.emt) || 0) + (Number(dp.cry) || 0);
  return '<div class="msgc" style="margin-top:8px;border:1px solid #b45309"><b style="color:#fdba74">📒 Dette de ' + money(m) + ' — raison obligatoire</b><input id="dpdTxt" maxlength="80" placeholder="Raison" value="' + esc(dpd.txt) + '">' +
    '<div class="small" id="dpdV">' + (dpd.txt.trim() ? (raisonOk(dpd.txt) ? '<span style="color:#86efac">✓ Raison acceptée</span>' : '<span style="color:#fca5a5">⛔ Raison pas acceptée. Utilise un des mots ci-dessous.</span>') : '') + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">' + DETTE_RAISONS.map((r, k) => '<button class="btn ghost sm" style="width:auto;display:inline-block;padding:6px 10px" data-fa="dpk' + k + '">' + esc(r) + '</button>').join('') + '</div>' +
    '<div class="err">' + esc(dpd.err) + '</div><div class="two">' + fBtn('dpdX', 'Annuler') + fBtn('dpdGo', 'Confirmer la dette', 'ok') + '</div></div>';
}
async function paieDette(c, raison) {
  const dp = c.demandePaie; if (!dp) return;
  const tot = (prive[c.id] && prive[c.id].total) || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0));
  const cash = (dp.mode === 'mix' || dp.mode === 'mixc') ? Math.min(tot, dp.cash) : 0, m = Math.max(0, tot - cash);
  const ref = doc(collection(db, 'dettes')), b = writeBatch(db);
  b.set(ref, { client: c.client || 'Client', montant: m, responsable: myMid(), livreur: c.livreur || '', livreurNom: c.livreurNom || '', cmd: c.id, note: String(raison).slice(0, 80),
    statut: 'ouverte', creePar: myMid(), creeParNom: me.nom || OWNER, creeLe: serverTimestamp() });
  b.update(doc(db, 'commandes', c.id), { demandePaie: null, bloque: false, encaisser: cash, paye: !(cash > 0), paieMode: dp.mode, dette: ref.id });
  b.set(doc(db, 'cmdPrive', c.id), { mode: dp.mode, cash, interac: tot - cash, recu: false, dette: ref.id }, { merge: true });
  await b.commit();
  notifyMsg(c.livreur, '✅ ' + (dp.cry ? 'Crypto' : 'EMT') + ' de ' + c.client + ' reçu — tu peux donner');
}
async function focusAct(c, a) {
  if (a === 'chpay' || a === 'lpX' || a === 'lpGo') return lpAct(c, a);
  if (a === 'cryX') { cry.id = null; return renderFocus(); }
  if (a === 'cryGo') { const k = coinOf(cry.coin, cry.autre); if (!k) { cry.err = 'Choisis la crypto (BTC, ETH…).'; return renderFocus(); }
    cry.ok = k; const kind = cry.kind; try { if (kind === 'dpOk') await paieOk(c, true); else await qAct('paid', c.id); } catch (e) { cry.ok = null; if ($('fxErr')) $('fxErr').textContent = msg(e); } cry.id = null; return renderFocus(); }
  if (a === 'dpNo' && c.demandePaie) { try { await writeBatch(db).update(doc(db, 'commandes', c.id), { demandePaie: Object.assign({}, c.demandePaie, { pasRecu: Date.now() }) }).commit(); } catch (e) { if ($('fxErr')) $('fxErr').textContent = msg(e); } return renderFocus(); }
  if (a === 'dpNo0') a = 'dpNo';
  if (a === 'dpDette') { dpd.id = dpd.id === c.id ? null : c.id; dpd.txt = ''; dpd.err = ''; return renderFocus(); }
  if (a === 'dpdX') { dpd.id = null; return renderFocus(); }
  if (a.startsWith('dpk')) { dpd.txt = DETTE_RAISONS[Number(a.slice(3))] || ''; dpd.err = ''; return renderFocus(); }
  if (a === 'dpdGo') { const t = ($('dpdTxt') ? $('dpdTxt').value : dpd.txt).trim(); dpd.txt = t;
    if (!raisonOk(t)) { dpd.err = 'Raison pas acceptée : ' + DETTE_RAISONS.join(' ou ') + '.'; return renderFocus(); }
    try { await paieDette(c, t); dpd.id = null; } catch (e) { dpd.err = msg(e); } return renderFocus(); }
  if (a === 'dpOk' && c.demandePaie && (c.demandePaie.mode === 'cry' || c.demandePaie.mode === 'mixc') && !cry.ok) { cry.id = c.id; cry.kind = 'dpOk'; cry.coin = null; cry.autre = ''; cry.err = ''; return renderFocus(); }
  if (a === 'dpOk' || a === 'dpNo') { try { await paieOk(c, a === 'dpOk'); } catch (e) { if ($('fxErr')) $('fxErr').textContent = msg(e); } return renderFocus(); }
  if (a === 'msg') { fx.client = !fx.client; return renderFocus(); }
  if (a === 'dette') { dt.disp = dt.disp ? null : { id: c.id, resp: c.livreur || myMid(), note: '' }; return renderFocus(); }
  if ((a === 'cancel' || a === 'unassign') && fx.ask !== a) { fx.ask = a; return renderFocus(); }
  fx.ask = null;
  await qAct(a, c.id);
  if (a === 'cancel' || a === 'unassign') focusNext(); else renderFocus();
}
setInterval(() => { if (fx.id) renderFocus(); }, 30000);

// =====================================================================
// Version 14 : fin de soirée — « Terminer ma soirée » : je garde mon stock, ou je le rends à MOUSSE (il confirme)
// =====================================================================
// retours/{id} : { de, deNom, vers, versNom, L, XL, statut: 'attente' | 'recue' | 'refusee', soiree, le }
// Ce qui n'est pas rendu reste sur le livreur pour la prochaine fois (il le voit au check-in).
const ret = { toMe: [], mine: [], f: null, busy: false };
function startRetours() {
  if (!me) return;
  if (me.role === 'complet') stops.push(onSnapshot(query(collection(db, 'retours'), where('vers', '==', myMid())), (qs) => {
    const n0 = ret.toMe.filter((x) => x.statut === 'attente').length;
    ret.toMe = []; qs.forEach((d) => ret.toMe.push(Object.assign({ id: d.id }, d.data())));
    if (ret.toMe.filter((x) => x.statut === 'attente').length > n0) bip();
    drawRetCard();
  }, () => {}));
  if (delivers()) stops.push(onSnapshot(query(collection(db, 'retours'), where('de', '==', myMid())), (qs) => {
    ret.mine = []; qs.forEach((d) => ret.mine.push(Object.assign({ id: d.id }, d.data()))); drawRetMine();
  }, () => {}));
}
// MOUSSE (dispatch complet) : à qui on rend le stock.
function mousseDispo() { const e = Object.entries(rm.dispos).find(([id, d]) => d.role === 'complet' && id !== myMid()); return e ? { id: e[0], nom: e[1].nom } : null; }
function finCard(s) {
  const mine = st(me.mid), f = ret.f;
  if (!f) return '<button class="btn ghost" id="finOpen" style="margin-top:4px">🌙 Terminer ma soirée</button>';
  const to = me.role === 'complet' ? null : mousseDispo();
  let h = '<div class="card"><div class="label">🌙 Terminer ma soirée</div><div>Il te reste <b>' + (mine.L || 0) + ' L · ' + (mine.XL || 0) + ' XL</b>.</div>';
  if (f.solde != null && Math.round(f.solde)) h += f.solde < 0 // v54 : ce que le dispatch lui doit (ou ce qu'il doit encore)
    ? '<div style="margin:10px 0;background:#2e1065;border-radius:12px;padding:12px;text-align:center"><div class="small" style="color:#ddd6fe">Argent</div><div style="font-size:21px;font-weight:900;color:#fff">💵 Le dispatch te doit ' + money(-f.solde) + '</div></div>'
    : '<div style="margin:10px 0;background:#1f2633;border-radius:12px;padding:12px;text-align:center"><div class="small">Argent</div><div style="font-size:21px;font-weight:900">💰 Tu dois encore remettre ' + money(f.solde) + '</div></div>';
  if (to) {
    h += '<div class="seg" id="finMode" style="margin:8px 0">' + [['garde', 'Je garde tout'], ['rends', 'Je rends à ' + esc(to.nom)]].map((x) => '<button data-m="' + x[0] + '" class="' + (f.mode === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
    if (f.mode === 'rends') h += ['L', 'XL'].map((k) => '<div class="step"><span>' + k + '</span><button data-fk="' + k + '" data-d="-1">−</button><div class="v">' + f[k] + '</div><button data-fk="' + k + '" data-d="1">+</button></div>').join('') +
      '<div class="small">' + esc(to.nom) + ' devra confirmer « Reçu ✓ ». Ce que tu ne rends pas, tu le gardes pour la prochaine fois.</div>';
    else h += '<div class="small">Tu le gardes pour la prochaine fois. Tu le verras au prochain check-in.</div>';
  } else h += '<div class="small" style="margin-top:6px">' + (me.role === 'complet' ? 'Ton stock reste à toi.' : 'MOUSSE n’est pas en ligne : tu gardes ton stock pour la prochaine fois.') + '</div>';
  h += '<div class="err" id="finErr"></div><div class="two"><button class="btn ghost" id="finCancel">Annuler</button><button class="btn ok" id="finGo">Terminer</button></div></div>';
  return h;
}
function bindFinCard(s) {
  if ($('finOpen')) $('finOpen').onclick = () => { const m = st(me.mid); ret.f = { mode: 'garde', L: m.L || 0, XL: m.XL || 0, solde: null }; renderSoiree(); if (!isStaff()) soldeMoi().then((so) => { if (ret.f) { ret.f.solde = so.tot; renderSoiree(); } }).catch(() => {}); };
  const f = ret.f; if (!f) return;
  document.querySelectorAll('#finMode button').forEach((b) => { b.onclick = () => { f.mode = b.dataset.m; renderSoiree(); }; });
  document.querySelectorAll('[data-fk]').forEach((b) => { b.onclick = () => { const k = b.dataset.fk, m = st(me.mid); f[k] = Math.max(0, Math.min(m[k] || 0, f[k] + Number(b.dataset.d))); renderSoiree(); }; });
  if ($('finCancel')) $('finCancel').onclick = () => { ret.f = null; renderSoiree(); };
  if ($('finGo')) $('finGo').onclick = async () => {
    if (myCmds.length) { $('finErr').textContent = 'Tu as encore des commandes.'; return; }
    const to = me.role === 'complet' ? null : mousseDispo();
    ret.busy = true; $('finGo').disabled = true;
    try {
      const b = writeBatch(db);
      if (to && f.mode === 'rends' && (f.L || f.XL)) b.set(doc(collection(db, 'retours')), { de: me.mid, deNom: me.nom, vers: to.id, versNom: to.nom, L: f.L, XL: f.XL, statut: 'attente', soiree: s.id, le: serverTimestamp() });
      b.update(doc(db, 'soirees', s.id), { statut: 'terminee', finLe: serverTimestamp() });
      await b.commit();
      if (to && f.mode === 'rends' && (f.L || f.XL)) notifyDispatch('📦 ' + me.nom + ' te rend ' + f.L + ' L · ' + f.XL + ' XL', to.id);
      ret.f = null; ret.busy = false; finState.me = null; renderSoiree(); initFin(); loadFin('me');
    } catch (e) { ret.busy = false; if ($('finErr')) $('finErr').textContent = msg(e); if ($('finGo')) $('finGo').disabled = false; }
  };
}
// Livreur : état de son retour (en attente / reçu)
function drawRetMine() {
  const box = $('retMine'); if (!box) return;
  const r = ret.mine.filter((x) => { const t = x.le && x.le.toDate ? x.le.toDate() : null; return !t || t >= soirStart(); }).slice(-1)[0];
  box.innerHTML = r ? '<div class="small" style="text-align:center;margin:6px 0">📦 ' + r.L + ' L · ' + r.XL + ' XL rendus à ' + esc(r.versNom) + ' — ' + (r.statut === 'attente' ? 'en attente de confirmation…' : r.statut === 'recue' ? 'reçu ✓' : 'pas reçu ✗ (tu les as encore)') + '</div>' : '';
}
// MOUSSE : « Fmj te rend 2 L · 2 XL » → Reçu ✓ / Pas reçu
function drawRetCard() {
  const box = $('retCard'); if (!box) return;
  const att = ret.toMe.filter((x) => x.statut === 'attente');
  box.innerHTML = att.length ? '<div class="card alert"><div class="label">📦 Stock qu’on te rend</div>' + att.map((r) => '<div class="item"><b>' + esc(r.deNom) + '</b> te rend <b>' + r.L + ' L · ' + r.XL + ' XL</b> (fin de soirée)' +
    '<div class="two" style="margin-top:8px"><button class="btn red sm" data-rtno="' + r.id + '">Pas reçu</button><button class="btn ok sm" data-rtyes="' + r.id + '">Reçu ✓</button></div></div>').join('') + '</div>' : '';
  box.querySelectorAll('[data-rtyes]').forEach((b) => { b.onclick = () => retDecide(att.find((x) => x.id === b.dataset.rtyes), true); });
  box.querySelectorAll('[data-rtno]').forEach((b) => { b.onclick = () => retDecide(att.find((x) => x.id === b.dataset.rtno), false); });
}
async function retDecide(r, ok) {
  if (!r) return;
  try {
    const b = writeBatch(db);
    b.update(doc(db, 'retours', r.id), { statut: ok ? 'recue' : 'refusee', decideLe: serverTimestamp() });
    if (ok) {
      const d = st(r.de);
      const L = Math.min(r.L, d.L || 0), XL = Math.min(r.XL, d.XL || 0);
      b.set(doc(db, 'stocks', r.de), { L: increment(-L), XL: increment(-XL) }, { merge: true });
      b.set(doc(db, 'stocks', myMid()), { L: increment(L), XL: increment(XL) }, { merge: true });
      b.set(doc(collection(db, 'mouvements')), { de: r.de, vers: myMid(), L, XL, type: 'retour', par: myMid(), le: serverTimestamp() });
    }
    await b.commit();
  } catch (e) { alertBar(msg(e)); }
}

// =====================================================================
// Version 15 : historique des soirées (propriétaire et MOUSSE) — une soirée (6 h à 6 h) ou une semaine, partager, CSV
// =====================================================================
const hs = { day: null, week: false, text: null, rows: [], extra: '', busy: false };
function dayStart(d) { const x = new Date(d); x.setHours(6, 0, 0, 0); return x; }
function histoRange() {
  if (!hs.day) { const y = soirStart(); hs.day = new Date(y.getTime() - 86400000); }
  if (!hs.week) return [dayStart(hs.day), new Date(dayStart(hs.day).getTime() + 86400000)];
  const m = dayStart(hs.day); const k = (m.getDay() + 6) % 7; m.setDate(m.getDate() - k); // lundi
  return [m, new Date(m.getTime() + 7 * 86400000)];
}
async function rangeDocs(col, field, a, b) {
  const out = [];
  try { const qs = await getDocs(query(collection(db, col), where(field, '>=', a), where(field, '<', b))); qs.forEach((d) => { if (!hidDoc(d.data())) out.push(Object.assign({ id: d.id }, d.data())); }); } catch (e) { console.warn(col, e); }
  return out;
}
async function loadHisto() {
  const [a, b] = histoRange();
  hs.busy = true; drawHisto();
  const [cmdsH, rems, dts, rets] = await Promise.all([
    rangeDocs('commandes', 'livreeLe', a, b), rangeDocs('remises', 'le', a, b),
    canDette() ? rangeDocs('dettes', 'creeLe', a, b) : Promise.resolve([]), rangeDocs('retours', 'le', a, b)]);
  const livrees = cmdsH.filter((c) => c.statut === 'livree');
  const remis = {}; rems.forEach((r) => { if (r.statut === 'recue') remis[r.de] = (remis[r.de] || 0) + (r.montant || 0); });
  const dtt = {}; dts.forEach((x) => { if (x.statut !== 'refusee') dtt[x.livreur] = (dtt[x.livreur] || 0) + (x.montant || 0); });
  const rows = withDettes(sumUp(livrees, remis), dtt);
  let t = teamText(rows, a);
  if (hs.week) t = t.replace(/^Soirée du [^\n]*/, 'Semaine du ' + jourTxt(a) + ' au ' + jourTxt(new Date(b.getTime() - 86400000)));
  let x = '';
  const dOk = dts.filter((d) => d.statut !== 'refusee');
  if (dOk.length) x += '\n\n📒 Dettes : ' + dOk.map((d) => d.client + ' ' + money(d.montant || 0) + ' (resp. ' + respNom(d) + (d.statut === 'reglee' ? ', réglée' : '') + ')').join(' · ');
  const rOk = rets.filter((r) => r.statut === 'recue');
  if (rOk.length) x += '\n\n📦 Stock rendu : ' + rOk.map((r) => r.deNom + ' → ' + r.versNom + ' ' + r.L + ' L · ' + r.XL + ' XL').join(' · ');
  const cash = rems.filter((r) => r.statut === 'recue');
  if (cash.length) x += '\n\n💵 Cash remis : ' + cash.map((r) => r.deNom + ' → ' + r.versNom + ' ' + money(r.montant)).join(' · ');
  hs.text = livrees.length || x ? t + x : (hs.week ? 'Semaine du ' + jourTxt(a) : 'Soirée du ' + jourTxt(a)) + '\nAucune livraison.';
  hs.rows = livrees.filter((c) => !c.test).sort((p, q) => tsMs(p.livreeLe) - tsMs(q.livreeLe));
  hs.all = cmdsH.filter((c) => c.statut === 'livree' || c.annuleTest || c.test || c.statut === 'ajout' || (c.statut === 'refusee' && c.ajoutPar)).sort((p, q) => tsMs(p.livreeLe) - tsMs(q.livreeLe));
  hs.sum = rows; hs.extra = x;
  hs.prv = {}; // v36 : montants (EMT / crypto) de chaque livraison, pour toi, MOUSSE et lost
  await Promise.all(hs.all.filter((c) => !c.test && !c.annuleTest && c.statut !== 'refusee').map((c) => getDoc(doc(db, 'cmdPrive', c.id)).then((d) => { if (d.exists()) hs.prv[c.id] = d.data(); }).catch(() => {})));
  hs.busy = false; drawHisto();
}
function histoCsv() {
  const head = ['date', 'heure', 'livreur', 'client', 'L', 'XL', 'a_encaisser', 'cash_recu', 'frais', 'paie', 'dette'];
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = hs.rows.map((c) => { const d = new Date(tsMs(c.livreeLe)); return [d.toLocaleDateString('fr-CA'), hm(d.getTime()), c.livreurNom || c.livreur, c.client, c.L, c.XL, c.encaisser, c.cashRecu, c.frais || 0, c.paie == null ? '' : c.paie, c.dette ? 'oui' : ''].map(q).join(','); });
  const blob = new Blob(['﻿' + head.join(',') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const [a] = histoRange(); const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'gotham-' + (hs.week ? 'semaine-' : '') + a.toISOString().slice(0, 10) + '.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}
function drawHisto() {
  const box = $('histo'); if (!box || !me) return;
  if (!(isOwner() || isStaff())) { box.innerHTML = ''; return; }
  const [a, b] = histoRange();
  const label = hs.week ? 'Semaine du ' + jourTxt(a) : jourTxt(a);
  hsCss();
  if (hs.text == null && !hs.busy) setTimeout(() => { if (hs.text == null && !hs.busy) loadHisto(); }, 0); // v55 : plus de bouton « Voir »
  const lab2 = hs.week ? jourTxt(a) + ' → ' + jourTxt(new Date(b.getTime() - 86400000)) : jourTxt(a);
  const nrN = isDispatcher() ? nr.list.length : 0;
  box.innerHTML = '<div class="card" style="padding:10px 12px"><div class="hsBar"><button class="hsArr" id="hPrev">‹</button>' +
    '<label class="hsDate">' + esc(lab2) + ' <span class="small">📅</span><input type="date" id="hDate" value="' + a.toISOString().slice(0, 10) + '"></label>' +
    '<button class="hsArr" id="hNext"' + (b > new Date() ? ' disabled' : '') + '>›</button>' +
    '<div class="hsTog">' + [['jour', 'Soirée'], ['sem', 'Semaine']].map((x) => '<button data-hm="' + x[0] + '" class="' + ((x[0] === 'sem') === hs.week ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div></div>' +
    '<div class="hsChips">' + [['tout', 'Tout'], ['cash', '🔵 Cash'], ['emt', '🟡 EMT'], ['ver', '⚠️ À vérifier']].map((x) => '<button data-hf="' + x[0] + '" class="' + ((hs.f || 'tout') === x[0] ? 'on' : '') + '"' + (x[0] === 'ver' && nrN ? ' style="border-color:#ef4444"' : '') + '>' + x[1] + (x[0] === 'ver' && nrN ? ' <span class="hsDot">' + nrN + '</span>' : '') + '</button>').join('') + '</div>' +
    (nrN && hs.f !== 'ver' ? '<div class="hsPop" data-hf="ver">🔴 ' + nrN + ' paiement' + (nrN > 1 ? 's' : '') + ' à vérifier — touche ici</div>' : '') +
    (hs.busy ? '<div class="small" style="margin-top:6px">Chargement…</div>' : '') + '</div>' + (hs.f === 'ver' ? nrHtml() : '') +
    (!hs.busy && hs.text != null ? histoPeople() + histoTotals() + addHtml() + '<div class="two"><button class="btn ghost sm" id="hCsv">⬇️ CSV (Sheet)</button><button class="btn ok sm" id="hShare">Partager</button></div>' +
      '<div class="small" style="margin-top:6px">Le CSV s’ouvre dans Google Sheets (Fichier → Importer) ou Excel.</div>' : '');
  const move = (n) => { const d = new Date(dayStart(hs.day)); d.setDate(d.getDate() + n * (hs.week ? 7 : 1)); hs.day = d; hs.text = null; loadHisto(); };
  box.querySelectorAll('[data-hm]').forEach((x) => { x.onclick = () => { hs.week = x.dataset.hm === 'sem'; hs.text = null; loadHisto(); }; });
  $('hPrev').onclick = () => move(-1); $('hNext').onclick = () => move(1);
  $('hDate').onchange = (e) => { if (!e.target.value) return; const [y, m, d] = e.target.value.split('-').map(Number); hs.day = new Date(y, m - 1, d, 12); hs.text = null; loadHisto(); };
  box.querySelectorAll('[data-hf]').forEach((x) => { x.onclick = () => { hs.f = x.dataset.hf; hx.det = null; drawHisto(); }; });
  if ($('hCsv')) $('hCsv').onclick = histoCsv;
  bindHistoPeople(); bindAdd();
  if ($('hTot')) $('hTot').onclick = () => { hs.totOpen = !hs.totOpen; drawHisto(); };
  if ($('hShare')) $('hShare').onclick = async () => { try { if (navigator.share) await navigator.share({ text: hs.text }); else { await navigator.clipboard.writeText(hs.text); $('hShare').textContent = 'Copié ✓'; } } catch (e) {} };
}

// =====================================================================
// Version 16 : petit chiffre rouge sur l'icône de l'app (écran d'accueil)
// =====================================================================
// Livreur : ses commandes à faire + messages du dispatch pas lus + dette à confirmer.
// Dispatch (propriétaire, MOUSSE, lost autorisé) : check-ins, commandes pas assignées, messages pas lus, cash / stock à confirmer, dettes demandées.
let badgeLast = -1;
function badgeCount() {
  if (!me) return 0;
  let n = 0;
  if (chatsDriver() || (delivers() && mySoiree && working(mySoiree))) {
    n += myCmds.length;
    const lu = (dm.myLu && dm.myLu.livreur) || 0;
    if (chatsDriver()) n += dm.mine.filter((m) => m.de === 'dispatch' && tsMs(m.le) > lu).length;
    n += dt.mine.filter((x) => x.statut === 'attente_livreur' && x.responsable === myMid()).length;
  }
  if (isDispatcher()) {
    n += Object.values(soirees).filter((s) => s.statut === 'demande' && canAuthorize(s)).length;
    n += Object.values(cmds).filter((c) => c.statut === 'attente').length;
    const ids = new Set(dm.all.map((m) => m.mid)); ids.forEach((id) => { n += unreadFor(id); });
    n += rm.toMe.filter((r) => r.statut === 'attente').length + ret.toMe.filter((r) => r.statut === 'attente').length;
    if (canDette()) n += dt.all.filter((x) => x.statut === 'demande').length;
  }
  return n;
}
function updBadge() {
  if (!('setAppBadge' in navigator)) return;
  const n = me ? badgeCount() : 0;
  if (n === badgeLast) return; badgeLast = n;
  try { (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
}
setInterval(updBadge, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // L'app est ouverte : on enlève les notifications déjà vues, le chiffre redevient celui de l'app.
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.getNotifications().then((ns) => ns.forEach((x) => x.close()))).catch(() => {});
    badgeLast = -1; updBadge();
  }
});

// =====================================================================
// Version 18 : toucher une photo pour l'ouvrir en grand (chats livreur ↔ client, livreur ↔ dispatch, copie des messages)
// =====================================================================
function openPhoto(src) {
  let v = $('photoView');
  if (!v) { v = document.createElement('div'); v.id = 'photoView'; document.body.appendChild(v); v.onclick = () => { v.classList.remove('on'); v.innerHTML = ''; }; }
  v.innerHTML = '<button class="pvx" aria-label="Fermer">✕</button><img src="' + esc(src) + '" alt="photo">';
  v.classList.add('on');
}
document.addEventListener('click', (e) => {
  const im = e.target && e.target.closest && e.target.closest('.cm img, .fchat img, .cfeed img');
  if (im && !im.closest('#photoView')) { e.preventDefault(); openPhoto(im.getAttribute('src')); }
});

// =====================================================================
// Version 19 : notifications pour le dispatch (MOUSSE, et lost quand il fait le dispatch)
// =====================================================================
// Message d'un livreur, check-in, « arrivé chez le client », cash / stock / dette à confirmer → à tous les dispatchs en ligne.
async function notifyDispatch(texte, pour) {
  try {
    const t = await auth.currentUser.getIdToken();
    fetch(NOTIFIER, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(Object.assign({ type: 'dispatch', texte: String(texte || '').slice(0, 140) }, pour ? { pour } : {})) }).catch(() => {});
  } catch (e) {}
}
// Carte « Activer les notifications » en haut d'En direct pour MOUSSE et lost.
function drawNotifD() {
  const box = $('notifD'); if (!box) return;
  if (!me || !isStaff() || !isDispatcher()) { box.innerHTML = ''; return; }
  box.innerHTML = notifCard(true);
  if ($('notifGoD')) $('notifGoD').onclick = () => { if (notifBusy) return; notifBusy = true; saveToken(true).finally(() => { notifBusy = false; }); };
}
setTimeout(() => { try { drawNotifD(); } catch (e) {} }, 3000);

// =====================================================================
// Version 20 : le propriétaire corrige le stock de n'importe qui (✏️), ou remet tout le monde à 0
// =====================================================================
// Chaque correction est notée dans les mouvements (type « correction », avant → après).
const fixS = { id: null, L: 0, XL: 0, all: false };
function fixForm(id) {
  return '<div class="msgc" style="margin:4px 0 10px"><div class="small">Corriger le stock de ' + esc(isDep(id) ? 'dépôt de ' + nomDe(id.replace(/-depot$/, '')) : nomDe(id)) + ' (le vrai compte)</div>' +
    ['L', 'XL'].map((k) => '<div class="step"><span>' + k + '</span><button data-fk2="' + k + '" data-d="-1">−</button><div class="v">' + fixS[k] + '</div><button data-fk2="' + k + '" data-d="1">+</button></div>').join('') +
    '<div class="two"><button class="btn ghost sm" id="fixCancel">Annuler</button><button class="btn ok sm" id="fixGo">Enregistrer</button></div></div>';
}
async function setStocks(list) {
  // list : [[id, L, XL], …] — au plus 200 personnes par lot
  for (let i = 0; i < list.length; i += 200) {
    const b = writeBatch(db);
    list.slice(i, i + 200).forEach(([id, L, XL]) => {
      const av = st(id);
      b.set(doc(db, 'stocks', id), { L, XL }, { merge: true });
      b.set(doc(collection(db, 'mouvements')), { de: id, vers: id, L: L - (av.L || 0), XL: XL - (av.XL || 0), avant: { L: av.L || 0, XL: av.XL || 0 }, apres: { L, XL }, type: 'correction', par: myMid(), le: serverTimestamp() });
    });
    await b.commit();
  }
}
function bindFix(ids) {
  if (!isOwner()) return;
  document.querySelectorAll('[data-fix]').forEach((b) => { b.onclick = () => { const id = b.dataset.fix, m = st(id); fixS.id = fixS.id === id ? null : id; fixS.L = m.L || 0; fixS.XL = m.XL || 0; fixS.all = false; renderStock(); }; });
  document.querySelectorAll('[data-fk2]').forEach((b) => { b.onclick = () => { const k = b.dataset.fk2; fixS[k] = Math.max(0, fixS[k] + Number(b.dataset.d)); renderStock(); }; });
  if ($('fixCancel')) $('fixCancel').onclick = () => { fixS.id = null; renderStock(); };
  if ($('fixGo')) $('fixGo').onclick = async () => { try { await setStocks([[fixS.id, fixS.L, fixS.XL]]); fixS.id = null; } catch (e) { $('fixErr').textContent = msg(e); } renderStock(); };
  if ($('fixAll')) $('fixAll').onclick = async () => {
    if (!fixS.all) { fixS.all = true; return renderStock(); }
    fixS.all = false;
    const tous = new Set(ids.concat(Object.keys(stocks)));
    try { await setStocks([...tous].filter((id) => { const m = st(id); return (m.L || 0) || (m.XL || 0); }).map((id) => [id, 0, 0])); } catch (e) { $('fixErr').textContent = msg(e); }
    renderStock();
  };
}

// =====================================================================
// Version 21 : sessions connectées (propriétaire seulement) — nom, appareil, adresse IP, « Déconnecter »
// =====================================================================
// Chaque téléphone ouvert envoie un signe de vie au programme « notifier » (toutes les 2 min, app visible).
// Le programme écrit sessions/{uid}_{appareil} avec l'adresse IP vue par le serveur. Seul le propriétaire lit.
function devId() {
  try { let d = localStorage.getItem('gDev'); if (!d) { d = Math.random().toString(36).slice(2, 12); localStorage.setItem('gDev', d); } return d; }
  catch (e) { return 'x' + String(navigator.userAgent.length); }
}
function appareil() {
  const ua = navigator.userAgent || '';
  const a = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (((ua.match(/Android [^;]*;\s*([^;)]+)/) || [])[1] || 'Android').replace(/\s*Build.*$/, '').trim()) :
    /Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : /Windows/.test(ua) ? 'PC Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const b = /Edg/.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  return a + (app ? ' · app Gotham' : b ? ' · ' + b : '');
}
async function callNotif(body) {
  const t = await auth.currentUser.getIdToken();
  const r = await fetch(NOTIFIER, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text().catch(() => 'erreur'));
  return r.json();
}
function ping(force) {
  if (!me || !auth.currentUser || document.visibilityState !== 'visible') return;
  if (!force && Date.now() - lastPing < 60000) return;
  lastPing = Date.now();
  callNotif({ type: 'presence', dev: devId(), appareil: appareil() }).catch(() => {});
}
setInterval(() => ping(true), 120000);
document.addEventListener('visibilitychange', () => ping(false));
setInterval(() => { if (curTab === 'equipe') drawSess(); }, 60000);
function startSessions() {
  setTimeout(() => ping(true), 1500);
  if (!isOwner()) return;
  stops.push(onSnapshot(collection(db, 'sessions'), (qs) => { ss.list = []; qs.forEach((d) => ss.list.push(Object.assign({ id: d.id }, d.data()))); drawSess(); }, (e) => { ss.err = msg(e); drawSess(); }));
}
function ilYa(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 3) return '<span style="color:#16a34a;font-weight:600">● en ligne</span>';
  if (m < 60) return 'vu il y a ' + m + ' min';
  if (m < 1440) return 'vu il y a ' + Math.floor(m / 60) + ' h';
  return 'vu il y a ' + Math.floor(m / 1440) + ' j';
}
function drawSess() {
  let box = $('sessCard');
  if (!box) { const a = $('archCard'); if (!a) return; box = document.createElement('div'); box.id = 'sessCard'; a.parentNode.insertBefore(box, a); }
  if (!isOwner()) { box.innerHTML = ''; return; }
  const L = (ss.list || []).filter((x) => Date.now() - tsMs(x.vu) < 7 * 86400000).sort((x, y) => tsMs(y.vu) - tsMs(x.vu));
  let h = '<div class="card"><div class="label">🖥 Sessions connectées</div>';
  if (ss.list == null) h += '<div class="small">Chargement…</div>';
  else if (!L.length) h += '<div class="small">Personne pour l’instant. (Chaque téléphone apparaît ici quand il ouvre l’app.)</div>';
  else h += L.map((x) => {
    const moi = x.uid === me.uid;
    return '<div class="q" style="display:flex;gap:8px;align-items:center;justify-content:space-between">' +
      '<div><b>' + esc(dispName(x.nom || x.mid || '?')) + '</b>' + (moi ? ' <span class="small">(toi)</span>' : '') +
      '<div class="small">' + esc(x.appareil || 'Appareil') + '</div>' +
      '<div class="small">IP ' + esc(x.ip || '?') + ' · ' + ilYa(tsMs(x.vu)) + '</div></div>' +
      (moi ? '' : '<button class="btn ' + (ss.ask === x.uid ? 'red' : 'ghost') + ' sm" data-out="' + esc(x.uid) + '" style="width:auto;white-space:nowrap">' + (ss.ask === x.uid ? 'Sûr ? Appuie encore' : 'Déconnecter') + '</button>') +
      '</div>';
  }).join('');
  h += '<div class="small" style="margin-top:6px">« Déconnecter » ferme l’app sur tous ses appareils. Il pourra se reconnecter avec son mot de passe (change-le ou désactive la personne si besoin).</div>';
  box.innerHTML = h + '<div class="err" id="sessErr">' + esc(ss.err || '') + '</div></div>';
  box.querySelectorAll('[data-out]').forEach((b) => {
    b.onclick = async () => {
      const uid = b.dataset.out;
      if (ss.ask !== uid) { ss.ask = uid; ss.err = ''; return drawSess(); }
      if (ss.busy) return;
      ss.busy = true; b.disabled = true; b.textContent = '…';
      try { await callNotif({ type: 'deconnecter', uid }); ss.ask = null; ss.err = ''; }
      catch (e) { ss.err = 'Ça n’a pas marché : ' + (e.message || e); }
      ss.busy = false; drawSess();
    };
  });
}

// =====================================================================
// Version 22 : petite bulle au milieu de l'écran pour un nouveau message (6,5 s). Toucher = ouvrir la conversation ; toucher ailleurs = elle part.
// =====================================================================
function bulle(nom, txt, onTap) {
  const e = $('bulle'); if (!e) return;
  e.innerHTML = '<span style="font-size:22px">💬</span><div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>' + esc(nom) + ' :</b> ' + esc(String(txt || '').slice(0, 80)) + '</div><small>touche pour répondre</small></div>';
  e.onclick = () => { e.classList.remove('on'); clearTimeout(e._t); if (onTap) onTap(); };
  e.classList.add('on'); e._at = Date.now(); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 6500);
}
document.addEventListener('pointerdown', (ev) => { const e = $('bulle'); if (!e || !e.classList.contains('on') || e.contains(ev.target) || Date.now() - (e._at || 0) < 250) return; e.classList.remove('on'); clearTimeout(e._t); }, true);

// =====================================================================
// Version 23 : « 📦 Recharger » un livreur pendant la soirée (propriétaire, MOUSSE, lost en dispatch).
// Le stock part : de la réserve (propriétaire) ; de lui ou de son dépôt, au choix (MOUSSE) ; de son propre stock (lost).
// Le livreur accepte (son stock monte) ou dit « Pas reçu » (le stock retourne à qui l'a envoyé).
// =====================================================================
const rc = { mid: null, L: 0, XL: 0, src: null, err: '', busy: false };
function rcSources() { return isOwner() ? [RESERVE] : me.role === 'complet' ? [me.mid, DEP(me.mid)] : [me.mid]; }
function rcBlock(s) {
  if (!s) return '';
  if (s.recharge) return '<div class="card"><div class="label">📦 Recharge envoyée à ' + esc(s.nom) + '</div><div class="small">' + qty(s.recharge) + ' de ' + esc(nomDe(s.recharge.de)) + ' — il doit l’accepter sur son téléphone.</div></div>';
  if (rc.mid !== s.mid) return '<button class="btn ghost" id="rcOpen" data-mid="' + s.mid + '" style="margin-bottom:8px">📦 Recharger ' + esc(s.nom) + '</button>';
  const srcs = rcSources(); if (!srcs.includes(rc.src)) rc.src = srcs[0];
  const lbl = (id) => id === RESERVE ? 'De la réserve' : id === me.mid ? 'De moi (' + qty(st(id)) + ')' : 'Du dépôt (' + qty(st(id)) + ')';
  return '<div class="card"><div class="label">📦 Recharger ' + esc(s.nom) + '</div>' +
    (srcs.length > 1 ? '<div class="seg" style="margin-bottom:10px">' + srcs.map((id) => '<button data-rcsrc="' + id + '" class="' + (rc.src === id ? 'on' : '') + '">' + esc(lbl(id)) + '</button>').join('') + '</div>' : '<div class="small" style="margin-bottom:8px">' + esc(lbl(srcs[0])) + '</div>') +
    ['L', 'XL'].map((k) => '<div class="step"><span>' + k + '</span><button data-rc="' + k + '|-1">−</button><div class="v">' + rc[k] + '</div><button data-rc="' + k + '|1">+</button></div>').join('') +
    '<div class="err">' + esc(rc.err) + '</div><div class="two"><button class="btn ghost" id="rcX">Annuler</button><button class="btn ok" id="rcGo">Envoyer la recharge</button></div></div>';
}
function bindRc() {
  if ($('rcOpen')) $('rcOpen').onclick = () => { rc.mid = $('rcOpen').dataset.mid; rc.L = 0; rc.XL = 0; rc.err = ''; rc.src = null; renderQueues(); };
  document.querySelectorAll('[data-rcsrc]').forEach((b) => { b.onclick = () => { rc.src = b.dataset.rcsrc; renderQueues(); }; });
  document.querySelectorAll('[data-rc]').forEach((b) => { b.onclick = () => { const [k, d] = b.dataset.rc.split('|'); rc[k] = Math.max(0, rc[k] + Number(d)); rc.err = ''; renderQueues(); }; });
  if ($('rcX')) $('rcX').onclick = () => { rc.mid = null; renderQueues(); };
  if ($('rcGo')) $('rcGo').onclick = async () => {
    const s = Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).find((x) => x.mid === rc.mid && working(x));
    if (!s || rc.busy) return;
    if (!rc.L && !rc.XL) { rc.err = 'Choisis au moins 1 L ou 1 XL.'; return renderQueues(); }
    const src = rc.src || rcSources()[0];
    if (src !== RESERVE && (rc.L > (st(src).L || 0) || rc.XL > (st(src).XL || 0))) { rc.err = 'Tu n’as que ' + qty(st(src)) + '.'; return renderQueues(); }
    rc.busy = true;
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'soirees', s.id), { recharge: { L: rc.L, XL: rc.XL, de: src, par: me.mid, le: Date.now() } });
      if (src !== RESERVE) b.set(doc(db, 'stocks', src), { L: increment(-rc.L), XL: increment(-rc.XL) }, { merge: true });
      await b.commit();
      notifyMsg(s.mid, '📦 Recharge : ' + qty({ L: rc.L, XL: rc.XL }) + ' — accepte-la dans Gotham');
      rc.mid = null;
    } catch (e) { rc.err = msg(e); }
    rc.busy = false; renderQueues();
  };
}
function rcLivreur(s) {
  const R = s.recharge; if (!R) return '';
  const mine = st(me.mid);
  return '<div class="card alert"><div class="label">📦 Recharge</div><p style="margin:0 0 8px">' + esc(nomDe(R.par === 'proprietaire' ? 'proprietaire' : R.par)) + ' t’envoie <b>' + (R.L || 0) + ' L</b> et <b>' + (R.XL || 0) + ' XL</b>.</p>' +
    '<p class="small" style="margin-top:0">Compte avant d’accepter. Tu auras ' + ((R.L || 0) + (mine.L || 0)) + ' L · ' + ((R.XL || 0) + (mine.XL || 0)) + ' XL.</p>' +
    '<div class="err" id="rcErr"></div><div class="two"><button class="btn red" id="rcNo">Pas reçu</button><button class="btn ok" id="rcOk">J’accepte</button></div></div>';
}
function bindRcLivreur(s) {
  const R = s.recharge; if (!R) return;
  const go = async (ok) => {
    document.querySelectorAll('#rcOk,#rcNo').forEach((b) => { b.disabled = true; });
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'soirees', s.id), { recharge: null, rechargeRep: ok ? 'ok' : 'non' });
      if (ok) {
        b.set(doc(db, 'stocks', me.mid), { L: increment(R.L || 0), XL: increment(R.XL || 0), via: s.id }, { merge: true });
        b.set(doc(collection(db, 'mouvements')), { de: R.de, vers: me.mid, L: R.L || 0, XL: R.XL || 0, type: 'recharge', par: me.mid, soiree: s.id, le: serverTimestamp() });
      } else if (R.de !== RESERVE) b.set(doc(db, 'stocks', R.de), { L: increment(R.L || 0), XL: increment(R.XL || 0), via: s.id }, { merge: true });
      await b.commit();
      notifyDispatch(ok ? '📦 ' + me.nom + ' a accepté la recharge (' + qty(R) + ')' : '📦 ' + me.nom + ' : recharge pas reçue (' + qty(R) + ')', R.par !== 'proprietaire' ? R.par : undefined);
    } catch (e) { if ($('rcErr')) $('rcErr').textContent = msg(e); document.querySelectorAll('#rcOk,#rcNo').forEach((b) => { b.disabled = false; }); }
  };
  if ($('rcOk')) $('rcOk').onclick = () => go(true);
  if ($('rcNo')) $('rcNo').onclick = () => go(false);
}

// Toucher le chiffre d'un compteur (− 12 +) permet de l'écrire directement (ex. 150) ; le + et le − restent.
document.addEventListener('click', (ev) => {
  const v = ev.target.closest && ev.target.closest('.step .v'); if (!v || v.querySelector('input')) return;
  const plusBtn = v.nextElementSibling; if (!plusBtn || plusBtn.tagName !== 'BUTTON') return;
  const old = Number(v.textContent) || 0;
  const inp = document.createElement('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.value = old; inp.min = '0';
  inp.style.cssText = 'width:70px;margin:0;padding:6px;text-align:center;font-size:18px;font-weight:800';
  v.textContent = ''; v.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const fin = () => {
    if (done) return; done = true;
    const n = Math.max(0, Math.round(Number(inp.value) || 0)), d = n - old;
    v.textContent = String(old);
    if (!d) return;
    if (plusBtn.dataset.rc) { const k = plusBtn.dataset.rc.split('|')[0]; plusBtn.dataset.rc = k + '|' + d; plusBtn.click(); plusBtn.dataset.rc = k + '|1'; }
    else { const keep = plusBtn.dataset.d; plusBtn.dataset.d = String(d); plusBtn.click(); plusBtn.dataset.d = keep; }
  };
  inp.addEventListener('blur', fin); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
});

// =====================================================================
// Version 23 : le propriétaire donne du stock à MOUSSE (sur lui ou au dépôt) → MOUSSE accepte ou refuse.
// =====================================================================
const dons = { list: [], busy: false };
function startDons() {
  if (me && !isOwner() && me.role !== 'complet') {
    stops.push(onSnapshot(query(collection(db, 'dons'), where('vers', '==', me.mid), where('statut', '==', 'attente')), (qs) => { dons.list = []; qs.forEach((d) => dons.list.push(Object.assign({ id: d.id }, d.data()))); renderSoiree(); }, () => {}));
    return;
  }
  stops.push(onSnapshot(query(collection(db, 'dons'), where('statut', '==', 'attente')), (qs) => { dons.list = []; qs.forEach((d) => dons.list.push(Object.assign({ id: d.id }, d.data()))); drawDons(); }, () => {}));
}
function drawDons() {
  const box = $('donCard'); if (!box) return;
  const mine = dons.list.filter((d) => isOwner() || d.vers === me.mid || d.vers === DEP(me.mid));
  if (!mine.length) { box.innerHTML = ''; if ($('donWait')) $('donWait').innerHTML = ''; return; }
  if (isOwner()) {
    box.innerHTML = '';
    if ($('donWait')) $('donWait').innerHTML = '<div class="small" style="margin:6px 0">⏳ En attente d’être accepté : ' + mine.map((d) => qty(d) + ' → ' + esc(nomDe(d.vers))).join(' · ') + '</div>';
    return;
  }
  box.innerHTML = mine.map((d) => '<div class="card alert"><div class="label">📦 Le propriétaire te donne du stock</div><p style="margin:0 0 6px"><b>' + qty(d) + '</b>' + (isDep(d.vers) ? ' au dépôt' : ' sur toi') + (d.de && isDep(d.de) ? ' (pris de ton dépôt)' : '') + '</p><p class="small" style="margin-top:0">Compte avant d’accepter.</p>' +
    '<div class="err" id="donErr' + d.id + '"></div><div class="two"><button class="btn red" data-don="' + d.id + '|non">Refuser</button><button class="btn ok" data-don="' + d.id + '|ok">J’accepte</button></div></div>').join('');
  box.querySelectorAll('[data-don]').forEach((b) => { b.onclick = async () => {
    const [id, rep] = b.dataset.don.split('|'), d = dons.list.find((x) => x.id === id);
    if (!d || dons.busy) return; dons.busy = true;
    try {
      const w = writeBatch(db);
      w.update(doc(db, 'dons', id), { statut: rep, repLe: serverTimestamp() });
      if (rep === 'ok') {
        w.set(doc(db, 'stocks', d.vers), { L: increment(d.L || 0), XL: increment(d.XL || 0) }, { merge: true });
        w.set(doc(collection(db, 'mouvements')), { de: d.de || RESERVE, vers: d.vers, L: d.L || 0, XL: d.XL || 0, type: 'don', par: me.mid, le: serverTimestamp() });
      } else if (d.de && d.de !== RESERVE) w.set(doc(db, 'stocks', d.de), { L: increment(d.L || 0), XL: increment(d.XL || 0) }, { merge: true }); // refusé : retourne au dépôt
      await w.commit();
    } catch (e) { if ($('donErr' + id)) $('donErr' + id).textContent = msg(e); }
    dons.busy = false;
  }; });
}

// v24 : stock donné à un livreur (par le propriétaire ou MOUSSE) → il accepte ou refuse, même hors soirée.
function donsLivreur() {
  if (!me || isOwner() || me.role === 'complet') return '';
  return dons.list.filter((d) => d.vers === me.mid).map((d) => '<div class="card alert"><div class="label">📦 ' + (d.par === 'proprietaire' ? 'Le propriétaire' : esc(nomDe(d.par))) + ' te donne du stock</div><p style="margin:0 0 6px"><b>' + qty(d) + '</b></p><p class="small" style="margin-top:0">Compte avant d’accepter. Tu auras ' + ((d.L || 0) + (st(me.mid).L || 0)) + ' L · ' + ((d.XL || 0) + (st(me.mid).XL || 0)) + ' XL.</p>' +
    '<div class="err" id="dlErr' + d.id + '"></div><div class="two"><button class="btn red" data-dl="' + d.id + '|non">Pas reçu</button><button class="btn ok" data-dl="' + d.id + '|ok">J’accepte</button></div></div>').join('');
}
function bindDonsLivreur() {
  document.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = async () => {
    const [id, rep] = b.dataset.dl.split('|'), d = dons.list.find((x) => x.id === id);
    if (!d || dons.busy) return; dons.busy = true;
    try {
      const w = writeBatch(db);
      w.update(doc(db, 'dons', id), { statut: rep, repLe: serverTimestamp() });
      if (rep === 'ok') {
        w.set(doc(db, 'stocks', me.mid), { L: increment(d.L || 0), XL: increment(d.XL || 0), via: id }, { merge: true });
        w.set(doc(collection(db, 'mouvements')), { de: d.de, vers: me.mid, L: d.L || 0, XL: d.XL || 0, type: 'don', par: me.mid, le: serverTimestamp() });
      } else if (d.de !== RESERVE) w.set(doc(db, 'stocks', d.de), { L: increment(d.L || 0), XL: increment(d.XL || 0), via: id }, { merge: true });
      await w.commit();
      notifyDispatch(rep === 'ok' ? '📦 ' + me.nom + ' a accepté ' + qty(d) : '📦 ' + me.nom + ' : stock pas reçu (' + qty(d) + ')', d.par !== 'proprietaire' ? d.par : undefined);
    } catch (e) { if ($('dlErr' + id)) $('dlErr' + id).textContent = msg(e); }
    dons.busy = false;
  }; });
}

// =====================================================================
// v27 : Samuel — seulement Uber et pick-up
// =====================================================================
// members.uber / users.uber : ce livreur ne reçoit jamais de commande automatique.
// commandes : type 'uber' | 'pickup', accepte, uberLien, uberEta (ms), pickAdr.
// soirees.pause : il est en pause (le dispatch le voit). reglages/{mid}.pickAdr : son adresse de pick-up habituelle.
// Uber : il commande le Uber seulement quand l'EMT est confirmé. Pick-up : le paiement marche comme chez un livreur.
let regs = {}, myReg = null;
const isUberMid = (mid) => !!(team[mid] && team[mid].uber);
function uberOpt(v) { const [type, mid] = v.split(':'); const s = Object.values(soirees).find((x) => x.mid === mid && working(x)); return { mid, nom: (s && s.nom) || nomDe(mid), kind: 'fin', type, trajet: 0, arr: Date.now(), ok: true }; }
function uberBtns(o) {
  const list = Object.values(soirees).filter((s) => working(s) && isUberMid(s.mid));
  if (!list.length) return '';
  return list.map((s) => {
    const nom = esc(s.nom);
    if (s.pause || sortis[s.mid]) return '<div class="small" style="margin:6px 0">🔴 ' + nom + ' n’est pas disponible (pas d’Uber ni de pick-up).</div>';
    const seeSt = isOwner() || me.role === 'complet', left = stockLeft(s.mid), ok = ((o.L || 0) + (o.XL || 0) > 0) && (!seeSt || (left.L >= (o.L || 0) && left.XL >= (o.XL || 0)));
    const uOk = ok && o.int && o.adr;
    const why = !ok ? 'pas assez de stock (' + left.L + ' L, ' + left.XL + ' XL)' : !o.int ? 'Uber : seulement si tout est payé en EMT ou en crypto (pas de cash, pas de mélange)' : !o.adr ? 'Uber : écris l’adresse du client' : '';
    return '<div class="two" style="margin:6px 0 2px"><button class="btn ghost sm" data-ub="uber:' + esc(s.mid) + '"' + (uOk ? '' : ' disabled') + '>🚕 Uber avec ' + nom + '</button><button class="btn ghost sm" data-ub="pickup:' + esc(s.mid) + '"' + (ok ? '' : ' disabled') + '>📍 Pick-up chez ' + nom + '</button></div>' +
      (why ? '<div class="small" style="margin-bottom:6px">' + why + '</div>' : '');
  }).join('');
}
// Ce que le dispatch voit d'une commande Uber / pick-up.
function uberInfo(c) {
  const n = esc(c.livreurNom || nomDe(c.livreur));
  if (!c.accepte) return '<div class="fban s-proche">⏳ En attente que ' + n + ' accepte</div>';
  if (c.type === 'pickup') {
    const a = c.pickAdr || '';
    return '<div class="fban s-new">📍 Le client va chez ' + n + (c.statut === 'ici' ? ' · il est arrivé' : '') + '</div>' +
      (a ? '<div class="small" style="margin:4px 0">' + esc(a) + ' <button class="linkbtn" data-copy="' + esc(a) + '">📋 Copier</button></div>' : '<div class="small">' + n + ' n’a pas encore entré son adresse.</div>');
  }
  if (c.bloque) return '<div class="fban s-ici">🔒 ' + n + ' attend ton « ✓ EMT reçu » pour commander le Uber</div>';
  if (!c.uberLien) return '<div class="fban s-proche">🚕 ' + n + ' commande le Uber…</div>';
  const m = Math.round(((c.uberEta || Date.now()) - Date.now()) / 60000);
  return '<div class="fban s-new">🚕 Uber en route · arrivée ~' + hm(c.uberEta) + (m >= 0 ? ' (' + m + ' min)' : '') + '</div><div class="small" style="margin:4px 0;word-break:break-all"><a href="' + esc(c.uberLien) + '" target="_blank" rel="noopener" style="color:#7fa8ff">' + esc(c.uberLien) + '</a></div>';
}
// ---------- Écran de Samuel ----------
const ub = { adrFor: null, adr: '', defOpen: false, def: '', lien: {}, eta: {}, cash: {}, pay: null, mix: '', ask: null };
const pickDef = () => (myReg && myReg.pickAdr) || '';
function bandOf(c) {
  const dp = c.demandePaie;
  return dp ? '<div class="banner b-no">💳 Paiement envoyé au dispatch — attends qu’il confirme<div class="small" style="color:inherit;margin-top:3px">' + esc(dp.mode === 'cash' ? 'Tout en cash' : dp.mode === 'int' ? 'Tout en EMT' : dp.mode === 'cry' ? 'Tout en crypto' : dp.cash + ' $ cash + le reste en EMT') + '</div></div>'
    : c.bloque ? '<div class="banner b-no">Pas payé — attends le dispatch</div>'
    : c.encaisser > 0 ? '<div class="banner" style="background:var(--card2);border:1px solid var(--line)">💵 À encaisser : <b>' + c.encaisser + ' $</b> cash</div>'
    : '<div class="banner" style="background:#0f2a1a;color:#86efac">✓ Déjà payé — rien à encaisser</div>';
}
function ubCard(c) {
  const up = c.type === 'pickup';
  let h = '<div class="card now"><div class="small">' + (up ? '📍 Pick-up' : '🚕 Uber') + '</div><div class="client">' + esc(c.client) + '</div>' + testTag(c) + qtyChips(c) + (c.note ? '<div class="note2">📝 ' + esc(c.note) + '</div>' : '');
  if (!c.accepte) {
    return h + '<div class="banner" style="background:#3a2a05;color:#fcd34d">Nouveau ' + (up ? 'pick-up : le client vient chez toi' : 'Uber') + '</div><div class="two"><button class="btn red" data-ua="no:' + c.id + '">Refuser</button><button class="btn ok" data-ua="ok:' + c.id + '">✓ Accepter</button></div></div>';
  }
  if (!up) {
    h += '<div class="label" style="margin-top:10px">Adresse pour Uber</div><div style="font-size:17px;font-weight:700;line-height:1.35">' + esc(c.adresse) + '</div>' +
      '<button class="btn ghost sm" data-ucopy="' + esc(c.adresse) + '" style="margin:8px 0">📋 Copier l’adresse</button>';
    if (c.bloque) h += '<div class="banner b-no">🔒 Attends que le dispatch confirme l’EMT.<br>Ne commande pas le Uber encore.</div>';
    else if (!c.uberLien) h += '<div class="banner" style="background:#0f2a1a;color:#86efac">✓ Payé — tu peux commander le Uber</div>' +
      '<input id="ubLien_' + c.id + '" placeholder="Colle le lien de suivi Uber" value="' + esc(ub.lien[c.id] || '') + '" autocomplete="off">' +
      '<input id="ubEta_' + c.id + '" type="number" inputmode="numeric" placeholder="Arrive dans combien de minutes ? (ex. 18)" value="' + esc(ub.eta[c.id] || '') + '">' +
      '<button class="btn ok" data-ug="' + c.id + '">🚕 Uber commandé</button>';
    else {
      const m = Math.round(((c.uberEta || Date.now()) - Date.now()) / 60000);
      h += '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:10px 0 2px"><span class="small">Uber arrive</span><span style="font-size:26px;font-weight:800">' + hm(c.uberEta) + '</span><span class="small">' + (m >= 0 ? 'dans ' + m + ' min' : 'en retard') + '</span></div>' +
        '<div class="small" style="word-break:break-all;margin-bottom:6px"><a href="' + esc(c.uberLien) + '" target="_blank" rel="noopener" style="color:#7fa8ff">' + esc(c.uberLien) + '</a></div>' +
        '<div style="display:flex;gap:6px;margin:8px 0"><button class="btn ghost" style="flex:1;padding:12px 4px;font-size:14px" data-ue="' + c.id + ':-5">−5 min</button><button class="btn ghost" style="flex:1;padding:12px 4px;font-size:14px" data-ue="' + c.id + ':5">+5 min</button><button class="btn ghost" style="flex:1;padding:12px 4px;font-size:14px" data-up="' + c.id + '">⚠️ Problème</button></div>' +
        '<button class="btn ok" data-ud="' + c.id + '" style="padding:18px;font-size:18px">' + (ub.ask === c.id ? 'Appuie encore : livré ✓' : '✓ Livré') + '</button>';
    }
    return h + '<div class="err" id="ubErr_' + c.id + '"></div></div>';
  }
  // Pick-up
  const adr = c.pickAdr || pickDef();
  if (ub.adrFor === c.id) h += '<div class="label" style="margin-top:10px">Adresse pour ce pick-up</div><input id="ubAdr" value="' + esc(ub.adr) + '"><div class="two"><button class="btn ghost sm" data-uaa="x">Annuler</button><button class="btn sm" data-uaa="' + c.id + '">Envoyer au dispatch</button></div>';
  else h += '<div class="label" style="margin-top:10px">Le client vient ici</div><div style="font-size:17px;font-weight:700;line-height:1.35">' + (adr ? esc(adr) : '<span style="color:var(--danger)">Pas d’adresse — appuie sur ✏️</span>') + '</div>' +
    '<div class="two" style="margin:8px 0">' + (adr ? '<button class="btn ghost sm" data-ucopy="' + esc(adr) + '">📋 Copier</button>' : '') + '<button class="btn ghost sm" data-uce="' + c.id + '">✏️ Changer cette fois</button></div>' +
    (c.pickAdr ? '<div class="small">✓ Envoyée au dispatch</div>' : '');
  if (c.statut !== 'ici') return h + '<button class="btn ok" data-uh="' + c.id + '" style="padding:18px;font-size:18px;margin-top:8px">👋 Le client est arrivé</button><div class="err" id="ubErr_' + c.id + '"></div></div>';
  const bloque = c.bloque || !!c.demandePaie;
  h += '<div style="margin:10px 0 2px;font-size:16px">👋 Le client est là depuis ' + minDe(c.iciLe) + ' min</div>' + bandOf(c) +
    '<button class="btn ghost" data-upay="' + c.id + '" style="margin:10px 0 8px">💳 Paiement</button>';
  if (ub.pay === c.id) h += lvPanel(c).replace('<a class="btn ghost sm"', '<a class="hide"');
  if (bloque) h += '<button class="btn" disabled style="padding:18px;font-size:17px">🔒 Remis au client (attends le paiement)</button>';
  else h += (c.encaisser > 0 ? '<div class="small" style="margin:4px 0">Cash reçu (change si différent)</div><input id="ubCash_' + c.id + '" type="number" inputmode="numeric" value="' + esc(ub.cash[c.id] != null ? ub.cash[c.id] : Math.max(0, c.encaisser - detteSur(c))) + '">' : '') +
    '<button class="btn ok" data-ud="' + c.id + '" style="padding:18px;font-size:18px">✓ Remis au client</button>';
  return h + '<div class="err" id="ubErr_' + c.id + '"></div></div>';
}
function uberHtml(s) {
  const mine = st(me.mid);
  // v53 : petit interrupteur Disponible / Pas disponible
  let h = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b style="font-size:17px">' + (s.pause ? '🔴 Pas disponible' : '🟢 Disponible') + '</b>' +
    '<div class="small" style="margin-top:3px">' + (s.pause ? 'Tu ne reçois rien.' : 'Le dispatch peut t’envoyer des Uber et des pick-up.') + '</div></div>' +
    '<button id="ubPause" aria-label="Disponible" style="flex:none;width:56px;height:32px;border-radius:999px;border:0;position:relative;padding:0;background:' + (s.pause ? '#4b5563' : '#22c55e') + '"><span style="position:absolute;top:4px;left:' + (s.pause ? '4px' : '28px') + ';width:24px;height:24px;border-radius:50%;background:#fff"></span></button></div></div>';
  if (!myCmds.length) h += '<div class="card center" style="padding:28px 14px"><div style="font-size:38px">🚕</div><div style="font-size:18px;font-weight:700;margin:8px 0 4px">Pas de commande pour l’instant</div><div class="small">Le dispatch t’enverra un Uber ou un pick-up ici.</div></div>';
  else h += myCmds.slice().sort((a, b) => (a.accepte ? 1 : 0) - (b.accepte ? 1 : 0) || a.ordre - b.ordre).map(ubCard).join('');
  h += '<details class="card" style="margin-top:4px"' + (ub.defOpen || !pickDef() ? ' open' : '') + '><summary class="small" style="cursor:pointer">Ma soirée ▾ · ' + (mine.L || 0) + ' L · ' + (mine.XL || 0) + ' XL sur toi · ' + (s.livrees || 0) + ' faite' + ((s.livrees || 0) > 1 ? 's' : '') + '</summary>' +
    '<div class="small" style="margin-top:10px">🚕 Uber depuis : <b style="color:var(--text)">' + esc(s.adresse || '') + '</b></div>' +
    '<div class="label" style="margin-top:10px">📍 Mon adresse de pick-up</div>' +
    (ub.defOpen ? '<input id="ubDef" placeholder="Ex. 4500 rue Saint-Denis, Montréal, QC H2J 2L3" value="' + esc(ub.def) + '"><div class="two"><button class="btn ghost sm" id="ubDefX">Annuler</button><button class="btn sm" id="ubDefGo">Enregistrer</button></div>'
      : '<div>' + (pickDef() ? esc(pickDef()) : '<span class="small">Pas encore entrée</span>') + '</div><button class="linkbtn" id="ubDefOpen">✏️ ' + (pickDef() ? 'Modifier' : 'Entrer mon adresse') + '</button>') +
    '<div class="err" id="ubDefErr"></div></details>';
  if (!myCmds.length) h += finCard(s);
  return h;
}
function bindUber(s) {
  watchChat(null);
  const ubAct = async (id, fn) => { document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = true; }); try { await fn(); } catch (e) { const el = $('ubErr_' + id) || $('ubDefErr'); if (el) el.textContent = msg(e); } document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = false; }); };
  const C = (id) => myCmds.find((x) => x.id === id);
  const upd = (id, d) => writeBatch(db).update(doc(db, 'commandes', id), d).commit();
  const qa = (sel, fn) => document.querySelectorAll('#soiree [' + sel + ']').forEach((el) => { el.onclick = () => fn(el.getAttribute(sel), el); });
  if ($('ubPause')) $('ubPause').onclick = () => ubAct('', async () => { const p = !s.pause; await writeBatch(db).update(doc(db, 'soirees', s.id), { pause: p }).commit(); notifyDispatch(p ? '🔴 ' + me.nom + ' n’est plus disponible' : '🟢 ' + me.nom + ' est disponible'); });
  qa('data-ucopy', (t, el) => { try { navigator.clipboard.writeText(t).catch(() => {}); } catch (e) {} el.textContent = 'Copié ✓'; });
  qa('data-ua', (v) => { const [k, id] = v.split(':'), c = C(id); if (!c) return;
    ubAct(id, async () => {
      if (k === 'ok') { await upd(id, Object.assign({ accepte: true }, c.type === 'pickup' && !c.pickAdr && pickDef() ? { pickAdr: pickDef() } : {})); notifyDispatch('✓ ' + me.nom + ' accepte ' + (c.type === 'uber' ? 'le Uber' : 'le pick-up') + ' de ' + c.client); }
      else { const b = writeBatch(db); b.update(doc(db, 'commandes', id), { statut: 'attente', livreur: null, livreurNom: null, accepte: false, type: null, pickAdr: null, refusPar: me.mid });
        if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'attente', eta: null }); await b.commit(); notifyDispatch('✗ ' + me.nom + ' refuse ' + c.client + ' — à réassigner'); }
    }); });
  document.querySelectorAll('#soiree [id^="ubLien_"]').forEach((el) => { el.oninput = () => { ub.lien[el.id.slice(7)] = el.value; }; });
  document.querySelectorAll('#soiree [id^="ubEta_"]').forEach((el) => { el.oninput = () => { ub.eta[el.id.slice(6)] = el.value; }; });
  document.querySelectorAll('#soiree [id^="ubCash_"]').forEach((el) => { el.oninput = () => { ub.cash[el.id.slice(7)] = el.value; }; });
  qa('data-ug', (id) => { const c = C(id); if (!c) return;
    const l = String(ub.lien[id] || '').trim(), m = Math.round(Number(ub.eta[id]) || 0), e = $('ubErr_' + id);
    if (!/^https?:\/\/\S+$/i.test(l)) { e.textContent = 'Colle le lien de suivi Uber (commence par https://).'; return; }
    if (m < 1 || m > 180) { e.textContent = 'Écris dans combien de minutes le Uber arrive.'; return; }
    ubAct(id, async () => { const eta = Date.now() + m * 60000, b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { uberLien: l.slice(0, 500), uberEta: eta, uberLe: Date.now() });
      if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { eta, statut: 'assignee' });
      await b.commit(); delete ub.lien[id]; delete ub.eta[id];
      notifyDispatch('🚕 ' + me.nom + ' a commandé le Uber pour ' + c.client + ' · arrivée ~' + hm(eta)); }); });
  qa('data-ue', (v) => { const [id, d] = v.split(':'), c = C(id); if (!c) return;
    ubAct(id, async () => { const eta = Math.max(Date.now() + 60000, (c.uberEta || Date.now()) + Number(d) * 60000), b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { uberEta: eta }); if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { eta, statut: 'assignee' });
      await b.commit(); notifyDispatch('⏱ Uber de ' + c.client + ' : maintenant ~' + hm(eta)); }); });
  qa('data-up', (id) => { const c = C(id); if (!c) return; ubAct(id, () => sendMsg(me.mid, 'livreur', '⚠️ Problème avec le Uber de ' + c.client)); });
  qa('data-uce', (id) => { const c = C(id); ub.adrFor = id; ub.adr = (c && c.pickAdr) || pickDef(); renderSoiree(); });
  if ($('ubAdr')) $('ubAdr').oninput = (e) => { ub.adr = e.target.value; };
  qa('data-uaa', (id) => { if (id === 'x') { ub.adrFor = null; return renderSoiree(); }
    const a = String(ub.adr || '').trim(); if (a.length < 6) { $('ubErr_' + id).textContent = 'Écris l’adresse.'; return; }
    const c = C(id); ub.adrFor = null;
    ubAct(id, async () => { await upd(id, { pickAdr: a.slice(0, 200) }); notifyDispatch('📍 ' + me.nom + ' : nouvelle adresse de pick-up pour ' + (c ? c.client : '') + ' : ' + a); }); });
  qa('data-uh', (id) => { const c = C(id); if (!c) return;
    ubAct(id, async () => { const b = writeBatch(db); b.update(doc(db, 'commandes', id), { statut: 'ici', iciLe: serverTimestamp() }); if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'ici' });
      await b.commit(); notifyDispatch('👋 ' + c.client + ' est arrivé chez ' + me.nom + (c.bloque ? ' · pas payé' : '')); }); });
  // Paiement du pick-up : pareil qu'un livreur
  qa('data-upay', (id) => { ub.pay = ub.pay === id ? null : id; lv.panel = ub.pay ? 'pay' : null; if (!ub.pay) delete dt.door[id]; renderSoiree(); });
  const pc = ub.pay && C(ub.pay);
  if (pc) {
    document.querySelectorAll('#soiree [data-lp]').forEach((b) => { b.onclick = () => {
      const k = b.dataset.lp;
      if (k === 'x') { lv.panel = null; ub.pay = null; delete dt.door[pc.id]; return renderSoiree(); }
      if (k === 'mix') { lv.panel = 'mix'; return renderSoiree(); }
      if (k === 'dette') { lv.panel = 'dette'; dt.door[pc.id] = { resp: 'moi', amt: pc.encaisser || '', note: '' }; return renderSoiree(); }
      lv.panel = null; ub.pay = null; ubAct(pc.id, () => askPaie(pc, { mode: k }));
    }; });
    if ($('lvMix')) $('lvMix').oninput = (e) => { lv.mix = e.target.value; };
    if ($('lvMixGo')) $('lvMixGo').onclick = () => { const x = Math.round(Number(lv.mix) || 0); if (x <= 0) { $('ubErr_' + pc.id).textContent = 'Écris le cash reçu.'; return; } lv.panel = null; ub.pay = null; lv.mix = ''; ubAct(pc.id, () => askPaie(pc, { mode: 'mix', cash: x })); };
    bindDetteDoor(pc);
  }
  qa('data-ud', (id) => { const c = C(id); if (!c) return;
    if (c.type === 'uber' && ub.ask !== id) { ub.ask = id; renderSoiree(); setTimeout(() => { if (ub.ask === id) { ub.ask = null; renderSoiree(); } }, 4000); return; }
    ub.ask = null;
    const ce = $('ubCash_' + id), cash = ce ? Math.max(0, Number(ce.value) || 0) : 0;
    ubAct(id, async () => {
      if (c.statut !== 'ici') await upd(id, { statut: 'ici', iciLe: serverTimestamp() });
      const b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { statut: 'livree', livreeLe: serverTimestamp(), cashRecu: cash, soiree: s.id, ...(paies[me.mid] != null && !c.test ? { paie: paies[me.mid] } : {}) });
      if (!c.test) {
        b.set(doc(db, 'stocks', me.mid), { L: increment(-(c.L || 0)), XL: increment(-(c.XL || 0)), cmd: id }, { merge: true });
        b.update(doc(db, 'soirees', s.id), { livrees: increment(1) });
      }
      await b.commit(); delete ub.cash[id];
      closeSuivi(c.suivi, 'livree');
      notifyDispatch('✓ ' + me.nom + ' : ' + c.client + (c.type === 'uber' ? ' livré (Uber)' : ' remis (pick-up)') + (cash ? ' · ' + cash + ' $ cash' : ''));
    }); });
  if ($('ubDefOpen')) $('ubDefOpen').onclick = () => { ub.defOpen = true; ub.def = pickDef(); renderSoiree(); };
  if ($('ubDef')) $('ubDef').oninput = (e) => { ub.def = e.target.value; };
  if ($('ubDefX')) $('ubDefX').onclick = () => { ub.defOpen = false; renderSoiree(); };
  if ($('ubDefGo')) $('ubDefGo').onclick = () => { const a = String(ub.def || '').trim(); if (a.length < 6) { $('ubDefErr').textContent = 'Écris l’adresse complète.'; return; }
    ub.defOpen = false; ubAct('', async () => { await setDoc(doc(db, 'reglages', me.mid), Object.assign({}, myReg && myReg.uberAdr ? { uberAdr: myReg.uberAdr } : {}, { pickAdr: a.slice(0, 200) })); renderSoiree(); }).then(() => { if ($('ubDefErr') && $('ubDefErr').textContent) { ub.defOpen = true; } }); };
}

// =====================================================================
// v28 : Historique en un seul panel — total, un livreur par ligne, livraisons numérotées,
//       et (propriétaire seulement) ✏️ Modifier : Ajuster (L, XL, cash reçu) ou Annuler (test).
// =====================================================================
// Annuler : commande « annulee » (annuleTest), ne compte plus nulle part ; le stock retourne chez le livreur ; son compteur baisse de 1.
// Ajuster : nouvelles quantités / cash reçu ; la différence de stock retourne chez le livreur (ou est enlevée) ; à encaisser suit le prix si c'était du cash.
const hx = { open: null, edit: null, mode: null, L: 0, XL: 0, cash: 0, busy: false, err: '' };
function histoTotals() { // v43 : en bas, petit, s'ouvre au toucher
  const T = { cash: 0, int: 0, cry: 0, no: 0, coins: {}, n: 0, reste: 0 };
  (hs.rows || []).forEach((c) => { const q = payOf(c); T.cash += q.cash; T.int += q.int; T.cry += q.cry; T.no += q.no || 0; if (q.cry) T.coins[q.coin || '?'] = (T.coins[q.coin || '?'] || 0) + q.cry; });
  (hs.sum || []).forEach((r) => { T.n += r.n; T.reste += r.reste; });
  const line = (k, v, col) => '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>' + k + '</span><b style="color:' + col + '">' + money(v) + '</b></div>';
  const coins = Object.keys(T.coins), o = !!hs.totOpen;
  let h = '<div class="card" id="hTot" style="padding:10px 14px;cursor:pointer"><div style="display:flex;justify-content:space-between;font-size:14px"><span>📊 Total de la ' + (hs.week ? 'semaine' : 'soirée') + '</span><b>' + money(T.cash + T.int + T.cry) + ' ' + (o ? '▲' : '▼') + '</b></div>';
  if (o) h += '<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">' + line('🔵 Cash', T.cash, PCOL.cash) + line('🟡 EMT', T.int, PCOL.int) + line('🟣 Crypto', T.cry, PCOL.cry) +
    (T.no ? line('<span style="color:#f87171">🔴 Pas encore reçu</span>', T.no, '#f87171') : '') +
    (coins.length ? '<div class="small" style="text-align:right;color:' + PCOL.cry + '">' + coins.map((k) => esc(coinIcon(k) + k) + ' ' + money(T.coins[k])).join(' · ') + '</div>' : '') +
    '<div class="small" style="margin-top:4px">' + T.n + ' livraison' + (T.n > 1 ? 's' : '') + ' · reste ' + money(T.reste) + '</div>' +
    (hs.extra ? '<div class="small" style="margin-top:6px;white-space:pre-line">' + esc(hs.extra.trim()) + '</div>' : '') + '</div>';
  return h + '</div>';
}
function hsTags(c, nom) {
  const t = [];
  if (c.statut === 'ajout') t.push('⏳ attend ' + nom);
  if (c.type === 'uber') t.push('🚕 Uber'); else if (c.type === 'pickup') t.push('📍 pick-up');
  if (c.envoyePar) t.push('✓ EMT de ' + String(c.envoyePar).trim().split(/\s+/)[0]);
  if (c.nonRecu) t.push('🔴 pas reçu');
  if (c.paieModLe && !c.chg) t.push('✏️ modifié');
  if (c.qtyAvant) t.push('✏️ quantité');
  if (c.chg) t.push('⏳ changement');
  if (c.ajoutPar) t.push('➕ ajoutée');
  if (c.vente) t.push('🛒 vente');
  if (c.dette) t.push('📒 dette');
  if (c.ajusteLe) t.push('✏️ ajustée');
  return t;
}
function hsRow(c, i, nom, owner) {
  const q = payOf(c), t = new Date(tsMs(c.livreeLe)), who = c.confirmeLe ? (c.confirmeNom ? dispName(c.confirmeNom) : nomDe(c.confirmePar || 'proprietaire')) : '';
  const parts = [[q.cash, 'cash', PCOL.cash], [q.int, 'EMT', PCOL.int], [q.cry, 'crypto' + (q.coin ? ' ' + q.coin : ''), PCOL.cry], [q.no || 0, (q.noKind === 'cry' ? 'crypto' : 'EMT') + ' pas reçu', '#f87171'], [q.dette || 0, 'dette', '#f87171']].filter((x) => x[0] > 0);
  const tot = parts.reduce((a, x) => a + x[0], 0);
  const col = parts.length === 1 ? parts[0][2] : 'var(--text)';
  const word = parts.length === 1 ? '<span style="color:' + parts[0][2] + '">' + esc(parts[0][1]) + '</span>' : parts.map((x) => '<span style="color:' + x[2] + '">' + x[0] + ' ' + esc(x[1]) + '</span>').join(' + ');
  const bar = parts.length ? (parts.length === 1 ? parts[0][2] : 'linear-gradient(' + parts.map((x, k) => x[2] + ' ' + (k * 100 / parts.length) + '% ' + ((k + 1) * 100 / parts.length) + '%').join(',') + ')') : '#4b5563';
  const tags = hsTags(c, nom), when = hs.week ? t.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' }) + ' ' + hm(t.getTime()) : hm(t.getTime());
  const open = hx.det === c.id;
  let h = '<div class="hsRow" data-hdet="' + c.id + '"' + (c.statut === 'ajout' ? ' style="background:rgba(245,179,1,.06)"' : '') + '><div class="hsBarC" style="background:' + bar + '"></div>' +
    '<div style="flex:1;min-width:0"><div><span class="hsNum">' + (i + 1) + '</span> <b>' + esc(c.client) + '</b> <span class="small">' + esc(qtyTxt(c)) + ' · ' + esc(when) + '</span></div>' +
    (tags.length ? '<div class="hsTg">' + tags.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' : '') + '</div>' +
    '<div style="text-align:right;white-space:nowrap"><div class="hsAmt" style="color:' + col + '">' + money(tot) + '</div><div class="small">' + word + '</div></div></div>';
  if (c.nonRecu && c.statut === 'livree') h += '<div style="padding:0 14px 8px 28px">' + nrBtn(c) + '</div>';
  if (open) h += '<div class="hsDet">' + payHtml(q) + '<div style="text-align:left">' + addNote(c, nom, who).replace(/text-align:right/g, 'text-align:left') + '</div>' +
    (who && !c.paieModLe ? '<div class="small">✓ confirmé par ' + esc(who) + '</div>' : '') +
    '<div class="small">Cash reçu ' + money(Number(c.cashRecu) || 0) + (c.paie != null ? ' · paie ' + money(c.paie) : '') + '</div>' +
    (c.statut === 'ajout' || c.statut === 'refusee' ? (isDispatcher() ? '<button class="linkbtn" data-adel="' + c.id + '" style="color:#f87171">Retirer</button>' : '') : owner ? '<button class="btn ghost sm" style="width:auto;margin-top:6px" data-he="' + c.id + '">✏️ Modifier</button>' : '') + '</div>';
  return h;
}
function hsCss() {
  if (document.getElementById('hsCss')) return; const st2 = document.createElement('style'); st2.id = 'hsCss'; st2.textContent =
  '.hsBar{display:flex;align-items:center;gap:6px}.hsArr{width:36px;height:36px;border-radius:10px;background:var(--card2);border:1px solid var(--line);color:var(--text);font-weight:900;font-size:18px;padding:0}.hsArr:disabled{opacity:.35}' +
  '.hsDate{flex:1;text-align:center;font-weight:800;font-size:15px;position:relative;cursor:pointer}.hsDate input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}' +
  '.hsTog{display:flex;background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:2px}.hsTog button{border:0;background:none;color:var(--muted);padding:6px 10px;border-radius:999px;font-size:12px;width:auto;margin:0}.hsTog button.on{background:#f5c518;color:#111;font-weight:800}' +
  '.hsChips{display:flex;gap:6px;overflow-x:auto;margin-top:8px}.hsChips button{flex:none;width:auto;margin:0;border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:999px;padding:5px 11px;font-size:12.5px}.hsChips button.on{background:#2a303a;border-color:#4b5563;font-weight:800}' +
  '.hsMini{display:flex;gap:10px;flex-wrap:wrap;padding:6px 14px 8px;font-size:12.5px;color:var(--muted);border-top:1px solid var(--line)}' +
  '.hsRow{display:flex;gap:10px;align-items:center;padding:9px 14px;border-top:1px solid var(--line);cursor:pointer;font-size:15px}' +
  '.hsBarC{width:4px;align-self:stretch;border-radius:4px;flex:none}.hsNum{color:var(--muted);font-size:11.5px}.hsAmt{font-weight:900;font-size:16px}' +
  '.hsTg{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}.hsTg span{font-size:11px;background:var(--card2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--text)}' +
  '.hsDet{margin:0 14px 10px 28px;background:var(--card2);border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.6}' +
  '.hsDot{display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;text-align:center;padding:0 5px;margin-left:2px}' +
  '.hsPop{margin-top:8px;background:#3a1517;border:1px solid #7f1d1d;color:#fca5a5;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:700;cursor:pointer}' +
  '.hsAnn{padding:8px 14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);cursor:pointer}';
  document.head.appendChild(st2);
}
function histoPeople() {
  const all = hs.all || [], ids = [];
  all.forEach((c) => { const k = c.livreur || '?'; if (!ids.includes(k)) ids.push(k); });
  if (!ids.length) return '<div class="card small">Aucune livraison.</div>';
  const owner = canEditH(); // v38 : Wayne et MOUSSE
  return ids.map((k) => {
    const S = (hs.sum || []).find((r) => r.mid === k) || { n: 0, cash: 0, reste: 0, paieOk: true };
    const mine = all.filter((c) => (c.livreur || '?') === k), nom = esc((mine[0] && mine[0].livreurNom) || nomDe(k)), o = hx.open === k;
    const tot = mine.filter((c) => !c.test && !c.annuleTest && c.statut === 'livree').reduce((a2, c) => { const q = payOf(c); return a2 + q.cash + q.int + q.cry; }, 0);
    let h = '<div class="card" style="padding:0;overflow:hidden;margin-bottom:8px' + (o ? ';border-color:#f5b301' : '') + '"><div data-hp="' + esc(k) + '" style="display:flex;justify-content:space-between;align-items:center;padding:13px 14px;cursor:pointer"><div><b style="font-size:17px">' + nom + '</b>' + alphaTag(k) + ' <span class="small">' + S.n + ' livraison' + (S.n > 1 ? 's' : '') + '</span></div><b>' + money(tot) + ' ' + (o ? '▲' : '▼') + '</b></div>';
    if (!o) return h + '</div>';
    { const P = { cash: 0, int: 0, cry: 0 }; mine.filter((c) => !c.test && !c.annuleTest && c.statut === 'livree').forEach((c) => { const q = payOf(c); P.cash += q.cash; P.int += q.int; P.cry += q.cry; }); // v43
      h += '<div class="hsMini"><span style="color:' + PCOL.cash + '">🔵 ' + money(P.cash) + '</span><span style="color:' + PCOL.int + '">🟡 ' + money(P.int) + '</span><span style="color:' + PCOL.cry + '">🟣 ' + money(P.cry) + '</span>' +
        '<span>· à remettre <b style="color:var(--text)">' + (S.paieOk ? money(S.reste) : '?') + '</b></span>' + (S.tips ? '<span>· pourboires ' + money(S.tips) + '</span>' : '') + (S.dette ? '<span style="color:#f87171">📒 ' + money(S.dette) + '</span>' : '') + '</div>'; }
    // v55 : une livraison = 2 lignes courtes (barre de couleur, client, montant ; en petit l'heure + petits mots). Toucher = détails.
    const F = hs.f || 'tout', isAnn = (c) => c.annuleTest || c.statut === 'refusee';
    const okF = (c) => { if (F === 'tout') return true; const q = payOf(c); if (F === 'cash') return q.cash > 0; if (F === 'emt') return q.int > 0 || q.cry > 0 || (q.no || 0) > 0; return !!(c.paieModLe || c.ajoutPar || c.dette || c.nonRecu || c.qtyAvant || c.chg || c.statut === 'ajout' || c.vente); };
    const anns = mine.filter(isAnn);
    mine.forEach((c, i) => {
      if (isAnn(c) && !hs.anOpen) return;
      if (!isAnn(c) && !okF(c)) return;
      if (isAnn(c) && F !== 'tout') return;
      if (!c.test && !isAnn(c) && hx.edit !== c.id) { h += hsRow(c, i, nom, owner); return; }
      const t = new Date(tsMs(c.livreeLe)), cash = Number(c.cashRecu) || 0, enc = Number(c.encaisser) || 0;
      const who = c.confirmeLe ? (c.confirmeNom ? dispName(c.confirmeNom) : nomDe(c.confirmePar || 'proprietaire')) : '';
      const line = '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div><b>' + (c.test ? '🧪' : (i + 1) + '.') + '</b> ' + esc(c.client) + ' <span class="small">· ' + esc(qtyTxt(c)) +
        (c.type === 'uber' ? ' · Uber' : c.type === 'pickup' ? ' · pick-up' : '') + (hs.week ? ' · ' + t.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' }) : ' · ' + hm(t.getTime())) + (c.ajusteLe ? ' · ✏️' : '') + (c.annuleTest ? ' · annulée' : '') + '</span></div>' +
        '<b style="white-space:nowrap">' + payHtml(payOf(c)) + '</b></div>' + addNote(c, nom, who) + (c.nonRecu && c.statut === 'livree' ? nrBtn(c) : '') + '</div>';
      if (c.statut === 'ajout' || c.statut === 'refusee') { h += '<div style="padding:10px 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center;' + (c.statut === 'refusee' ? 'opacity:.5' : 'background:rgba(245,179,1,.06)') + '">' + line + (isDispatcher() ? '<button class="linkbtn" data-adel="' + c.id + '" style="color:#f87171">Retirer</button>' : '') + '</div>'; return; }
      if (c.annuleTest) { h += '<div style="padding:10px 14px;border-top:1px solid var(--line);opacity:.45;display:flex;gap:8px;align-items:center">' + line + '<span class="small">↩️</span></div>'; return; }
      if (c.test) { h += '<div style="padding:10px 14px;border-top:1px solid var(--line);opacity:.5;display:flex;gap:8px;align-items:center">' + line + '<span class="small">🧪 test<br>effacée après 15 min</span></div>'; return; }
      if (hx.edit !== c.id) { h += '<div ' + (owner ? 'data-he="' + c.id + '" ' : '') + 'style="padding:10px 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center' + (owner ? ';cursor:pointer' : '') + '">' + line + '</div>'; return; }
      h += '<div style="padding:10px 14px;border-top:1px solid var(--line);background:var(--card2)"><div style="display:flex">' + line + '</div>' +
        '<div class="small" style="margin-top:4px">Cash reçu ' + money(cash) + (cash > enc ? ' (pourboire ' + money(cash - enc) + ')' : '') + (c.paie != null ? ' · paie ' + money(c.paie) : '') + '</div>' +
        '<div class="seg" style="margin:10px 0">' + [['pay', 'Paiement'], ['adj', 'Ajuster L / XL'], ['ann', 'Annuler (test)']].map((x) => '<button data-hm2="' + x[0] + '" class="' + (hx.mode === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
      if (hx.mode === 'pay') h += payEditHtml(c);
      if (hx.mode === 'adj') h += '<div style="display:flex;gap:8px"><div style="flex:1"><div class="small">L</div><input id="hxL" type="number" inputmode="numeric" min="0" value="' + hx.L + '"></div><div style="flex:1"><div class="small">XL</div><input id="hxXL" type="number" inputmode="numeric" min="0" value="' + hx.XL + '"></div></div>' +
        '<div class="small">Cash reçu ($)</div><input id="hxCash" type="number" inputmode="numeric" min="0" value="' + hx.cash + '">' +
        '<div class="small" style="margin:4px 0 8px">Si la quantité baisse, la différence retourne chez ' + nom + ' ; si elle monte, elle est enlevée de son stock.</div>' +
        '<div class="two"><button class="btn ghost sm" data-hx="1">Fermer</button><button class="btn ok sm" data-hsave="' + c.id + '"' + (hx.busy ? ' disabled' : '') + '>' + (hx.busy ? '…' : 'Enregistrer') + '</button></div>';
      if (hx.mode === 'ann') h += '<div class="banner b-no" style="text-align:left">Annuler la livraison ' + (i + 1) + ' (' + esc(c.client) + ') ?<div class="small" style="color:inherit;margin-top:6px;line-height:1.6">📦 ' + esc(qtyTxt(c)) + ' retourne chez ' + nom +
        '<br>💵 ' + money(cash) + ' cash enlevé' + (c.paie != null ? '<br>💸 paie ' + money(c.paie) + ' enlevée' : '') + '<br>🔢 ne compte plus comme livraison</div></div>' +
        '<div class="two"><button class="btn ghost sm" data-hx="1">Garder</button><button class="btn red sm" data-hann="' + c.id + '"' + (hx.busy ? ' disabled' : '') + '>' + (hx.busy ? '…' : 'Oui, annuler') + '</button></div>';
      if (hx.err) h += '<div class="err">' + esc(hx.err) + '</div>';
      h += '</div>';
    });
    if (anns.length && F === 'tout') h += '<div class="hsAnn" data-hann2="1">⊘ ' + anns.length + ' annulée' + (anns.length > 1 ? 's' : '') + ' ' + (hs.anOpen ? '▴' : '▾') + '</div>';
    if (owner && k !== '?') h += '<div class="small" style="padding:8px 14px;border-top:1px solid var(--line)">Touche une livraison pour voir les détails. · 📦 Stock de ' + nom + ' : ' + esc(qty(st(k))) + '</div>';
    return h + '</div>';
  }).join('');
}
function bindHistoPeople() {
  const box = $('histo'); if (!box) return;
  const C = (id) => (hs.all || []).find((x) => x.id === id);
  box.querySelectorAll('[data-hp]').forEach((el) => { el.onclick = () => { hx.open = hx.open === el.dataset.hp ? null : el.dataset.hp; hx.edit = null; drawHisto(); }; });
  box.querySelectorAll('[data-he]').forEach((el) => { el.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ev && ev.target.closest && ev.target.closest('[data-nrok],[data-nrc],[data-nrbox]')) return; const c = C(el.dataset.he); if (!c) return; Object.assign(hx, { edit: c.id, mode: 'pay', L: c.L || 0, XL: c.XL || 0, cash: Number(c.cashRecu) || 0, err: '' }); payInit(c); drawHisto(); }; });
  box.querySelectorAll('[data-hm2]').forEach((el) => { el.onclick = () => { hx.mode = el.dataset.hm2; hx.err = ''; drawHisto(); }; });
  box.querySelectorAll('[data-hdet]').forEach((el) => { el.onclick = (ev) => { if (ev && ev.target.closest && ev.target.closest('[data-nrok],[data-nrc],[data-nrbox],[data-nrnom],[data-nrgo],[data-nrx],input,button')) return; hx.det = hx.det === el.dataset.hdet ? null : el.dataset.hdet; drawHisto(); }; });
  box.querySelectorAll('[data-hann2]').forEach((el) => { el.onclick = () => { hs.anOpen = !hs.anOpen; drawHisto(); }; });
  box.querySelectorAll('[data-hx]').forEach((el) => { el.onclick = () => { hx.edit = null; hx.mode = null; drawHisto(); }; });
  [['hxL', 'L'], ['hxXL', 'XL'], ['hxCash', 'cash']].forEach(([id, k]) => { if ($(id)) $(id).oninput = (e) => { hx[k] = e.target.value; }; });
  const run = async (fn) => { if (hx.busy || !canEditH()) return; hx.busy = true; hx.err = ''; drawHisto();
    try { await fn(); hx.edit = null; hx.mode = null; hx.busy = false; await loadHisto(); } catch (e) { hx.busy = false; hx.err = msg(e); drawHisto(); } };
  bindPayEdit(C, run);
  box.querySelectorAll('[data-hann]').forEach((el) => { el.onclick = () => { const c = C(el.dataset.hann); if (!c) return; run(async () => {
    const bt = writeBatch(db);
    bt.update(doc(db, 'commandes', c.id), { statut: 'annulee', annuleTest: true, annuleLe: serverTimestamp(), annulePar: myMid() });
    if (c.livreur) {
      bt.set(doc(db, 'stocks', c.livreur), { L: increment(c.L || 0), XL: increment(c.XL || 0) }, { merge: true });
      bt.set(doc(collection(db, 'mouvements')), { de: 'annulation', vers: c.livreur, L: c.L || 0, XL: c.XL || 0, type: 'annulation', client: c.client || '', cmd: c.id, par: myMid(), le: serverTimestamp() });
    }
    if (c.soiree) bt.update(doc(db, 'soirees', c.soiree), { livrees: increment(-1) });
    await bt.commit(); }); }; });
  box.querySelectorAll('[data-hsave]').forEach((el) => { el.onclick = () => { const c = C(el.dataset.hsave); if (!c) return;
    const L = Math.round(Number(hx.L)), XL = Math.round(Number(hx.XL)), cash = Math.round(Number(hx.cash));
    if (!(L >= 0 && XL >= 0 && L + XL > 0)) { hx.err = 'Mets au moins 1 L ou 1 XL (sinon, annule la livraison).'; return drawHisto(); }
    if (!(cash >= 0)) { hx.err = 'Écris le cash reçu.'; return drawHisto(); }
    if (c.livreur) { const have = st(c.livreur), needL = L - (c.L || 0), needXL = XL - (c.XL || 0);
      if ((needL > 0 && needL > (have.L || 0)) || (needXL > 0 && needXL > (have.XL || 0))) { hx.err = nomDe(c.livreur) + ' n’a pas assez de stock pour ça (il a ' + qty(have) + '). Donne-lui du stock d’abord.'; return drawHisto(); } }
    run(async () => {
      const dL = (c.L || 0) - L, dXL = (c.XL || 0) - XL, bt = writeBatch(db);
      const pr = prive[c.id] || null, pL = (pr && pr.prixL) || cfg.prixL, pXL = (pr && pr.prixXL) || cfg.prixXL, dPrix = -(dL * pL + dXL * pXL);
      const d = { L, XL, cashRecu: cash, ajusteLe: serverTimestamp(), ajustePar: myMid() };
      if ((c.encaisser || 0) > 0 && dPrix) d.encaisser = Math.max(0, (c.encaisser || 0) + dPrix);
      bt.update(doc(db, 'commandes', c.id), d);
      if (dL || dXL) {
        if (c.livreur) {
          bt.set(doc(db, 'stocks', c.livreur), { L: increment(dL), XL: increment(dXL) }, { merge: true });
          // Un mouvement par sens : ce qui retourne chez le livreur, ce qui est enlevé de son stock.
          const back = { L: Math.max(0, dL), XL: Math.max(0, dXL) }, out = { L: Math.max(0, -dL), XL: Math.max(0, -dXL) };
          if (back.L + back.XL) bt.set(doc(collection(db, 'mouvements')), { de: 'ajustement', vers: c.livreur, L: back.L, XL: back.XL, type: 'ajustement', client: c.client || '', cmd: c.id, par: myMid(), le: serverTimestamp() });
          if (out.L + out.XL) bt.set(doc(collection(db, 'mouvements')), { de: c.livreur, vers: 'ajustement', L: out.L, XL: out.XL, type: 'ajustement', client: c.client || '', cmd: c.id, par: myMid(), le: serverTimestamp() });
        }
        try { const sp = await getDoc(doc(db, 'cmdPrive', c.id)); if (sp.exists()) bt.update(doc(db, 'cmdPrive', c.id), { total: (sp.data().total || 0) + dPrix }); } catch (e) {}
      }
      await bt.commit(); });
  }; });
}

// v29 : écrire à un livreur depuis Équipe (propriétaire) — ouvre sa conversation dans En direct.
function openDmWith(mid) {
  setTab('direct'); dm.open = mid; drawDm();
  setTimeout(() => { const el = $('dmCard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if ($('dmTxt')) $('dmTxt').focus(); }, 250);
}

// =====================================================================
// v30 : commandes test (le nom du client contient « test »)
// =====================================================================
// La commande marche comme une vraie (étiquette 🧪 TEST), mais à la livraison : pas de stock enlevé, pas de compteur,
// pas de paie, et elle ne compte dans aucun total (résumés, bulle 💰, historique). Elle reste visible en gris dans
// l'historique, puis le propriétaire ou MOUSSE l'efface toute seule 15 minutes après (commande + montants + lien client).
const isTestName = (n) => /^test$/i.test(String(n || '').trim()) || (String(n || '').match(/(^|[^\p{L}\p{N}])test\d*(?![\p{L}])/giu) || []).length >= 2; // v51 : « test » tout seul, ou le mot « test » écrit 2 fois
function testTag(c) { return c && c.test ? '<div style="display:inline-block;margin:4px 0;padding:3px 10px;border-radius:999px;background:#3a2a05;color:#fcd34d;font-size:13px;font-weight:700">🧪 TEST — ne compte pas</div>' : ''; }
let testSweepOn = false;
async function sweepTests() {
  if (!me || !(isOwner() || me.role === 'complet')) return;
  try {
    const qs = await getDocs(query(collection(db, 'commandes'), where('test', '==', true)));
    const lim = Date.now() - 15 * 60000, b = writeBatch(db); let n = 0;
    qs.forEach((d) => { const c = d.data(); const t = tsMs(c.livreeLe || c.annuleLe);
      if (['livree', 'annulee'].includes(c.statut) && t < lim && n < 150) {
        b.delete(d.ref); b.delete(doc(db, 'cmdPrive', d.id)); if (c.suivi) b.delete(doc(db, 'suivi', c.suivi)); n++; } });
    if (n) await b.commit();
  } catch (e) { console.warn('tests', e); }
}
function startTestSweep() { if (testSweepOn) return; testSweepOn = true; setTimeout(sweepTests, 5000); setInterval(sweepTests, 60000); setTimeout(detteSweep, 7000); setInterval(detteSweep, 60000); }

// v31 : check-in de Samuel (mode Uber) — 2 adresses : d'où partent les Uber + où les clients viennent chercher (pick-up).
// Pré-remplies avec celles de la dernière fois (reglages/{mid} : uberAdr, pickAdr).
function ciUberPre() {
  if (!ci.pre && myReg) { ci.pre = true;
    if (!ci.q && myReg.uberAdr) ci.q = myReg.uberAdr;
    if (ci.pickQ == null) ci.pickQ = myReg.pickAdr || '';
    if (ci.same == null) ci.same = !myReg.pickAdr || !myReg.uberAdr || myReg.pickAdr === myReg.uberAdr;
  }
  if (ci.same == null) ci.same = true;
  return '';
}
function ciPickHtml() {
  return '<p class="small" style="margin:14px 0 4px"><b style="color:var(--text)">2. Où les clients viennent chercher (pick-up) ?</b></p>' +
    '<label class="chk"><input type="checkbox" id="ciSame" ' + (ci.same ? 'checked' : '') + '> Même adresse que les Uber</label>' +
    (ci.same ? '' : '<input id="ciPick" placeholder="Adresse de pick-up avec code postal" autocomplete="off" value="' + esc(ci.pickQ || '') + '">') +
    '<p class="small" style="margin-top:0">Gardée pour la prochaine fois. Tu peux la changer pour un seul pick-up plus tard.</p>';
}

// v32 : la quantité en grosses cases de couleur (L bleu, XL mauve) sur la commande du livreur.
function qtyChips(c) {
  const box = (n, f, bg) => '<div style="flex:1;border-radius:14px;padding:10px 6px;text-align:center;background:' + bg + '"><div style="font-size:30px;font-weight:900;line-height:1">' + n + '</div><div style="font-size:15px;font-weight:700;margin-top:2px">' + f + '</div></div>';
  const h = (c.L ? box(c.L, 'L', '#16324f') : '') + (c.XL ? box(c.XL, 'XL', '#3b2350') : '');
  return h ? '<div style="display:flex;gap:8px;margin:10px 0">' + h + '</div>' : '';
}

// =====================================================================
// v35 : Crypto (comme EMT) + « confirmé par » qui et quand
// =====================================================================
// Crypto : mode « cry » (payé avant, le dispatch confirme). À la confirmation, le dispatch doit choisir la crypto
// (BTC, ETH, USDT, SOL ou Autre écrit) → commandes.crypto. À chaque confirmation EMT / crypto :
// commandes.confirmePar / confirmeNom / confirmeLe, affichés sur la commande et dans l'historique.
const COINS = [['BTC', '₿ BTC'], ['ETH', 'Ξ ETH'], ['USDT', '💲 USDT'], ['SOL', '◎ SOL'], ['autre', 'Autre']];
const cry = { id: null, kind: null, coin: null, autre: '', err: '', ok: null };
const coinOf = (k, a) => (k === 'autre' ? String(a || '').trim().toUpperCase().slice(0, 12) : k || '');
const needCoin = (c) => (c.demandePaie ? ['cry', 'mixc'].includes(c.demandePaie.mode) : (prive[c.id] && ['cry', 'mixc'].includes(prive[c.id].mode)) || ['cry', 'mixc'].includes(c.paieMode));
const payWord = (c) => (needCoin(c) ? 'Crypto' : 'EMT');
function cryBox() {
  return '<div class="msgc" style="margin:8px 0;border:2px solid #8b5cf6"><div style="font-weight:800;margin-bottom:6px">Quelle crypto ? <span class="small">(obligatoire)</span></div><div class="seg">' +
    COINS.map((x) => '<button data-ck="' + x[0] + '" class="' + (cry.coin === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
    (cry.coin === 'autre' ? '<input id="cryA" placeholder="Laquelle ? (ex. LTC)" value="' + esc(cry.autre) + '">' : '') +
    '<div class="err">' + esc(cry.err) + '</div><div class="two"><button class="btn ghost" data-fa="cryX">Annuler</button><button class="btn ok" data-fa="cryGo">✓ Confirmer</button></div></div>';
}
function confLine(c) {
  if (!c.confirmeLe) return '';
  const qui = c.confirmeNom ? dispName(c.confirmeNom) : nomDe(c.confirmePar || 'proprietaire');
  const t = hm(tsMs(c.confirmeLe));
  if (c.crypto || c.paieMode === 'cry') return '<div style="font-size:13px;margin-top:4px;color:#c4b5fd">🟣 Crypto reçu' + (c.crypto ? ' · <b>' + esc(c.crypto) + '</b>' : '') + ' · confirmé par <b>' + esc(qui) + '</b> à ' + t + '</div>';
  if (c.paieMode === 'cash') return '<div style="font-size:13px;margin-top:4px;color:#86efac">💵 Cash · confirmé par <b>' + esc(qui) + '</b> à ' + t + '</div>';
  return '<div style="font-size:13px;margin-top:4px;color:#fcd34d">📲 EMT reçu · confirmé par <b>' + esc(qui) + '</b> à ' + t + '</div>';
}

// =====================================================================
// v36 : Historique — comment chaque livraison a été payée (montants, couleurs de l'app) + total crypto
// =====================================================================
const PCOL = { cash: '#60a5fa', int: '#fcd34d', cry: '#c4b5fd' };
const coinIcon = (k) => ({ BTC: '₿ ', ETH: 'Ξ ', USDT: '💲 ', SOL: '◎ ' }[k] || '');
function payOf(c) {
  let p = (hs.prv && hs.prv[c.id]) || prive[c.id] || {};
  if (c.chgRep === 'ok' && p.next && p.next.mode === c.paieMode) p = Object.assign({}, p, p.next); // v40
  const mode = c.paieMode || p.mode || ((c.encaisser || 0) > 0 ? 'cash' : 'int');
  const total = p.total || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0));
  const cash = Number(c.cashRecu) || 0;
  const int = mode === 'int' ? total : mode === 'mix' ? (p.interac != null ? p.interac : Math.max(0, total - (c.encaisser || 0))) : 0;
  const cryv = mode === 'cry' ? total : mode === 'mixc' ? (p.cryPart != null ? p.cryPart : Math.max(0, total - (c.encaisser || 0))) : 0;
  // v37 : « paie plus tard » (dette) — pas encaissé : on le montre à part, il ne compte pas dans les totaux
  if (c.dette) return { cash, int: 0, cry: 0, coin: '', dette: Math.max(0, (mode === 'cash' ? (c.encaisser || total) : total) - cash) };
  if (c.nonRecu) return { cash, int: 0, cry: 0, coin: c.crypto || p.crypto || '', no: int + cryv, noKind: cryv ? 'cry' : 'int' }; // v41
  return { cash, int, cry: cryv, coin: c.crypto || p.crypto || '' };
}
function payHtml(q) {
  const parts = [];
  if (q.cash) parts.push('<span style="color:' + PCOL.cash + '">🔵 ' + money(q.cash) + '</span>');
  if (q.int) parts.push('<span style="color:' + PCOL.int + '">🟡 ' + money(q.int) + '</span>');
  if (q.cry) parts.push('<span style="color:' + PCOL.cry + '">🟣 ' + money(q.cry) + (q.coin ? ' ' + esc(q.coin) : '') + '</span>');
  if (q.no) parts.push('<span style="color:#f87171">🔴 ' + money(q.no) + ' ' + (q.noKind === 'cry' ? 'crypto' : 'EMT') + ' pas reçu</span>');
  if (q.dette) parts.push('<span style="color:#f87171">📒 ' + money(q.dette) + ' dette</span>');
  return parts.join(' + ') || '<span class="small">0 $</span>';
}

// =====================================================================
// v38 : Historique — Wayne ET MOUSSE peuvent modifier : changer le paiement (Cash / EMT / Crypto / Mélange),
//       ajuster L / XL, annuler (test). Le changement de paiement est noté « paiement modifié par X ».
// =====================================================================
// Mélange = une partie cash + le reste en EMT (mode « mix ») ou en crypto (mode « mixc », cmdPrive.cryPart).
const canEditH = () => isOwner() || (me && me.role === 'complet');
const pe = { mode: 'cash', cash: 0, reste: 'int', coin: null, autre: '', env: '' };
function payTotal(c) { const p = (hs.prv && hs.prv[c.id]) || prive[c.id] || {}; return p.total || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0)); }
function payInit(c) {
  const q = payOf(c), coin = q.coin || '';
  pe.mode = q.cash && (q.int || q.cry) ? 'mix' : q.cry ? 'cry' : q.int ? 'int' : 'cash';
  pe.cash = q.cash || 0; pe.reste = q.cry || q.noKind === 'cry' ? 'cry' : 'int'; pe.recu = !c.nonRecu; pe.env = c.envoyePar || '';
  if (c.nonRecu) pe.mode = q.cash ? 'mix' : q.noKind === 'cry' ? 'cry' : 'int';
  pe.coin = coin ? (COINS.some((x) => x[0] === coin) ? coin : 'autre') : null; pe.autre = coin && !COINS.some((x) => x[0] === coin) ? coin : '';
}
function payEditHtml(c) {
  const tot = payTotal(c), seg = (list, cur, attr) => '<div class="seg" style="margin:4px 0">' + list.map((x) => '<button ' + attr + '="' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
  let h = '<div style="font-weight:800;margin-bottom:4px">Changer le paiement · total ' + money(tot) + '</div>' + seg([['cash', '🔵 Cash'], ['int', '🟡 EMT'], ['cry', '🟣 Crypto'], ['mix', 'Mélange']], pe.mode, 'data-pm');
  if (pe.mode === 'mix') h += '<div class="small" style="margin-top:6px">Partie cash ($)</div><input id="peCash" type="number" inputmode="numeric" value="' + esc(pe.cash) + '">' +
    '<div class="small">Le reste (<b id="peRest">' + money(Math.max(0, tot - (Number(pe.cash) || 0))) + '</b>) en :</div>' + seg([['int', '🟡 EMT'], ['cry', '🟣 Crypto']], pe.reste, 'data-pr');
  const peC = pe.mode === 'cry' || (pe.mode === 'mix' && pe.reste === 'cry');
  if (pe.mode !== 'cash') { // v41 : reçu ou pas encore reçu
    const amt = pe.mode === 'mix' ? Math.max(0, tot - (Number(pe.cash) || 0)) : tot;
    h += '<div class="small" style="margin-top:8px"><b style="color:var(--text)">' + (peC ? 'La crypto' : 'L’EMT') + ' de <span id="peAmt">' + money(amt) + '</span> est…</b></div>' +
      '<div style="display:flex;gap:6px;margin:6px 0"><button data-prc="1" class="btn ghost sm" style="flex:1;margin:0;' + (pe.recu ? 'border:2px solid #2fbf71;color:#86efac;background:#0f2a1a' : '') + '">✓ Reçu</button>' +
      '<button data-prc="0" class="btn ghost sm" style="flex:1;margin:0;' + (!pe.recu ? 'border:2px solid #ef4444;color:#fca5a5;background:#3a1517' : '') + '">⏳ Pas encore reçu</button></div>' +
      (!pe.recu ? '<div class="small" style="color:#fca5a5;line-height:1.5">La livraison va montrer 🔴 pas reçu. Ça ne compte pas dans les totaux tant que quelqu’un ne touche pas « ✓ reçu ».</div>' : '');
  }
  if (pe.recu && (pe.mode === 'int' || (pe.mode === 'mix' && pe.reste === 'int'))) h += '<div class="small" style="margin-top:6px"><b style="color:var(--text)">Envoyé par</b> (nom sur le virement, obligatoire)</div><input id="peEnv" maxlength="60" placeholder="Ex. Marc Tremblay" value="' + esc(pe.env || '') + '">'; // v47
  if (peC && pe.recu) h += '<div class="small" style="margin-top:6px"><b style="color:var(--text)">Quelle crypto ?</b> (obligatoire)</div>' + seg(COINS, pe.coin, 'data-pc') +
    (pe.coin === 'autre' ? '<input id="peAutre" placeholder="Laquelle ? (ex. LTC)" value="' + esc(pe.autre) + '">' : '');
  return h + '<div class="two" style="margin-top:8px"><button class="btn ghost sm" data-hx="1">Fermer</button><button class="btn ok sm" data-psave="' + c.id + '"' + (hx.busy ? ' disabled' : '') + '>' + (hx.busy ? '…' : 'Enregistrer') + '</button></div>';
}
function bindPayEdit(C, run) {
  const box = $('histo'); if (!box) return;
  box.querySelectorAll('[data-pm]').forEach((el) => { el.onclick = () => { pe.mode = el.dataset.pm; hx.err = ''; drawHisto(); }; });
  box.querySelectorAll('[data-pr]').forEach((el) => { el.onclick = () => { pe.reste = el.dataset.pr; drawHisto(); }; });
  box.querySelectorAll('[data-pc]').forEach((el) => { el.onclick = () => { pe.coin = el.dataset.pc; hx.err = ''; drawHisto(); }; });
  box.querySelectorAll('[data-prc]').forEach((el) => { el.onclick = () => { if ($('peCash')) pe.cash = $('peCash').value; pe.recu = el.dataset.prc === '1'; hx.err = ''; drawHisto(); }; });
  if ($('peAutre')) $('peAutre').oninput = (e) => { pe.autre = e.target.value; };
  if ($('peCash')) $('peCash').oninput = (e) => { pe.cash = e.target.value; const c = C(hx.edit); if (c && $('peRest')) $('peRest').textContent = money(Math.max(0, payTotal(c) - (Number(pe.cash) || 0))); if (c && $('peAmt')) $('peAmt').textContent = money(Math.max(0, payTotal(c) - (Number(pe.cash) || 0))); };
  box.querySelectorAll('[data-psave]').forEach((el) => { el.onclick = () => { const c = C(el.dataset.psave); if (!c) return;
    const tot = payTotal(c), cashPart = Math.round(Number(pe.cash) || 0);
    const recu = pe.mode === 'cash' || pe.recu !== false;
    const needC = pe.mode === 'cry' || (pe.mode === 'mix' && pe.reste === 'cry'), coin = needC && recu ? coinOf(pe.coin, pe.autre) : '';
    const needEnv = recu && (pe.mode === 'int' || (pe.mode === 'mix' && pe.reste === 'int')), env = String(($('peEnv') && $('peEnv').value) || pe.env || '').trim();
    if (needEnv && !env) { hx.err = 'Écris le nom de la personne qui a envoyé l’EMT.'; return drawHisto(); }
    if (needC && recu && !coin) { hx.err = 'Choisis la crypto (BTC, ETH…).'; return drawHisto(); }
    if (pe.mode === 'mix' && !(cashPart > 0 && cashPart < tot)) { hx.err = 'Écris la partie cash (entre 1 et ' + (tot - 1) + ' $).'; return drawHisto(); }
    const mode = pe.mode === 'mix' ? (pe.reste === 'cry' ? 'mixc' : 'mix') : pe.mode;
    const cash = mode === 'cash' ? Math.max(tot, Number(c.cashRecu) || 0) : mode === 'mix' || mode === 'mixc' ? cashPart : 0;
    const enc = mode === 'cash' ? tot : mode === 'mix' || mode === 'mixc' ? cashPart : 0;
    const pv = { total: tot, mode, cash: enc, interac: mode === 'int' ? tot : mode === 'mix' ? tot - cashPart : 0, cryPart: mode === 'cry' ? tot : mode === 'mixc' ? tot - cashPart : 0, crypto: coin || null };
    // v40 : si le livreur a PLUS de cash à remettre qu'avant, il doit confirmer qu'il l'a reçu.
    const ask = c.livreur && c.livreur !== myMid() && c.statut === 'livree' && (mode !== (c.paieMode || payOld(c)) || cash !== (Number(c.cashRecu) || 0)); // v42 : toujours l'accord du livreur
    run(async () => {
      const b = writeBatch(db), mod = Object.assign({ paieModPar: myMid(), paieModNom: me.nom || OWNER, paieModLe: serverTimestamp() }, needEnv ? { envoyePar: env.slice(0, 60) } : {}, ask ? {} : { nonRecu: !recu },
        !ask && recu && c.nonRecu && mode !== 'cash' ? { confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() } : {});
      if (ask) {
        b.update(doc(db, 'commandes', c.id), Object.assign({ chg: { paieMode: mode, cashRecu: cash, encaisser: enc, crypto: coin || null, avant: Number(c.cashRecu) || 0, nonRecu: !recu }, chgRep: null, aValider: true }, mod));
        b.set(doc(db, 'cmdPrive', c.id), { next: pv }, { merge: true });
      } else {
        b.update(doc(db, 'commandes', c.id), Object.assign({ paieMode: mode, cashRecu: cash, encaisser: enc, crypto: coin || null, chg: null, chgRep: null, aValider: false }, mod));
        b.set(doc(db, 'cmdPrive', c.id), Object.assign(pv, { next: null, recu }), { merge: true });
      }
      await b.commit(); if (!ask) detteSweep();
      if (ask) notifyMsg(c.livreur, '💳 ' + (me.nom || OWNER) + ' change le paiement de ' + c.client + ' : ' + payWord2(mode, cash) + '. Ouvre l’app pour dire si tu es d’accord.');
    });
  }; });
}

// =====================================================================
// v39 : le dispatch (Wayne, MOUSSE, lost en dispatch) change le paiement d'une commande en cours
// =====================================================================
// « 💳 Changer le paiement » dans la fiche : Cash / EMT / Crypto / Mélange (+ case « déjà reçu », crypto obligatoire si reçu).
// Le livreur voit tout de suite sa commande changer (bloquée si pas reçu) et reçoit une notification.
const lp = { id: null, mode: 'cash', cash: 0, rest: 'int', coin: null, autre: '', recu: false, err: '' };
function lpTotal(c) { const p = prive[c.id] || {}; return p.total || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0)); }
function lpBox(c) {
  const tot = lpTotal(c), seg = (list, cur, attr) => '<div class="seg" style="margin:4px 0">' + list.map((x) => '<button ' + attr + '="' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
  const needC = lp.mode === 'cry' || (lp.mode === 'mix' && lp.rest === 'cry');
  let h = '<div class="msgc" style="margin:8px 0;border:2px solid #f5b301"><div style="font-weight:800">Changer le paiement · total ' + money(tot) + '</div>' + seg([['cash', '🔵 Cash'], ['int', '🟡 EMT'], ['cry', '🟣 Crypto'], ['mix', 'Mélange']], lp.mode, 'data-lm');
  if (lp.mode === 'mix') h += '<div class="small" style="margin-top:6px">Partie cash ($)</div><input id="lpCash" type="number" inputmode="numeric" value="' + esc(lp.cash) + '"><div class="small">Le reste en :</div>' + seg([['int', '🟡 EMT'], ['cry', '🟣 Crypto']], lp.rest, 'data-lr');
  if (lp.mode !== 'cash') h += '<label class="chk"><input type="checkbox" id="lpRecu" ' + (lp.recu ? 'checked' : '') + '> ' + (needC ? 'Crypto' : 'EMT') + ' déjà reçu <span class="small">(sinon le livreur attend ta confirmation)</span></label>';
  if (needC && lp.recu) h += '<div class="small"><b style="color:var(--text)">Quelle crypto ?</b> (obligatoire)</div>' + seg(COINS, lp.coin, 'data-lc') + (lp.coin === 'autre' ? '<input id="lpAutre" placeholder="Laquelle ? (ex. LTC)" value="' + esc(lp.autre) + '">' : '');
  return h + '<div class="err">' + esc(lp.err) + '</div><div class="two"><button class="btn ghost" data-fa="lpX">Fermer</button><button class="btn ok" data-fa="lpGo">Enregistrer</button></div></div>';
}
function bindLp() {
  const v = $('focusView'); if (!v) return;
  v.querySelectorAll('[data-lm]').forEach((el) => { el.onclick = () => { lp.mode = el.dataset.lm; lp.err = ''; renderFocus(); }; });
  v.querySelectorAll('[data-lr]').forEach((el) => { el.onclick = () => { lp.rest = el.dataset.lr; renderFocus(); }; });
  v.querySelectorAll('[data-lc]').forEach((el) => { el.onclick = () => { lp.coin = el.dataset.lc; lp.err = ''; renderFocus(); }; });
  if ($('lpCash')) $('lpCash').oninput = (e) => { lp.cash = e.target.value; };
  if ($('lpAutre')) $('lpAutre').oninput = (e) => { lp.autre = e.target.value; };
  if ($('lpRecu')) $('lpRecu').onchange = (e) => { lp.recu = e.target.checked; renderFocus(); };
}
async function lpAct(c, a) {
  if (a === 'chpay') { const p = prive[c.id] || {}, m = p.mode || c.paieMode || 'cash';
    Object.assign(lp, { id: c.id, mode: m === 'mixc' ? 'mix' : m, cash: p.cash || Math.round(lpTotal(c) / 2), rest: m === 'mixc' ? 'cry' : 'int', coin: null, autre: '', recu: false, err: '' }); return renderFocus(); }
  if (a === 'lpX') { lp.id = null; return renderFocus(); }
  const tot = lpTotal(c), cashPart = Math.round(Number(lp.cash) || 0);
  const mode = lp.mode === 'mix' ? (lp.rest === 'cry' ? 'mixc' : 'mix') : lp.mode;
  const needC = mode === 'cry' || mode === 'mixc', recu = mode === 'cash' ? true : !!lp.recu;
  const coin = needC && recu ? coinOf(lp.coin, lp.autre) : '';
  if (needC && recu && !coin) { lp.err = 'Choisis la crypto (BTC, ETH…).'; return renderFocus(); }
  if ((mode === 'mix' || mode === 'mixc') && !(cashPart > 0 && cashPart < tot)) { lp.err = 'Écris la partie cash (entre 1 et ' + (tot - 1) + ' $).'; return renderFocus(); }
  const enc = mode === 'cash' ? tot : mode === 'mix' || mode === 'mixc' ? cashPart : 0;
  try {
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', c.id), Object.assign({ paieMode: mode, encaisser: enc, bloque: !recu, paye: recu && enc === 0, demandePaie: null, crypto: coin || null,
      paieModPar: myMid(), paieModNom: me.nom || OWNER, paieModLe: serverTimestamp() }, recu && mode !== 'cash' ? { confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() } : {}));
    b.set(doc(db, 'cmdPrive', c.id), { total: tot, mode, cash: enc, interac: mode === 'int' ? tot : mode === 'mix' ? tot - cashPart : 0, cryPart: mode === 'cry' ? tot : mode === 'mixc' ? tot - cashPart : 0, recu, crypto: coin || null }, { merge: true });
    await b.commit();
    if (c.livreur) notifyMsg(c.livreur, '💳 Paiement changé pour ' + c.client + ' : ' + (mode === 'cash' ? 'encaisse ' + tot + ' $ cash' : enc ? 'encaisse ' + enc + ' $ cash, le reste ' + (recu ? 'est déjà payé' : 'attend le dispatch') : recu ? 'déjà payé, rien à encaisser' : 'pas encore payé, attends le dispatch'));
    lp.id = null;
  } catch (e) { lp.err = msg(e); }
  renderFocus();
}


// =====================================================================
// v40 : « ➕ Ajouter une commande » dans l'Historique (Wayne + tous les dispatchs), à l'heure choisie.
//       Elle se place dans l'ordre (les numéros suivent). Le livreur doit TOUJOURS approuver avant
//       que ça compte (stock, trésorerie, paie). Et : un changement de paiement qui donne PLUS de cash
//       au livreur (EMT → cash…) doit être confirmé par lui.
// =====================================================================
const ad = { open: false, mid: null, client: '', L: 0, XL: 0, mode: 'cash', cash: '', rest: 'int', coin: null, autre: '', heure: '', date: '', err: '', busy: false };
const av = { list: [], busy: false, err: '' };
function addNote(c, nom, who) {
  const r = (t, col) => '<div class="small" style="text-align:right' + (col ? ';color:' + col : '') + '">' + t + '</div>';
  if (c.statut === 'ajout') return r('⏳ en attente de ' + nom + ' · pas encore comptée', '#fcd34d');
  if (c.statut === 'refusee') return r('❌ refusée par ' + nom);
  let h = '';
  if (c.chg) h += r('⏳ changement vers ' + payWord2(c.chg.paieMode, c.chg.cashRecu) + ' · ' + nom + ' doit être d’accord', '#fcd34d');
  if (c.vente) h += r('🛒 vente ajoutée par ' + nom);
  if (c.qtyAvant) h += r('✏️ quantité changée par ' + nom + ' (' + esc(qtyTxt(c.qtyAvant)) + ' → ' + esc(qtyTxt(c)) + ')');
  if (c.envoyePar) h += r('envoyé par <b style="color:var(--text)">' + esc(c.envoyePar) + '</b>'); // v47
  if (c.ajoutPar) h += r('➕ ajoutée par ' + esc(dispName(c.ajoutNom || '')) + (c.ajoutRep === 'ok' ? ' · ✓ approuvée par ' + nom : ''));
  if (c.paieModLe && !c.chg) h += r('✏️ paiement modifié par ' + esc(dispName(c.paieModNom || '')) + (c.chgRep === 'ok' ? ' · ✓ accepté par ' + nom : '') +
    (c.confirmeLe && c.paieModLe && tsMs(c.confirmeLe) > tsMs(c.paieModLe) && !c.nonRecu ? ' · ✓ confirmé par ' + esc(dispName(c.confirmeNom || '')) + ' à ' + hm(tsMs(c.confirmeLe)) : ''));
  if (c.chgRep === 'non' && !c.chg) h += r('❌ refusé par ' + nom + ' — paiement pas changé', '#f87171');
  if (!h && who) h = r('confirmé par ' + esc(who));
  return h;
}
function addMids() {
  return Object.keys(team).filter((id) => { const p = team[id]; return p && p.actif && (['livreur', 'limite'].includes(p.role) || p.livre || p.uber); })
    .sort((a, b) => nomDe(a).localeCompare(nomDe(b)));
}
function addTotal() { return (Number(ad.L) || 0) * cfg.prixL + (Number(ad.XL) || 0) * cfg.prixXL; }
function addHtml() {
  if (!isDispatcher()) return '';
  if (!ad.open) return '<button class="btn ghost" id="adOpen" style="margin-bottom:12px">➕ Ajouter une commande</button>';
  const seg = (list, cur, attr) => '<div class="seg" style="margin:4px 0;flex-wrap:wrap">' + list.map((x) => '<button ' + attr + '="' + esc(x[0]) + '" class="' + (cur === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>').join('') + '</div>';
  const tot = addTotal(), needC = ad.mode === 'cry' || (ad.mode === 'mix' && ad.rest === 'cry');
  let h = '<div class="card" style="border:2px solid #f5b301"><div style="font-weight:800;font-size:17px;margin-bottom:8px">➕ Ajouter une commande</div>' +
    '<div class="small">Livreur</div>' + seg(addMids().map((id) => [id, nomDe(id)]), ad.mid, 'data-amid') +
    '<div class="small" style="margin-top:6px">Client</div><input id="adClient" value="' + esc(ad.client) + '" placeholder="Nom du client" maxlength="60">' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><div class="small">L</div><input id="adL" type="number" inputmode="numeric" min="0" value="' + esc(ad.L) + '"></div><div style="flex:1"><div class="small">XL</div><input id="adXL" type="number" inputmode="numeric" min="0" value="' + esc(ad.XL) + '"></div></div>' +
    '<div class="small">Paiement · total <b id="adTot" style="color:var(--text)">' + money(tot) + '</b></div>' + seg([['cash', '🔵 Cash'], ['int', '🟡 EMT'], ['cry', '🟣 Crypto'], ['mix', 'Mélange']], ad.mode, 'data-amo');
  if (ad.mode === 'mix') h += '<div class="small" style="margin-top:6px">Partie cash ($)</div><input id="adCash" type="number" inputmode="numeric" value="' + esc(ad.cash) + '"><div class="small">Le reste en :</div>' + seg([['int', '🟡 EMT'], ['cry', '🟣 Crypto']], ad.rest, 'data-are');
  if (needC) h += '<div class="small" style="margin-top:6px"><b style="color:var(--text)">Quelle crypto ?</b> (obligatoire)</div>' + seg(COINS, ad.coin, 'data-aco') + (ad.coin === 'autre' ? '<input id="adAutre" placeholder="Laquelle ? (ex. LTC)" value="' + esc(ad.autre) + '">' : '');
  h += '<div style="display:flex;gap:8px;margin-top:6px"><div style="flex:1"><div class="small">Soirée du</div><input id="adDate" type="date" value="' + esc(ad.date) + '"></div><div style="flex:1"><div class="small"><b style="color:var(--text)">Heure de la livraison</b></div><input id="adHeure" type="time" value="' + esc(ad.heure) + '"></div></div>' +
    '<div class="small" style="line-height:1.5">Elle se place dans l’ordre selon l’heure (après minuit = même soirée). Le livreur doit approuver : ensuite le stock est enlevé, le cash va dans sa trésorerie et sa paie compte.</div>' +
    (ad.err ? '<div class="err">' + esc(ad.err) + '</div>' : '') +
    '<div class="two" style="margin-top:8px"><button class="btn ghost sm" id="adX">Fermer</button><button class="btn ok sm" id="adGo"' + (ad.busy ? ' disabled' : '') + '>' + (ad.busy ? '…' : 'Envoyer au livreur') + '</button></div></div>';
  return h;
}
function bindAdd() {
  const box = $('histo'); if (!box) return;
  const keep = () => { ['adClient', 'client', 'adL', 'L', 'adXL', 'XL', 'adCash', 'cash', 'adAutre', 'autre', 'adDate', 'date', 'adHeure', 'heure'].reduce((a, k, i, arr) => { if (i % 2 === 0 && $(k)) ad[arr[i + 1]] = $(k).value; return a; }, 0); };
  if ($('adOpen')) $('adOpen').onclick = () => { const [a] = histoRange(); const d = new Date(a.getTime() - a.getTimezoneOffset() * 60000);
    Object.assign(ad, { open: true, mid: ad.mid || hx.open || null, client: '', L: 0, XL: 0, mode: 'cash', cash: '', rest: 'int', coin: null, autre: '', heure: '', date: d.toISOString().slice(0, 10), err: '' }); drawHisto();
    setTimeout(() => { const el = $('adClient'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); };
  if (!ad.open) return;
  const re = (k, v) => { keep(); ad[k] = v; ad.err = ''; drawHisto(); };
  box.querySelectorAll('[data-amid]').forEach((el) => { el.onclick = () => re('mid', el.dataset.amid); });
  box.querySelectorAll('[data-amo]').forEach((el) => { el.onclick = () => re('mode', el.dataset.amo); });
  box.querySelectorAll('[data-are]').forEach((el) => { el.onclick = () => re('rest', el.dataset.are); });
  box.querySelectorAll('[data-aco]').forEach((el) => { el.onclick = () => re('coin', el.dataset.aco); });
  ['adL', 'adXL'].forEach((id) => { if ($(id)) $(id).oninput = () => { keep(); if ($('adTot')) $('adTot').textContent = money(addTotal()); }; });
  $('adX').onclick = () => { ad.open = false; drawHisto(); };
  $('adGo').onclick = async () => {
    keep();
    const L = Math.round(Number(ad.L) || 0), XL = Math.round(Number(ad.XL) || 0), tot = L * cfg.prixL + XL * cfg.prixXL, client = String(ad.client || '').trim();
    const fail = (t) => { ad.err = t; drawHisto(); };
    if (!ad.mid) return fail('Choisis le livreur.');
    if (!client) return fail('Écris le nom du client.');
    if (!(L >= 0 && XL >= 0 && L + XL > 0)) return fail('Mets au moins 1 L ou 1 XL.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ad.date || '') || !/^\d{1,2}:\d{2}$/.test(ad.heure || '')) return fail('Choisis la date et l’heure de la livraison.');
    const mode = ad.mode === 'mix' ? (ad.rest === 'cry' ? 'mixc' : 'mix') : ad.mode, needC = mode === 'cry' || mode === 'mixc';
    const coin = needC ? coinOf(ad.coin, ad.autre) : '';
    if (needC && !coin) return fail('Choisis la crypto (BTC, ETH…).');
    const cashPart = Math.round(Number(ad.cash) || 0);
    if ((mode === 'mix' || mode === 'mixc') && !(cashPart > 0 && cashPart < tot)) return fail('Écris la partie cash (entre 1 et ' + (tot - 1) + ' $).');
    const enc = mode === 'cash' ? tot : mode === 'mix' || mode === 'mixc' ? cashPart : 0;
    const [y, m, d] = ad.date.split('-').map(Number), [hh, mm] = ad.heure.split(':').map(Number);
    const when = new Date(y, m - 1, d, hh, mm); if (hh < 6) when.setDate(when.getDate() + 1); // après minuit = même soirée
    if (when.getTime() > Date.now() + 5 * 60000) return fail('L’heure est dans le futur.');
    const near = (hs.all || []).filter((c) => c.livreur === ad.mid && c.soiree).sort((a, b) => Math.abs(tsMs(a.livreeLe) - when) - Math.abs(tsMs(b.livreeLe) - when))[0];
    const sv = Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).find((x) => x.mid === ad.mid && working(x));
    const soiree = (near && near.soiree) || (sv && sv.id) || null, test = isTestName(client);
    ad.busy = true; ad.err = ''; drawHisto();
    try {
      const ref = doc(collection(db, 'commandes')), b = writeBatch(db);
      b.set(ref, { client: client.slice(0, 60), adresse: '', L, XL, frais: 0, encaisser: enc, paieMode: mode, crypto: coin || null, paye: enc === 0, bloque: false,
        livreur: ad.mid, livreurNom: nomDe(ad.mid), statut: 'ajout', livreeLe: when, soiree, cashRecu: 0, aValider: true, ajout: true,
        ajoutPar: myMid(), ajoutNom: me.nom || OWNER, ajoutLe: serverTimestamp(), creeLe: serverTimestamp(), ...(test ? { test: true } : {}) });
      b.set(doc(db, 'cmdPrive', ref.id), { total: tot, mode, cash: enc, interac: mode === 'int' ? tot : mode === 'mix' ? tot - cashPart : 0, cryPart: mode === 'cry' ? tot : mode === 'mixc' ? tot - cashPart : 0, recu: true, crypto: coin || null });
      await b.commit();
      notifyMsg(ad.mid, '➕ ' + (me.nom || OWNER) + ' ajoute une livraison : ' + client + ' · ' + qtyTxt({ L, XL }) + '. Ouvre l’app pour approuver.');
      ad.open = false; ad.busy = false; hx.open = ad.mid; await loadHisto();
    } catch (e) { ad.busy = false; fail(msg(e)); }
  };
}
// Retirer une commande ajoutée qui attend encore (ou refusée)
document.addEventListener('click', async (e) => {
  const el = e.target.closest && e.target.closest('[data-adel]'); if (!el || !isDispatcher()) return;
  const c = (hs.all || []).find((x) => x.id === el.dataset.adel); if (!c || !(c.statut === 'ajout' || c.statut === 'refusee')) return;
  el.disabled = true;
  try { const b = writeBatch(db); b.delete(doc(db, 'commandes', c.id)); b.delete(doc(db, 'cmdPrive', c.id)); await b.commit(); await loadHisto(); } catch (err) { el.disabled = false; hx.err = msg(err); drawHisto(); }
});

// ----- Côté livreur : la fenêtre « Tu l'as livrée ? » / « As-tu reçu le cash ? » -----
function drawVal() {
  let ov = $('valOv');
  const c = av.list[0];
  if (!c) { if (ov) ov.remove(); return; }
  if (!ov) { ov = document.createElement('div'); ov.id = 'valOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;z-index:60'; document.body.appendChild(ov); }
  const box = (t, body, q, okT, noT) => '<div style="background:#17171b;border:1px solid #4b5563;border-radius:20px;padding:18px;width:100%;max-width:420px">' +
    '<div style="font-size:18px;font-weight:800;margin-bottom:10px">' + t + '</div>' + body + '<div style="font-weight:800;margin:10px 0 6px">' + q + '</div>' +
    (av.err ? '<div class="err">' + esc(av.err) + '</div>' : '') +
    '<button class="btn ok" id="valOk"' + (av.busy ? ' disabled' : '') + '>' + okT + '</button><button class="btn ghost" id="valNo" style="margin-top:8px;border-color:#ff5a5f;color:#ff5a5f"' + (av.busy ? ' disabled' : '') + '>' + noT + '</button>' +
    (av.list.length > 1 ? '<div class="small" style="margin-top:8px;text-align:center">' + (av.list.length - 1) + ' autre(s) après</div>' : '') + '</div>';
  const t = new Date(tsMs(c.livreeLe)), jour = t.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  const ban = (x) => '<div style="background:#3a2a0e;color:#fcd34d;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5;margin-top:10px">' + x + '</div>';
  if (c.statut === 'ajout') {
    const enc = Number(c.encaisser) || 0;
    ov.innerHTML = box('➕ Livraison ajoutée',
      '<div style="font-size:15px;line-height:1.6">' + esc(dispName(c.ajoutNom || '')) + ' ajoute une livraison que tu aurais faite :<br><b>' + esc(c.client) + ' · ' + esc(qtyTxt(c)) + '</b><br>' +
      (enc ? '<span style="color:' + PCOL.cash + '">🔵 ' + money(enc) + ' cash</span>' + (c.paieMode !== 'cash' ? ' <span class="small">(le reste déjà payé)</span>' : '') : '<span style="color:' + PCOL.int + '">déjà payé (rien en cash)</span>') +
      '<br><span class="small">vers ' + hm(t.getTime()) + ', ' + esc(jour) + '</span></div>' +
      ban('Si tu dis oui : ' + esc(qtyTxt(c)) + ' enlevé de ton stock' + (enc ? ' et ' + money(enc) + ' ajouté à ta trésorerie' : '') + '.'),
      'Tu l’as livrée ?', '✓ Oui, je l’ai livrée', '✗ Non');
  } else if (c.chg) {
    const plus = (Number(c.chg.cashRecu) || 0) - (Number(c.cashRecu) || 0);
    ov.innerHTML = box('💳 Changement de paiement',
      '<div style="font-size:15px;line-height:1.6">' + esc(dispName(c.paieModNom || '')) + ' change le paiement de <b>' + esc(c.client) + '</b> (' + esc(qtyTxt(c)) + ', ' + hm(t.getTime()) + ') :<br>' +
      payWord2(c.paieMode || payOld(c), Number(c.cashRecu) || 0) + ' → <b>' + payWord2(c.chg.paieMode, c.chg.cashRecu) + '</b></div>' +
      ban(plus > 0 ? 'Si tu dis oui, ' + money(plus) + ' s’ajoutent à ce que tu dois remettre.' : plus < 0 ? 'Si tu dis oui : ' + money(-plus) + ' de moins à remettre.' : 'Ce que tu dois remettre ne change pas.'),
      plus > 0 ? 'As-tu reçu ' + money(c.chg.cashRecu) + ' cash de ' + esc(c.client) + ' ?' : 'Tu es d’accord ?', plus > 0 ? '✓ Oui, j’ai reçu le cash' : '✓ Oui, d’accord', '✗ Non');
  } else { ov.remove(); return; }
  $('valOk').onclick = () => valAct(c, true);
  $('valNo').onclick = () => valAct(c, false);
}
async function valAct(c, oui) {
  if (av.busy) return; av.busy = true; av.err = ''; drawVal();
  try {
    const b = writeBatch(db), ref = doc(db, 'commandes', c.id);
    if (c.statut === 'ajout') {
      if (oui) {
        b.update(ref, { statut: 'livree', cashRecu: Number(c.encaisser) || 0, aValider: false, ajoutRep: 'ok', ajoutRepLe: serverTimestamp(), ...(paies[me.mid] != null && !c.test ? { paie: paies[me.mid] } : {}) });
        if (!c.test) {
          b.set(doc(db, 'stocks', me.mid), { L: increment(-(c.L || 0)), XL: increment(-(c.XL || 0)), cmd: c.id }, { merge: true });
          if (mySoiree && c.soiree === mySoiree.id && mySoiree.statut === 'ouverte') b.update(doc(db, 'soirees', mySoiree.id), { livrees: increment(1) });
        }
      } else b.update(ref, { statut: 'refusee', aValider: false, ajoutRep: 'non', ajoutRepLe: serverTimestamp() });
      await b.commit();
      notifyDispatch((oui ? '✓ ' : '❌ ') + me.nom + (oui ? ' a approuvé' : ' a refusé') + ' la livraison ajoutée : ' + c.client + ' · ' + qtyTxt(c));
    } else if (c.chg) {
      if (oui) b.update(ref, { paieMode: c.chg.paieMode, cashRecu: c.chg.cashRecu, encaisser: c.chg.encaisser, crypto: c.chg.crypto || null, nonRecu: !!c.chg.nonRecu, chg: null, chgRep: 'ok', chgRepLe: serverTimestamp(), aValider: false });
      else b.update(ref, { chg: null, chgRep: 'non', chgRepLe: serverTimestamp(), aValider: false });
      await b.commit();
      notifyDispatch((oui ? '✓ ' : '❌ ') + me.nom + (oui ? ' accepte' : ' refuse') + ' le changement de paiement de ' + c.client + ' (' + payWord2(c.chg.paieMode, c.chg.cashRecu) + ')');
    }
    av.busy = false; av.list = av.list.filter((x) => x.id !== c.id); drawVal();
  } catch (e) { av.busy = false; av.err = msg(e); drawVal(); }
}


// =====================================================================
// v41 : Historique — « ⏳ Pas encore reçu » pour l'EMT / la crypto d'une livraison déjà faite.
//       La livraison montre 🔴 X $ pas reçu (pas compté dans les totaux) ; carte rouge « À confirmer »
//       en haut de l'Historique + 🔴 sur l'onglet ; Wayne, MOUSSE ou lost (dispatch) touchent « ✓ reçu ».
// =====================================================================
const nr = { list: [], prv: {}, pick: null, busy: null, nom: '', err: '' };
document.addEventListener('input', (e) => { if (e.target && e.target.dataset && e.target.dataset.nrnom) nr.nom = e.target.value; if (e.target && e.target.id === 'peEnv') pe.env = e.target.value; });
function nrAmt(c) { const p = nr.prv[c.id] || (hs.prv && hs.prv[c.id]) || {}; const tot = p.total || ((c.L || 0) * cfg.prixL + (c.XL || 0) * cfg.prixXL + (c.frais || 0)); return Math.max(0, tot - (Number(c.encaisser) || 0)); }
function nrKind(c) { const m = c.paieMode || (nr.prv[c.id] || {}).mode; return m === 'cry' || m === 'mixc' ? 'cry' : 'int'; }
function nrPrv() { nr.list.forEach((c) => { if (!nr.prv[c.id]) getDoc(doc(db, 'cmdPrive', c.id)).then((d) => { if (d.exists()) { nr.prv[c.id] = d.data(); if (curTab === 'histo') drawHisto(); } }).catch(() => {}); }); }
function nrBadge() { const tb = document.querySelector('#tabs button[data-t="histo"]'); if (tb) tb.textContent = 'Historique' + (nr.list.length && isDispatcher() ? ' 🔴' + nr.list.length : ''); }
function nrBtn(c) {
  if (!isDispatcher()) return '';
  const k = nrKind(c);
  if (nr.pick === c.id && k !== 'cry') return '<div data-nrbox="' + c.id + '" style="margin-top:8px;background:var(--card2);border-radius:12px;padding:10px"><div class="small"><b style="color:var(--text)">Envoyé par</b> (nom sur le virement, obligatoire)</div>' + // v47
    '<input data-nrnom="' + c.id + '" placeholder="Ex. Marc Tremblay" maxlength="60" value="' + esc(nr.nom || '') + '" style="margin:6px 0">' + (nr.err ? '<div class="err">' + esc(nr.err) + '</div>' : '') +
    '<div class="two"><button class="btn ghost sm" data-nrx="1">Annuler</button><button class="btn ok sm" data-nrgo="' + c.id + '">Confirmer</button></div></div>';
  if (nr.pick === c.id) return '<div style="margin-top:6px"><div class="small"><b style="color:var(--text)">Quelle crypto ?</b></div><div class="seg" style="flex-wrap:wrap">' + COINS.filter((x) => x[0] !== 'autre').map((x) => '<button data-nrc="' + c.id + '|' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>';
  return '<div style="text-align:right;margin-top:6px"><button class="btn ok sm" style="width:auto;padding:8px 12px;margin:0" data-nrok="' + c.id + '"' + (nr.busy === c.id ? ' disabled' : '') + '>' + (nr.busy === c.id ? '…' : '✓ ' + (k === 'cry' ? 'Crypto' : 'EMT') + ' reçu') + '</button></div>';
}
function nrHtml() {
  if (!isDispatcher() || !nr.list.length) return '';
  return '<div class="card" style="background:#3a1517;border-color:#7f1d1d"><div style="color:#fca5a5;font-weight:800;margin-bottom:6px">🔴 À confirmer · ' + nr.list.length + '</div>' +
    nr.list.map((c) => { const t = new Date(tsMs(c.livreeLe)); return '<div style="padding:8px 0;border-top:1px solid #7f1d1d"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="font-size:14px">' + esc(c.client) + ' · ' + esc(c.livreurNom || nomDe(c.livreur)) +
      '<div class="small">' + t.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' }) + ' ' + hm(t.getTime()) + '</div><span style="color:#f87171">' + money(nrAmt(c)) + ' ' + (nrKind(c) === 'cry' ? 'crypto' : 'EMT') + ' pas reçu</span></div></div>' + nrBtn(c) + '</div>'; }).join('') + '</div>';
}
async function nrConfirm(id, coin, nom) {
  const c = nr.list.find((x) => x.id === id) || (hs.all || []).find((x) => x.id === id); if (!c || nr.busy) return;
  if (nrKind(c) === 'cry' && !coin) { nr.pick = id; return drawHisto(); }
  if (nrKind(c) !== 'cry') { nom = String(nom || '').trim(); if (!nom) { if (nr.pick === id) nr.err = 'Écris le nom de la personne qui a envoyé.'; else { nr.pick = id; nr.err = ''; nr.nom = ''; } return drawHisto(); } }
  nr.err = ''; nr.nom = '';
  nr.busy = id; nr.pick = null; drawHisto();
  try {
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', id), Object.assign({ nonRecu: false, confirmePar: myMid(), confirmeNom: me.nom || OWNER, confirmeLe: serverTimestamp() }, coin ? { crypto: coin } : {}, nom ? { envoyePar: nom.slice(0, 60) } : {}));
    b.set(doc(db, 'cmdPrive', id), Object.assign({ recu: true }, coin ? { crypto: coin } : {}), { merge: true });
    await b.commit();
    detteSweep();
    nr.busy = null; if (hs.text != null) await loadHisto(); else drawHisto();
  } catch (e) { nr.busy = null; hx.err = msg(e); drawHisto(); }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('[data-nrok]'); if (a) { nrConfirm(a.dataset.nrok); return; }
  const g = e.target.closest && e.target.closest('[data-nrgo]'); if (g) { const box = g.closest('[data-nrbox]'), inp = box && box.querySelector('input'); nrConfirm(g.dataset.nrgo, null, inp ? inp.value : ''); return; }
  if (e.target.closest && e.target.closest('[data-nrx]')) { nr.pick = null; nr.err = ''; nr.nom = ''; drawHisto(); return; }
  const b = e.target.closest && e.target.closest('[data-nrc]'); if (b) { const [id, coin] = b.dataset.nrc.split('|'); nrConfirm(id, coin); }
});


// =====================================================================
// v42 : (A) le livreur change la quantité à la porte (le prix se recalcule ; le dispatch est averti au milieu
//       de l'écran, « OK, compris ») · (B) le livreur ajoute une vente lui-même (passe tout de suite ; EMT /
//       crypto = 🔴 pas encore reçu, à confirmer) · (C) tout changement de paiement dans l'Historique = accord du livreur.
// =====================================================================
const qv = { L: 0, XL: 0, err: '', busy: false };
const vt = { open: false, client: '', L: 0, XL: 0, mode: 'cash', cash: '', recu: '', err: '', busy: false };
const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
function payOld(c) { const e = Number(c.encaisser) || 0; return e > 0 ? 'cash' : 'int'; }
function payWord2(mode, cash) {
  const cs = '🔵 ' + money(Number(cash) || 0) + ' cash';
  return mode === 'cash' ? cs : mode === 'int' ? '🟡 EMT' : mode === 'cry' ? '🟣 crypto' : mode === 'mixc' ? cs + ' + 🟣 crypto' : cs + ' + 🟡 EMT';
}
function qtyPanel(c) {
  const d = (qv.L - (c.L || 0)) * cfg.prixL + (qv.XL - (c.XL || 0)) * cfg.prixXL, enc = (Number(c.encaisser) || 0) + d, mine = st(me.mid);
  const step = (k) => '<div style="flex:1;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:8px;text-align:center"><div class="small">' + k + '</div><div style="font-size:26px;font-weight:900">' + qv[k] + '</div>' +
    '<button class="btn ghost sm" style="width:42px;display:inline-block;margin:4px 2px 0;padding:6px" data-qd="' + k + '|-1">−</button><button class="btn ghost sm" style="width:42px;display:inline-block;margin:4px 2px 0;padding:6px" data-qd="' + k + '|1">+</button></div>';
  return '<div class="msgc" style="margin-bottom:8px;border:2px solid #f5b301"><div style="font-weight:800;margin-bottom:6px">✏️ Le client en veut combien ?</div><div style="display:flex;gap:8px">' + step('L') + step('XL') + '</div>' +
    '<div style="margin-top:8px">' + (d ? (d > 0 ? '+' : '−') + money(Math.abs(d)) + ' · à encaisser : <b>' + money(Math.max(0, enc)) + ' cash</b>' : 'Pas de changement') + '</div>' +
    '<div class="small">Ton stock : ' + esc(qty(mine)) + '</div>' + (qv.err ? '<div class="err">' + esc(qv.err) + '</div>' : '') +
    '<div class="two"><button class="btn ghost sm" data-lp="x">Annuler</button><button class="btn ok sm" id="lvQGo"' + (qv.busy ? ' disabled' : '') + '>' + (qv.busy ? '…' : 'Confirmer') + '</button></div></div>';
}
function bindQty(c) {
  document.querySelectorAll('#soiree [data-qd]').forEach((b) => { b.onclick = () => { const [k, d] = b.dataset.qd.split('|'); qv[k] = Math.max(0, qv[k] + Number(d)); qv.err = ''; renderSoiree(); }; });
  if (!$('lvQGo')) return;
  $('lvQGo').onclick = async () => {
    const L = qv.L, XL = qv.XL, dL = L - (c.L || 0), dXL = XL - (c.XL || 0), d = dL * cfg.prixL + dXL * cfg.prixXL, enc = (Number(c.encaisser) || 0) + d;
    if (!dL && !dXL) { lv.panel = null; return renderSoiree(); }
    if (L + XL <= 0) { qv.err = 'Mets au moins 1 L ou 1 XL (sinon : ⋯ Autre → Je ne peux pas livrer).'; return renderSoiree(); }
    if (enc < 0) { qv.err = 'Le client a déjà payé plus que ça : écris au dispatch.'; return renderSoiree(); }
    const mine = st(me.mid), needL = myCmds.reduce((a, x) => a + (x.id === c.id ? L : (x.L || 0)), 0), needXL = myCmds.reduce((a, x) => a + (x.id === c.id ? XL : (x.XL || 0)), 0);
    if (!c.test && (needL > (mine.L || 0) || needXL > (mine.XL || 0))) { qv.err = 'Pas assez de stock sur toi (' + qty(mine) + ').'; return renderSoiree(); }
    const pm = c.paieMode || payOld(c), nm = d > 0 && pm === 'int' ? 'mix' : d > 0 && pm === 'cry' ? 'mixc' : pm;
    qv.busy = true; renderSoiree();
    try {
      await writeBatch(db).update(doc(db, 'commandes', c.id), Object.assign({ L, XL, encaisser: enc, qtyDelta: (c.qtyDelta || 0) + d, qtyAvant: c.qtyAvant || { L: c.L || 0, XL: c.XL || 0 }, qtyLe: serverTimestamp() },
        c.paieMode && nm !== c.paieMode ? { paieMode: nm } : {}, enc > 0 && c.paye ? { paye: false } : {})).commit();
      notifyDispatch('✏️ ' + me.nom + ' chez ' + c.client + ' : ' + qtyTxt({ L, XL }) + ' au lieu de ' + qtyTxt(c) + ' · à encaisser ' + money(enc) + ' cash');
      qv.busy = false; lv.panel = null;
    } catch (e) { qv.busy = false; qv.err = msg(e); }
    renderSoiree();
  };
}
// Le dispatch : garder le total privé à jour + message au milieu de l'écran
function qtySync() {
  // v52 : le client a tout payé en cash à la porte → le total privé suit
  Object.values(cmds).forEach((c) => {
    if (!c.porteLe || !(isOwner() || isStaff())) return;
    const ms = tsMs(c.porteLe), p = prive[c.id];
    if (p && p.porteMs !== ms) { setDoc(doc(db, 'cmdPrive', c.id), { mode: 'cash', cash: c.encaisser || 0, interac: 0, total: c.encaisser || 0, recu: true, porteMs: ms }, { merge: true }).catch(() => {}); p.porteMs = ms; }
  });
  Object.values(cmds).forEach((c) => {
    if (!c.qtyLe) return;
    const ms = tsMs(c.qtyLe), p = prive[c.id];
    if (p && p.qtyMs !== ms && (isOwner() || isStaff())) {
      const t0 = p.total0 != null ? p.total0 : (p.total || 0);
      setDoc(doc(db, 'cmdPrive', c.id), { total0: t0, total: t0 + (c.qtyDelta || 0), cash: c.encaisser || 0, mode: c.paieMode || p.mode, qtyMs: ms }, { merge: true }).catch(() => {});
      p.qtyMs = ms;
    }
    if (!c.qtyPorte) popAdd('q' + c.id + ms, ms, '✏️ Quantité changée', '<b>' + esc(nomDe(c.livreur)) + '</b> chez <b>' + esc(c.client) + '</b> :<br>le client prend <b>' + esc(qtyTxt(c)) + '</b> au lieu de ' + esc(qtyTxt(c.qtyAvant || {})) + '.<br>À encaisser : <b style="color:' + PCOL.cash + '">' + money(c.encaisser || 0) + ' cash</b>');
  });
}
function ventePop(c) {
  const ms = tsMs(c.livreeLe);
  const q = payOf(c), pw = c.paieMode === 'cash' ? '<span style="color:' + PCOL.cash + '">🔵 ' + money(c.cashRecu || 0) + ' cash</span>' : payHtml(q);
  popAdd('v' + c.id, ms, '🛒 Vente ajoutée', '<b>' + esc(c.livreurNom || nomDe(c.livreur)) + '</b> a fait une vente :<br><b>' + esc(c.client) + ' · ' + esc(qtyTxt(c)) + '</b> · ' + pw +
    (c.nonRecu ? '<div class="small" style="color:#fca5a5;margin-top:6px">À confirmer dans l’Historique quand c’est reçu.</div>' : ''));
}
const pops = { list: [] };
function popSeen() { try { return JSON.parse(localStorage.getItem('gothamVu') || '[]'); } catch (e) { return []; } }
function popAdd(key, ms, title, body) {
  if (!isDispatcher() || Date.now() - ms > 30 * 60000) return;
  if (popSeen().includes(key) || pops.list.some((x) => x.key === key)) return;
  pops.list.push({ key, title, body }); drawAvis();
}
function drawAvis() {
  let ov = $('avisOv'); const x = pops.list[0];
  if (!x) { if (ov) ov.remove(); return; }
  if (!ov) { ov = document.createElement('div'); ov.id = 'avisOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;z-index:59'; document.body.appendChild(ov); }
  ov.innerHTML = '<div style="background:#17171b;border:1px solid #4b5563;border-radius:20px;padding:18px;width:100%;max-width:420px"><div style="font-size:18px;font-weight:800;margin-bottom:10px">' + x.title + '</div><div style="font-size:15px;line-height:1.6">' + x.body + '</div>' +
    '<button class="btn ok" id="avisOk" style="margin-top:12px">OK, compris</button>' + (pops.list.length > 1 ? '<div class="small" style="margin-top:8px;text-align:center">' + (pops.list.length - 1) + ' autre(s) après</div>' : '') + '</div>';
  $('avisOk').onclick = () => { const a = popSeen(); a.push(x.key); try { localStorage.setItem('gothamVu', JSON.stringify(a.slice(-300))); } catch (e) {} pops.list.shift(); drawAvis(); };
}
// (B) Vente faite par le livreur
function venteHtml(s) {
  if (!s || s.statut !== 'ouverte' || me.uber) return '';
  if (!vt.open) return '<button class="btn ghost" id="vtOpen" style="margin-top:4px">➕ Ajouter une vente</button>';
  const tot = (Number(vt.L) || 0) * cfg.prixL + (Number(vt.XL) || 0) * cfg.prixXL, seg = (list, cur, attr) => '<div class="seg" style="margin:4px 0">' + list.map((x) => '<button ' + attr + '="' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
  return '<div class="card" style="border:2px solid #f5b301"><div style="font-weight:800;font-size:16px;margin-bottom:8px">➕ Ajouter une vente</div>' +
    '<div class="small">Client</div><input id="vtClient" value="' + esc(vt.client) + '" placeholder="Nom du client" maxlength="60">' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><div class="small">L</div><input id="vtL" type="number" inputmode="numeric" min="0" value="' + esc(vt.L) + '"></div><div style="flex:1"><div class="small">XL</div><input id="vtXL" type="number" inputmode="numeric" min="0" value="' + esc(vt.XL) + '"></div></div>' +
    '<div class="small">Paiement · total <b id="vtTot" style="color:var(--text)">' + money(tot) + '</b></div>' + seg([['cash', '🔵 Cash'], ['int', '🟡 EMT'], ['cry', '🟣 Crypto'], ['mix', 'Mélange']], vt.mode, 'data-vm') +
    (vt.mode === 'cash' ? '<div class="small">Cash reçu (laisse vide = le total)</div><input id="vtRecu" type="number" inputmode="numeric" value="' + esc(vt.recu) + '" placeholder="' + tot + '">'
      : vt.mode === 'mix' ? '<div class="small">Partie cash reçue ($) — le reste en EMT</div><input id="vtCash" type="number" inputmode="numeric" value="' + esc(vt.cash) + '">' : '') +
    (vt.mode !== 'cash' ? '<div class="small" style="color:#fca5a5;line-height:1.5">Le dispatch confirmera ' + (vt.mode === 'cry' ? 'la crypto' : 'l’EMT') + ' (🔴 pas encore reçu en attendant).</div>' : '') +
    (vt.err ? '<div class="err">' + esc(vt.err) + '</div>' : '') +
    '<div class="two" style="margin-top:8px"><button class="btn ghost sm" id="vtX">Fermer</button><button class="btn ok sm" id="vtGo"' + (vt.busy ? ' disabled' : '') + '>' + (vt.busy ? '…' : 'Enregistrer la vente') + '</button></div></div>';
}
function vtKeep() { [['vtClient', 'client'], ['vtL', 'L'], ['vtXL', 'XL'], ['vtCash', 'cash'], ['vtRecu', 'recu']].forEach(([id, k]) => { if ($(id)) vt[k] = $(id).value; }); }
document.addEventListener('click', async (e) => {
  const t = e.target.closest && e.target.closest('#vtOpen,#vtX,#vtGo,[data-vm]'); if (!t || !me) return;
  if (t.id === 'vtOpen') { Object.assign(vt, { open: true, client: '', L: 0, XL: 0, mode: 'cash', cash: '', recu: '', err: '' }); return renderSoiree(); }
  if (t.id === 'vtX') { vt.open = false; return renderSoiree(); }
  vtKeep();
  if (t.dataset.vm) { vt.mode = t.dataset.vm; vt.err = ''; return renderSoiree(); }
  // Enregistrer
  const s = mySoiree, L = Math.round(Number(vt.L) || 0), XL = Math.round(Number(vt.XL) || 0), tot = L * cfg.prixL + XL * cfg.prixXL, client = String(vt.client || '').trim();
  const fail = (x) => { vt.err = x; renderSoiree(); };
  if (!s || s.statut !== 'ouverte') return fail('Ta soirée doit être ouverte.');
  if (!client) return fail('Écris le nom du client.');
  if (!(L >= 0 && XL >= 0 && L + XL > 0)) return fail('Mets au moins 1 L ou 1 XL.');
  const test = isTestName(client), mine = st(me.mid), qL = myCmds.reduce((a, x) => a + (x.L || 0), 0), qXL = myCmds.reduce((a, x) => a + (x.XL || 0), 0);
  if (!test && (L + qL > (mine.L || 0) || XL + qXL > (mine.XL || 0))) return fail('Pas assez de stock sur toi (' + qty(mine) + (qL + qXL ? ', avec ta file' : '') + ').');
  const mode = vt.mode, cashPart = Math.round(Number(vt.cash) || 0);
  if (mode === 'mix' && !(cashPart > 0 && cashPart < tot)) return fail('Écris la partie cash (entre 1 et ' + (tot - 1) + ' $).');
  const enc = mode === 'cash' ? tot : mode === 'mix' ? cashPart : 0;
  const recu = mode === 'cash' ? (String(vt.recu).trim() === '' ? tot : Math.max(0, Math.round(Number(vt.recu) || 0))) : enc;
  vt.busy = true; vt.err = ''; renderSoiree();
  try {
    const ref = doc(collection(db, 'commandes')), b = writeBatch(db);
    b.set(ref, Object.assign({ client: client.slice(0, 60), adresse: '', L, XL, frais: 0, encaisser: enc, paieMode: mode, crypto: null, paye: enc === 0, bloque: false,
      livreur: me.mid, livreurNom: me.nom, statut: 'livree', livreeLe: serverTimestamp(), creeLe: serverTimestamp(), cashRecu: recu, soiree: s.id, vente: true, venteJour: dayKey(soirStart()),
      nonRecu: mode !== 'cash' }, test ? { test: true } : paies[me.mid] != null ? { paie: paies[me.mid] } : {}));
    if (!test) {
      b.set(doc(db, 'stocks', me.mid), { L: increment(-L), XL: increment(-XL), cmd: ref.id }, { merge: true });
      b.update(doc(db, 'soirees', s.id), { livrees: increment(1) });
    }
    await b.commit();
    notifyDispatch('🛒 ' + me.nom + ' a fait une vente : ' + client + ' · ' + qtyTxt({ L, XL }) + ' · ' + (mode === 'cash' ? recu + ' $ cash' : mode === 'mix' ? enc + ' $ cash + EMT (à confirmer)' : mode === 'cry' ? 'crypto (à confirmer)' : 'EMT (à confirmer)'));
    vt.open = false; vt.busy = false; renderSoiree();
  } catch (err) { vt.busy = false; fail(msg(err)); }
});
document.addEventListener('input', (e) => { if (e.target && (e.target.id === 'vtL' || e.target.id === 'vtXL')) { vtKeep(); const el = $('vtTot'); if (el) el.textContent = money((Number(vt.L) || 0) * cfg.prixL + (Number(vt.XL) || 0) * cfg.prixXL); } });


// =====================================================================
// v44 : 💵 Cash — le solde de chacun continue d'un jour à l'autre (à partir de la soirée du 18 nov. 2026).
//       Solde = (cash encaissé − paie − frais − pourboires) − cash donné + cash reçu (remises « reçu ✓ »).
//       Onglet « 💵 Cash » (Wayne + dispatchs) : total pas encore rendu à Wayne, un solde par personne, journal jour par jour.
// =====================================================================
const CASH_START = new Date(2026, 10, 18, 6, 0, 0);
const cs = { busy: false, data: null, sel: null, err: '' };
const soirOf = (ms) => { const d = new Date(ms); if (d.getHours() < 6) d.setDate(d.getDate() - 1); d.setHours(6, 0, 0, 0); return d; };
async function soldeMoi() {
  const mid = me.mid, d0 = CASH_START, t0 = soirStart(), list = [];
  const qs = await getDocs(query(collection(db, 'commandes'), where('livreur', '==', mid), where('statut', '==', 'livree')));
  qs.forEach((x) => { const c = x.data(); if (tsMs(c.livreeLe) >= d0.getTime()) list.push(c); });
  const all = (sumUp(list)[0] || { reste: 0 }).reste, tonight = (sumUp(list.filter((c) => tsMs(c.livreeLe) >= t0.getTime()))[0] || { reste: 0 }).reste;
  let out = 0, outT = 0, inn = 0, innT = 0;
  const rs = await getDocs(query(collection(db, 'remises'), where('de', '==', mid)));
  rs.forEach((x) => { const r = x.data(), t = tsMs(r.le); if (r.statut !== 'recue' || t < d0.getTime()) return; out += r.montant || 0; if (t >= t0.getTime()) outT += r.montant || 0; });
  { // v54 : aussi pour le livreur (le dispatch lui rend l'argent qu'il a donné en trop)
    const rv = await getDocs(query(collection(db, 'remises'), where('vers', '==', mid)));
    rv.forEach((x) => { const r = x.data(), t = tsMs(r.le); if (r.statut !== 'recue' || t < d0.getTime()) return; inn += r.montant || 0; if (t >= t0.getTime()) innT += r.montant || 0; });
  }
  try { const dq = await getDocs(query(collection(db, 'dettes'), where('responsable', '==', mid))); // dette réglée en cash = cash à remettre
    dq.forEach((x) => { const r = x.data(), t = tsMs(r.regleLe); if (r.statut !== 'reglee' || r.regleMode !== 'cash' || t < d0.getTime()) return; inn += r.montant || 0; if (t >= t0.getTime()) innT += r.montant || 0; }); } catch (e) {}
  const tot = all - out + inn, ceSoir = tonight - outT + innT;
  return { tot, ceSoir, avant: tot - ceSoir };
}
async function loadCash() {
  const box = $('cashTab'); if (!box || !(isOwner() || isStaff())) return;
  cs.busy = true; drawCash();
  try {
    const far = new Date(Date.now() + 2 * 86400000);
    const [cm, rems] = await Promise.all([rangeDocs('commandes', 'livreeLe', CASH_START, far), rangeDocs('remises', 'le', CASH_START, far)]);
    let dts = []; if (canDette()) { try { const q = await getDocs(collection(db, 'dettes')); q.forEach((x) => dts.push(Object.assign({ id: x.id }, x.data()))); } catch (e) {} }
    const P = {};
    const per = (id, nom) => P[id] || (P[id] = { id, nom: nom || nomDe(id), solde: 0, dette: 0, days: {} });
    const day = (p, ms) => { const k = soirOf(ms).getTime(); return p.days[k] || (p.days[k] = { k, n: 0, cash: 0, garde: 0, lines: [] }); };
    cm.filter((c) => c.statut === 'livree' && !c.test && c.livreur).forEach((c) => {
      const p = per(c.livreur, c.livreurNom), d = day(p, tsMs(c.livreeLe)), r = sumUp([c])[0]; if (!r) return;
      d.n += 1; d.cash += r.cash; d.garde += r.cash - r.reste; p.solde += r.reste;
    });
    rems.forEach((r) => {
      const t = tsMs(r.le), ok = r.statut === 'recue', att = r.statut === 'attente';
      if (!ok && !att) return;
      if (r.de && r.de !== 'proprietaire') { const p = per(r.de, r.deNom); day(p, t).lines.push({ t, txt: '→ ' + (r.versNom || nomDe(r.vers)), m: -(r.montant || 0), ok, att }); if (ok) p.solde -= r.montant || 0; }
      if (r.vers && r.vers !== 'proprietaire') { const p = per(r.vers, r.versNom); day(p, t).lines.push({ t, txt: 'Reçu de ' + (r.deNom || nomDe(r.de)), m: r.montant || 0, ok, att }); if (ok) p.solde += r.montant || 0; }
    });
    // Dettes : ouvertes = notées à part (pas encore de cash) ; réglées en cash = le cash s'ajoute au solde du responsable.
    dts.forEach((x) => {
      const rid = x.responsable; if (!rid || rid === 'dispatch' || rid === 'proprietaire') return;
      if (x.statut === 'ouverte') { const p = per(rid); p.dette += x.montant || 0; day(p, tsMs(x.creeLe)).lines.push({ t: tsMs(x.creeLe), txt: '📒 Dette ouverte · ' + (x.client || ''), m: 0, dm: x.montant || 0, att: true }); }
      if (x.statut === 'reglee' && tsMs(x.regleLe) >= CASH_START.getTime()) { const p = per(rid), cash = x.regleMode === 'cash';
        day(p, tsMs(x.regleLe)).lines.push({ t: tsMs(x.regleLe), txt: '📒 Dette réglée ' + (cash ? 'en cash' : 'par EMT') + ' · ' + (x.client || ''), m: cash ? (x.montant || 0) : 0, dm: cash ? 0 : x.montant || 0, ok: true });
        if (cash) p.solde += x.montant || 0; }
    });
    cs.data = Object.values(P).sort((a, b) => b.solde - a.solde); cs.err = '';
  } catch (e) { cs.err = msg(e); }
  cs.busy = false; drawCash();
}
function drawCash() {
  const box = $('cashTab'); if (!box) return;
  const L = cs.data || [], tot = L.reduce((a, p) => a + p.solde, 0);
  let h = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="label" style="margin:0">💵 Cash pas encore rendu à ' + OWNER + '</div><button class="linkbtn" id="csReload">↻</button></div>' +
    '<div style="font-size:26px;font-weight:900;margin:6px 0 2px">' + (cs.busy && !cs.data ? '…' : money(tot)) + '</div><div class="small">Le solde de chacun continue d’un jour à l’autre (depuis la soirée du 18 nov.).</div>' + (cs.err ? '<div class="err">' + esc(cs.err) + '</div>' : '') + '</div>';
  if (!L.length && !cs.busy) h += '<div class="card small">Rien pour l’instant.</div>';
  L.forEach((p) => {
    const o = cs.sel === p.id, disp = team[p.id] && ['complet', 'limite'].includes(team[p.id].role);
    h += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:8px' + (o ? ';border-color:#f5b301' : '') + '"><div data-cs="' + esc(p.id) + '" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer"><div><b style="font-size:16px">' + esc(p.nom) + '</b> <span class="small">' + (disp ? 'dispatch' : 'livreur') + '</span>' +
      '<div class="small">' + (Math.round(p.solde) ? (disp ? 'sur lui' : p.solde < 0 ? 'on lui doit' : 'à remettre') : '✓ tout remis') + (p.dette ? ' · <span style="color:#f87171">📒 ' + money(p.dette) + ' en dettes</span>' : '') + '</div></div><b style="font-size:19px;color:' + (Math.round(p.solde) ? '#fcd34d' : '#86efac') + '">' + money(p.solde) + ' ' + (o ? '▲' : '▼') + '</b></div>';
    if (!disp && Math.round(p.solde) < 0 && (isStaff() || isOwner())) h += '<div style="padding:8px 14px 12px;border-top:1px solid var(--line)"><div style="color:#c4b5fd;font-weight:800;margin-bottom:6px">💜 Tu lui dois ' + money(-p.solde) + '</div>' +
      (cs.rend === p.id ? '<button class="btn sm" style="background:#7c3aed;color:#fff" data-rend="' + esc(p.id) + '">Sûr ? Appuie encore : je lui ai donné ' + money(-p.solde) + '</button>' : '<button class="btn sm" style="background:#7c3aed;color:#fff" data-rend="' + esc(p.id) + '">💵 Je lui ai donné ' + money(-p.solde) + '</button>') + '<div class="small" style="margin-top:4px">Il devra confirmer « Reçu ✓ ».</div></div>';
    if (o) Object.values(p.days).sort((a, b) => b.k - a.k).forEach((d) => {
      h += '<div style="padding:6px 14px;background:var(--card2);border-top:1px solid var(--line);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">' + esc(new Date(d.k).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })) + '</div>';
      const row = (txt, m, sub, col) => '<div style="padding:7px 14px;border-top:1px solid var(--line);font-size:13px;display:flex;justify-content:space-between;gap:8px"><span>' + txt + (sub ? '<div class="small">' + sub + '</div>' : '') + '</span><b style="color:' + col + ';white-space:nowrap">' + m + '</b></div>';
      if (d.n) { h += row(d.n + ' livraison' + (d.n > 1 ? 's' : '') + ' · cash encaissé', '+' + money(d.cash), '', '#86efac'); if (d.garde) h += row('Gardé (paie, frais, pourboires)', '−' + money(d.garde), '', '#fca5a5'); }
      d.lines.sort((a, b) => a.t - b.t).forEach((l) => {
        if (l.dm != null && !l.m) { h += row(esc(l.txt), money(l.dm), (l.ok ? 'réglée · ' : 'pas comptée tant qu’elle n’est pas payée · ') + hm(l.t), '#f87171'); return; }
        h += row(esc(l.txt), (l.m > 0 ? '+' : '−') + money(Math.abs(l.m)), l.dm != null ? 'réglée · ' + hm(l.t) : l.ok ? '✓ reçu · ' + hm(l.t) : '⏳ en attente · ' + hm(l.t), l.att ? 'var(--muted)' : l.m > 0 ? '#86efac' : '#fca5a5'); });
    });
    h += '</div>';
  });
  box.innerHTML = h;
  box.querySelectorAll('[data-cs]').forEach((el) => { el.onclick = () => { cs.sel = cs.sel === el.dataset.cs ? null : el.dataset.cs; drawCash(); }; });
  if ($('csReload')) $('csReload').onclick = () => loadCash();
  box.querySelectorAll('[data-rend]').forEach((el) => { el.onclick = async () => {
    const id = el.dataset.rend, p = (cs.data || []).find((x) => x.id === id); if (!p) return;
    if (cs.rend !== id) { cs.rend = id; return drawCash(); }
    cs.rend = null; el.disabled = true;
    try { await rendreA(id, p.nom, -p.solde); cs.err = ''; } catch (e) { cs.err = msg(e); }
    loadCash();
  }; });
}


// =====================================================================
// v46 : une dette se ferme toute seule quand le paiement de sa commande est confirmé après coup
//       (« ✓ EMT / crypto reçu », paiement changé dans l'Historique et accepté par le livreur…).
//       Tourne chez Wayne et MOUSSE (ceux qui peuvent régler une dette), chaque minute.
// =====================================================================
async function detteSweep() {
  if (!canDette()) return;
  try {
    const qs = await getDocs(query(collection(db, 'commandes'), where('dette', '!=', null)));
    const list = []; qs.forEach((d) => list.push(d));
    for (const d of list) {
      const c = Object.assign({ id: d.id }, d.data());
      if (!c.dette || c.statut !== 'livree' || c.nonRecu || c.chg || c.bloque) continue;
      const ds = await getDoc(doc(db, 'dettes', c.dette)); if (!ds.exists()) continue;
      const x = ds.data(); if (x.statut !== 'ouverte') { if (x.statut === 'reglee') await writeBatch(db).update(doc(db, 'commandes', c.id), { dette: null }).commit(); continue; }
      const t0 = tsMs(x.decideLe || x.creeLe);
      const conf = [c.confirmeLe, c.chgRep === 'ok' ? c.chgRepLe : null, c.paieModLe && !c.chg ? c.paieModLe : null].filter(Boolean).map(tsMs).filter((t) => t > t0).sort((a, b) => b - a)[0];
      if (!conf) continue;
      const mode = c.paieMode === 'cash' ? 'cash' : c.paieMode === 'cry' || c.paieMode === 'mixc' ? 'cry' : 'int';
      const nom = c.confirmeNom || c.paieModNom || OWNER, par = c.confirmePar || c.paieModPar || myMid();
      const b = writeBatch(db);
      b.update(doc(db, 'dettes', c.dette), { statut: 'reglee', regleMode: mode, reglePar: par, regleParNom: nom, regleLe: new Date(conf), regleAuto: true });
      b.update(doc(db, 'commandes', c.id), { dette: null });
      b.set(doc(db, 'cmdPrive', c.id), { dette: null }, { merge: true });
      await b.commit();
    }
  } catch (e) { console.warn('detteSweep', e); }
}


// =====================================================================
// v47 : mise à jour forcée — toutes les 2 minutes (et quand on revient dans l'app), on regarde la version
//       d'app.js dans index.html. Plus récente → bande bleue, mise à jour après 10 s (ou tout de suite),
//       mais jamais pendant qu'on écrit dans une case.
// =====================================================================
const APP_V = 56;
const maj = { v: 0, t: null, left: 0 };
const typingNow = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && String(a.value || '').length > 0; };
async function majCheck() {
  try {
    const t = await fetch('index.html?maj=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
    const m = t.match(/app\.js\?v=(\d+)/); const v = m ? Number(m[1]) : 0;
    if (v > APP_V && !maj.v) { maj.v = v; maj.left = 10; majTick(); }
  } catch (e) {}
}
function majGo() { try { location.reload(); } catch (e) {} }
function majTick() {
  let b = $('majBan');
  if (!b) { b = document.createElement('div'); b.id = 'majBan'; b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);background:#10233f;border:1px solid #2563eb;color:#bfdbfe;border-radius:16px;padding:12px 14px;font-size:14px;line-height:1.5;z-index:70;max-width:520px;margin:0 auto'; document.body.appendChild(b); }
  const w = typingNow();
  b.innerHTML = '🔄 <b>Nouvelle version de Gotham</b><br>' + (w ? 'Elle se fera quand tu auras fini d’écrire.' : 'Mise à jour dans ' + maj.left + ' s…') + '<button class="btn ok sm" id="majNow" style="margin-top:8px">Mettre à jour maintenant</button>';
  $('majNow').onclick = majGo;
  if (!w) maj.left -= 1;
  if (maj.left < 0) return majGo();
  clearTimeout(maj.t); maj.t = setTimeout(majTick, 1000);
}
setTimeout(majCheck, 20000); setInterval(majCheck, 120000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') majCheck(); });
