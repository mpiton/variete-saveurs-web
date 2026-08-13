// Test d'intégration du Worker POST /api/commande : le fetch Brevo est bouchonné,
// tout le reste (formData, honeypot, validation, filtrage des photos) tourne pour de vrai.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './commande';

const ENV = {
  BREVO_API_KEY: 'cle-de-test',
  ORDER_EMAIL: 'pro@example.com',
  SENDER_EMAIL: 'site@example.com',
  // pas de TURNSTILE_SECRET : la vérification anti-spam est hors de ce test
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2]);
const SVG_PIÈGE = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const requete = (photos: File[], corps?: (fd: FormData) => void) => {
  const fd = new FormData();
  fd.set('description', 'Un fraisier pour 8 personnes');
  fd.set('date', '2099-01-15');
  fd.set('remise', 'retrait');
  fd.set('prenom', 'Aline');
  fd.set('nom', 'Piton');
  fd.set('telephone', '0516483243');
  fd.set('email', 'client@example.com');
  corps?.(fd);
  for (const p of photos) fd.append('photos', p);
  return new Request('https://test.local/api/commande', { method: 'POST', body: fd });
};

const brevo = vi.fn();
vi.stubGlobal('fetch', brevo);
afterEach(() => brevo.mockReset());

// Renvoie le JSON que le Worker a posté à Brevo.
const appelBrevo = async () => {
  expect(brevo).toHaveBeenCalledOnce();
  const init = brevo.mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body)) as { attachment?: { name: string; content: string }[] };
};

describe('onRequestPost', () => {
  it('répond 400 et non 500 sur un corps illisible', async () => {
    const req = new Request('https://test.local/api/commande', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=casse' },
      body: 'ceci-n-est-pas-du-multipart',
    });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(400);
    expect(brevo).not.toHaveBeenCalled();
  });

  it('écarte un SVG déguisé en image/jpeg', async () => {
    brevo.mockResolvedValue(new Response('{}', { status: 201 }));
    const piege = new File([SVG_PIÈGE], 'photo.html', { type: 'image/jpeg' });
    const res = await onRequestPost({ request: requete([piege]), env: ENV });
    expect(res.status).toBe(200);
    const corps = await appelBrevo();
    expect(corps.attachment ?? []).toEqual([]);
  });

  it('impose le nom et l\'extension d\'après le contenu réel, pas celui du POST', async () => {
    brevo.mockResolvedValue(new Response('{}', { status: 201 }));
    const mensonge = new File([PNG], 'facture.svg', { type: 'image/png' });
    const jpeg = new File([JPEG], 'avec espace & co.jpg', { type: 'image/jpeg' });
    const res = await onRequestPost({ request: requete([mensonge, jpeg]), env: ENV });
    expect(res.status).toBe(200);
    const corps = await appelBrevo();
    expect(corps.attachment?.map((a) => a.name)).toEqual(['photo-1.png', 'photo-2.jpg']);
  });
});
