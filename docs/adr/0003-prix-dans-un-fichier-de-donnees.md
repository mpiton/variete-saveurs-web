# Prix dans un fichier de données versionné

La carte et les prix vivent dans `src/data/carte.yaml`, édité par le mainteneur et publié par commit + déploiement automatique. Les prix de la pâtisserie changent rarement ; un CMS ou un flux d'export depuis l'app mobile serait de l'infrastructure pour un besoin qui ne s'est pas encore présenté. Le fichier reprend le vocabulaire du Catalogue (`CONTEXT.md` parent : nom, groupe, prix unitaire, unité) pour que la carte du site et le catalogue de l'app racontent la même chose. Coût assumé : la gérante passe par le mainteneur pour tout changement, et rien ne garantit mécaniquement la cohérence site ↔ app.

## Considered Options

- **Export du catalogue depuis l'app mobile** — garantit la cohérence mais ajoute un chantier app et un workflow de publication ; à reconsidérer si les prix divergent ou changent souvent ; écarté pour l'instant.
- **CMS headless éditable par la gérante** — autonomie maximale mais setup, auth et formation ; justifié seulement si le passage par le mainteneur devient un goulot ; écarté.
