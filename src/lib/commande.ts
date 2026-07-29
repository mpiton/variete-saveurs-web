// Logique de validation de /api/commande, isolée du Worker pour être testable.
// Aucune I/O ici : le Worker garde le formData, le base64 et l'appel Brevo.

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_OCTETS = 3 * 1024 * 1024;   // marge au-dessus de la compression client (~2 Mo)
export const MAX_TOTAL_OCTETS = 8 * 1024 * 1024;   // sous la limite Brevo (~10 Mo)

export const echapper = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Champs {
  description: string;
  date: string;
  remise: string;
  adresse: string;
  prenom: string;
  nom: string;
  telephone: string;
  email: string;
}

/** Les champs refusés, dans l'ordre du formulaire. Vide = demande recevable. */
export const champsManquants = (c: Champs, maintenant: number): string[] => {
  const manquants: string[] = [];
  if (!c.description) manquants.push('description');
  // Le round-trip ISO rejette le mauvais format ET les dates impossibles (2026-02-31, 2026-13-40).
  // Le client pose date.min=demain ; un POST direct ne passe pas par le formulaire.
  const jour = new Date(`${c.date}T12:00:00Z`);
  const demain = new Date(maintenant + 86_400_000).toISOString().slice(0, 10);
  if (Number.isNaN(jour.getTime()) || !jour.toISOString().startsWith(c.date) || c.date < demain) {
    manquants.push('date');
  }
  if (c.remise !== 'retrait' && c.remise !== 'livraison') manquants.push('remise');
  if (c.remise === 'livraison' && !c.adresse) manquants.push('adresse');
  if (!c.prenom) manquants.push('prenom');
  if (!c.nom) manquants.push('nom');
  if (!c.telephone) manquants.push('telephone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) manquants.push('email');
  return manquants;
};

/**
 * Les photos effectivement jointes. Une photo hors gabarit est écartée en silence
 * (le client filtre déjà, un POST direct non) ; le cumul coupe la série.
 */
export const photosRetenues = <T extends { type: string; size: number }>(fichiers: T[]): T[] => {
  const gardees: T[] = [];
  let total = 0;
  for (const f of fichiers) {
    if (gardees.length >= MAX_PHOTOS) continue;
    if (!f.type.startsWith('image/')) continue;
    if (f.size === 0 || f.size > MAX_PHOTO_OCTETS) continue;
    total += f.size;
    if (total > MAX_TOTAL_OCTETS) break;
    gardees.push(f);
  }
  return gardees;
};
