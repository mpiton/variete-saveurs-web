import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// La galerie tire l'alt de chaque photo du tableau LEGENDES, avec le slug du
// fichier en repli. Un repli ne casse rien de visible : la page se construit,
// l'image s'affiche, et l'alt devient « Mini choux craquelin ». C'est justement
// ce silence qui a laissé passer des légendes fausses jusqu'en production.
// On lit donc la source plutôt que d'importer, LEGENDES vivant dans le
// frontmatter d'un .astro.
//
// Ce fichier vit hors de src/pages/ : Astro route tout ce qui s'y trouve, un
// test posé là devient une page et casse le build.
const RACINE = new URL('../src/assets/galerie', import.meta.url).pathname;
const source = readFileSync(new URL('../src/pages/galerie.astro', import.meta.url).pathname, 'utf8');

const legendes = (): string[] => {
  const bloc = source.match(/const LEGENDES: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!bloc) throw new Error('bloc LEGENDES introuvable — le test suit le format du fichier');
  return [...bloc[1]!.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]!);
};

const slugs = (): string[] =>
  readdirSync(RACINE, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) =>
      readdirSync(join(RACINE, e.name))
        .filter((f) => f.endsWith('.jpg'))
        .map((f) => f.replace(/\.jpg$/, '')),
    );

describe('légendes de la galerie', () => {
  it('couvre toutes les photos, sinon l’alt retombe sur le slug', () => {
    const sans = slugs().filter((s) => !legendes().includes(s));
    expect(sans).toEqual([]);
  });

  it('ne garde pas de légende orpheline après un renommage', () => {
    const orphelines = legendes().filter((l) => !slugs().includes(l));
    expect(orphelines).toEqual([]);
  });

  it('ne classe aucune photo hors des familles affichées', () => {
    const familles = [...source.matchAll(/\{ cle: '([^']+)'/g)].map((m) => m[1]!);
    const dossiers = readdirSync(RACINE, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(dossiers.filter((d) => !familles.includes(d))).toEqual([]);
  });
});
