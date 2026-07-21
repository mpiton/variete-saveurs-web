# Site statique Astro sur Cloudflare

Le site est généré statiquement avec Astro et servi par Cloudflare. Une vitrine avec une carte de produits est du contenu, pas de l'application : tout est rendu au build depuis les fichiers du repo, zéro JavaScript envoyé au client hors l'îlot du formulaire. Cloudflare regroupe au même endroit l'hébergement, le Worker du formulaire, le DNS et (si possible) le registrar du domaine. Coût assumé : un framework de plus à connaître, et un rebuild nécessaire pour tout changement de contenu.

## Considered Options

- **HTML/CSS pur** — zéro outillage, mais pas de templating : boucler sur la carte et partager le layout entre pages devient de la duplication manuelle ; écarté.
- **Next.js** — runtime React et complexité de build sans bénéfice pour un site sans état ; à reconsidérer seulement si le site devient réellement dynamique (panier, comptes) ; écarté.
