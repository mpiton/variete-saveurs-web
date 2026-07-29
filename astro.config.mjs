import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

// Le widget anti-spam n'est servi que si la clé publique existe au build ; la
// politique de sécurité suit, pour ne pas ouvrir un domaine tiers inutilement.
// Ce fichier est évalué avant que les .env soient chargés, d'où loadEnv : sans
// lui, une clé posée en local ferait apparaître le widget dans la page sans
// ouvrir challenges.cloudflare.com dans la politique, et le script serait bloqué.
const { PUBLIC_TURNSTILE_SITEKEY } = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const turnstile = Boolean(PUBLIC_TURNSTILE_SITEKEY);

export default defineConfig({
  site: 'https://variete-de-saveurs.fr',
  integrations: [
    // Le site n'est reconstruit que lorsqu'un contenu change (déploiement sur
    // push), donc la date du build vaut date de dernière modification.
    sitemap({ lastmod: new Date() }),
  ],
  security: {
    // Astro calcule les empreintes SHA-256 de ses propres scripts et styles et
    // les écrit dans un <meta http-equiv>, ce qui remplace le 'unsafe-inline'
    // que portait public/_headers — lequel autorisait n'importe quel script
    // injecté dans la page.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",     // blob: — aperçus de photos du formulaire
        "font-src 'self'",
        "connect-src 'self'",             // le POST vers /api/commande
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
        ...(turnstile ? ['frame-src https://challenges.cloudflare.com'] : []),
      ],
      ...(turnstile
        ? { scriptDirective: { resources: ["'self'", 'https://challenges.cloudflare.com'] } }
        : {}),
    },
  },
});
