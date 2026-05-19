// Proxy serverless Vercel pour TravelGuesser v0.6.1 — DEBUG
// Étape 1 : récupère les avions via ADSB.lol /v2/lat/lon/dist
// Étape 2 : enrichit avec routes via ADSB.lol /api/0/routeset
// MODE DEBUG : ajoute ?debug=1 à l'URL pour voir le format brut de la réponse routeset

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { lat, lon, radius = 50, debug } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const debugInfo = {
    routeset_payload_sent: null,
    routeset_status: null,
    routeset_response_sample: null,
    routeset_error: null
  };

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
      headers: { 'Accept': 'application/json', 'User-Agent': 'TravelGuesser/0.6' },
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

    // === ÉTAPE 2 : appeler /api/0/routeset ===
    const routesByCallsign = {};
    let routesetRawResponse = null;

    if (aircraft.length > 0) {
      const planes = aircraft.map(a => ({
        callsign: (a.flight || '').trim(),
        lat: a.lat,
        lng: a.lon
      })).filter(p => p.callsign.length >= 3);

      if (planes.length > 0) {
        const payload = { planes };
        debugInfo.routeset_payload_sent = {
          planes_count: planes.length,
          sample_plane: planes[0]
        };

        try {
          const ctl2 = new AbortController();
          const to2 = setTimeout(() => ctl2.abort(), 8000);
          const routeResp = await fetch('https://api.adsb.lol/api/0/routeset', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'TravelGuesser/0.6'
            },
            body: JSON.stringify(payload),
            signal: ctl2.signal
          });
          clearTimeout(to2);

          debugInfo.routeset_status = routeResp.status;

          if (routeResp.ok) {
            routesetRawResponse = await routeResp.json();
            if (Array.isArray(routesetRawResponse)) {
              debugInfo.routeset_response_sample = {
                type: 'array', length: routesetRawResponse.length,
                first_two: routesetRawResponse.slice(0, 2)
              };
            } else if (routesetRawResponse && typeof routesetRawResponse === 'object') {
              debugInfo.routeset_response_sample = {
                type: 'object',
                keys: Object.keys(routesetRawResponse),
                sample: JSON.stringify(routesetRawResponse).slice(0, 1500)
              };
            }

            // Indexer par callsign en essayant plusieurs structures
            const tryIndex = (items) => {
              if (!Array.isArray(items)) return;
              for (const r of items) {
                if (!r) continue;
                const cs = (r.callsign || r.flight || '').toString().trim();
                if (cs) routesByCallsign[cs] = r;
              }
            };
            if (Array.isArray(routesetRawResponse)) tryIndex(routesetRawResponse);
            else if (routesetRawResponse.routes) tryIndex(routesetRawResponse.routes);
            else if (routesetRawResponse.planes) tryIndex(routesetRawResponse.planes);
          } else {
            const txt = await routeResp.text();
            debugInfo.routeset_error = 'HTTP ' + routeResp.status + ': ' + txt.slice(0, 300);
          }
        } catch (e) {
          debugInfo.routeset_error = 'Exception: ' + e.message;
        }
      }
    }

    // === ÉTAPE 3 : assembler la réponse ===
    const states = aircraft.map(a => {
      const altMeters = (typeof a.alt_baro === 'number') ? Math.round(a.alt_baro * 0.3048) : null;
      const speedMs = (typeof a.gs === 'number') ? a.gs * 0.514444 : null;
      const onGround = (a.alt_baro === 'ground') || (a.gnd === true);
      const verticalRate = (typeof a.baro_rate === 'number') ? a.baro_rate * 0.00508 : 0;
      const callsign = (a.flight || a.hex || '').trim();
      const route = routesByCallsign[callsign] || null;

      // Plusieurs noms de champs possibles
      let airportCodes = null;
      let airports = null;
      let airlineCode = null;
      if (route) {
        airportCodes = route.airport_codes
          || route.airport_codes_iata
          || route.airportcodes
          || (route.origin && route.destination ? `${route.origin}-${route.destination}` : null);
        airports = route._airports || route.airports || null;
        airlineCode = route.airline_code || route.airline || null;
      }

      return [
        a.hex || '',
        callsign,
        '',
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        a.lon,
        a.lat,
        altMeters,
        onGround,
        speedMs,
        a.track || 0,
        verticalRate,
        null, null, null, false, 0, 0,
        a.t || null,
        a.r || null,
        a.nav_altitude_mcp || null,
        a.nav_altitude_fms || null,
        a.category || null,
        airportCodes,
        airports,
        airlineCode
      ];
    });

    const response = {
      time: Math.floor(Date.now() / 1000),
      states,
      source: 'adsb.lol',
      enriched: Object.keys(routesByCallsign).length,
      total: states.length
    };

    if (debug === '1' || debug === 'true') {
      response.debug = debugInfo;
      response.routeset_raw_sample = routesetRawResponse
        ? (Array.isArray(routesetRawResponse)
            ? routesetRawResponse.slice(0, 3)
            : routesetRawResponse)
        : null;
    } else {
      response.debug_summary = {
        routeset_status: debugInfo.routeset_status,
        routeset_error: debugInfo.routeset_error,
        planes_sent: debugInfo.routeset_payload_sent ? debugInfo.routeset_payload_sent.planes_count : 0,
        enriched: Object.keys(routesByCallsign).length
      };
    }

    return res.status(200).json(response);

  } catch (err) {
    return res.status(200).json({
      error: 'Proxy error: ' + (err.message || 'unknown'),
      states: [],
      debug: debugInfo
    });
  }
}
