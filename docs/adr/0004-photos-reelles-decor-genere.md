# Photos réelles pour les produits, décor généré en SVG

Les produits sont montrés exclusivement en photos réelles fournies par la gérante — des photos téléphone bien éclairées suffisent au lancement. Tout le décor du site (ornements, motifs, textures, illustrations de fond, icônes) est généré, en SVG, dans la palette de la marque (rouge #C0182B, or, crème, rose). Motivation : le client commande ce qu'il voit ; une photo IA d'une pâtisserie qui n'existe pas est une promesse que la production ne tiendra pas telle quelle. Le SVG s'impose pour le décor : net à toutes les densités, quelques Ko, colorable aux tokens de la marque. Coût assumé : la mise en ligne dépend de la fourniture des photos, et leur qualité conditionne l'impression d'ensemble.

## Consequences

- Les photos produits sont un contenu bloquant (`PRODUCT.md`, « Contenu à fournir »).
- Les prompts et fichiers du décor généré sont versionnés dans le repo (`src/assets/`), reproductibles et retouchables.

## Considered Options

- **Identité 100 % illustrée, sans photos** — élégant et sans dépendance aux photos, mais le client ne voit pas les produits réels ; défendable pour une pure vitrine, pas pour une page qui appelle à commander ; écarté.
- **Photos IA des produits** — rapide et spectaculaire, mais trompeur sur ce qui est vendu ; écarté.
