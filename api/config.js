/**
 * Public client config. The Google Maps browser key is public by design and
 * must be locked to this site's referrers in the Google Cloud console; absence
 * simply means the map runs on its keyless Leaflet engine.
 */
export default function handler(request, response) {
  response.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
  return response.status(200).json({
    gmapsKey: process.env.GMAPS_BROWSER_KEY || null,
  });
}
