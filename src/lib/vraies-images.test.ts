// Vérifie les validateurs contre les vraies images du site (pas des fixtures).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatImage } from './commande';

describe('formatImage contre de vraies images', () => {
  it('accepte les PNG du site', () => {
    for (const p of ['public/favicon.png', 'public/apple-touch-icon.png', 'public/og-image.png']) {
      expect(formatImage(new Uint8Array(readFileSync(p))), p).toBe('png');
    }
  });

  it('accepte les JPEG de la galerie', () => {
    const jpegs = readdirSync('src/assets/galerie', { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.jpg'));
    expect(jpegs.length).toBeGreaterThan(0);
    for (const f of jpegs) {
      expect(formatImage(new Uint8Array(readFileSync(`src/assets/galerie/${f}`))), f).toBe('jpg');
    }
  });
});
