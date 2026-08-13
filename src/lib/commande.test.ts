import { describe, expect, it } from 'vitest';
import { champsManquants, echapper, formatImage, MAX_LONGUEURS, photosValides, type Champs } from './commande';

// Horloge figée : les tests ne doivent pas dépendre du jour où on les lance.
const MAINTENANT = Date.parse('2026-07-29T10:00:00Z');   // donc la première date acceptée est le 2026-07-30

const valide = (): Champs => ({
  description: 'Un fraisier pour 8 personnes',
  date: '2026-07-30',
  remise: 'retrait',
  adresse: '',
  prenom: 'Aline',
  nom: 'Piton',
  telephone: '0516483243',
  email: 'client@example.com',
  facebook: '',
});

const long = (n: number) => 'a'.repeat(n);

describe('echapper', () => {
  it('neutralise les cinq caractères HTML', () => {
    expect(echapper(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it("désamorce une injection dans le texte libre d'une demande", () => {
    expect(echapper('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('laisse un texte ordinaire intact, accents compris', () => {
    expect(echapper('Gâteau à étages, 20 parts')).toBe('Gâteau à étages, 20 parts');
  });
});

describe('champsManquants', () => {
  it('accepte une demande complète', () => {
    expect(champsManquants(valide(), MAINTENANT)).toEqual([]);
  });

  it('liste chaque champ vide', () => {
    const vide: Champs = { description: '', date: '', remise: '', adresse: '', prenom: '', nom: '', telephone: '', email: '', facebook: '' };
    expect(champsManquants(vide, MAINTENANT)).toEqual(['description', 'date', 'remise', 'prenom', 'nom', 'telephone', 'email']);
  });

  it('refuse une date qui n\'existe pas', () => {
    expect(champsManquants({ ...valide(), date: '2026-02-31' }, MAINTENANT)).toContain('date');
    expect(champsManquants({ ...valide(), date: '2026-13-40' }, MAINTENANT)).toContain('date');
  });

  it('refuse un format de date non ISO', () => {
    expect(champsManquants({ ...valide(), date: '30/07/2026' }, MAINTENANT)).toContain('date');
  });

  it('refuse aujourd\'hui et le passé, accepte demain', () => {
    expect(champsManquants({ ...valide(), date: '2026-07-28' }, MAINTENANT)).toContain('date');
    expect(champsManquants({ ...valide(), date: '2026-07-29' }, MAINTENANT)).toContain('date');
    expect(champsManquants({ ...valide(), date: '2026-07-30' }, MAINTENANT)).not.toContain('date');
  });

  it('exige une adresse en livraison, pas en retrait', () => {
    expect(champsManquants({ ...valide(), remise: 'livraison', adresse: '' }, MAINTENANT)).toContain('adresse');
    expect(champsManquants({ ...valide(), remise: 'livraison', adresse: '2 rue des Lilas' }, MAINTENANT)).toEqual([]);
    expect(champsManquants({ ...valide(), remise: 'retrait', adresse: '' }, MAINTENANT)).toEqual([]);
  });

  it('refuse un mode de remise inventé', () => {
    expect(champsManquants({ ...valide(), remise: 'drone' }, MAINTENANT)).toContain('remise');
  });

  it('refuse une adresse email malformée', () => {
    for (const email of ['client', 'client@', '@example.com', 'a b@example.com', 'client@example']) {
      expect(champsManquants({ ...valide(), email }, MAINTENANT), email).toContain('email');
    }
  });
});

describe('champsManquants — longueurs', () => {
  it('accepte un champ pile à la borne', () => {
    expect(champsManquants({ ...valide(), description: long(MAX_LONGUEURS.description) }, MAINTENANT)).toEqual([]);
    expect(champsManquants({ ...valide(), facebook: long(MAX_LONGUEURS.facebook) }, MAINTENANT)).toEqual([]);
  });

  it('refuse un champ au-delà de la borne', () => {
    expect(champsManquants({ ...valide(), description: long(MAX_LONGUEURS.description + 1) }, MAINTENANT)).toEqual(['description']);
    expect(champsManquants({ ...valide(), prenom: long(MAX_LONGUEURS.prenom + 1) }, MAINTENANT)).toEqual(['prenom']);
    expect(champsManquants({ ...valide(), nom: long(MAX_LONGUEURS.nom + 1) }, MAINTENANT)).toEqual(['nom']);
    expect(champsManquants({ ...valide(), telephone: long(MAX_LONGUEURS.telephone + 1) }, MAINTENANT)).toEqual(['telephone']);
  });

  it('borne une adresse email de forme valide mais démesurée', () => {
    const local = MAX_LONGUEURS.email - '@example.com'.length;
    expect(champsManquants({ ...valide(), email: `${long(local)}@example.com` }, MAINTENANT)).toEqual([]);
    expect(champsManquants({ ...valide(), email: `${long(local + 1)}@example.com` }, MAINTENANT)).toEqual(['email']);
  });

  it('borne le Facebook alors même qu\'il est optionnel', () => {
    expect(champsManquants({ ...valide(), facebook: long(MAX_LONGUEURS.facebook + 1) }, MAINTENANT)).toEqual(['facebook']);
  });

  it('ne borne l\'adresse qu\'en livraison, là où elle part dans l\'email', () => {
    const enorme = long(MAX_LONGUEURS.adresse + 1);
    expect(champsManquants({ ...valide(), remise: 'livraison', adresse: enorme }, MAINTENANT)).toEqual(['adresse']);
    expect(champsManquants({ ...valide(), remise: 'retrait', adresse: enorme }, MAINTENANT)).toEqual([]);
  });
});

// Images minimales mais structurellement complètes — un simple préfixe de
// signature ne passe plus, il faut le conteneur entier (segments JPEG jusqu'au
// SOS + EOI final, chunks PNG jusqu'à IEND final, taille RIFF exacte).
const JPEG_VALIDE = new Uint8Array([
  0xff, 0xd8,                                          // SOI
  0xff, 0xe0, 0x00, 0x10, ...new Uint8Array(14),       // segment APP0 (16 octets)
  0xff, 0xda, 0x00, 0x08, ...new Uint8Array(6),        // SOS (8 octets) → données compressées
  0x2a, 0x17,
  0xff, 0xd9,                                          // EOI
]);
const PNG_VALIDE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, ...new Uint8Array(13), 0, 0, 0, 0,   // IHDR + CRC
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,              // IEND + CRC
]);
const WEBP_VALIDE = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,      // « RIFF », taille déclarée 16 = total - 8
  0x57, 0x45, 0x42, 0x50,                              // « WEBP »
  0x56, 0x50, 0x38, 0x20, 0x04, 0x00, 0x00, 0x00, ...new Uint8Array(4),   // « VP8 » + données
]);

const jpegDe = (taille: number) => {
  const entete = [0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, ...new Uint8Array(6)];   // SOI + SOS
  return new Uint8Array([...entete, ...new Uint8Array(taille - entete.length - 2), 0xff, 0xd9]);
};
const concat = (a: Uint8Array | number[], b: number[]) => new Uint8Array([...a, ...b]);

describe('formatImage', () => {
  it('reconnaît les trois formats que produit la compression navigateur', () => {
    expect(formatImage(JPEG_VALIDE)).toBe('jpg');
    expect(formatImage(PNG_VALIDE)).toBe('png');
    expect(formatImage(WEBP_VALIDE)).toBe('webp');
  });

  it('rejette les charges qui ne font qu\'imiter une signature', () => {
    expect(formatImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();                      // préfixe JPEG seul
    expect(formatImage(concat([0xff, 0xd8, 0xff], [0x3c, 0x73, 0x63, 0x72]))).toBeNull();    // préfixe + charge
    expect(formatImage(PNG_VALIDE.slice(0, 8))).toBeNull();                                  // signature PNG seule
    expect(formatImage(WEBP_VALIDE.slice(0, 12))).toBeNull();                                // « RIFF....WEBP » seul
  });

  it('exige la fin du format en fin de fichier : rien ne peut être ajouté derrière', () => {
    expect(formatImage(JPEG_VALIDE.slice(0, -2))).toBeNull();                // JPEG sans EOI
    expect(formatImage(concat(JPEG_VALIDE, [0x3c, 0x73]))).toBeNull();       // octets après l'EOI
    expect(formatImage(PNG_VALIDE.slice(0, -12))).toBeNull();                // PNG sans IEND
    expect(formatImage(concat(PNG_VALIDE, [0x3c, 0x73]))).toBeNull();        // octets après l'IEND
    const webpGonfle = concat(WEBP_VALIDE, [0, 0]);
    expect(formatImage(webpGonfle)).toBeNull();                              // taille RIFF fausse
  });

  it('démasque un fichier piégé déclaré image/*', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(formatImage(svg)).toBeNull();
    expect(formatImage(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]))).toBeNull();   // exécutable PE (« MZ »)
  });

  it('rejette un fichier vide ou tronqué avant la signature', () => {
    expect(formatImage(new Uint8Array())).toBeNull();
    expect(formatImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('photosValides', () => {
  const fichier = (octets: Uint8Array, type = 'image/jpeg') => new File([new Uint8Array(octets)], 'photo', { type });

  it('garde les photos valides, avec leur format lu dans le contenu', async () => {
    const gardees = await photosValides([fichier(JPEG_VALIDE), fichier(PNG_VALIDE, 'image/png')]);
    expect(gardees.map((p) => p.format)).toEqual(['jpg', 'png']);
  });

  it('ignore le MIME déclaré : une vraie image en application/octet-stream est gardée', async () => {
    const gardees = await photosValides([fichier(PNG_VALIDE, 'application/octet-stream'), fichier(JPEG_VALIDE, '')]);
    expect(gardees.map((p) => p.format)).toEqual(['png', 'jpg']);
  });

  it('écarte un fichier piégé déclaré image/*', async () => {
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');
    expect(await photosValides([fichier(svg)])).toEqual([]);
  });

  it('un fichier invalide ne consomme ni slot ni budget : la photo valide derrière passe', async () => {
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');
    const pieces = [fichier(svg), fichier(svg), fichier(svg), fichier(PNG_VALIDE, 'image/png')];
    const gardees = await photosValides(pieces);
    expect(gardees.map((p) => p.format)).toEqual(['png']);
  });

  it('écarte une photo vide ou au-dessus du plafond unitaire', async () => {
    expect(await photosValides([fichier(new Uint8Array())])).toEqual([]);
    expect(await photosValides([fichier(new Uint8Array(3 * 1024 * 1024 + 1))])).toEqual([]);
  });

  it('plafonne à trois photos valides', async () => {
    const pieces = [JPEG_VALIDE, JPEG_VALIDE, JPEG_VALIDE, JPEG_VALIDE].map((o) => fichier(o));
    expect(await photosValides(pieces)).toHaveLength(3);
  });

  it('coupe la série quand le cumul dépasse la limite Brevo', async () => {
    const gros = () => fichier(jpegDe(3 * 1024 * 1024));   // 3 Mo chacun, la 3e ferait 9 Mo
    expect(await photosValides([gros(), gros(), gros()])).toHaveLength(2);
  });

  it('ne compte pas les fichiers écartés dans le cumul', async () => {
    const pieces = [fichier(new Uint8Array(4 * 1024 * 1024)), fichier(JPEG_VALIDE), fichier(JPEG_VALIDE)];
    expect(await photosValides(pieces)).toHaveLength(2);
  });
});
