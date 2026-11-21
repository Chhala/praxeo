// PRAXEO v2 — Annuler (lot 3, validé le 19/11/2026) : après chaque action, une mention « Annuler » apparaît
// quelques secondes en bas de l'écran ; on peut revenir sur les 4 dernières actions (comme en v1).

const MAX = 4;
const DUREE = 5000;   // ms d'affichage de la mention
const pile = [];
let minuteur = null;

// action : { libelle: 'Lexis faite', defaire: async () => {…} }
export function enregistrer(libelle, defaire) {
  pile.push({ libelle, defaire });
  if (pile.length > MAX) pile.shift();
  montrer();
}

function montrer() {
  const toast = document.getElementById('toast');
  const derniere = pile[pile.length - 1];
  if (!toast || !derniere) return;
  toast.querySelector('.toast-texte').textContent = derniere.libelle;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('visible'));
  clearTimeout(minuteur);
  minuteur = setTimeout(cacher, DUREE);
}

function cacher() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.remove('visible');
  setTimeout(() => { if (!toast.classList.contains('visible')) toast.hidden = true; }, 250);
}

export async function annulerDerniere() {
  const action = pile.pop();
  if (!action) return;
  clearTimeout(minuteur);
  await action.defaire();
  document.dispatchEvent(new CustomEvent('praxeo:change'));   // chaque onglet se redessine
  if (pile.length) montrer(); else cacher();
}

export function initAnnuler() {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-annuler').addEventListener('click', annulerDerniere);
}
