/**
 * WeatherX API proxy
 * ---------------------------------------------------------------
 * Holds the OpenWeather key as a Worker secret and forwards
 * requests, so the key never reaches the browser. The front end
 * points `proxyUrl` at this Worker instead of api.openweathermap.org.
 *
 * Deploy:
 *   cd worker
 *   npx wrangler secret put OPENWEATHER_API_KEY
 *   npx wrangler deploy
 */

/** Only the endpoints the app actually uses — this is not an open relay. */
const ALLOWED_PATHS = new Set([
  "data/2.5/weather",
  "data/2.5/forecast",
  "data/2.5/air_pollution",
  "geo/1.0/direct",
  "geo/1.0/reverse",
]);

/** Query params we will pass through; anything else is dropped. */
const ALLOWED_PARAMS = new Set(["q", "lat", "lon", "units", "limit", "lang", "cnt"]);

const UPSTREAM = "https://api.openweathermap.org";

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const allowOrigin =
    allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ message: "Method not allowed" }, 405, cors);
    }
    if (!env.OPENWEATHER_API_KEY) {
      console.error(JSON.stringify({ message: "missing OPENWEATHER_API_KEY secret" }));
      return json({ message: "Proxy is not configured." }, 500, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    if (!ALLOWED_PATHS.has(path)) {
      return json({ message: `Unsupported endpoint: ${path}` }, 404, cors);
    }

    // Rebuild the query from an allow-list so a caller cannot smuggle in
    // their own appid or unexpected upstream parameters.
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (ALLOWED_PARAMS.has(key)) params.set(key, value);
    }
    params.set("appid", env.OPENWEATHER_API_KEY);

    const upstream = `${UPSTREAM}/${path}?${params}`;

    try {
      // Cache at the edge so repeat lookups do not burn the free-tier quota.
      const response = await fetch(upstream, {
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      console.log(JSON.stringify({
        message: "proxied", path, status: response.status,
      }));

      // Stream the body through rather than buffering it.
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...cors,
          "Content-Type": response.headers.get("Content-Type") || "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "upstream request failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ message: "Upstream request failed." }, 502, cors);
    }
  },
};
