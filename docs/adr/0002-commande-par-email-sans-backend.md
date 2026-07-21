# Commande par email, sans backend ni sync avec l'app mobile

La demande de commande passée sur le site part en email vers l'adresse pro, via un Worker Cloudflare qui appelle l'API Brevo (compte et domaine vérifié déjà en place, cf. ADR mobile 0002). La gérante traite la demande comme celles qui arrivent aujourd'hui par téléphone ou Facebook : elle crée le devis dans l'app mobile. L'app reste 100 % locale, sans backend ni compte, conformément à son architecture — le site ne lui impose aucune modification. Coût assumé : pas de suivi de statut côté client, et la « commande » n'est qu'une demande, pas un engagement.

## Consequences

- Le Worker est le seul code serveur du projet : validation, anti-spam (honeypot + Turnstile), transformation en email, pièces jointes photos en base64. Aucun stockage.
- La clé Brevo vit en secret Worker, jamais dans le repo — même règle que l'app mobile.
- Le reply-to est l'email du client : répondre à la demande = ouvrir la conversation commerciale.

## Considered Options

- **Backend de commandes (Workers + D1) synchronisé avec l'app** — casse le principe « 100 % locale » de l'app, ajoute auth, sync et états de commande ; disproportionné tant que le volume ne le justifie pas ; écarté.
- **Service de formulaires tiers** — dépendance externe et quotas pour économiser ~30 lignes de Worker ; écarté.
- **mailto:** — dépend du client mail du visiteur, aucune structure garantie, pas de pièces jointes fiables ; écarté.
