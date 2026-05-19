// Endpoint city-image : récupère une photo de ville via Pexels API
// Clé Pexels en env var PEXELS_API_KEY
// Cache simple en mémoire (vivant le temps de la fonction serverless)

const CACHE = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h cache navigateur

  const { city, country } = req.query;
  if (!city) {
    return res.status(400).json({ error: 'city query param required' });
  }

  const key = `${city}|${country || ''}`.toLowerCase();
  const cached = CACHE.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.status(200).json({ url: cached.url, cached: true });
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ url: null, error: 'PEXELS_API_KEY not configured' });
  }

  try {
    // Recherche : "{city} skyline" puis fallback "{city}"
    const queries = [`${city} skyline`, `${city} city`, city];
    let photoUrl = null;

    for (const q of queries) {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=5`;
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
        // Prend une photo au hasard parmi les premiers résultats (variété)
        const pick = data.photos[Math.floor(Math.random() * Math.min(3, data.photos.length))];
        photoUrl = pick.src.large || pick.src.medium;
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
