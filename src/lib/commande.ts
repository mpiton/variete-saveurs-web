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
// conteneur, au plus près d'un décodeur (que le runtime Workers n'a pas) :
// segments JPEG avec SOF et table de Huffman, entropy stream parcouru jusqu'à
// l'EOI final ; chunks PNG avec CRC32 vérifié, IDAT présent, IEND en toute fin ;
// chunks WebP énumérés avec taille RIFF exacte. Et le fichier finit là où le
// format finit : rien ne peut être ajouté derrière. Limite connue : un octet
// stream syntaxiquement valide mais indécodable (ex. image tronquée en plein
// scan) peut encore passer — il serait joint sous un nom photo-N.* inoffensif,
// jamais exécutable. Renvoie l'extension à imposer côté serveur, ou null.

// SOI, segments balisés (DHT/DAC et SOFn obligatoires avant le premier SOS),
// puis alternance scans/segments : les JPEG progressifs comptent une dizaine de
// scans. Dans l'entropy stream, FF 00 est un octet échappé, RSTn un repère,
// les FF répétés du bourrage ; tout autre marqueur (nouveau SOS, DHT…) renvoie
// à la boucle des segments. Seul EOI termine — en toute fin de fichier.
const estJpeg = (o: Uint8Array): boolean => {
  if (o.length < 6 || o[0] !== 0xff || o[1] !== 0xd8) return false;
  let i = 2;
  let sof = false, table = false, scan = false;
  while (i + 1 < o.length) {
    if (o[i] !== 0xff) return false;
    let marqueur = o[i + 1]!;
    while (marqueur === 0xff) {                 // bourrage avant marqueur
      i++;
      if (i + 1 >= o.length) return false;
      marqueur = o[i + 1]!;
    }
    if (marqueur === 0x00) return false;        // FF 00 n'existe que dans les données
    if (marqueur === 0xd9) {
      if (!scan) return false;                  // EOI sans le moindre scan : pas d'image
      // Certains encodeurs doublent l'EOI ou ajoutent du bourrage FF : on
      // tolère ça, mais aucun autre octet ne peut suivre l'image.
      for (let j = i + 2; j < o.length; j++) if (o[j] !== 0xff && o[j] !== 0xd9) return false;
      return true;
    }
    if (marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) { i += 2; continue; }
    if (i + 4 > o.length) return false;
    const longueur = (o[i + 2]! << 8) | o[i + 3]!;
    if (longueur < 2 || i + 2 + longueur > o.length) return false;
    if (marqueur === 0xc4 || marqueur === 0xcc) table = true;   // DHT ou DAC
    if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) sof = true;
    i += 2 + longueur;
    if (marqueur !== 0xda) continue;
    if (!sof || !table) return false;           // pas de cadre ni de table : pas d'image
    scan = true;
    while (i + 1 < o.length) {                  // entropy stream jusqu'au prochain marqueur
      if (o[i] !== 0xff) { i++; continue; }
      let suivant = o[i + 1]!;
      while (suivant === 0xff) {                // bourrage
        i++;
        if (i + 1 >= o.length) return false;
        suivant = o[i + 1]!;
      }
      if (suivant === 0x00 || (suivant >= 0xd0 && suivant <= 0xd7)) { i += 2; continue; }
      break;                                    // vrai marqueur : retour boucle segments
    }
    if (i + 1 >= o.length) return false;        // scan jamais terminé
  }
  return false;                                 // jamais d'EOI
};

// CRC32 (polynôme PNG), calculé sur type + données de chaque chunk.
const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (o: Uint8Array, debut: number, fin: number): number => {
  let c = 0xffffffff;
  for (let i = debut; i < fin; i++) c = TABLE_CRC[(c ^ o[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Signature, IHDR de 13 octets obligatoire en premier chunk, chaîne de chunks
// bornés dont le CRC32 est vérifié, IDAT présent, IEND en toute fin.
const estPng = (o: Uint8Array): boolean => {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (o.length < 8 + 12 + 13 + 12 || !SIGNATURE.every((b, i) => o[i] === b)) return false;
  let i = 8;
  let premier = true, idat = false;
  while (i + 12 <= o.length) {
    const longueur = ((o[i]! << 24) | (o[i + 1]! << 16) | (o[i + 2]! << 8) | o[i + 3]!) >>> 0;
    const type = String.fromCharCode(o[i + 4]!, o[i + 5]!, o[i + 6]!, o[i + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (longueur > o.length || i + 12 + longueur > o.length) return false;
    const crcLu = ((o[i + 8 + longueur]! << 24) | (o[i + 9 + longueur]! << 16) | (o[i + 10 + longueur]! << 8) | o[i + 11 + longueur]!) >>> 0;
    if (crc32(o, i + 4, i + 8 + longueur) !== crcLu) return false;
    if (premier && (type !== 'IHDR' || longueur !== 13)) return false;
    premier = false;
    if (type === 'IDAT') idat = true;
    i += 12 + longueur;
    if (type === 'IEND') return longueur === 0 && idat && i === o.length;   // IEND nu, en toute fin
  }
  return false;
};

// RIFF dont la taille déclarée égale la taille réelle (rien d'ajouté), chunks
// énumérés jusqu'au bout du fichier, dont un chunk image VP8/VP8L.
const estWebp = (o: Uint8Array): boolean => {
  const est = (d: number, s: string) =>
    o.length >= d + 4 && [...s].every((c, i) => o[d + i] === s.charCodeAt(i));
  const le32 = (d: number) => (o[d]! | (o[d + 1]! << 8) | (o[d + 2]! << 16) | (o[d + 3]! << 24)) >>> 0;
  if (o.length < 20 || !est(0, 'RIFF') || !est(8, 'WEBP')) return false;
  if (le32(4) !== o.length - 8) return false;
  let i = 12, image = false;
  while (i + 8 <= o.length) {
    const type = String.fromCharCode(o[i]!, o[i + 1]!, o[i + 2]!, o[i + 3]!);
    if (!/^[A-Za-z0-9 ]{4}$/.test(type)) return false;
    const taille = le32(i + 4);
    if (taille > o.length || i + 8 + taille > o.length) return false;
    if (type === 'VP8 ' || type === 'VP8L') image = true;
    i += 8 + taille + (taille & 1);   // les chunks impairs sont complétés d'un octet
  }
  return i === o.length && image;   // un VP8X seul, sans image derrière, ne suffit pas
};

/** Le format réel d'une image validée structurellement, ou null. */
export const formatImage = (octets: Uint8Array): 'jpg' | 'png' | 'webp' | null =>
  estJpeg(octets) ? 'jpg' : estPng(octets) ? 'png' : estWebp(octets) ? 'webp' : null;

export interface PhotoValide {
  octets: Uint8Array;
  format: 'jpg' | 'png' | 'webp';
}

/**
 * Les photos effectivement jointes. Le plafond unitaire s'applique d'abord — il
 * évite de lire un corps énorme en mémoire — puis la validation des octets passe
 * AVANT les quotas de slots et de cumul : un fichier invalide ne consomme ni
 * place ni budget, donc une vraie photo derrière une série de fichiers piégés
 * n'est pas évincée. Le MIME déclaré est ignoré — seul le contenu décide. Une
 * photo hors gabarit est écartée en silence ; le cumul des valides coupe la série.
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
