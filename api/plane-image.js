// Endpoint plane-image : récupère une photo d'un modèle d'avion via Pexels API
// Cache simple en mémoire, filtrage strict pour vue de côté / en vol

const CACHE = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Mapping code modèle → plusieurs requêtes Pexels, classées par qualité attendue
// On privilégie "side view", "in flight", "takeoff", "landing" qui donnent des vues de profil
const MODEL_QUERIES = {
  'A380': [
    'Airbus A380 in flight',
    'A380 takeoff',
    'A380 landing',
    'Emirates A380',
    'Airbus A380'
  ],
  'B747': [
    'Boeing 747 in flight',
    '747 jumbo takeoff',
    '747 landing',
    'Boeing 747 side',
    'jumbo jet'
  ],
  'A350': [
    'Airbus A350 in flight',
    'A350 takeoff',
    'A350 XWB',
    'Qatar Airways A350',
    'Airbus A350'
  ],
  'A330': [
    'Airbus A330 in flight',
    'A330 takeoff',
    'A330 landing',
    'Airbus A330'
  ],
  'A320': [
    'Airbus A320 in flight',
    'A320 takeoff',
    'A320 landing',
    'Airbus A320 side'
  ],
  'B777': [
    'Boeing 777 in flight',
    '777 takeoff',
    '777 landing',
    'Boeing 777 side',
    'Emirates 777'
  ],
  'B787': [
    'Boeing 787 in flight',
    '787 Dreamliner',
    '787 takeoff',
    'Boeing 787'
  ],
  'B737': [
    'Boeing 737 in flight',
    '737 takeoff',
    '737 landing',
    'Boeing 737 side'
  ],
  'E190': [
    'Embraer E190 in flight',
    'regional jet flying',
    'E190 takeoff',
    'Embraer 190'
  ]
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

  const queries = MODEL_QUERIES[key] || [`${key} aircraft in flight`, `${key} airplane`];

  try {
    let photoUrl = null;
    for (const q of queries) {
      // size=large pour avoir de la qualité, orientation=landscape obligatoire
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=15`;
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: ctl.signal
      });
      clearTimeout(tid);
      if (!r.ok) continue;
      const data = await r.json();
      if (!data.photos || data.photos.length === 0) continue;

      // FILTRAGE : on ne garde que les photos avec ratio >= 16/9 (1.77)
      // → exclut les vues du dessus / dessous / face qui sont souvent carrées
      const wideOnly = data.photos.filter(p => {
        if (!p.width || !p.height) return false;
        const ratio = p.width / p.height;
        return ratio >= 1.5; // au moins 3:2
      });

      const candidates = wideOnly.length > 0 ? wideOnly : data.photos;
      // Prend une photo aléatoire parmi le top 5 (variété entre parties)
      const pick = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
      photoUrl = pick.src.large || pick.src.medium || pick.src.small;
      if (photoUrl) break;
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
