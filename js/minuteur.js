// Minuteur de l'Horloge, lancé par le raccourci iOS « Praxeo Minuteur » (§5.5).
// Une application web ne peut pas sonner quand elle n'est pas à l'écran : seule l'Horloge le peut.
// iOS exige un geste de l'utilisateur pour lancer un raccourci : à appeler dans un gestionnaire de tap.

export const NOM_RACCOURCI = 'Praxeo Minuteur';

// Sablier au trait (19/11/2026) : plus proche de l'esprit antique qu'une horloge
export const SVG_SABLIER = '<svg class="sablier" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7.5 3c0 5 4.5 6.2 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6.2-4.5 9s4.5 4 4.5 9"/><path class="sable" d="M9.6 19.6h4.8L12 16.8z"/></svg>';

export function dureeCourte(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function lancerMinuteur(minutes) {
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(NOM_RACCOURCI)}&input=text&text=${Math.round(minutes)}`;
  window.location.href = url;   // sur l'iPhone, ouvre Raccourcis ; ailleurs, sans effet
}
