// Fonction Cloudflare Pages : POST /api/commande
// Valide la demande, transforme en email Brevo vers l'adresse pro. Aucun stockage (ADR 0002).

interface Env {
  BREVO_API_KEY: string;      // secret Worker — jamais dans le repo
  ORDER_EMAIL: string;        // adresse pro destinataire
  SENDER_EMAIL: string;       // expéditeur vérifié Brevo (SPF/DKIM)
  TURNSTILE_SECRET?: string;  // optionnel : active la vérification Turnstile si présent
}

const MAX_PHOTOS = 3;
const MAX_PHOTO_OCTETS = 3 * 1024 * 1024;   // marge au-dessus de la compression client (~2 Mo)
const MAX_TOTAL_OCTETS = 8 * 1024 * 1024;   // sous la limite Brevo (~10 Mo)

const echapper = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const donnees = await request.formData();

  // Honeypot : on répond « ok » sans rien envoyer
  if (String(donnees.get('site') ?? '') !== '') {
    return Response.json({ ok: true });
  }

  if (env.TURNSTILE_SECRET) {
    const token = String(donnees.get('cf-turnstile-response') ?? '');
    const verif = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
    }).then((r) => r.json() as Promise<{ success: boolean }>);
    if (!verif.success) return Response.json({ ok: false, erreur: 'anti-spam' }, { status: 403 });
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

  const manquants: string[] = [];
  if (!description) manquants.push('description');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) manquants.push('date');
  if (remise !== 'retrait' && remise !== 'livraison') manquants.push('remise');
  if (remise === 'livraison' && !adresse) manquants.push('adresse');
  if (!prenom) manquants.push('prenom');
  if (!nom) manquants.push('nom');
  if (!telephone) manquants.push('telephone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) manquants.push('email');
  if (manquants.length) return Response.json({ ok: false, erreur: 'champs', manquants }, { status: 400 });

  // Photos → pièces jointes base64
  const attachments: { name: string; content: string }[] = [];
  let total = 0;
  for (const entree of donnees.getAll('photos')) {
    if (!(entree instanceof File) || attachments.length >= MAX_PHOTOS) continue;
    if (entree.size === 0 || entree.size > MAX_PHOTO_OCTETS) continue;
    total += entree.size;
    if (total > MAX_TOTAL_OCTETS) break;
    const octets = new Uint8Array(await entree.arrayBuffer());
    let bin = '';
    for (let i = 0; i < octets.length; i += 0x8000) {
      bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    }
    attachments.push({ name: entree.name || `photo-${attachments.length + 1}.jpg`, content: btoa(bin) });
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
  });

  if (!envoi.ok) {
    console.error('brevo', envoi.status, await envoi.text());
    return Response.json({ ok: false, erreur: 'envoi' }, { status: 502 });
  }
  return Response.json({ ok: true });
};
