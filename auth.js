// auth.js — Autenticazione condivisa (Supabase Auth)
// Richiede che la pagina includa PRIMA:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const SUPABASE_URL = 'https://fqnzoxttbzzlgjxefelx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxbnpveHR0Ynp6bGdqeGVmZWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4NTksImV4cCI6MjA4Mjk0Nzg1OX0.PLsZsBkac_Pjd8irfOXSwGlM5mg7B6X-5HRSQOfaFnk';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  // Permesso per-pagina (l'Admin ha sempre accesso; default = consentito se non c'è una riga)
  if (profile.ruolo !== 'Admin') {
    const { data: perm } = await supabaseClient
      .from('permessi_pagine').select('can_access')
      .eq('user_id', profile.id).eq('pagina', pageName).maybeSingle();
    if (perm && perm.can_access === false) {
      alert('Non hai i permessi per accedere a questa pagina.');
      window.location.href = 'dashboard.html'; return null;
    }
  }

  const el = document.getElementById('userName');
  if (el) el.textContent = `Ciao, ${profile.nome || 'Utente'}`;

  registraAccesso(pageName, 'visualizzazione');
  return profile;
}

function getCurrentUser() { return currentProfile; }
function isAdmin() { return !!currentProfile && currentProfile.ruolo === 'Admin'; }

async function logout() {
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
