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
  facebook: string;
}

// Le navigateur ne borne aucun de ces champs : un POST direct peut expédier
// des mégaoctets de texte, que Brevo recopierait tels quels dans la boîte de
// la pâtissière. Les plafonds sont larges — une vraie demande tient dans un
// dixième — mais ils coupent l'abus.
export const MAX_LONGUEURS = {
  description: 5_000,
  adresse: 500,
  prenom: 100,
  nom: 100,
  telephone: 30,
  email: 254,      // RFC 5321
  facebook: 300,
} as const;

/** Les champs refusés, dans l'ordre du formulaire. Vide = demande recevable. */
export const champsManquants = (c: Champs, maintenant: number): string[] => {
  const manquants: string[] = [];
  const trop = (nom: keyof typeof MAX_LONGUEURS) => c[nom].length > MAX_LONGUEURS[nom];
  if (!c.description || trop('description')) manquants.push('description');
  // Le round-trip ISO rejette le mauvais format ET les dates impossibles (2026-02-31, 2026-13-40).
  // Le client pose date.min=demain ; un POST direct ne passe pas par le formulaire.
  const jour = new Date(`${c.date}T12:00:00Z`);
  const demain = new Date(maintenant + 86_400_000).toISOString().slice(0, 10);
  if (Number.isNaN(jour.getTime()) || !jour.toISOString().startsWith(c.date) || c.date < demain) {
    manquants.push('date');
  }
  if (c.remise !== 'retrait' && c.remise !== 'livraison') manquants.push('remise');
  if (c.remise === 'livraison' && (!c.adresse || trop('adresse'))) manquants.push('adresse');
  if (!c.prenom || trop('prenom')) manquants.push('prenom');
  if (!c.nom || trop('nom')) manquants.push('nom');
  if (!c.telephone || trop('telephone')) manquants.push('telephone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) || trop('email')) manquants.push('email');
  if (trop('facebook')) manquants.push('facebook');   // optionnel : seule la longueur est bornée
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

/**
 * Le format réel d'une image, lu dans ses premiers octets — le `type` MIME d'un
 * POST est déclaré par le client et ne vaut rien : sans cette vérification, un
 * SVG piégé ou un exécutable renommé partirait en pièce jointe vers la boîte
 * pro. Renvoie l'extension à imposer côté serveur, ou null si le contenu
 * n'est ni JPEG, ni PNG, ni WebP (ce que produit la compression du navigateur).
 */
export const formatImage = (octets: Uint8Array): 'jpg' | 'png' | 'webp' | null => {
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'jpg';
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length >= PNG.length && PNG.every((b, i) => octets[i] === b)) return 'png';
  const est = (decalage: number, s: string) =>
    octets.length >= decalage + 4 && [...s].every((c, i) => octets[decalage + i] === c.charCodeAt(0));
  if (est(0, 'RIFF') && est(8, 'WEBP')) return 'webp';
  return null;
};
