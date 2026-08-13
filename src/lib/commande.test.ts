import { describe, expect, it } from 'vitest';
import { champsManquants, echapper, formatImage, MAX_LONGUEURS, photosRetenues, type Champs } from './commande';

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

describe('photosRetenues', () => {
  const photo = (size: number, type = 'image/jpeg') => ({ type, size });

  it('garde les photos conformes', () => {
    const f = [photo(500_000), photo(800_000)];
    expect(photosRetenues(f)).toEqual(f);
  });

  it('écarte ce qui n\'est pas une image', () => {
    expect(photosRetenues([photo(1000, 'application/pdf'), photo(1000, 'text/html')])).toEqual([]);
  });

  it('écarte une photo vide ou au-dessus du plafond unitaire', () => {
    expect(photosRetenues([photo(0)])).toEqual([]);
    expect(photosRetenues([photo(3 * 1024 * 1024 + 1)])).toEqual([]);
    expect(photosRetenues([photo(3 * 1024 * 1024)])).toHaveLength(1);   // la borne exacte passe
  });

  it('plafonne à trois photos', () => {
    expect(photosRetenues([photo(1000), photo(1000), photo(1000), photo(1000)])).toHaveLength(3);
  });

  it('coupe la série quand le cumul dépasse la limite Brevo', () => {
    const gros = 3 * 1024 * 1024;                       // 3 Mo chacun, la 3e ferait 9 Mo
    expect(photosRetenues([photo(gros), photo(gros), photo(gros)])).toHaveLength(2);
  });

  it('ne compte pas les fichiers écartés dans le cumul', () => {
    const gardees = photosRetenues([photo(4 * 1024 * 1024), photo(1000), photo(1000)]);
    expect(gardees).toHaveLength(2);
  });
});

describe('formatImage', () => {
  const octets = (...valeurs: number[]) => new Uint8Array(valeurs);
  const JPEG = octets(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46);
  const PNG = octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
  const WEBP = octets(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

  it('reconnaît les trois formats que produit la compression navigateur', () => {
    expect(formatImage(JPEG)).toBe('jpg');
    expect(formatImage(PNG)).toBe('png');
    expect(formatImage(WEBP)).toBe('webp');
  });

  it('démasque un fichier piégé déclaré image/*', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(formatImage(svg)).toBeNull();
    expect(formatImage(octets(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0))).toBeNull();   // exécutable PE (« MZ »)
  });

  it('rejette un fichier vide ou tronqué avant la signature', () => {
    expect(formatImage(octets())).toBeNull();
    expect(formatImage(octets(0xff, 0xd8))).toBeNull();
    expect(formatImage(octets(0x52, 0x49, 0x46, 0x46))).toBeNull();   // « RIFF » sans « WEBP »
  });
});
