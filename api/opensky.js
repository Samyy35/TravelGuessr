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

    const distNm = Math.min(250, Math.round(radiusKm / 1.852));
    const url = `https://api.adsb.lol/v2/lat/${latNum}/lon/${lonNum}/dist/${distNm}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TravelGuesser/0.5'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const txt = await response.text();
      return res.status(200).json({
        error: 'ADSB.lol returned ' + response.status,
        details: txt.slice(0, 200),
        states: []
      });
    }

    const data = await response.json();
    const aircraft = data.ac || [];

    const states = aircraft
      .filter(a => a.lat != null && a.lon != null && a.flight)
      .map(a => {
        const altMeters = (typeof a.alt_baro === 'number') ? Math.round(a.alt_baro * 0.3048) : null;
        const speedMs = (typeof a.gs === 'number') ? a.gs * 0.514444 : null;
        const onGround = (a.alt_baro === 'ground') || (a.gnd === true);

        return [
          a.hex || '',
          (a.flight || a.hex || '').trim(),
          '',
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
          a.lon,
          a.lat,
          altMeters,
          onGround,
          speedMs,
          a.track || 0,
          0,
          null, null, null, false, 0, 0
        ];
      });

    return res.status(200).json({
      time: Math.floor(Date.now() / 1000),
      states,
      source: 'adsb.lol'
    });

  } catch (err) {
    return res.status(200).json({
      error: 'Proxy error: ' + (err.message || 'unknown'),
      states: []
    });
  }
}
