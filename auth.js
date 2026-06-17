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

  // Permesso per-profilo (Admin sempre dentro; dashboard sempre accessibile; default tollerante)
  if (profile.ruolo !== 'Admin' && pageName !== 'dashboard.html') {
    const { data: perm } = await supabaseClient
      .from('permessi_profili').select('can_access')
      .eq('profilo', profile.ruolo).eq('pagina', pageName).maybeSingle();
    if (perm && perm.can_access === false) {
      alert('Non hai i permessi per accedere a questa pagina.');
      window.location.href = 'dashboard.html'; return null;
    }
  }

  const el = document.getElementById('userName');
  if (el) el.textContent = `Ciao, ${profile.nome || 'Utente'}`;

  await applyMenuPermissions();
  registraAccesso(pageName, 'visualizzazione');
  return profile;
}

// Calcola le pagine vietate al profilo, le memorizza in cache di sessione e le nasconde via CSS
async function applyMenuPermissions() {
  if (!currentProfile) return;
  const isAdminUser = currentProfile.ruolo === 'Admin';
  const denied = [];
  if (!isAdminUser) {
    ['utenti.html', 'crea-utente.html'].forEach(p => denied.push(p)); // pagine solo-Admin
    const { data } = await supabaseClient.from('permessi_profili')
      .select('pagina, can_access').eq('profilo', currentProfile.ruolo);
    (data || []).forEach(r => { if (r.can_access === false) denied.push(r.pagina); });
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
