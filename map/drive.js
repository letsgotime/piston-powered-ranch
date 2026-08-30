/**
 * Drive intelligence for the ranch map.
 *
 * The map already reads weather properly: NWS observations, the forecast for
 * the tenth, and active alerts, with Open-Meteo behind it. This adds the three
 * things it did not have.
 *
 *   Base layers you can switch. Satellite is right for the field and wrong for
 *   a road at speed, and a greyscale base is the only one a coloured route
 *   actually reads against.
 *
 *   Surface conditions and what tyre that implies. Read the honesty note on
 *   surfaceRead before quoting any of it: one of these numbers is measured, one
 *   is modelled, and one is derived, and they are labelled accordingly.
 *
 *   Alternative routes. A morning drive is not the fastest way there, so the
 *   map offers the fastest and then the ones worth taking instead.
 *
 * No paid API and no key. Everything here is free at this volume.
 */

/* ---------------------------------------------------------------- layers */

/* Attribution is a licence condition on every one of these, not decoration. */
export function baseLayers(L) {
  return {
    Satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery &copy; Esri" }
    ),
    Greyscale: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }),
    Dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }),
    Roads: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }),
  }
}

/* Labels ride above imagery in their own pane so they stay legible when the
   base underneath is a photograph. */
export function labelLayer(L) {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, pane: "shadowPane" }
  )
}

/* ------------------------------------------------- surface and tyres */

/**
 * Three numbers, and they are not the same kind of number.
 *
 *   air      measured, from the weather model's 2m temperature
 *   ground   modelled, Open-Meteo's soil temperature at the surface
 *   asphalt  derived here from air temperature and solar radiation
 *
 * The third one matters and deserves the caveat. There is no public sensor
 * network reporting the temperature of a given stretch of road, so anything
 * claiming to know it is estimating. Dark asphalt in full sun runs roughly
 * 20 to 40F above air temperature, scaling with how much sun is actually
 * landing, and that is what this models. It is good enough to tell somebody
 * their summer tyres will be cold at eight in the morning. It is not good
 * enough to put a number on a sign.
 */
export async function surfaceRead(lat, lng) {
  const u =
    "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
    "&current=temperature_2m,shortwave_radiation,precipitation,cloud_cover,wind_speed_10m,relative_humidity_2m" +
    "&hourly=soil_temperature_0cm" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" +
    "&timezone=America%2FChicago&forecast_days=1"
  const r = await fetch(u)
  if (!r.ok) throw new Error("weather " + r.status)
  const w = await r.json()
  const c = w.current || {}
  const air = typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : null
  const rad = typeof c.shortwave_radiation === "number" ? c.shortwave_radiation : 0

  let ground = null
  if (w.hourly && Array.isArray(w.hourly.soil_temperature_0cm)) {
    const now = new Date()
    const idx = w.hourly.time
      ? w.hourly.time.findIndex((t) => new Date(t).getHours() === now.getHours())
      : -1
    const v = w.hourly.soil_temperature_0cm[idx > -1 ? idx : 0]
    if (typeof v === "number") ground = Math.round(v)
  }

  /* 1000 W/m2 is roughly full midday sun. Wet road loses the gain entirely. */
  const wet = (c.precipitation || 0) > 0
  const gain = wet ? 0 : Math.min(40, (rad / 1000) * 38)
  const asphalt = air == null ? null : Math.round(air + gain)

  return {
    air,
    ground,
    asphalt,
    wet,
    cloud: c.cloud_cover ?? null,
    wind: c.wind_speed_10m == null ? null : Math.round(c.wind_speed_10m),
    humidity: c.relative_humidity_2m ?? null,
    radiation: Math.round(rad),
    tyre: tyreAdvice(air, asphalt, wet),
  }
}

/**
 * Compound advice, from published temperature behaviour rather than opinion.
 * Summer compounds go glassy below roughly 45F and that is the number every
 * manufacturer gives. Everything else here follows from it.
 */
export function tyreAdvice(air, asphalt, wet) {
  if (air == null) return { level: "unknown", head: "No reading", note: "Weather is not answering." }
  if (wet)
    return {
      level: "caution",
      head: "Wet, whatever is fitted",
      note: "Standing water beats compound. Slow the entry, brake in a straight line, and leave room. Grip is a fraction of dry on any tyre.",
    }
  if (air < 40)
    return {
      level: "stop",
      head: "Too cold for summer tyres",
      note: "Below 40F a summer compound is hard and will not key into the road. If that is what is fitted, drive it like it is raining until the tread is warm, and accept it may not get there.",
    }
  if (air < 50)
    return {
      level: "caution",
      head: "Cold for summer tyres",
      note: "Summer compounds are stiff under 50F and want ten minutes of use before they mean anything. All season and winter tyres are fine now.",
    }
  if (asphalt != null && asphalt > 120)
    return {
      level: "caution",
      head: "Hot surface",
      note: "Above 120F on the asphalt, pressures climb several psi over cold. Set them cold in the morning rather than chasing them at the ranch, and expect a softer feel by the afternoon.",
    }
  return {
    level: "go",
    head: "Good conditions",
    note: "Summer compounds are in their window and everything else is comfortable. Nothing to work around.",
  }
}

/* -------------------------------------------------------------- routing */

/**
 * OSRM, the public demo server. Free, no key, returns alternates as GeoJSON.
 *
 * Worth knowing before the tenth: that server is a courtesy, rate limited and
 * offered without an availability promise. It is right for planning a drive in
 * September and wrong to depend on at eight in the morning on the day. If this
 * ends up in front of guests, move it to a hosted OSRM or GraphHopper with a
 * key, which is a one line change to BASE.
 */
const BASE = "https://router.project-osrm.org/route/v1/driving/"

export async function routes(from, to) {
  const u =
    BASE + from.lng + "," + from.lat + ";" + to.lng + "," + to.lat +
    "?alternatives=true&overview=full&geometries=geojson&steps=false"
  const r = await fetch(u)
  if (!r.ok) throw new Error("routing " + r.status)
  const j = await r.json()
  if (j.code !== "Ok" || !Array.isArray(j.routes)) throw new Error(j.code || "no route")
  return j.routes.map((rt, i) => ({
    coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]),
    miles: +(rt.distance / 1609.344).toFixed(1),
    minutes: Math.round(rt.duration / 60),
    /* The first one back is the fastest. The others are the interesting ones,
       which is the whole point of a morning drive. */
    fastest: i === 0,
    /* Bends per mile is a crude proxy for whether a road is worth driving, and
       crude is honest: it counts direction changes in the geometry. */
    bendiness: bendsPerMile(rt.geometry.coordinates, rt.distance / 1609.344),
  }))
}

function bendsPerMile(coords, miles) {
  if (!coords || coords.length < 3 || !miles) return 0
  let turns = 0
  for (let i = 2; i < coords.length; i++) {
    const a = bearing(coords[i - 2], coords[i - 1])
    const b = bearing(coords[i - 1], coords[i])
    let d = Math.abs(b - a)
    if (d > 180) d = 360 - d
    if (d > 12) turns++
  }
  return +(turns / miles).toFixed(1)
}

function bearing(p, q) {
  const y = q[0] - p[0]
  const x = q[1] - p[1]
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Draws the set and returns the layer group, fastest in amber, rest in teal. */
export function drawRoutes(L, map, set) {
  const g = L.layerGroup()
  set.forEach((rt) => {
    L.polyline(rt.coords, {
      color: rt.fastest ? "#F2C94C" : "#00D2BE",
      weight: rt.fastest ? 5 : 4,
      opacity: rt.fastest ? 0.95 : 0.75,
      dashArray: rt.fastest ? null : "1 9",
      lineCap: "round",
    })
      .bindPopup(
        "<b>" + (rt.fastest ? "Fastest" : "Alternative") + "</b><br>" +
        rt.miles + " miles, about " + rt.minutes + " minutes" +
        (rt.bendiness ? "<br>" + rt.bendiness + " bends a mile" : "")
      )
      .addTo(g)
  })
  g.addTo(map)
  return g
}
