// Version 10 : connexion, équipe, stock, check-in, commandes, notifications, lien client, résumé, messages (Firebase).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, doc, getDoc, getDocs, getDocFromServer, onSnapshot, writeBatch, setDoc, increment, serverTimestamp, collection, query, where, orderBy, limit }
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
const ROLES = { proprio: 'Propriétaire', complet: 'Dispatch complet', limite: 'Dispatch limité', livreur: 'Livreur' };
const DESC = {
  complet: 'Tout sauf les prix, les paies, les mots de passe, l’équipe et les ajouts à la réserve.',
  limite: 'Check-in et loads, commandes, Interac, messages. Pas l’argent des livreurs, pas la fermeture.',
  livreur: 'Sa soirée seulement. Ne voit jamais les montants Interac.'
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
  me.mid = data.mid || 'proprietaire';
  $('who').textContent = data.nom;
  buildTabs();
  show('home');
  // Si le compte est désactivé ou son mot de passe changé, il est déconnecté tout de suite.
  stops.push(onSnapshot(doc(db, 'users', user.uid), (s) => {
    if (!s.exists() || s.data().actif === false) { $('lErr').textContent = 'Ce compte n’est plus actif.'; signOut(auth); }
  }, () => {}));
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
const isStaff = () => me && (me.role === 'complet' || me.role === 'limite');
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
  if (isOwner()) t.push(['equipe', 'Équipe']);
  $('tabs').innerHTML = t.map((x) => '<button data-t="' + x[0] + '">' + x[1] + '</button>').join('');
  $('tabs').classList.toggle('hide', t.length < 2);
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
  setTab(t[0][0]);
}
let curTab = '';
function setTab(t) {
  if (locked() && (t === 'direct' || t === 'stock')) t = 'soiree';
  curTab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  ['direct', 'stock', 'soiree', 'equipe'].forEach((x) => $('tab' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hide', x !== t));
}

// ---------- Équipe (propriétaire seulement) ----------
// members/{id} : nom, rôle, fait aussi des livraisons, actif, compte de connexion actuel.
// paies/{id}   : paie par livraison (seulement le propriétaire et la personne elle-même la voient).
let team = {}, paies = {};
const paieTxt = (p) => (p == null ? 'paie à entrer' : p + ' $ / livraison');
function renderTeam() {
  const ids = Object.keys(team).sort((a, b) => (team[a].nom || '').localeCompare(team[b].nom || '', 'fr'));
  let d = '', l = '';
  ids.forEach((id) => {
    const p = team[id];
    const sub = p.role === 'livreur' ? paieTxt(paies[id]) : (p.livre ? 'Fait aussi des livraisons · ' + paieTxt(paies[id]) : 'Ne livre pas');
    const h = '<div class="row' + (p.actif ? '' : ' off') + '" data-id="' + esc(id) + '"><div><div class="n">' + esc(p.nom) +
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
  F = { mode: 'edit', id, nom: p.nom, role: p.role, livre: !!p.livre, paie: paies[id] == null ? null : paies[id], pwd: '' };
  drawSheet(); $('sheet').classList.remove('hide');
}
const needPaie = () => F.role === 'livreur' || F.livre;

function roleBlock() {
  return '<div class="label">Rôle</div><div class="seg">' + ['livreur', 'limite', 'complet'].map((r) =>
    '<button data-r="' + r + '" class="' + (F.role === r ? 'on' : '') + '">' + ROLES[r] + '</button>').join('') + '</div>' +
    '<p class="small" style="margin-top:0">' + DESC[F.role] + '</p>' +
    (F.role !== 'livreur' ? '<label class="chk"><input type="checkbox" id="fLivre" ' + (F.livre ? 'checked' : '') + '> Fait aussi des livraisons</label>' : '') +
    (needPaie() ? '<div class="label">Paie par livraison ($)</div><input id="fPaie" type="number" inputmode="numeric" min="0" value="' + (F.paie == null ? '' : F.paie) + '">' : '');
}
function drawSheet() {
  let h = '';
  if (F.mode === 'add') {
    h = '<div class="label">Ajouter quelqu’un</div>' +
      '<input id="fNom" placeholder="Nom (ex. FMJ)" autocapitalize="words" value="' + esc(F.nom) + '">' + roleBlock() +
      '<div class="label">Mot de passe (tu le choisis, 6 caractères min.)</div><input id="fPwd" type="text" autocomplete="off" autocapitalize="none" value="' + esc(F.pwd) + '">' +
      '<div class="err" id="fErr"></div>' +
      '<div class="two"><button class="btn ghost" id="fCancel">Annuler</button><button class="btn ok" id="fSave">Ajouter</button></div>';
  } else if (F.mode === 'edit') {
    const p = team[F.id];
    h = '<div class="label">' + esc(p.nom) + '</div>' + roleBlock() + '<div class="err" id="fErr"></div>' +
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
  on('fNom', 'oninput', (e) => { F.nom = e.target.value; });
  on('fPwd', 'oninput', (e) => { F.pwd = e.target.value; });
  on('fPaie', 'oninput', (e) => { F.paie = e.target.value === '' ? null : Number(e.target.value); });
  on('fLivre', 'onchange', (e) => { F.livre = e.target.checked; drawSheet(); });
  document.querySelectorAll('#sheetBody .seg button').forEach((b) => { b.onclick = () => { F.role = b.dataset.r; drawSheet(); }; });
  on('fCancel', 'onclick', closeSheet);
  on('fBack', 'onclick', () => { F.mode = 'edit'; drawSheet(); });
  on('fPwdBtn', 'onclick', () => { F.mode = 'pwd'; F.pwd = ''; drawSheet(); });
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
  const livre = F.role !== 'livreur' && F.livre;
  const b = writeBatch(db);
  b.set(doc(db, 'members', id), { nom, role: F.role, livre, actif: true, uid, creeLe: serverTimestamp() });
  b.set(doc(db, 'paies', id), { paie: needPaie() ? Number(F.paie) : 0 });
  b.set(doc(db, 'users', uid), { nom, mid: id, role: F.role, livre, actif: true });
  b.set(doc(db, 'logins', id), { email });
  await b.commit();
  F.nom = nom; F.mode = 'give'; drawSheet();
}

async function saveMember() {
  if (needPaie() && (F.paie == null || isNaN(F.paie) || F.paie < 0)) return err('Écris la paie par livraison.');
  const p = team[F.id];
  const livre = F.role !== 'livreur' && F.livre;
  const b = writeBatch(db);
  b.update(doc(db, 'members', F.id), { role: F.role, livre });
  b.set(doc(db, 'paies', F.id), { paie: needPaie() ? Number(F.paie) : 0 });
  if (p.uid) b.update(doc(db, 'users', p.uid), { role: F.role, livre });
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
  b.set(doc(db, 'users', uid), { nom: p.nom, mid: F.id, role: p.role, livre: !!p.livre, actif: !!p.actif });
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
const nomDe = (id) => (id === RESERVE ? 'Réserve' : id === 'proprietaire' ? 'Propriétaire' : isDep(id) ? 'Dépôt de ' + nomDe(id.replace(/-depot$/, '')) : (team[id] && team[id].nom) || id);
const hhmm = (ts) => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d ? d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') : ''; };
const qty = (o) => (o.L || 0) + ' L · ' + (o.XL || 0) + ' XL';

function startLive() {
  finState.team = null; finState.me = null; setTimeout(initFin, 0);
  dm.all = []; dm.lus = {}; dm.mine = []; dm.open = null; setTimeout(startDm, 0);
  stops.push(onSnapshot(collection(db, 'members'), (qs) => { team = {}; qs.forEach((d) => { team[d.id] = d.data(); }); renderTeam(); renderAll(); }, () => {}));
  if (isOwner()) stops.push(onSnapshot(collection(db, 'paies'), (qs) => { paies = {}; qs.forEach((d) => { paies[d.id] = d.data().paie; }); renderTeam(); }, () => {}));
  else if (me.mid) stops.push(onSnapshot(doc(db, 'paies', me.mid), (s) => { if (s.exists()) paies[me.mid] = s.data().paie; }, () => {}));
  // Stock : le propriétaire et le dispatch complet voient tout ; les autres seulement le leur.
  if (isOwner() || me.role === 'complet') {
    stops.push(onSnapshot(collection(db, 'stocks'), (qs) => { stocks = {}; qs.forEach((d) => { stocks[d.id] = d.data(); }); renderAll(); }, () => {}));
  } else {
    stops.push(onSnapshot(doc(db, 'stocks', me.mid), (s) => { stocks = {}; if (s.exists()) stocks[me.mid] = s.data(); renderAll(); }, () => {}));
  }
  if (isOwner() || isStaff()) {
    stops.push(onSnapshot(query(collection(db, 'soirees'), where('statut', 'in', ACTIVES)), (qs) => { soirees = {}; qs.forEach((d) => { soirees[d.id] = d.data(); }); renderAll(); }, (e) => console.warn(e)));
    stops.push(onSnapshot(query(collection(db, 'mouvements'), orderBy('le', 'desc'), limit(15)), (qs) => { mvts = []; qs.forEach((d) => mvts.push(d.data())); renderAll(); }, () => {}));
  }
  if (delivers()) {
    stops.push(onSnapshot(query(collection(db, 'soirees'), where('mid', '==', me.mid), where('statut', 'in', ACTIVES)), (qs) => {
      const wasLocked = locked();
      mySoiree = null; qs.forEach((d) => { mySoiree = Object.assign({ id: d.id }, d.data()); }); renderSoiree();
      document.querySelectorAll('#tabs button').forEach((b) => { b.disabled = locked() && (b.dataset.t === 'direct' || b.dataset.t === 'stock'); });
      if (locked()) setTab('soiree'); else if (wasLocked) setTab('direct');
      drawDm(); drawMine(); drawCashBtn();
    }, (e) => console.warn(e)));
  }
  startOrders();
  renderAll(); renderSoiree();
  if (delivers()) saveToken(false);
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
  const list = Object.keys(soirees).map((id) => Object.assign({ id }, soirees[id])).sort((a, b) => ((a.demandeLe && a.demandeLe.seconds) || 0) - ((b.demandeLe && b.demandeLe.seconds) || 0));
  const todo = list.filter((s) => s.statut === 'demande');
  const att = list.filter((s) => s.statut === 'load');
  const srv = list.filter((s) => s.statut === 'ouverte');
  $('todoN').textContent = todo.length; $('todoN').classList.toggle('hide', !todo.length);
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
  if (self && !canAuthorize(s)) return '<div class="item"><div class="wait"><span class="dot"></span><b>Ta soirée</b>&nbsp;attend MOUSSE ou le propriétaire.</div></div>';
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
      : '<div class="small">MOUSSE ou le propriétaire doit autoriser ta propre soirée.</div>') +
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
  await b.commit();
  delete drafts[s.id];
}
async function refuseReq(s) {
  await writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'refusee', refuseePar: me.mid, finLe: serverTimestamp() }).commit();
  delete drafts[s.id];
}

// ---------- Stock (propriétaire et dispatchs) ----------
const give = { to: null, from: null, L: 0, XL: 0 };
function giveSources() {
  if (isOwner()) return [RESERVE];
  if (me.role === 'complet') return [me.mid, DEP(me.mid)];
  return [me.mid];
}
function giveTargets(from) {
  const disp = Object.keys(team).filter((id) => team[id].actif && (team[id].role === 'complet' || team[id].role === 'limite'));
  const complets = disp.filter((id) => team[id].role === 'complet');
  if (isOwner()) return disp.concat(complets.map(DEP));                                      // propriétaire → MOUSSE, son dépôt, ou lost
  if (me.role === 'complet') {                                                               // MOUSSE : entre lui et son dépôt, ou à lost
    const other = from === DEP(me.mid) ? me.mid : DEP(me.mid);
    return [other].concat(disp.filter((id) => id !== me.mid));
  }
  return complets.concat(complets.map(DEP));                                                // lost : seulement retourner à MOUSSE ou à son dépôt
}
function renderStock() {
  const all = isOwner() || me.role === 'complet';
  const ids = all ? [].concat(...Object.keys(team).filter((id) => team[id].actif || (stocks[id] && (stocks[id].L || stocks[id].XL)))
    .sort((a, b) => ({ complet: 0, limite: 1, livreur: 2 }[team[a].role] - { complet: 0, limite: 1, livreur: 2 }[team[b].role]) || team[a].nom.localeCompare(team[b].nom, 'fr'))
    .map((id) => (team[id].role === 'complet' ? [id, DEP(id)] : [id]))) : [me.mid];
  $('stockList').innerHTML = ids.map((id) => '<div class="srow"><span>' + (isDep(id) ? '&nbsp;&nbsp;↳ ' : '') + esc(isDep(id) ? 'au dépôt' : nomDe(id) + (team[id] && team[id].role === 'complet' ? ' (sur lui)' : '')) + (id === me.mid ? ' · moi' : '') + '</span><b>' + qty(st(id)) + '</b></div>').join('');
  const srcs = giveSources();
  if (srcs.indexOf(give.from) < 0) give.from = srcs[0];
  const tg = giveTargets(give.from);
  $('giveCard').classList.toggle('hide', !tg.length);
  if (give.to && tg.indexOf(give.to) < 0) give.to = null;
  if (!give.to && tg.length === 1) give.to = tg[0];
  const lbl = (id) => (me.role === 'complet' && id === me.mid ? 'Sur moi' : me.role === 'complet' && id === DEP(me.mid) ? 'Mon dépôt' : nomDe(id));
  $('giveTitle').textContent = isOwner() ? 'Donner du stock (de la réserve)' : me.role === 'complet' ? 'Déplacer / donner du stock' : 'Retourner du stock';
  $('giveWho').innerHTML = (srcs.length > 1 ? '<div class="small" style="margin-bottom:6px">De :</div><div class="who" id="giveFrom">' + srcs.map((id) => '<button data-id="' + id + '" class="' + (give.from === id ? 'on' : '') + '">' + esc(lbl(id)) + ' (' + qty(st(id)) + ')</button>').join('') + '</div><div class="small" style="margin-bottom:6px">Vers :</div>' : '') +
    '<div class="who" id="giveTo">' + tg.map((id) => '<button data-id="' + id + '" class="' + (give.to === id ? 'on' : '') + '">' + esc(lbl(id)) + '</button>').join('') + '</div>';
  document.querySelectorAll('#giveFrom button').forEach((b) => { b.onclick = () => { give.from = b.dataset.id; give.to = null; renderStock(); }; });
  document.querySelectorAll('#giveTo button').forEach((b) => { b.onclick = () => { give.to = b.dataset.id; renderStock(); }; });
  $('gL').textContent = give.L; $('gXL').textContent = give.XL;
  $('gGo').textContent = (me.role === 'limite' ? 'Retourner' : me.role === 'complet' && (give.to === me.mid || give.to === DEP(me.mid)) ? 'Déplacer' : 'Donner') + (give.to ? ' → ' + lbl(give.to) : '');
  $('mvts').innerHTML = mvts.map((m) => hhmm(m.le) + ' · ' + esc(nomDe(m.de)) + ' → ' + esc(nomDe(m.vers)) + ' : ' + qty(m) + (m.type === 'load' ? ' (load)' : '') + (m.par && m.par !== m.de ? ' · par ' + esc(nomDe(m.par)) : '')).join('<br>') || 'Aucun mouvement pour l’instant.';
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
  if (document.activeElement && (document.activeElement.id === 'mcCash' || document.activeElement.id === 'chatTxt')) return; // ne pas effacer ce qu'il tape
  const s = mySoiree, mine = st(me.mid);
  let h = '';
  if (!s) {
    const dmode = me.role === 'limite' && ci.mode === 'dispatch';
    h = '<div class="card"><div class="label">Commencer ma soirée</div>' +
      (me.role === 'limite' ? '<p class="small" style="margin-top:0">Ce soir je fais :</p><div class="seg" id="ciMode">' + [['livreur', '🚗 Livreur'], ['dispatch', '🧭 Dispatch'], ['les2', '🚗+🧭 Les deux']].map((x) =>
        '<button data-m="' + x[0] + '" class="' + ((ci.mode || 'livreur') === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' : '') +
      (dmode ? '' : '<p class="small" style="margin-top:0">Où es-tu en ce moment ?</p>' +
      '<input id="ciAdr" placeholder="Ex. 1400 Sainte-Catherine" autocomplete="off" value="' + esc(ci.q) + '">' +
      '<div id="ciSugs"></div>' +
      '<p class="small" style="margin-top:0">Tu peux aussi écrire une adresse qui n’est pas dans la liste.</p>') +
      ((mine.L || mine.XL) ? '<p class="small">Tu as déjà sur toi : <b style="color:var(--text)">' + qty(mine) + '</b></p>' : '') +
      (me.role === 'limite' ? '<p class="small">MOUSSE ou le propriétaire doit t’autoriser' + (ci.mode === 'dispatch' || ci.mode === 'les2' ? ' avant que tu puisses faire le dispatch.' : '.') + '</p>' : '') +
      '<div class="err" id="ciErr"></div><button class="btn ok" id="ciGo">Envoyer la demande</button></div>';
  } else if (s.statut === 'demande') {
    h = '<div class="card"><div class="wait"><span class="dot"></span><b>' + (me.role === 'limite' ? 'En attente de MOUSSE ou du propriétaire…' : 'En attente du dispatch…') + '</b></div>' +
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
    h = myOrdersHtml(s);
  }
  const keepFocus = document.activeElement && document.activeElement.id === 'ciAdr';
  const pos = keepFocus ? document.activeElement.selectionStart : null;
  $('soiree').innerHTML = notifCard() + h;
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
  if ($('ciCancel')) $('ciCancel').onclick = () => soirAct(() => writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'annulee', finLe: serverTimestamp() }).commit());
  if ($('ciAccept')) $('ciAccept').onclick = () => soirAct(() => acceptLoad(s));
  if ($('ciRefuse')) $('ciRefuse').onclick = () => soirAct(() => refuseLoad(s));
  if (s && s.statut === 'ouverte') bindMyOrders(s);
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
    try {
      const r = await fetch('https://photon.komoot.io/api/?limit=6&lang=fr&lat=45.52&lon=-73.6&bbox=-79.8,44.9,-57.1,62.6&q=' + encodeURIComponent(q));
      const j = await r.json();
      if (my !== ci.seq) return;
      const seen = {};
      ci.sugs = (j.features || []).map((f) => {
        const p = f.properties || {};
        const l1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
        const l2 = [p.city || p.town || p.village || p.district, 'QC', p.postcode].filter(Boolean).join(' ').replace(' QC ', ', QC ');
        return { l1, l2, lat: f.geometry && f.geometry.coordinates[1], lon: f.geometry && f.geometry.coordinates[0], st: p.state };
      }).filter((x) => x.l1 && (!x.st || /qu[ée]bec/i.test(x.st))).filter((x) => { const k = x.l1 + x.l2; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 5);
    } catch (e) { ci.sugs = []; }
    drawSugs();
  }, 350);
}
function drawSugs() {
  const box = $('ciSugs'); if (!box) return;
  box.innerHTML = ci.sugs.length && !ci.pick ? '<div class="sugs">' + ci.sugs.map((x, i) => '<div data-i="' + i + '">' + esc(x.l1) + '<div class="s2">' + esc(x.l2) + '</div></div>').join('') + '</div>' : '';
  box.querySelectorAll('[data-i]').forEach((d) => { d.onclick = () => { const x = ci.sugs[+d.dataset.i]; ci.pick = x; ci.q = x.l1 + ', ' + x.l2; $('ciAdr').value = ci.q; drawSugs(); }; });
}
async function requestStart() {
  const mode = me.role === 'limite' && (ci.mode === 'dispatch' || ci.mode === 'les2') ? ci.mode : 'livreur';
  const adr = mode === 'dispatch' ? 'Dispatch' : ci.q.trim();
  if (adr.length < 4) { $('ciErr').textContent = 'Écris où tu es.'; return; }
  const data = { mid: me.mid, nom: me.nom, statut: 'demande', mode, adresse: adr, demandeLe: serverTimestamp() };
  if (ci.pick && ci.pick.lat) { data.lat = ci.pick.lat; data.lon = ci.pick.lon; }
  await setDoc(doc(collection(db, 'soirees')), data);
  ci.q = ''; ci.pick = null; ci.sugs = [];
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
// cmdPrive/{id}    : montants et paiement complet (Interac) : propriétaire et dispatchs seulement.
// config/app       : prix et clé Google Maps (entrés par le propriétaire).
// Règles de temps (décidées par le propriétaire) : 4 min de marge pour partir sur la 1re commande,
// 2 min pour chacune des suivantes, 7 min sur place. Retard : gris jusqu'à 10 min, rouge après.
// « Sur son chemin » : proposé si le détour est de 10 min ou moins, jamais avant la commande où il s'en va.

const SUR_PLACE = 7, MARGE1 = 4, MARGE = 2, DETOUR_MAX = 10;
let cfg = { prixL: 150, prixXL: 220, mapsKey: '' };
let cmds = {}, prive = {}, myCmds = [], myDone = 0;
const ttMem = {}; // mémoire des temps de route (15 min)

function startOrders() {
  stops.push(onSnapshot(doc(db, 'config', 'app'), (s) => { if (s.exists()) cfg = Object.assign({ prixL: 150, prixXL: 220, mapsKey: '' }, s.data()); renderAll(); renderSoiree(); renderCfg(); }, () => {}));
  if (isOwner() || isStaff()) {
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('statut', 'in', ['attente', 'assignee', 'ici'])), (qs) => {
      cmds = {}; qs.forEach((d) => { cmds[d.id] = Object.assign({ id: d.id }, d.data()); }); renderAll();
    }, (e) => console.warn(e)));
    stops.push(onSnapshot(query(collection(db, 'cmdPrive'), where('actif', '==', true)), (qs) => {
      prive = {}; qs.forEach((d) => { prive[d.id] = d.data(); }); renderAll();
    }, (e) => console.warn(e)));
  }
  if (delivers()) {
    stops.push(onSnapshot(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', 'in', ['assignee', 'ici'])), (qs) => {
      myCmds = []; qs.forEach((d) => myCmds.push(Object.assign({ id: d.id }, d.data()))); myCmds.sort((a, b) => a.ordre - b.ordre); renderSoiree();
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
  if (c.bloque) return '<span class="pay p-no">' + (p.mode === 'mix' ? p.cash + ' $ cash + Interac pas reçu' : 'Interac pas reçu') + '</span>';
  if (p.mode === 'mix') return '<span class="pay p-cash">' + p.cash + ' $ cash</span><span class="pay p-int">+ Interac reçu</span>';
  if (p.mode === 'int') return '<span class="pay p-int">Interac reçu</span>';
  return '<span class="pay p-cash">Cash ' + (c.encaisser || 0) + ' $</span>';
}

// ---------- Créer une commande (dispatch) ----------
let NF = null; // formulaire en cours
const nf = { timer: null, seq: 0, sugs: [] };
function newOrder() { NF = { client: '', tel: '', q: '', pick: null, L: 1, XL: 0, frais: 0, meth: 'cash', recu: false, cashPart: 0, note: '', plus: false, more: false, opts: null, busy: false }; renderNew(); }
function renderNew() {
  const box = $('cmdNew'); if (!box) return;
  if (!NF) { box.innerHTML = '<button class="btn ok" id="nfOpen" style="margin-bottom:12px">＋ Créer une commande</button>'; $('nfOpen').onclick = newOrder; return; }
  const f = NF, tot = totalOf(f);
  const focusId = document.activeElement && document.activeElement.id;
  box.innerHTML = '<div class="card"><div class="label">Nouvelle commande</div>' +
    '<textarea id="nfPaste" rows="4" placeholder="📋 Colle ici le message du client (nom, numéro, adresse avec code postal, commande)"></textarea>' +
    (f.pasted ? '<div class="small" style="margin:-4px 0 8px;color:var(--cash)">✓ Rempli à partir du message. Vérifie l’adresse et les quantités, puis choisis le paiement.</div>' : '') +
    '<input id="nfClient" placeholder="Nom du client" value="' + esc(f.client) + '">' +
    '<input id="nfAdr" placeholder="Adresse (ex. 5000 jean-talon)" autocomplete="off" value="' + esc(f.q) + '"><div id="nfSugs"></div>' +
    '<div class="step"><span>L</span><button data-k="L" data-d="-1">−</button><div class="v">' + f.L + '</div><button data-k="L" data-d="1">+</button>' +
    '<span style="margin-left:10px">XL</span><button data-k="XL" data-d="-1">−</button><div class="v">' + f.XL + '</div><button data-k="XL" data-d="1">+</button></div>' +
    '<div class="small" style="margin-bottom:4px">Comment le client paie ?</div><div class="seg" id="nfMeth">' + [['cash', '🔵 Cash'], ['int', '🟡 Interac'], ['mix', '🔵🟡 Les deux']].map((x) => '<button data-m="' + x[0] + '" class="' + (f.meth === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
    (f.meth === 'mix' ? '<div class="mixbox"><div class="two"><div><div class="small">Partie cash ($)</div><input id="nfCash" type="number" inputmode="numeric" value="' + f.cashPart + '"></div><div><div class="small">Partie Interac</div><div class="mixv" id="nfInt">' + Math.max(0, tot - f.cashPart) + ' $</div></div></div></div>' : '') +
    (f.meth !== 'cash' ? '<label class="chk"><input type="checkbox" id="nfRecu" ' + (f.recu ? 'checked' : '') + '> Interac déjà reçu' + (f.recu ? '' : ' <span class="small">(sinon le livreur attend ta confirmation)</span>') + '</label>' : '') +
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
  document.querySelectorAll('#nfMeth button').forEach((b) => { b.onclick = () => { f.meth = b.dataset.m; if (f.meth === 'mix' && !f.cashPart) f.cashPart = Math.round(totalOf(f) / 20) * 10; renderNew(); }; });
  document.querySelectorAll('#nfFee button').forEach((b) => { b.onclick = () => { f.frais = Number(b.dataset.v); renderNew(); }; });
  if (focusId && $(focusId) && focusId.indexOf('nf') === 0) { const el = $(focusId); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
  drawNfSugs(); drawAssign();
}
function nfLookup() {
  clearTimeout(nf.timer);
  const q = NF.q.trim();
  if (q.length < 4) { nf.sugs = []; drawNfSugs(); return; }
  nf.timer = setTimeout(async () => { const my = ++nf.seq; const s = await photon(q); if (my === nf.seq) { nf.sugs = s; drawNfSugs(); } }, 350);
}
async function photon(q) {
  try {
    const r = await fetch('https://photon.komoot.io/api/?limit=6&lang=fr&lat=45.52&lon=-73.6&bbox=-79.8,44.9,-57.1,62.6&q=' + encodeURIComponent(q));
    const j = await r.json(); const seen = {};
    return (j.features || []).map((f) => {
      const p = f.properties || {};
      const l1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
      const l2 = [p.city || p.town || p.village || p.district, 'QC', p.postcode].filter(Boolean).join(' ').replace(' QC ', ', QC ');
      return { l1, l2, lat: f.geometry && f.geometry.coordinates[1], lon: f.geometry && f.geometry.coordinates[0], st: p.state };
    }).filter((x) => x.l1 && (!x.st || /qu[ée]bec/i.test(x.st))).filter((x) => { const k = x.l1 + x.l2; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 5);
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
  const people = Object.values(soirees).filter(working);
  const cand = [];
  people.forEach((s) => {
    const q = queueOf(s.mid).filter((c) => c.id !== skipId), plan = planOf(q);
    const left = stockLeft(s.mid); if (skipId && cmds[skipId] && cmds[skipId].livreur === s.mid) { left.L += cmds[skipId].L || 0; left.XL += cmds[skipId].XL || 0; }
    const ok = left.L >= (o.L || 0) && left.XL >= (o.XL || 0);
    const start = pos(s) || X;
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
  if (!f.q.trim()) return ($('nfErr').textContent = 'Écris l’adresse.');
  if (!f.L && !f.XL) return ($('nfErr').textContent = 'Mets au moins 1 L ou 1 XL.');
  f.busy = true;
  try {
    const tot = totalOf(f);
    const mode = f.meth, recu = f.meth === 'cash' ? true : f.recu;
    const encaisser = mode === 'cash' ? tot : mode === 'mix' ? f.cashPart : 0;
    const ref = doc(collection(db, 'commandes'));
    const code = newCode();
    const data = { suivi: code, client: f.client.trim() || 'Client', tel: f.tel.trim(), adresse: f.q.trim(), L: f.L, XL: f.XL, frais: f.frais, note: f.note.trim(),
      encaisser, paye: mode !== 'cash' && recu && mode === 'int', bloque: !recu, statut: 'attente', livreur: null, retard: 0, creeLe: serverTimestamp(), creePar: me.mid };
    if (f.pick && f.pick.lat != null) { data.lat = f.pick.lat; data.lon = f.pick.lon; }
    const b = writeBatch(db);
    if (opt) Object.assign(data, await assignFields(opt, data));
    b.set(ref, data);
    b.set(doc(db, 'suivi', code), { actif: true, statut: opt ? 'assignee' : 'attente', eta: opt ? Math.round(opt.arr) : null, luid: opt ? uidOf(opt.mid) : null, prenom: prenom(data.client), le: serverTimestamp() });
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
function renderQueues() {
  const box = $('service'); if (!box) return;
  const people = Object.values(soirees).filter(working).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const seeStock = isOwner() || me.role === 'complet';
  let h = '';
  people.forEach((s) => {
    const q = queueOf(s.mid), plan = planOf(q), left = stockLeft(s.mid);
    const low = seeStock && (left.L <= 2 && left.XL <= 1);
    h += '<div class="item"><div class="qhead"><b>' + esc(s.nom) + '</b><span class="small">' + (seeStock ? qty(st(s.mid)) + ' sur lui' : '') + (low ? ' <span class="pay p-int">stock bas</span>' : '') + '</span></div>';
    if (!q.length) h += '<div class="small">Libre · ' + esc(s.adresse || '') + '</div>';
    q.forEach((c, i) => {
      h += '<div class="q"><span class="num">' + (i + 1) + '</span><b>' + esc(c.client) + '</b>' + payTag(c) +
        '<div class="small" style="margin:3px 0 6px">' + esc(c.adresse) + ' · ' + c.L + ' L ' + c.XL + ' XL · ' + (c.statut === 'ici' ? '<b style="color:var(--cash)">sur place</b>' : 'arrivée ~' + hm(plan[i])) + (c.retard ? ' ' + lateTag(c.retard) : '') + (c.note ? '<br>📝 ' + esc(c.note) : '') + '</div>' +
        '<div class="seg" style="margin:0">' + (c.bloque ? '<button class="on" data-a="paid" data-id="' + c.id + '">✓ Interac reçu</button>' : '') +
        '<button data-a="msg" data-id="' + c.id + '">💬 Client</button>' +
        (menuOpen === c.id ? '<button data-a="unassign" data-id="' + c.id + '">Retirer</button><button data-a="cancel" data-id="' + c.id + '">Annuler</button>' : '<button data-a="menu" data-id="' + c.id + '" style="flex:0 0 46px">⋯</button>') + '</div>' +
        (msgOpen === c.id ? msgBox(c, plan[i]) : '') + '</div>';
    });
    h += '</div>';
  });
  box.innerHTML = h || '<div class="small">Personne en service pour l’instant.</div>';
  // Commandes pas assignées
  const free = Object.values(cmds).filter((c) => c.statut === 'attente');
  $('freeCard').classList.toggle('hide', !free.length);
  $('freeList').innerHTML = free.map((c) => '<div class="q"><b>' + esc(c.client) + '</b>' + payTag(c) + '<div class="small" style="margin:3px 0 6px">' + esc(c.adresse) + ' · ' + c.L + ' L ' + c.XL + ' XL</div>' +
    (reassign && reassign.id === c.id ? (reassign.opts === 'calc' ? '<div class="small">Calcul…</div>' : (reassign.opts || []).map((o, i) => optLine(o, i === 0 && o.ok, i)).join('') || '<div class="small">Aucun livreur en service.</div>') :
      '<div class="seg" style="margin:0"><button class="on" data-a="assign" data-id="' + c.id + '">Assigner</button>' + (c.bloque ? '<button data-a="paid" data-id="' + c.id + '">✓ Interac reçu</button>' : '') + '<button data-a="cancel" data-id="' + c.id + '">Annuler</button></div>') + '</div>').join('');
  document.querySelectorAll('#service [data-a], #freeList [data-a]').forEach((el) => { el.onclick = () => qAct(el.dataset.a, el.dataset.id); });
  document.querySelectorAll('#freeList [data-o]').forEach((el) => { el.onclick = () => assignExisting(reassign.id, reassign.opts[+el.dataset.o]); });
  document.querySelectorAll('#service [data-copy]').forEach((el) => { el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.copy).catch(() => {}); } catch (e) {} el.textContent = 'Copié ✓'; }; });
}
function msgBox(c, eta) {
  const t = 'Salut ' + prenom(c.client) + ' ! Ton livreur arrive dans environ ' + Math.max(1, Math.round((eta - Date.now()) / 60000)) + ' minutes.' + (c.suivi ? ' Suis ta livraison et écris-lui ici : ' + SUIVI + c.suivi : '');
  return '<div class="msgc">' + esc(t) + '<div class="two" style="margin-top:8px"><button class="btn ghost sm" data-copy="' + esc(t) + '">Copier</button>' +
    (c.tel ? '<a class="btn ok sm" style="text-align:center;text-decoration:none" href="sms:' + encodeURIComponent(c.tel) + '?&body=' + encodeURIComponent(t) + '">Texto à ' + esc(c.tel) + '</a>' : '<span class="small" style="align-self:center">Pas de téléphone : copie-le où tu parles au client.</span>') + '</div></div>';
}
async function qAct(a, id) {
  const c = cmds[id]; if (!c) return;
  try {
    if (a === 'menu') { menuOpen = id; return renderQueues(); }
    if (a === 'msg') { msgOpen = msgOpen === id ? null : id; return renderQueues(); }
    if (a === 'paid') {
      const b = writeBatch(db);
      b.update(doc(db, 'commandes', id), { bloque: false, paye: !(c.encaisser > 0), confirmePar: me.mid, confirmeLe: serverTimestamp() });
      b.update(doc(db, 'cmdPrive', id), { recu: true });
      return await b.commit();
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
function myOrdersHtml(s) {
  const mine = st(me.mid);
  let h = '<div class="card"><div class="stock"><div><b>' + (mine.L || 0) + '</b>L sur toi</div><div><b>' + (mine.XL || 0) + '</b>XL sur toi</div><div><b>' + (s.livrees || 0) + '</b>livraisons</div></div></div>';
  if (!myCmds.length) return h + '<div class="card"><div class="small">Aucune commande pour l’instant. Elles apparaissent ici toutes seules.</div><p class="small" style="margin-bottom:0">Départ : ' + esc(s.adresse) + '</p></div>';
  const plan = planOf(myCmds), c = myCmds[0];
  const banner = c.bloque ? '<div class="banner b-no">🔴 PAS ENCORE PAYÉ — ne livre pas, attends que le dispatch confirme</div>'
    : c.encaisser > 0 ? '<div class="banner b-cash">🔵 À ENCAISSER : <b>' + c.encaisser + ' $</b> cash' + (c.paye === false && c.encaisser && !c.paye ? '' : '') + '</div>'
    : '<div class="banner b-int">🟡 DÉJÀ PAYÉ — rien à encaisser</div>';
  h += '<div class="card now"><div class="label">Maintenant · commande 1 sur ' + myCmds.length + '</div><div class="client">' + esc(c.client) + '</div>' +
    '<a class="addr" href="' + mapsUrl(c) + '" target="_blank" rel="noopener"><span class="pin">📍</span><span><b>' + esc(c.adresse) + '</b><br><u>Ouvrir dans Google Maps</u></span></a>' +
    '<div class="chips"><span class="chip">' + c.L + ' × L</span><span class="chip">' + c.XL + ' × XL</span><span class="chip eta">' + (c.statut === 'ici' ? 'Sur place' : 'Arrivée ~' + hm(plan[0]) + (c.retard ? ' (+' + c.retard + ' min)' : ' si tu pars maintenant')) + '</span></div>' +
    banner + (c.note ? '<div class="note2">📝 ' + esc(c.note) + '</div>' : '') + chatHtml(c) + '<div class="err" id="mcErr"></div>';
  if (c.statut !== 'ici') h += '<div class="two"><button class="btn ghost" id="mcLate" style="color:var(--danger);border-color:var(--danger)">⏱ +5 min</button><button class="btn" id="mcHere">Je suis arrivé</button></div>';
  else if (c.bloque) h += '<button class="btn" disabled>🔒 Attends l’Interac</button>';
  else h += (c.encaisser > 0 ? '<div class="small" style="margin:4px 0">Cash reçu (change si différent)</div><input id="mcCash" type="number" inputmode="numeric" value="' + c.encaisser + '">' : '') + '<button class="btn ok big" id="mcDone">✓ Livrée</button>';
  h += '</div>';
  if (myCmds.length > 1) {
    h += '<div class="card"><div class="label">Ensuite</div>' + myCmds.slice(1).map((d, i) => '<div class="q"><span class="num">' + (i + 2) + '</span><b>' + esc(d.client) + '</b> <span class="small">~' + hm(plan[i + 1]) + '</span>' +
      (d.bloque ? '<span class="pay p-no">Pas payé</span>' : d.encaisser > 0 ? '<span class="pay p-cash">Cash ' + d.encaisser + ' $</span>' : '<span class="pay p-int">Payé</span>') +
      '<div class="small" style="margin-top:3px"><a href="' + mapsUrl(d) + '" target="_blank" rel="noopener" style="color:var(--blue)">📍 ' + esc(d.adresse) + '</a> · ' + d.L + ' L · ' + d.XL + ' XL</div></div>').join('') + '</div>';
  }
  return h;
}
function bindMyOrders(s) {
  const c = myCmds[0];
  watchChat(c); syncEtas();
  if (!c) return;
  bindChat();
  const act = async (fn) => { document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = true; }); try { await fn(); } catch (e) { if ($('mcErr')) $('mcErr').textContent = msg(e); } document.querySelectorAll('#soiree button').forEach((b) => { b.disabled = false; }); };
  if ($('mcLate')) $('mcLate').onclick = () => act(() => writeBatch(db).update(doc(db, 'commandes', c.id), { retard: (c.retard || 0) + 5 }).commit());
  if ($('mcHere')) $('mcHere').onclick = () => act(() => { const b = writeBatch(db); b.update(doc(db, 'commandes', c.id), { statut: 'ici', iciLe: serverTimestamp() }); if (c.suivi) b.update(doc(db, 'suivi', c.suivi), { statut: 'ici' }); return b.commit(); });
  if ($('mcDone')) $('mcDone').onclick = () => act(async () => {
    const cash = $('mcCash') ? Math.max(0, Number($('mcCash').value) || 0) : 0;
    const b = writeBatch(db);
    b.update(doc(db, 'commandes', c.id), { statut: 'livree', livreeLe: serverTimestamp(), cashRecu: cash, soiree: s.id, ...(paies[me.mid] != null ? { paie: paies[me.mid] } : {}) });
    b.set(doc(db, 'stocks', me.mid), { L: increment(-(c.L || 0)), XL: increment(-(c.XL || 0)), cmd: c.id }, { merge: true });
    b.update(doc(db, 'soirees', s.id), { livrees: increment(1) });
    const nx = myCmds[1];
    if (nx) b.update(doc(db, 'commandes', nx.id), { depart: Date.now() - (MARGE1 - MARGE) * 60000 }); // la suivante part maintenant (2 min de marge)
    await b.commit();
    closeSuivi(c.suivi, 'livree');
  });
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
  if (!me || !delivers()) return;
  if (!(await pushOk())) { notifState = isIOS() && !isStandalone() ? 'installer' : 'impossible'; return renderSoiree(); }
  if (Notification.permission === 'denied') { notifState = 'refuse'; return renderSoiree(); }
  if (Notification.permission !== 'granted') {
    if (!ask) { notifState = 'a-activer'; return renderSoiree(); }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { notifState = p === 'denied' ? 'refuse' : 'a-activer'; return renderSoiree(); }
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const tok = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (tok) { await setDoc(doc(db, 'tokens', tok), { mid: me.mid, le: serverTimestamp(), appareil: isIOS() ? 'iphone' : 'autre' }, { merge: true }); notifState = 'ok'; }
  } catch (e) { console.warn('notif', e); notifState = 'erreur'; }
  renderSoiree();
}
function notifCard() {
  if (!delivers()) return '';
  if (notifState === 'ok' || notifState === 'inconnu') return '';
  if (notifState === 'installer') return '<div class="card notif"><b>🔔 Pour recevoir les notifications sur iPhone</b><p class="small" style="margin:6px 0 0">1. Dans Safari, touche Partager → « Sur l’écran d’accueil ».<br>2. Ouvre l’app avec la nouvelle icône, puis active les notifications ici.</p></div>';
  if (notifState === 'refuse') return '<div class="card notif"><b>🔕 Notifications bloquées</b><p class="small" style="margin:6px 0 0">Va dans Réglages du téléphone → Notifications → Livreurs, et autorise-les.</p></div>';
  if (notifState === 'impossible') return '<div class="card notif"><b>🔕 Ce téléphone ne peut pas recevoir les notifications de l’app.</b><p class="small" style="margin:6px 0 0">Mets à jour le téléphone (iPhone : iOS 16.4 ou plus).</p></div>';
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
function sumUp(list) {
  const by = {};
  list.forEach((c) => {
    const k = c.livreur || '?';
    const r = by[k] || (by[k] = { mid: k, nom: c.livreurNom || nomDe(k), n: 0, cash: 0, frais: 0, tips: 0, manque: 0, paie: 0, paieOk: true });
    const cash = Number(c.cashRecu) || 0, enc = Number(c.encaisser) || 0;
    const p = c.paie != null ? c.paie : paies[k];
    r.n++; r.cash += cash; r.frais += Number(c.frais) || 0;
    if (cash > enc) r.tips += cash - enc; else if (cash < enc) r.manque += enc - cash;
    if (p == null) r.paieOk = false; else r.paie += Number(p);
  });
  return Object.values(by).map((r) => Object.assign(r, { reste: r.cash - r.paie - r.frais - r.tips })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
const jourTxt = (d) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
function teamText(rows, d) {
  let t = 'Soirée du ' + jourTxt(d) + '\n';
  const T = { cash: 0, n: 0, reste: 0 };
  rows.forEach((r) => { T.cash += r.cash; T.n += r.n; T.reste += r.reste;
    t += '\n' + r.nom + ' : cash ' + money(r.cash) + ' · ' + r.n + ' livraison' + (r.n > 1 ? 's' : '') + ' · reste ' + (r.paieOk ? money(r.reste) : '? (paie inconnue)') +
      (r.tips ? ' (pourboires ' + money(r.tips) + ')' : '') + (r.manque ? ' ⚠️ manque ' + money(r.manque) : ''); });
  t += '\n\nTOTAL : cash ' + money(T.cash) + ' · ' + T.n + ' livraison' + (T.n > 1 ? 's' : '') + ' · reste ' + money(T.reste);
  return t;
}
function myText(r, d) {
  if (!r) return 'Soirée du ' + jourTxt(d) + '\nAucune livraison.';
  return 'Ma soirée du ' + jourTxt(d) + '\n\nTotal cash : ' + money(r.cash) + '\nLivraisons : ' + r.n + (r.paieOk ? ' (paie ' + money(r.paie) + ')' : '') +
    (r.frais ? '\nFrais : ' + money(r.frais) : '') + (r.tips ? '\nPourboires : ' + money(r.tips) : '') + (r.manque ? '\n⚠️ Manque : ' + money(r.manque) : '') +
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
      finState.team = teamText(sumUp(list), d);
    } else {
      const qs = await getDocs(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', '==', 'livree')));
      qs.forEach((x) => { const c = x.data(); const t = c.livreeLe && c.livreeLe.toDate ? c.livreeLe.toDate() : null; if (t && t >= d) list.push(c); });
      finState.me = myText(sumUp(list)[0], d);
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
      dm.all = []; qs.forEach((d) => dm.all.push(Object.assign({ id: d.id }, d.data()))); dm.all.reverse(); drawDm();
    }, () => {}));
    stops.push(onSnapshot(collection(db, 'lus'), (qs) => { dm.lus = {}; qs.forEach((d) => { dm.lus[d.id] = d.data(); }); drawDm(); }, () => {}));
  }
  if (me.role === 'livreur' || me.role === 'limite') {
    let first = true;
    stops.push(onSnapshot(query(collection(db, 'messages'), where('mid', '==', me.mid)), (qs) => {
      const before = dm.mine.length; dm.mine = [];
      qs.forEach((d) => dm.mine.push(Object.assign({ id: d.id }, d.data())));
      dm.mine.sort((a, b) => tsMs(a.le) - tsMs(b.le));
      if (!first && dm.mine.length > before && dm.mine[dm.mine.length - 1].de === 'dispatch' && chatsDriver()) bip();
      first = false; drawMine();
    }, () => {}));
    stops.push(onSnapshot(doc(db, 'lus', me.mid), (s) => { dm.myLu = s.exists() ? s.data() : {}; drawMine(); }, () => {}));
  }
  drawDm(); drawMine(); drawCashBtn(); drawArch();
}
function bubbles(list, mine) {
  return list.map((m) => { const t = new Date(tsMs(m.le));
    return '<div class="cm ' + (m.tous ? 'call' : m.de === mine ? 'cme' : 'cthem') + '">' + (m.tous ? '📣 ' : '') + esc(m.txt || '') + (m.img ? '<img src="' + esc(m.img) + '" alt="photo">' : '') +
      '<div class="ct">' + (m.tous ? 'À tous · ' : m.de === 'dispatch' && mine === 'dispatch' ? esc(m.nom || '') + ' · ' : '') + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') + '</div></div>'; }).join('');
}
async function sendMsg(mid, de, txt, img, tous) {
  txt = String(txt || '').trim().slice(0, 300); if (!txt && !img) return;
  const d = { mid, de, par: me.mid, nom: me.nom || 'Dispatch', txt: txt || '📷 Photo', le: serverTimestamp() };
  if (img) d.img = img; if (tous) d.tous = true;
  await setDoc(doc(collection(db, 'messages')), d);
  if (de === 'dispatch') notifyMsg(mid, d.txt);
}
async function notifyMsg(mid, texte) {
  try { const t = await auth.currentUser.getIdToken();
    fetch(NOTIFIER, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ type: 'message', mid, texte }) }).catch(() => {}); } catch (e) {}
}
function markRead(mid, side) { setDoc(doc(db, 'lus', mid), { [side]: Date.now() }, { merge: true }).catch(() => {}); }
function unreadFor(mid) { const lu = (dm.lus[mid] && dm.lus[mid].dispatch) || 0; return dm.all.filter((m) => m.mid === mid && m.de === 'livreur' && tsMs(m.le) > lu).length; }
const typing = (box) => document.activeElement && document.activeElement.closest && document.activeElement.closest('#' + box) && document.activeElement.tagName === 'INPUT';

// ----- Côté dispatch (propriétaire, MOUSSE, lost quand il est autorisé comme dispatch) -----
function drawDm() {
  const box = $('dmCard'); if (!box || !me) return;
  if (!isDispatcher()) { box.innerHTML = ''; return; }
  const ids = new Set(Object.values(soirees).filter((s) => working(s) && !isDispPerson(s)).map((s) => s.mid));
  dm.all.forEach((m) => ids.add(m.mid));
  const total = [...ids].reduce((a, id) => a + unreadFor(id), 0);
  const tb = document.querySelector('#tabs button[data-t="direct"]'); if (tb) tb.textContent = 'En direct' + (total ? ' 🔴' + total : '');
  if (dm.open) {
    const mid = dm.open, list = dm.all.filter((m) => m.mid === mid);
    if (unreadFor(mid)) markRead(mid, 'dispatch');
    if (typing('dmCard') && $('dmFeed')) { $('dmFeed').innerHTML = bubbles(list, 'dispatch') || '<div class="small">Pas encore de message.</div>'; $('dmFeed').scrollTop = 1e6; return; }
    box.innerHTML = '<div class="card"><button class="linkbtn" id="dmBack">‹ Tous les livreurs</button><div class="label" style="margin-top:6px">💬 ' + esc(nomDe(mid)) + '</div>' +
      '<div class="cfeed" id="dmFeed">' + (bubbles(list, 'dispatch') || '<div class="small">Pas encore de message.</div>') + '</div>' +
      '<div class="seg" style="margin:6px 0">' + DQ.map((q) => '<button data-dq="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
      '<div class="crow"><input id="dmTxt" maxlength="300" placeholder="Écrire à ' + esc(nomDe(mid)) + '…"><label class="cpic">📷<input type="file" id="dmPic" accept="image/*" class="hide"></label><button class="btn sm" id="dmSend">➤</button></div><div class="err" id="dmErr"></div></div>';
    $('dmFeed').scrollTop = 1e6;
    const go = (t, img) => sendMsg(mid, 'dispatch', t, img).catch((e) => { $('dmErr').textContent = msg(e); });
    $('dmBack').onclick = () => { dm.open = null; drawDm(); };
    box.querySelectorAll('[data-dq]').forEach((b) => { b.onclick = () => go(b.dataset.dq); });
    $('dmSend').onclick = () => { const v = $('dmTxt').value; $('dmTxt').value = ''; go(v); };
    $('dmTxt').onkeydown = (e) => { if (e.key === 'Enter') $('dmSend').click(); };
    $('dmPic').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { go('', await shrinkImg(f)); } catch (x) {} } };
    return;
  }
  if (typing('dmCard')) return;
  const rows = [...ids].sort((a, b) => nomDe(a).localeCompare(nomDe(b), 'fr')).map((id) => {
    const list = dm.all.filter((m) => m.mid === id), last = list[list.length - 1], n = unreadFor(id);
    return '<div class="q dmrow" data-mid="' + id + '" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center"><div><b>' + esc(nomDe(id)) + '</b><div class="small">' +
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
  box.querySelectorAll('[data-lq]').forEach((b) => { b.onclick = () => go(b.dataset.lq); });
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
  b.classList.toggle('hide', !(delivers() && mySoiree && working(mySoiree)));
  b.onclick = async () => {
    const pop = $('cashPop');
    if (!pop.classList.contains('hide')) { pop.classList.add('hide'); return; }
    pop.textContent = '…'; pop.classList.remove('hide');
    try {
      const d = soirStart(), list = [];
      const qs = await getDocs(query(collection(db, 'commandes'), where('livreur', '==', me.mid), where('statut', '==', 'livree')));
      qs.forEach((x) => { const c = x.data(); const t = c.livreeLe && c.livreeLe.toDate ? c.livreeLe.toDate() : null; if (t && t >= d) list.push(c); });
      const r = sumUp(list)[0] || { cash: 0, n: 0 };
      pop.innerHTML = '💰 <b>' + money(r.cash) + '</b> cash · <b>' + r.n + '</b> livraison' + (r.n > 1 ? 's' : '');
    } catch (e) { pop.textContent = msg(e); }
    clearTimeout(drawCashBtn.t); drawCashBtn.t = setTimeout(() => pop.classList.add('hide'), 8000);
  };
}
