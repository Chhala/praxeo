// Feuille du bas (invites, fiches). Un tap sur le voile la ferme.

let voile = null;
let surFermeture = null;

export function ouvrirFeuille(html, brancher, quandFermee = null) {
  fermerFeuille();
  surFermeture = quandFermee;
  voile = document.createElement('div');
  voile.className = 'voile';
  voile.innerHTML = `<div class="feuille" role="dialog" aria-modal="true"><div class="feuille-poignee"></div>${html}</div>`;
  voile.addEventListener('click', (e) => { if (e.target === voile) fermerFeuille(); });
  document.body.appendChild(voile);
  requestAnimationFrame(() => voile && voile.classList.add('ouvert'));
  if (brancher) brancher(voile.querySelector('.feuille'));
}

export function fermerFeuille() {
  if (!voile) return;
  const v = voile;
  voile = null;
  const f = surFermeture;
  surFermeture = null;
  if (f) f();
  v.classList.remove('ouvert');
  setTimeout(() => v.remove(), 220);
}
