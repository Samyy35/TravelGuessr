// Proxy serverless Vercel pour TravelGuesser v0.7 — FINAL
// Étape 1 : récupère les avions via ADSB.lol /v2/lat/lon/dist
// Étape 2 : pour chaque avion, fetch en parallèle vers adsbdb.com pour la route
//   - https://api.adsbdb.com/v0/callsign/{CALLSIGN}
//   - retourne directement origin/destination/airline avec IATA + ICAO + lat/lon

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { lat, lon, radius = 50, debug } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const debugInfo = {
    aircraft_total: 0,
    routes_attempted: 0,
    routes_found: 0,
    routes_errors: 0,
    sample_route: null
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
      headers: { 'Accept': 'application/json', 'User-Agent': 'TravelGuesser/0.7' },
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
    debugInfo.aircraft_total = aircraft.length;

    // === ÉTAPE 2 : récupérer les routes via adsbdb.com EN PARALLÈLE ===
    // Un appel par avion, mais tous en même temps. Avec timeout court par appel.
    const routesByCallsign = {};

    if (aircraft.length > 0) {
      const callsigns = aircraft
        .map(a => (a.flight || '').trim())
        .filter(cs => cs.length >= 3);

      // Déduplique (au cas où plusieurs avions ont le même callsign — rare mais possible)
      const uniqueCallsigns = [...new Set(callsigns)];
      debugInfo.routes_attempted = uniqueCallsigns.length;

      // Fonction qui récupère une route, avec timeout court (3s)
      const fetchRoute = async (callsign) => {
        try {
          const ctl = new AbortController();
          const tid = setTimeout(() => ctl.abort(), 3000);
          const r = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'TravelGuesser/0.7' },
            signal: ctl.signal
          });
          clearTimeout(tid);
          if (!r.ok) {
            // 404 = callsign non connu, normal pour pas mal d'avions (privés, militaires...)
            return { callsign, route: null };
          }
          const data = await r.json();
          if (data && data.response && data.response.flightroute) {
            return { callsign, route: data.response.flightroute };
          }
          return { callsign, route: null };
        } catch (e) {
          return { callsign, route: null, err: e.message };
        }
      };

      // Tous les fetchs en parallèle. Promise.allSettled pour ne JAMAIS bloquer.
      const results = await Promise.allSettled(uniqueCallsigns.map(fetchRoute));

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.route) {
          routesByCallsign[r.value.callsign] = r.value.route;
          if (!debugInfo.sample_route) {
            debugInfo.sample_route = r.value.route;
          }
        } else if (r.status === 'fulfilled' && r.value && r.value.err) {
          debugInfo.routes_errors++;
        }
      }
      debugInfo.routes_found = Object.keys(routesByCallsign).length;
    }

    // === ÉTAPE 3 : assembler la réponse au format de l'app ===
    const states = aircraft.map(a => {
      const altMeters = (typeof a.alt_baro === 'number') ? Math.round(a.alt_baro * 0.3048) : null;
      const speedMs = (typeof a.gs === 'number') ? a.gs * 0.514444 : null;
      const onGround = (a.alt_baro === 'ground') || (a.gnd === true);
      const verticalRate = (typeof a.baro_rate === 'number') ? a.baro_rate * 0.00508 : 0;
      const callsign = (a.flight || a.hex || '').trim();
      const route = routesByCallsign[callsign] || null;

      // Construire les champs enrichis depuis adsbdb
      let airportCodes = null;
      let airports = null;
      let airlineCode = null;
      if (route) {
        const origIata = route.origin && route.origin.iata_code;
        const destIata = route.destination && route.destination.iata_code;
        const origIcao = route.origin && route.origin.icao_code;
        const destIcao = route.destination && route.destination.icao_code;
        // On envoie une string "ICAO-ICAO" (format compatible avec la conversion ICAO_TO_IATA côté client)
        // mais comme on a les IATA directement, on peut aussi envoyer en format IATA
        if (origIata && destIata) {
          airportCodes = `${origIata}-${destIata}`;
        } else if (origIcao && destIcao) {
          airportCodes = `${origIcao}-${destIcao}`;
        }

        // _airports format pour ajout à la volée d'aéroports inconnus
        airports = [];
        if (route.origin) {
          airports.push({
            iata: route.origin.iata_code,
            icao: route.origin.icao_code,
            name: route.origin.name,
            location: route.origin.municipality,
            country: route.origin.country_name,
            countryiso2: route.origin.country_iso_name,
            lat: route.origin.latitude,
            lon: route.origin.longitude
          });
        }
        if (route.destination) {
          airports.push({
            iata: route.destination.iata_code,
            icao: route.destination.icao_code,
            name: route.destination.name,
            location: route.destination.municipality,
            country: route.destination.country_name,
            countryiso2: route.destination.country_iso_name,
            lat: route.destination.latitude,
            lon: route.destination.longitude
          });
        }

        airlineCode = (route.airline && route.airline.icao) || null;
      }

      return [
        a.hex || '',                       // 0
        callsign,                          // 1
        '',                                // 2
        Math.floor(Date.now() / 1000),     // 3
        Math.floor(Date.now() / 1000),     // 4
        a.lon,                             // 5
        a.lat,                             // 6
        altMeters,                         // 7
        onGround,                          // 8
        speedMs,                           // 9
        a.track || 0,                      // 10
        verticalRate,                      // 11
        null, null, null, false, 0, 0,     // 12-17
        a.t || null,                       // 18 ADSB type
        a.r || null,                       // 19 registration
        a.nav_altitude_mcp || null,        // 20
        a.nav_altitude_fms || null,        // 21
        a.category || null,                // 22
        airportCodes,                      // 23
        airports,                          // 24
        airlineCode                        // 25
      ];
    });

    const response = {
      time: Math.floor(Date.now() / 1000),
      states,
      source: 'adsb.lol + adsbdb.com',
      enriched: debugInfo.routes_found,
      total: states.length
    };

    if (debug === '1' || debug === 'true') {
      response.debug = debugInfo;
    } else {
      response.debug_summary = {
        aircraft_total: debugInfo.aircraft_total,
        routes_attempted: debugInfo.routes_attempted,
        routes_found: debugInfo.routes_found,
        routes_errors: debugInfo.routes_errors
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
