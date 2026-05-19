// Proxy serverless Vercel pour OpenSky Network
// Évite le CORS en appelant OpenSky depuis le serveur Vercel
// L'app cliente appelle /api/opensky?lat=X&lon=Y&radius=Z

export default async function handler(req, res) {
  // Autoriser les appels depuis n'importe quelle origine (notre app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

  const { lat, lon, radius = 50 } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const radiusKm = parseFloat(radius);

  // Bounding box
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(latNum * Math.PI / 180));

  const url = `https://opensky-network.org/api/states/all?` +
    `lamin=${(latNum - dLat).toFixed(4)}&lomin=${(lonNum - dLon).toFixed(4)}` +
    `&lamax=${(latNum + dLat).toFixed(4)}&lomax=${(lonNum + dLon).toFixed(4)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TravelGuesser/1.0 (proto)'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'OpenSky returned error',
        status: response.status
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Failed to fetch from OpenSky' });
  }
}
