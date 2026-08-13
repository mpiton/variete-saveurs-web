// Fonction Cloudflare Pages : POST /api/commande
// Valide la demande, transforme en email Brevo vers l'adresse pro. Aucun stockage (ADR 0002).

import { champsManquants, echapper, photosValides } from '../../src/lib/commande';

interface Env {
  BREVO_API_KEY: string;      // secret Worker — jamais dans le repo
  ORDER_EMAIL: string;        // adresse pro destinataire
  SENDER_EMAIL: string;       // expéditeur vérifié Brevo (SPF/DKIM)
  TURNSTILE_SECRET?: string;  // optionnel : active la vérification Turnstile si présent
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Un corps vide ou malformé fait lever formData() : on répond 400 plutôt que 500.
  let donnees: FormData;
  try {
    donnees = await request.formData();
  } catch {
    return Response.json({ ok: false, erreur: 'lecture' }, { status: 400 });
  }

  // Honeypot : on répond « ok » sans rien envoyer
  if (String(donnees.get('site') ?? '') !== '') {
    return Response.json({ ok: true });
  }

  if (env.TURNSTILE_SECRET) {
    const token = String(donnees.get('cf-turnstile-response') ?? '');
    let succes = false;
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
        signal: AbortSignal.timeout(5000),
      });
      succes = r.ok && ((await r.json()) as { success: boolean }).success;
    } catch (e) {
      console.error('turnstile', e);   // réseau, timeout, réponse non-JSON : on refuse
    }
    if (!succes) return Response.json({ ok: false, erreur: 'anti-spam' }, { status: 403 });
  }

  const champ = (nom: string) => String(donnees.get(nom) ?? '').trim();
  const description = champ('description');
  const date = champ('date');
  const remise = champ('remise');
  const adresse = champ('adresse');
  const prenom = champ('prenom');
  const nom = champ('nom');
  const telephone = champ('telephone');
  const email = champ('email');
  const facebook = champ('facebook');

  const manquants = champsManquants(
    { description, date, remise, adresse, prenom, nom, telephone, email, facebook },
    Date.now(),
  );
  if (manquants.length) return Response.json({ ok: false, erreur: 'champs', manquants }, { status: 400 });

  // Photos → pièces jointes base64. Seul le contenu compte : le MIME déclaré est
  // ignoré, la structure binaire est validée avant tout quota, et le nom est
  // imposé côté serveur — celui du POST pourrait être « facture.svg ».
  const fichiers = donnees.getAll('photos').filter((e): e is File => e instanceof File);
  const attachments: { name: string; content: string }[] = [];
  for (const { octets, format } of await photosValides(fichiers)) {
    let bin = '';
    for (let i = 0; i < octets.length; i += 0x8000) {
      bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    }
    attachments.push({ name: `photo-${attachments.length + 1}.${format}`, content: btoa(bin) });
  }

  const dateFr = new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ligne = (t: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6B5A4E;white-space:nowrap;vertical-align:top">${t}</td><td style="padding:6px 0">${echapper(v)}</td></tr>`;

  const html = `
    <div style="font-family:Georgia,serif;color:#4A2C1A">
      <h2 style="color:#C0182B">Nouvelle demande de commande</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
        ${ligne('Client', `${prenom} ${nom}`)}
        ${ligne('Téléphone', telephone)}
        ${ligne('Email', email)}
        ${facebook ? ligne('Facebook', facebook) : ''}
        ${ligne('Date souhaitée', dateFr)}
        ${ligne('Remise', remise === 'livraison' ? `Livraison — ${adresse}` : 'Retrait sur place')}
        ${ligne('Photos', attachments.length ? `${attachments.length} en pièce(s) jointe(s)` : 'aucune')}
      </table>
      <h3 style="margin-top:18px">Demande</h3>
      <p style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${echapper(description)}</p>
    </div>`;

  let envoye = false;
  try {
    const envoi = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: env.SENDER_EMAIL, name: 'variete-de-saveurs.fr' },
        to: [{ email: env.ORDER_EMAIL }],
        replyTo: { email, name: `${prenom} ${nom}` },
        subject: `Demande de commande — ${prenom} ${nom} — ${dateFr}`,
        htmlContent: html,
        ...(attachments.length ? { attachment: attachments } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    envoye = envoi.ok;
    if (!envoi.ok) console.error('brevo', envoi.status, await envoi.text());
  } catch (e) {
    console.error('brevo', e);   // réseau ou timeout : même 502 que sur réponse en erreur
  }

  if (!envoye) return Response.json({ ok: false, erreur: 'envoi' }, { status: 502 });
  return Response.json({ ok: true });
};
