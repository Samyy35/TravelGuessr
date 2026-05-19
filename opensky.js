// Proxy serverless Vercel pour TravelGuesser v0.5
// Étape 1 : récupère les avions via ADSB.lol /v2/lat/lon/dist
// Étape 2 : enrichit avec routes via ADSB.lol /api/0/routeset
// Format de sortie : compatible avec l'app (basé sur OpenSky) + champs enrichis

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

    // === ÉTAPE 1 : récupérer les avions ===
    const acUrl = `https://api.adsb.lol/v2/lat/${latNum}/lon/${lonNum}/dist/${distNm}`;

    const ctl1 = new AbortController();
    const to1 = setTimeout(() => ctl1.abort(), 8000);
    const acResp = await fetch(acUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'TravelGuesser/0.5' },
      signal: ctl1.signal
    });
    clearTimeout(to1);

    if (!acResp.ok) {
      const txt = await acResp.text();
      return res.status(200).json({
        error: 'ADSB.lol /v2 returned ' + acResp.status,
        details: txt.slice(0, 200),
        states: []
      });
    }

    const acData = await acResp.json();
    const aircraft = (acData.ac || []).filter(a => a.lat != null && a.lon != null && a.flight);

    // === ÉTAPE 2 : appeler /api/0/routeset pour enrichir ===
    // On envoie tous les callsigns + positions à ADSB.lol pour obtenir les routes
    const routesByCallsign = {};

    if (aircraft.length > 0) {
      const planes = aircraft.map(a => ({
        callsign: (a.flight || '').trim(),
        lat: a.lat,
        lng: a.lon
      })).filter(p => p.callsign.length >= 3);

      if (planes.length > 0) {
        try {
          const ctl2 = new AbortController();
          const to2 = setTimeout(() => ctl2.abort(), 6000);
          const routeResp = await fetch('https://api.adsb.lol/api/0/routeset', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'TravelGuesser/0.5'
            },
            body: JSON.stringify({ planes }),
            signal: ctl2.signal
          });
          clearTimeout(to2);

          if (routeResp.ok) {
            const routeData = await routeResp.json();
            // Format de réponse attendu : array d'objets { callsign, airport_codes, ... }
            // ou { _airports: [{iata, icao, name, ...}] }
            // On indexe par callsign pour lookup rapide
            const routes = Array.isArray(routeData) ? routeData : (routeData.routes || []);
            for (const r of routes) {
              const cs = (r.callsign || '').trim();
              if (cs) routesByCallsign[cs] = r;
            }
          }
        } catch (e) {
          // Si routeset plante, on continue sans enrichissement
          console.warn('routeset failed:', e.message);
        }
      }
    }

    // === ÉTAPE 3 : assembler la réponse au format de l'app ===
    const states = aircraft.map(a => {
      const altMeters = (typeof a.alt_baro === 'number') ? Math.round(a.alt_baro * 0.3048) : null;
      const speedMs = (typeof a.gs === 'number') ? a.gs * 0.514444 : null;
      const onGround = (a.alt_baro === 'ground') || (a.gnd === true);
      const verticalRate = (typeof a.baro_rate === 'number') ? a.baro_rate * 0.00508 : 0; // ft/min → m/s
      const callsign = (a.flight || a.hex || '').trim();
      const route = routesByCallsign[callsign] || null;

      // Format de base compatible OpenSky (positionnel)
      const stateVector = [
        a.hex || '',                       // 0 icao24
        callsign,                          // 1 callsign
        '',                                // 2 origin_country
        Math.floor(Date.now() / 1000),     // 3 time_position
        Math.floor(Date.now() / 1000),     // 4 last_contact
        a.lon,                             // 5 longitude
        a.lat,                             // 6 latitude
        altMeters,                         // 7 baro_altitude (m)
        onGround,                          // 8 on_ground
        speedMs,                           // 9 velocity (m/s)
        a.track || 0,                      // 10 true_track
        verticalRate,                      // 11 vertical_rate (m/s)
        null, null, null, false, 0, 0,     // 12-17 sensors, geo_alt, squawk, spi, source, category
        // === Champs enrichis TravelGuesser à partir de l'index 18 ===
        a.t || null,                       // 18 type ICAO (B38M, A20N, ...)
        a.r || null,                       // 19 registration
        a.nav_altitude_mcp || null,        // 20 altitude cible MCP
        a.nav_altitude_fms || null,        // 21 altitude cible FMS
        a.category || null,                // 22 catégorie taille (A3, A5, A7...)
        route ? (route.airport_codes || null) : null,    // 23 ex: "EBBR-LFPG"
        route ? (route._airports || null) : null,        // 24 détails aéroports
        route ? (route.airline_code || null) : null      // 25 code compagnie 3-letter
      ];

      return stateVector;
    });

    return res.status(200).json({
      time: Math.floor(Date.now() / 1000),
      states,
      source: 'adsb.lol',
      enriched: Object.keys(routesByCallsign).length,
      total: states.length
    });

  } catch (err) {
    return res.status(200).json({
      error: 'Proxy error: ' + (err.message || 'unknown'),
      states: []
    });
  }
}
