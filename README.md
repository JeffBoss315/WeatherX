# WeatherX

A photographic weather report. Search any city for live conditions, air quality,
an hourly temperature trend and a five-day outlook — where the forecast is told
through photographs rather than icons alone.

Built as a static site with vanilla HTML, CSS and JavaScript. No build step.

![WeatherX](images/thunderstorm-day.jpg)

## Features

- **Photo-led forecast** — twelve photographs (a day and a night variant for
  each of six conditions) drive the hero band and the five-day filmstrip. A
  rainy street at noon looks nothing like one at midnight, and the app shows
  the difference. Every photo renders below its native size, so it stays sharp.
- **Condition-driven accent** — the interface hue follows the weather: amber for
  clear, blue for rain, violet for storms, ice for snow, slate for mist.
- **Live local clock** for the searched city, in its own timezone.
- **City autocomplete** with full keyboard navigation (↑/↓/Enter/Esc).
- **Air quality** with PM2.5, **sun arc** with daylight length, **wind compass**,
  and a smoothed 24-hour temperature trend.
- **Instant °C/°F** — data is fetched once in metric and converted at render
  time, so switching units costs no extra API calls.
- **Light and dark themes**, remembered between visits.
- **Shareable links** — `?city=Nairobi` or `?lat=..&lon=..`.

## Running it locally

1. Clone the repo.
2. Copy the config template and add a credential:

   ```bash
   cp config.example.js config.js
   ```

3. Open `config.js` and set **one** of the two fields (see below).
4. Serve the folder over HTTP — opening `index.html` directly from disk will
   fail CORS:

   ```bash
   python -m http.server 8080
   ```

   Then visit <http://localhost:8080>.

## About the API key

This matters, so it is worth being precise.

A static site **cannot hide an API key from its visitors.** The browser has to
send the key to OpenWeather, so anyone can open DevTools → Network and read it.
Obfuscating it in JavaScript does not change that.

There are two modes, and only one of them actually hides the key:

| `config.js` field | Where the key lives | Can visitors see it? |
| --- | --- | --- |
| `apiKey` | In the browser | **Yes** — visible in DevTools |
| `proxyUrl` | On your Worker | **No** — it never leaves the server |

`config.js` is gitignored either way, so no key is committed to this repo.

### Hiding the key properly (Cloudflare Worker)

`worker/` contains a small proxy that holds the key as a secret and forwards
requests. The browser calls the Worker; the Worker calls OpenWeather. The key
never reaches the client.

```bash
cd worker
npx wrangler secret put OPENWEATHER_API_KEY   # paste your key when prompted
npx wrangler deploy
```

Wrangler prints a URL like `https://weatherx-api.<subdomain>.workers.dev`. Put
that in `config.js` and clear `apiKey`:

```js
window.WEATHERX = {
  proxyUrl: "https://weatherx-api.<subdomain>.workers.dev",
  apiKey: "",
};
```

The Worker only forwards the handful of endpoints this app uses and rebuilds the
query string from an allow-list, so it is not an open relay. Once deployed,
narrow `ALLOWED_ORIGINS` in `worker/wrangler.jsonc` from `*` to your own site.

> A brand-new OpenWeather key returns `401` until it activates, which can take
> up to about two hours.

## Deploying the site

Any static host works. For GitHub Pages, note that `config.js` is gitignored, so
the deployed site needs credentials another way — deploy the Worker, then commit
a `config.js` containing only the `proxyUrl` (no key), or have your build write
the file.

## Credits

Weather data, condition icons, air quality and geocoding from
[OpenWeather](https://openweathermap.org/).

The condition photographs come from [Wikimedia Commons](https://commons.wikimedia.org/)
under licences that permit reuse (CC0, public domain, CC BY and CC BY-SA).
Per-image author, licence and source links are in **[CREDITS.md](CREDITS.md)** —
keep that file if you reuse this project, since the CC BY and CC BY-SA licences
require attribution.
