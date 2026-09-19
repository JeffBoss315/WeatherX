/* ============================================================
   WeatherX — local configuration
   ------------------------------------------------------------
   Copy this file to `config.js` (which is gitignored) and fill
   in ONE of the two options below.

   Which should you use?

   proxyUrl  — the key lives on your Cloudflare Worker and never
               reaches the browser. Visitors cannot see it.
               This is the only way to actually hide the key.

   apiKey    — the browser calls OpenWeather directly. Simple and
               needs no server, but the key is visible to anyone
               who opens DevTools. Fine for local development.
   ============================================================ */
window.WEATHERX = {
  // Preferred: your deployed Worker, e.g. "https://weatherx-api.<you>.workers.dev"
  proxyUrl: "",

  // Fallback for local development only — visible to any visitor.
  apiKey: "",
};
