// ===== EXTRACTION d'infos d'offre depuis un lien =====
// Cascade : JSON-LD (JobPosting schema.org) -> Open Graph -> <title>
// Sans dépendance externe (parsing regex).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const url = ((req.query && req.query.url) || (req.body && req.body.url) || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: "URL invalide" });
    }

    let html = "";
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });
      html = await resp.text();
    } catch (e) {
      return res.status(200).json({
        ok: false,
        error: "Page inaccessible (le site bloque peut-être la récupération)",
        offer: { lien: url, source: hostFromUrl(url) },
      });
    }

    const result = { lien: url, source: hostFromUrl(url) };

    // ---- 1) JSON-LD JobPosting ----
    let job = null;
    const ldMatches = [
      ...html.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      ),
    ];
    for (const m of ldMatches) {
      try {
        const data = JSON.parse(m[1].trim());
        const candidates = [];
        const pushAll = (d) => {
          if (Array.isArray(d)) d.forEach(pushAll);
          else if (d && typeof d === "object") {
            candidates.push(d);
            if (d["@graph"]) pushAll(d["@graph"]);
          }
        };
        pushAll(data);
        job = candidates.find((c) => {
          const t = c && c["@type"];
          return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
        });
        if (job) break;
      } catch (e) {}
    }

    if (job) {
      result.titre = clean(job.title || job.name);
      result.description = clean(stripTags(asText(job.description)));
      if (result.description && result.description.length > 700)
        result.description = result.description.slice(0, 700) + "…";
      const org = job.hiringOrganization;
      result.entreprise = clean(typeof org === "string" ? org : org && org.name);
      result.lieu = extractLocation(job.jobLocation);
      result.dateCreation = job.datePosted || null;
      result.typeContrat = mapEmployment(job.employmentType);
      result.salaire = extractSalary(job.baseSalary);
    }

    // ---- 2) Open Graph (fallback) ----
    const og = (p) => {
      let m =
        html.match(
          new RegExp(
            '<meta[^>]+property=["\']og:' + p + '["\'][^>]+content=["\']([^"\']*)["\']',
            "i"
          )
        ) ||
        html.match(
          new RegExp(
            '<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:' + p + '["\']',
            "i"
          )
        );
      return m ? decodeEntities(m[1]) : null;
    };
    if (!result.titre) result.titre = clean(og("title")) || cleanPageTitle(titleTag(html));
    if (!result.description) result.description = clean(og("description")) || clean(metaDesc(html));
    const siteName = og("site_name");
    if (siteName) result.source = clean(siteName);

    // ---- normalisation ----
    result.titre = result.titre || "";
    result.entreprise = result.entreprise || "";
    result.lieu = result.lieu || "";
    result.typeContrat = result.typeContrat || "";
    result.salaire = result.salaire || "";
    result.description = result.description || "";

    const quality = job ? "full" : result.titre ? "partial" : "empty";

    return res.status(200).json({ ok: true, offer: result, quality });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}

// ===== Helpers =====
function hostFromUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch (e) {
    return "lien";
  }
}
function asText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(asText).join(" ");
  return "";
}
function stripTags(s) {
  return (s || "").replace(/<[^>]*>/g, " ");
}
function clean(s) {
  if (!s) return "";
  return decodeEntities(String(s)).replace(/\s+/g, " ").trim();
}
function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1] : "";
}
// Nettoie un <title> type "Demand Planner - Michelin | Indeed" -> "Demand Planner"
function cleanPageTitle(t) {
  let s = clean(t);
  // coupe au premier séparateur courant
  const seps = [" | ", " - ", " – ", " — ", " · ", " :: "];
  for (const sep of seps) {
    const i = s.indexOf(sep);
    if (i > 8) { s = s.slice(0, i); break; }
  }
  return s.trim();
}
function metaDesc(html) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return m ? m[1] : "";
}
function extractLocation(loc) {
  if (!loc) return "";
  const one = Array.isArray(loc) ? loc[0] : loc;
  if (!one) return "";
  const addr = one.address || one;
  if (typeof addr === "string") return clean(addr);
  const city = addr.addressLocality || "";
  const region = addr.addressRegion || "";
  const postal = addr.postalCode || "";
  let s = city;
  if (postal) s = (s ? s + " " : "") + "(" + postal + ")";
  else if (region && region !== city) s = (s ? s + ", " : "") + region;
  return clean(s);
}
function mapEmployment(t) {
  if (!t) return "";
  const v = Array.isArray(t) ? t[0] : t;
  const map = {
    FULL_TIME: "Temps plein",
    PART_TIME: "Temps partiel",
    CONTRACTOR: "Freelance",
    TEMPORARY: "CDD / Intérim",
    INTERN: "Stage",
    OTHER: "",
  };
  return map[String(v).toUpperCase()] || clean(String(v));
}
function extractSalary(bs) {
  if (!bs) return "";
  const val = bs.value || bs;
  if (!val) return "";
  const min = val.minValue || val.value || "";
  const max = val.maxValue || "";
  const unit = (val.unitText || "").toLowerCase();
  const unitFr =
    unit === "year" ? "/an" : unit === "month" ? "/mois" : unit === "hour" ? "/h" : "";
  if (min && max) return min + "–" + max + unitFr;
  if (min) return min + unitFr;
  return "";
}
function decodeEntities(s) {
  if (!s) return "";
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&eacute;": "é",
    "&egrave;": "è",
    "&ecirc;": "ê",
    "&agrave;": "à",
    "&ccedil;": "ç",
    "&ugrave;": "ù",
    "&ocirc;": "ô",
    "&icirc;": "î",
    "&iuml;": "ï",
    "&nbsp;": " ",
    "&laquo;": "«",
    "&raquo;": "»",
    "&hellip;": "…",
    "&rsquo;": "'",
    "&#x27;": "'",
    "&#x2F;": "/",
  };
  return s
    .replace(/&[a-zA-Z#0-9x]+;/g, (e) => named[e] || named[e.toLowerCase()] || e)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
