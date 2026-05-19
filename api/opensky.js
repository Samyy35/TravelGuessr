const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET missing in env');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('Token request failed: ' + resp.status + ' ' + txt.slice(0, 200));
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  const expiresInSec = (data.expires_in || 1800) - 30;
  tokenExpiresAt = now + expiresInSec * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { lat, lon, radius = 50 } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusKm = parseFloat(radius);

    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.cos(latNum * Math.PI / 180));

    const url = 'https://opensky-network.org/api/states/all?' +
      'lamin=' + (latNum - dLat).toFixed(4) +
      '&lomin=' + (lonNum - dLon).toFixed(4) +
      '&lamax=' + (latNum + dLat).toFixed(4) +
      '&lomax=' + (lonNum + dLon).toFixed(4);

    const token = await getAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'TravelGuesser/0.5'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const txt = await response.text();
      return res.status(200).json({
        error: 'OpenSky returned ' + response.status,
        details: txt.slice(0, 200),
        states: []
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(200).json({
      error: 'Proxy error: ' + (err.message || 'unknown'),
      states: []
    });
  }
}
