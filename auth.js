// auth.js — Autenticazione condivisa (Supabase Auth)
// Richiede che la pagina includa PRIMA:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const SUPABASE_URL = 'https://fqnzoxttbzzlgjxefelx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxbnpveHR0Ynp6bGdqeGVmZWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4NTksImV4cCI6MjA4Mjk0Nzg1OX0.PLsZsBkac_Pjd8irfOXSwGlM5mg7B6X-5HRSQOfaFnk';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Nasconde SUBITO (da cache di sessione) i link vietati, per evitare il "lampo" al cambio pagina.
// Gira durante il parsing dell'<head>, prima che il menù venga disegnato.
(function () {
  try {
    const denied = JSON.parse(sessionStorage.getItem('menu_denied') || 'null');
    if (denied && denied.length) {
      const st = document.createElement('style');
      st.id = 'menu-denied-style';
      st.textContent = denied.map(p => `a[href$="${p}"]`).join(',') + '{display:none !important;}';
      (document.head || document.documentElement).appendChild(st);
    }
  } catch (e) {}
})();

let currentProfile = null; // { id, nome, cognome, email, ruolo, attivo, auth_id }

// Barra di navigazione unica e uniforme per tutte le pagine (le voci non concesse le nasconde applyMenuPermissions)
const NAV_PAGES = [
  { href: 'dashboard.html', label: 'Dashboard' },
  { href: 'fatture.html', label: 'Fatture' },
  { href: 'prodotti.html', label: 'Prodotti' },
  { href: 'vendite.html', label: 'Vendite' },
  { href: 'margini.html', label: 'Margini' },
  { href: 'ricavi.html', label: 'Ricavi' },
  { href: 'fornitori.html', label: 'Fornitori' },
  { href: 'classificazione.html', label: 'Costi' },
  { href: 'utenti.html', label: 'Utenti' },
];

function buildNavbar() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const current = (location.pathname.split('/').pop() || 'dashboard.html');
  const links = NAV_PAGES.map(p => {
    const active = p.href === current;
    const cls = active
      ? 'px-3 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-700 whitespace-nowrap'
      : 'px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap';
    return `<a href="${p.href}" class="${cls}">${p.label}</a>`;
  }).join('');
  nav.className = 'fixed top-0 left-0 right-0 bg-white shadow-lg z-40';
  nav.innerHTML =
    '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">' +
      '<div class="flex justify-between h-16">' +
        '<div class="flex items-center min-w-0">' +
          '<button onclick="window.location.href=\'dashboard.html\'" class="flex items-center space-x-3 flex-shrink-0">' +
            '<div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"><img src="logo.png" alt="Logo" class="w-full h-full object-cover"></div>' +
            '<span class="text-lg font-bold hidden sm:inline">Grappoli &amp; Luppoli</span>' +
          '</button>' +
          '<div class="hidden md:flex md:ml-6 lg:ml-10 md:space-x-1 lg:space-x-2 overflow-x-auto">' + links + '</div>' +
        '</div>' +
        '<div class="flex items-center space-x-3 flex-shrink-0">' +
          '<span id="userName" class="text-sm text-gray-600 whitespace-nowrap"></span>' +
          '<button onclick="logout()" class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">Esci</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const el = document.getElementById('userName');
  if (el && currentProfile) el.textContent = `Ciao, ${currentProfile.nome || 'Utente'}`;
}

// Da chiamare a inizio pagina protetta: await requireAuth('fatture.html');
async function requireAuth(pageName, opts = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  const { data: profile, error } = await supabaseClient
    .from('utenti').select('*').eq('auth_id', session.user.id).single();
  if (error || !profile) { await supabaseClient.auth.signOut(); window.location.href = 'index.html'; return null; }
  if (!profile.attivo) { alert('Utente disattivato.'); await supabaseClient.auth.signOut(); window.location.href = 'index.html'; return null; }
  currentProfile = profile;

  if (opts.adminOnly && profile.ruolo !== 'Admin') {
    alert('Accesso negato.'); window.location.href = 'dashboard.html'; return null;
  }

  // Permesso per-profilo (Admin sempre dentro; dashboard sempre accessibile; default NEGATO: serve grant esplicito)
  if (profile.ruolo !== 'Admin' && pageName !== 'dashboard.html') {
    const { data: perm } = await supabaseClient
      .from('permessi_profili').select('can_access')
      .eq('profilo', profile.ruolo).eq('pagina', pageName).maybeSingle();
    if (!perm || perm.can_access !== true) {
      alert('Non hai i permessi per accedere a questa pagina.');
      window.location.href = 'dashboard.html'; return null;
    }
  }

  buildNavbar();

  await applyMenuPermissions();
  checkRicaviSerali();
  registraAccesso(pageName, 'visualizzazione');
  return profile;
}

// Badge Admin: numero di ricavi serali (da PWA) in attesa di approvazione, sulla voce Ricavi
async function checkRicaviSerali() {
  try {
    if (!currentProfile || currentProfile.ruolo !== 'Admin') return;
    const { count } = await supabaseClient.from('ricavi_serali').select('*', { count: 'exact', head: true }).eq('stato', 'in_attesa');
    if (!count) return;
    document.querySelectorAll('a[href$="ricavi.html"]').forEach(a => {
      if (a.querySelector('.serali-badge')) return;
      const b = document.createElement('span');
      b.className = 'serali-badge';
      b.textContent = count;
      b.style.cssText = 'display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;background:#dc2626;color:#fff;border-radius:9px;font-size:11px;font-weight:700;margin-left:6px;padding:0 5px;';
      a.appendChild(b);
    });
  } catch (e) {}
}

// Calcola le pagine vietate al profilo, le memorizza in cache di sessione e le nasconde via CSS.
// Default STRUTTURALE: una pagina gestita è nascosta se il profilo non ha un grant esplicito (can_access=true).
// L'universo delle pagine gestite = tutte quelle presenti nella matrice permessi_profili → ogni pagina nuova è nascosta finché non viene concessa.
async function applyMenuPermissions() {
  if (!currentProfile) return;
  const isAdminUser = currentProfile.ruolo === 'Admin';
  const denied = [];
  if (!isAdminUser) {
    const { data: tutte } = await supabaseClient.from('permessi_profili').select('pagina');
    const universo = new Set((tutte || []).map(r => r.pagina));
    const { data: mie } = await supabaseClient.from('permessi_profili')
      .select('pagina, can_access').eq('profilo', currentProfile.ruolo);
    const granted = new Set((mie || []).filter(r => r.can_access === true).map(r => r.pagina));
    universo.forEach(pg => { if (!granted.has(pg)) denied.push(pg); });
    ['utenti.html', 'crea-utente.html'].forEach(p => { if (!denied.includes(p)) denied.push(p); }); // solo-Admin
  }
  try { sessionStorage.setItem('menu_denied', JSON.stringify(denied)); } catch (e) {}
  let st = document.getElementById('menu-denied-style');
  if (!st) { st = document.createElement('style'); st.id = 'menu-denied-style'; (document.head || document.documentElement).appendChild(st); }
  st.textContent = denied.length ? (denied.map(p => `a[href$="${p}"]`).join(',') + '{display:none !important;}') : '';
}

function getCurrentUser() { return currentProfile; }
function isAdmin() { return !!currentProfile && currentProfile.ruolo === 'Admin'; }

async function logout() {
  try { sessionStorage.removeItem('menu_denied'); } catch (e) {}
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

async function registraAccesso(pagina, azione = 'visualizzazione') {
  try {
    if (!currentProfile) return;
    await supabaseClient.from('log_accessi').insert([{
      user_id: currentProfile.id,
      user_email: currentProfile.email,
      user_nome: `${currentProfile.nome || ''} ${currentProfile.cognome || ''}`.trim(),
      user_ruolo: currentProfile.ruolo,
      pagina, azione, timestamp: new Date().toISOString()
    }]);
    await supabaseClient.rpc('tocca_ultimo_accesso');
  } catch (e) { console.error('Errore tracciamento:', e); }
}

// Helper per azioni personalizzate dalle pagine
async function traccia(azione, pagina) { await registraAccesso(pagina || document.title, azione); }

// Costruisce subito la barra uniforme non appena il DOM è pronto (indipendente dal login)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildNavbar);
} else {
  buildNavbar();
}
