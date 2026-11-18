// Version 3 : connexion, équipe, stock des dispatchs et check-in (Firebase).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, doc, getDoc, getDocFromServer, onSnapshot, writeBatch, setDoc, increment, serverTimestamp, collection, query, where, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
const delivers = () => me && (me.role === 'livreur' || me.livre);
function buildTabs() {
  const t = [];
  if (isOwner() || isStaff()) t.push(['direct', 'En direct'], ['stock', 'Stock']);
  if (delivers()) t.push(['soiree', 'Ma soirée']);
  if (isOwner()) t.push(['equipe', 'Équipe']);
  $('tabs').innerHTML = t.map((x) => '<button data-t="' + x[0] + '">' + x[1] + '</button>').join('');
  $('tabs').classList.toggle('hide', t.length < 2);
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
  setTab(t[0][0]);
}
let curTab = '';
function setTab(t) {
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
const ACTIVES = ['demande', 'load', 'ouverte'];
let stocks = {}, soirees = {}, mySoiree = null, mvts = [];
const nomDe = (id) => (id === RESERVE ? 'Réserve' : id === 'proprietaire' ? 'Propriétaire' : (team[id] && team[id].nom) || id);
const hhmm = (ts) => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d ? d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') : ''; };
const qty = (o) => (o.L || 0) + ' L · ' + (o.XL || 0) + ' XL';

function startLive() {
  stops.push(onSnapshot(collection(db, 'members'), (qs) => { team = {}; qs.forEach((d) => { team[d.id] = d.data(); }); renderTeam(); renderAll(); }, () => {}));
  if (isOwner()) stops.push(onSnapshot(collection(db, 'paies'), (qs) => { paies = {}; qs.forEach((d) => { paies[d.id] = d.data().paie; }); renderTeam(); }, () => {}));
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
      mySoiree = null; qs.forEach((d) => { mySoiree = Object.assign({ id: d.id }, d.data()); }); renderSoiree();
    }, (e) => console.warn(e)));
  }
  renderAll(); renderSoiree();
}
function renderAll() { if (!me) return; if (isOwner() || isStaff()) { renderDirect(); renderStock(); } }
const st = (id) => stocks[id] || { L: 0, XL: 0 };

// ---------- En direct (dispatch) ----------
const drafts = {}; // load en cours de préparation par demande
function renderDirect() {
  const mine = st(me.mid);
  $('myStockCard').classList.toggle('hide', isOwner());
  $('msL').textContent = mine.L || 0; $('msXL').textContent = mine.XL || 0;
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
  $('service').innerHTML = srv.map((s) => '<div class="item"><b>' + esc(s.nom) + '</b> <span class="small">· depuis ' + hhmm(s.ouverteLe) + '</span><div class="small">' +
    ((isOwner() || me.role === 'complet') ? qty(st(s.mid)) + ' · ' : '') + esc(s.adresse || '') + '</div></div>').join('') || '<div class="small">Personne pour l’instant.</div>';
}
function canAuthorize(s) { return isOwner() || me.role === 'complet' || s.mid !== me.mid; }
function reqHtml(s) {
  const d = drafts[s.id] || (drafts[s.id] = { L: (s.load && s.load.L) || 0, XL: (s.load && s.load.XL) || 0, adr: s.adresse || '' });
  const self = s.mid === me.mid;
  if (self && !canAuthorize(s)) return '<div class="item"><div class="wait"><span class="dot"></span><b>Ta soirée</b>&nbsp;attend MOUSSE ou le propriétaire.</div></div>';
  const src = isOwner() ? RESERVE : me.mid;
  const have = st(src);
  const over = !isOwner() && (d.L > (have.L || 0) || d.XL > (have.XL || 0));
  const gard = st(s.mid);
  return '<div class="item" data-sid="' + s.id + '"><b>' + esc(s.nom) + ' veut commencer</b> <span class="small">· ' + hhmm(s.demandeLe) + '</span>' +
    (s.refusLe ? '<div class="small" style="color:var(--danger)">A refusé le dernier load (pas le bon compte).</div>' : '') +
    '<div class="label" style="margin-top:10px">Adresse de départ (tu peux corriger)</div><input class="rAdr" value="' + esc(d.adr) + '">' +
    ((isOwner() || me.role === 'complet') && (gard.L || gard.XL) ? '<div class="small" style="margin:-2px 0 8px">Il a déjà sur lui : ' + qty(gard) + '</div>' : '') +
    (self ? '<div class="small" style="margin-bottom:8px">C’est toi : ta soirée s’ouvre avec ton stock.</div>' :
      '<div class="label">Load à lui envoyer' + (isOwner() ? ' (de la réserve)' : ' (de ton stock)') + '</div>' +
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
    const src = isOwner() ? RESERVE : me.mid;
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
const give = { to: null, L: 0, XL: 0 };
function giveTargets() {
  const disp = Object.keys(team).filter((id) => team[id].actif && (team[id].role === 'complet' || team[id].role === 'limite'));
  if (isOwner()) return disp;                                                   // propriétaire → un dispatch (de la réserve)
  if (me.role === 'complet') return disp.filter((id) => id !== me.mid);         // MOUSSE → Lost (ou un autre dispatch)
  return disp.filter((id) => team[id].role === 'complet');                      // Lost → seulement retourner à MOUSSE
}
function renderStock() {
  const all = isOwner() || me.role === 'complet';
  const ids = all ? Object.keys(team).filter((id) => team[id].actif || (stocks[id] && (stocks[id].L || stocks[id].XL)))
    .sort((a, b) => ({ complet: 0, limite: 1, livreur: 2 }[team[a].role] - { complet: 0, limite: 1, livreur: 2 }[team[b].role]) || team[a].nom.localeCompare(team[b].nom, 'fr')) : [me.mid];
  $('stockList').innerHTML = ids.map((id) => '<div class="srow"><span>' + esc(nomDe(id)) + (id === me.mid ? ' (moi)' : '') + '</span><b>' + qty(st(id)) + '</b></div>').join('');
  const tg = giveTargets();
  $('giveCard').classList.toggle('hide', !tg.length);
  if (give.to && tg.indexOf(give.to) < 0) give.to = null;
  if (!give.to && tg.length === 1) give.to = tg[0];
  $('giveTitle').textContent = isOwner() ? 'Donner du stock (de la réserve)' : me.role === 'complet' ? 'Donner de mon stock' : 'Retourner du stock';
  $('giveWho').innerHTML = '<div class="who">' + tg.map((id) => '<button data-id="' + id + '" class="' + (give.to === id ? 'on' : '') + '">' + esc(nomDe(id)) + '</button>').join('') + '</div>';
  document.querySelectorAll('#giveWho button').forEach((b) => { b.onclick = () => { give.to = b.dataset.id; renderStock(); }; });
  $('gL').textContent = give.L; $('gXL').textContent = give.XL;
  $('gGo').textContent = isOwner() || me.role === 'complet' ? 'Donner' + (give.to ? ' à ' + nomDe(give.to) : '') : 'Retourner' + (give.to ? ' à ' + nomDe(give.to) : '');
  $('mvts').innerHTML = mvts.map((m) => hhmm(m.le) + ' · ' + esc(nomDe(m.de)) + ' → ' + esc(nomDe(m.vers)) + ' : ' + qty(m) + (m.type === 'load' ? ' (load)' : '') + (m.par && m.par !== m.de ? ' · par ' + esc(nomDe(m.par)) : '')).join('<br>') || 'Aucun mouvement pour l’instant.';
}
document.querySelectorAll('#giveCard .step button').forEach((b) => { b.onclick = () => { give[b.dataset.k] = Math.max(0, give[b.dataset.k] + Number(b.dataset.d)); $('gErr').textContent = ''; renderStock(); }; });
$('gGo').onclick = async () => {
  $('gErr').textContent = '';
  if (!give.to) return ($('gErr').textContent = 'Choisis à qui.');
  if (!give.L && !give.XL) return ($('gErr').textContent = 'Mets une quantité.');
  const src = isOwner() ? RESERVE : me.mid;
  if (src !== RESERVE && (give.L > (st(src).L || 0) || give.XL > (st(src).XL || 0))) return ($('gErr').textContent = 'Tu n’as que ' + qty(st(src)) + '.');
  $('gGo').disabled = true;
  try {
    const b = writeBatch(db);
    if (src !== RESERVE) b.set(doc(db, 'stocks', src), { L: increment(-give.L), XL: increment(-give.XL) }, { merge: true });
    b.set(doc(db, 'stocks', give.to), { L: increment(give.L), XL: increment(give.XL) }, { merge: true });
    b.set(doc(collection(db, 'mouvements')), { de: src, vers: give.to, L: give.L, XL: give.XL, type: me.role === 'limite' ? 'retour' : 'don', par: me.mid, le: serverTimestamp() });
    await b.commit();
    give.L = 0; give.XL = 0; renderStock();
  } catch (e) { $('gErr').textContent = msg(e); }
  $('gGo').disabled = false;
};

// ---------- Ma soirée (livreur) ----------
const ci = { q: '', pick: null, sugs: [], timer: null, seq: 0 };
function renderSoiree() {
  if (!me || !delivers()) return;
  const s = mySoiree, mine = st(me.mid);
  let h = '';
  if (!s) {
    h = '<div class="card"><div class="label">Commencer ma soirée</div>' +
      '<p class="small" style="margin-top:0">Où es-tu en ce moment ?</p>' +
      '<input id="ciAdr" placeholder="Ex. 1400 Sainte-Catherine" autocomplete="off" value="' + esc(ci.q) + '">' +
      '<div id="ciSugs"></div>' +
      '<p class="small" style="margin-top:0">Tu peux aussi écrire une adresse qui n’est pas dans la liste.</p>' +
      ((mine.L || mine.XL) ? '<p class="small">Tu as déjà sur toi : <b style="color:var(--text)">' + qty(mine) + '</b></p>' : '') +
      '<div class="err" id="ciErr"></div><button class="btn ok" id="ciGo">Envoyer la demande</button></div>';
  } else if (s.statut === 'demande') {
    h = '<div class="card"><div class="wait"><span class="dot"></span><b>En attente du dispatch…</b></div>' +
      '<p class="small">Adresse envoyée : ' + esc(s.adresse) + '</p><div class="err" id="ciErr"></div><button class="btn ghost" id="ciCancel">Annuler ma demande</button></div>';
  } else if (s.statut === 'load') {
    const L = s.load || {};
    h = '<div class="card alert"><div class="label">Ton load est arrivé</div>' +
      '<p style="margin:0 0 10px">' + esc(nomDe(L.de)) + ' t’envoie <b>' + (L.L || 0) + ' L</b> et <b>' + (L.XL || 0) + ' XL</b>.</p>' +
      '<p class="small" style="margin-top:0">Compte avant d’accepter. Avec ce que tu as déjà, tu auras ' + ((L.L || 0) + (mine.L || 0)) + ' L · ' + ((L.XL || 0) + (mine.XL || 0)) + ' XL.</p>' +
      '<div class="err" id="ciErr"></div><div class="two"><button class="btn red" id="ciRefuse">Pas le bon compte</button><button class="btn ok" id="ciAccept">J’accepte</button></div></div>';
  } else if (s.statut === 'ouverte') {
    h = '<div class="card"><div class="label">Soirée ouverte ✓ <span class="small" style="text-transform:none;letter-spacing:0">depuis ' + hhmm(s.ouverteLe) + '</span></div>' +
      '<div class="stock"><div><b>' + (mine.L || 0) + '</b>L</div><div><b>' + (mine.XL || 0) + '</b>XL</div></div>' +
      '<p class="small">Départ : ' + esc(s.adresse) + '</p><p class="small" style="margin-bottom:0">Prochaine étape : ta file de commandes apparaîtra ici.</p></div>';
  }
  const keepFocus = document.activeElement && document.activeElement.id === 'ciAdr';
  const pos = keepFocus ? document.activeElement.selectionStart : null;
  $('soiree').innerHTML = h;
  if ($('ciAdr')) {
    $('ciAdr').oninput = (e) => { ci.q = e.target.value; ci.pick = null; lookup(); };
    if (keepFocus) { $('ciAdr').focus(); try { $('ciAdr').setSelectionRange(pos, pos); } catch (e) {} }
    drawSugs();
    $('ciGo').onclick = () => soirAct(requestStart);
  }
  if ($('ciCancel')) $('ciCancel').onclick = () => soirAct(() => writeBatch(db).update(doc(db, 'soirees', s.id), { statut: 'annulee', finLe: serverTimestamp() }).commit());
  if ($('ciAccept')) $('ciAccept').onclick = () => soirAct(() => acceptLoad(s));
  if ($('ciRefuse')) $('ciRefuse').onclick = () => soirAct(() => refuseLoad(s));
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
  const adr = ci.q.trim();
  if (adr.length < 4) { $('ciErr').textContent = 'Écris où tu es.'; return; }
  const data = { mid: me.mid, nom: me.nom, statut: 'demande', adresse: adr, demandeLe: serverTimestamp() };
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
