import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// La version de Node est écrite à deux endroits du dépôt : .nvmrc (la
// référence, lue par nvm et par la CI) et engines.node dans package.json. Le
// workflow de CI, lui, doit lire .nvmrc et ne plus porter de version en dur.
// Rien ne casse quand ils divergent : la CI vérifie sous une version, le site
// se construit sous une autre, et l'écart ne se voit qu'en production. Ce test
// les tient ensemble.
//
// Reste hors de portée : la variable NODE_VERSION du projet Cloudflare Pages.
// Elle vit dans les réglages Cloudflare, c'est elle que suit le build Pages
// (elle l'emporte sur .nvmrc), et elle se change à la main en même temps que
// ce fichier.
const lire = (chemin: string): string =>
  readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

const nvmrc = lire('.nvmrc').trim();

type Etape = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps: Etape[] }> };

const etapesSetupNode = (): Etape[] =>
  Object.values((parse(lire('.github/workflows/ci.yml')) as Workflow).jobs)
    .flatMap((job) => job.steps)
    .filter((etape) => etape.uses?.startsWith('actions/setup-node@'));

describe('version de Node', () => {
  it('.nvmrc donne une version majeure, sans préfixe ni mineure', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('engines.node de package.json part de la version de .nvmrc', () => {
    const { engines } = JSON.parse(lire('package.json')) as { engines?: { node?: string } };
    expect(engines?.node).toBe(`>=${nvmrc}`);
  });

  it('la CI lit .nvmrc au lieu de réécrire la version', () => {
    const etapes = etapesSetupNode();
    expect(etapes.length).toBeGreaterThan(0);
    for (const etape of etapes) {
      expect(etape.with?.['node-version-file']).toBe('.nvmrc');
      expect(etape.with).not.toHaveProperty('node-version');
    }
  });
});
