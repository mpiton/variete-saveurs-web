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

// ——— Validation structurelle des images ———
// Le `type` MIME d'un POST est déclaré par le client et ne vaut rien. La simple
// signature d'en-tête ne vaut guère mieux : trois octets `FF D8 FF` se collent
// devant n'importe quelle charge. On vérifie donc la structure complète du
// conteneur — segments JPEG jusqu'au scan, chunks PNG jusqu'à IEND, taille RIFF
// — et on exige que le fichier finisse là où le format finit : rien ne peut
// être ajouté derrière. Renvoie l'extension à imposer côté serveur, ou null.

const terminePar = (o: Uint8Array, a: number, b: number) =>
  o.length >= 2 && o[o.length - 2] === a && o[o.length - 1] === b;

// SOI, segments balisés jusqu'au SOS (les données compressées suivent), EOI en
// toute fin. Un préfixe `FF D8 FF` sans structure ne mène nulle part.
const estJpeg = (o: Uint8Array): boolean => {
  if (o.length < 6 || o[0] !== 0xff || o[1] !== 0xd8) return false;
  if (!terminePar(o, 0xff, 0xd9)) return false;   // EOI : rien d'ajouté après l'image
  let i = 2;
  while (i + 4 <= o.length) {
    if (o[i] !== 0xff) return false;
    const marqueur = o[i + 1]!;
    if (marqueur === 0x00 || marqueur === 0xff) return false;
    if (marqueur === 0xda) return true;   // SOS : début des données compressées
    if (marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) { i += 2; continue; }   // marqueurs autonomes
    const longueur = (o[i + 2]! << 8) | o[i + 3]!;
    if (longueur < 2 || i + 2 + longueur > o.length) return false;
    i += 2 + longueur;
  }
  return false;   // jamais de SOS : pas d'image
};

// Signature, IHDR de 13 octets obligatoire en premier chunk, chaîne de chunks
// bornés (longueur + type ASCII + CRC), IEND en toute fin.
const estPng = (o: Uint8Array): boolean => {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (o.length < 8 + 12 + 13 + 12 || !SIGNATURE.every((b, i) => o[i] === b)) return false;
  let i = 8;
  let premier = true;
  while (i + 12 <= o.length) {
    const longueur = ((o[i]! << 24) | (o[i + 1]! << 16) | (o[i + 2]! << 8) | o[i + 3]!) >>> 0;
    const type = String.fromCharCode(o[i + 4]!, o[i + 5]!, o[i + 6]!, o[i + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (longueur > o.length || i + 12 + longueur > o.length) return false;
    if (premier && (type !== 'IHDR' || longueur !== 13)) return false;
    premier = false;
    i += 12 + longueur;
    if (type === 'IEND') return i === o.length;   // rien d'ajouté après IEND
  }
  return false;
};

// RIFF dont la taille déclarée égale la taille réelle (rien d'ajouté), et un
// chunk image VP8/VP8L/VP8X immédiatement après l'en-tête WEBP.
const estWebp = (o: Uint8Array): boolean => {
  const est = (d: number, s: string) =>
    o.length >= d + 4 && [...s].every((c, i) => o[d + i] === c.charCodeAt(0));
  if (o.length < 20 || !est(0, 'RIFF') || !est(8, 'WEBP')) return false;
  const tailleRiff = (o[4]! | (o[5]! << 8) | (o[6]! << 16) | (o[7]! << 24)) >>> 0;
  if (tailleRiff !== o.length - 8) return false;
  return est(12, 'VP8 ') || est(12, 'VP8L') || est(12, 'VP8X');
};

/** Le format réel d'une image validée structurellement, ou null. */
export const formatImage = (octets: Uint8Array): 'jpg' | 'png' | 'webp' | null =>
  estJpeg(octets) ? 'jpg' : estPng(octets) ? 'png' : estWebp(octets) ? 'webp' : null;

export interface PhotoValide {
  octets: Uint8Array;
  format: 'jpg' | 'png' | 'webp';
}

/**
 * Les photos effectivement jointes. La validation des octets passe AVANT les
 * quotas : un fichier invalide ne consomme ni slot ni budget, donc une vraie
 * photo derrière une série de fichiers piégés n'est pas évincée. Le MIME
 * déclaré est ignoré — seul le contenu décide. Une photo hors gabarit est
 * écartée en silence ; le cumul des photos valides coupe la série.
 */
export const photosValides = async (
  fichiers: { size: number; arrayBuffer(): Promise<ArrayBuffer> }[],
): Promise<PhotoValide[]> => {
  const gardees: PhotoValide[] = [];
  let total = 0;
  for (const f of fichiers) {
    if (gardees.length >= MAX_PHOTOS) break;
    if (f.size === 0 || f.size > MAX_PHOTO_OCTETS) continue;
    const octets = new Uint8Array(await f.arrayBuffer());
    const format = formatImage(octets);
    if (!format) continue;
    total += f.size;
    if (total > MAX_TOTAL_OCTETS) break;
    gardees.push({ octets, format });
  }
  return gardees;
};
