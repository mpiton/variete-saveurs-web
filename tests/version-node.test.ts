import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// La version de Node est écrite à deux endroits du dépôt : .nvmrc (la
// référence, lue par nvm et par la CI) et engines.node dans package.json. Les
// workflows GitHub, eux, doivent lire .nvmrc et ne plus porter de version en
// dur. Rien ne casse quand ils divergent : la CI vérifie sous une version, le
// site se construit sous une autre, et l'écart ne se voit qu'en production. Ce
// test les tient ensemble.
//
// Reste hors de portée : la variable NODE_VERSION du projet Cloudflare Pages.
// Elle vit dans les réglages Cloudflare, c'est elle que suit le build Pages
// (elle l'emporte sur .nvmrc), et elle se change à la main en même temps que
// ce fichier. Si elle reste en arrière, engine-strict (.npmrc) fait échouer
// l'installation du build Pages : le site précédent reste en ligne.
const lire = (chemin: string): string =>
  readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

const nvmrc = lire('.nvmrc').trim();

type Etape = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Etape[] }> };

const DOSSIER_WORKFLOWS = '.github/workflows';

const fichiersWorkflow = (): string[] =>
  readdirSync(new URL(`../${DOSSIER_WORKFLOWS}/`, import.meta.url))
    .filter((nom) => /\.ya?ml$/.test(nom))
    .map((nom) => `${DOSSIER_WORKFLOWS}/${nom}`);

const etapesSetupNode = (): { fichier: string; etape: Etape }[] =>
  fichiersWorkflow().flatMap((fichier) =>
    Object.values((parse(lire(fichier)) as Workflow).jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((etape) => etape.uses?.startsWith('actions/setup-node@'))
      .map((etape) => ({ fichier, etape })),
  );

describe('version de Node', () => {
  it('.nvmrc donne une version majeure, sans préfixe ni mineure', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('engines.node de package.json part de la version de .nvmrc', () => {
    const { engines } = JSON.parse(lire('package.json')) as { engines?: { node?: string } };
    expect(engines?.node).toBe(`>=${nvmrc}`);
  });

  it('.npmrc fait échouer l\'installation sous un Node plus ancien', () => {
    const lignes = lire('.npmrc').split('\n').map((ligne) => ligne.trim());
    expect(lignes).toContain('engine-strict=true');
  });

  it('aucun workflow ne réécrit la version : chaque setup-node lit .nvmrc', () => {
    const etapes = etapesSetupNode();
    expect(etapes.length).toBeGreaterThan(0);
    for (const { fichier, etape } of etapes) {
      expect(etape.with?.['node-version-file'], fichier).toBe('.nvmrc');
      expect(etape.with, fichier).not.toHaveProperty('node-version');
    }
  });
});
