// Endpoint plane-image : récupère une photo d'un modèle d'avion via Pexels API
// Cache simple en mémoire

const CACHE = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Mapping code modèle → requête Pexels optimisée
const MODEL_QUERIES = {
  'A380': ['Airbus A380', 'A380 aircraft', 'double decker plane'],
  'B747': ['Boeing 747', '747 jumbo jet', 'jumbo jet aircraft'],
  'A350': ['Airbus A350', 'A350 XWB', 'modern airliner'],
  'A330': ['Airbus A330', 'A330 aircraft', 'wide body jet'],
  'A320': ['Airbus A320', 'A320 aircraft', 'commercial airliner'],
  'B777': ['Boeing 777', '777 aircraft', 'twin engine airliner'],
  'B787': ['Boeing 787 Dreamliner', 'B787 aircraft', 'Dreamliner'],
  'B737': ['Boeing 737', '737 aircraft', 'narrow body jet'],
  'E190': ['Embraer E190', 'regional jet', 'small commercial plane']
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const { model } = req.query;
  if (!model) {
    return res.status(400).json({ error: 'model query param required' });
  }

  const key = model.toUpperCase();
  const cached = CACHE.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.status(200).json({ url: cached.url, cached: true });
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ url: null, error: 'PEXELS_API_KEY not configured' });
  }

  const queries = MODEL_QUERIES[key] || [`${key} aircraft`, 'commercial aircraft'];

  try {
    let photoUrl = null;
    for (const q of queries) {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=medium&per_page=8`;
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: ctl.signal
      });
      clearTimeout(tid);
      if (!r.ok) continue;
      const data = await r.json();
      if (data.photos && data.photos.length > 0) {
        const pick = data.photos[Math.floor(Math.random() * Math.min(5, data.photos.length))];
        photoUrl = pick.src.medium || pick.src.small;
        break;
      }
    }

    if (!photoUrl) {
      return res.status(200).json({ url: null, error: 'No photo found' });
    }

    CACHE.set(key, { url: photoUrl, ts: Date.now() });
    return res.status(200).json({ url: photoUrl });
  } catch (e) {
    return res.status(200).json({ url: null, error: e.message });
  }
}
