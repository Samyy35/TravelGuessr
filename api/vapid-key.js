// Endpoint /api/vapid-key
// Retourne la clé publique VAPID pour permettre au client de subscribe

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  return res.status(200).json({ vapidPublicKey: key });
}
