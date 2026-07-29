// Source unique de la carte : index.astro (extrait) et carte.astro (complète) lisent d'ici.
import { parse } from 'yaml';
import carteRaw from '../data/carte.yaml?raw';

export type Produit = { nom: string; prix: string; unite?: string };
export type Groupe = { nom: string; produits: Produit[] };

export const carte = parse(carteRaw) as { groupes: Groupe[] };

// « 28 € » → montant seul ; « à partir de 60 € » → préfixe en petit ; « sur devis » → pastille
export function decouperPrix(prix: string): { tag: boolean; prefixe?: string; montant: string } {
  if (prix.toLowerCase() === 'sur devis') return { tag: true, montant: prix };
  const m = prix.match(/^(à partir de)\s+(.+)$/i);
  if (m) return { tag: false, prefixe: m[1], montant: m[2]! };
  return { tag: false, montant: prix };
}
