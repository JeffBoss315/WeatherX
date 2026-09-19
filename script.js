/* ============================================================
   WeatherX — OpenWeather client
   ------------------------------------------------------------
   Credentials come from config.js, which is gitignored. Copy
   config.example.js to config.js to set them up.

   Two modes:

   proxyUrl  Requests go to your Cloudflare Worker (see worker/),
             which holds the key as a secret and forwards the
             call. The key never reaches the browser, so visitors
             cannot read it. This is the only way to hide it.

   apiKey    The browser calls OpenWeather directly. There is no
             way to hide a key in this mode — anything the browser
             sends is visible in DevTools. Local development only.

   A brand-new OpenWeather key returns 401 until it activates,
   which can take up to ~2 hours.
   ============================================================ */
const CONFIG = (typeof window !== "undefined" && window.WEATHERX) || {};
const PROXY_URL = (CONFIG.proxyUrl || "").replace(/\/+$/, "");
const API_KEY = CONFIG.apiKey || "";
const API_BASE = "https://api.openweathermap.org";

/* Everything is fetched in metric and converted at render time, so
   flipping °C/°F is instant and costs no extra API calls. */
const FETCH_UNITS = "metric";

const DEFAULT_TITLE = "WeatherX — Live Weather & Forecast";

/* ------------------------------------------------------------
   Element refs
   ------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const els = {
  form: $("searchForm"),
  input: $("city"),
  ac: $("acList"),
  geoBtn: $("geoBtn"),
  themeBtn: $("themeBtn"),
  status: $("status"),
  skeleton: $("skeleton"),
  result: $("result"),
  empty: $("empty"),
  recents: $("recents"),
  recentsChips: $("recentsChips"),
  suggestions: $("suggestions"),
  heroPhoto: $("heroPhoto"),
  heroBadge: $("heroBadge"),
  clock: $("clock"),
  heroCity: $("heroCity"),
  heroIcon: $("heroIcon"),
  heroTemp: $("heroTemp"),
  heroUnit: $("heroUnit"),
  heroDesc: $("heroDesc"),
  heroFeels: $("heroFeels"),
  heroMax: $("heroMax"),
  heroMin: $("heroMin"),
  heroRange: $("heroRange"),
  sunProgress: $("sunProgress"),
  sunDot: $("sunDot"),
  dayLength: $("dayLength"),
  mSunrise: $("mSunrise"),
  mSunset: $("mSunset"),
  mHumidity: $("mHumidity"),
  humidityBar: $("humidityBar"),
  mWind: $("mWind"),
  mWindDir: $("mWindDir"),
  compassNeedle: $("compassNeedle"),
  mAqi: $("mAqi"),
  mAqiSub: $("mAqiSub"),
  aqiBar: $("aqiBar"),
  mPressure: $("mPressure"),
  mVisibility: $("mVisibility"),
  mClouds: $("mClouds"),
  cloudBar: $("cloudBar"),
  spark: $("spark"),
  trendHint: $("trendHint"),
  hourly: $("hourly"),
  daily: $("daily"),
  hourlyPanel: $("hourlyPanel"),
  dailyPanel: $("dailyPanel"),
  forecastNote: $("forecastNote"),
  retryForecast: $("retryForecast"),
};

/* ------------------------------------------------------------
   Storage + state
   ------------------------------------------------------------ */
const STORE_UNIT = "weatherx:unit";
const STORE_THEME = "weatherx:theme";
const STORE_RECENTS = "weatherx:recents";
const STORE_LAST = "weatherx:last";

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

const state = {
  unit: readStore(STORE_UNIT) === "imperial" ? "imperial" : "metric",
  lastQuery: null,   // { q } or { lat, lon }
  lastLabel: null,   // preferred display name (from geocoding)
  clockTimer: null,
  controller: null,
  // Raw metric payloads, kept so a unit flip is a pure re-render.
  data: { current: null, slots: null, air: null },
  todayRange: null,  // { min, max } in °C, derived from the forecast
  photoSrc: null,
};

/* ------------------------------------------------------------
   Units — API data is metric; these convert for display only
   ------------------------------------------------------------ */
const isImperial = () => state.unit === "imperial";

const toTemp = (c) => (isImperial() ? c * 9 / 5 + 32 : c);
const tempUnit = () => (isImperial() ? "°F" : "°C");

/** API metric wind is m/s; km/h reads better than m/s for most people. */
const toSpeed = (ms) => (isImperial() ? ms * 2.236936 : ms * 3.6);
const speedUnit = () => (isImperial() ? "mph" : "km/h");

/** Visibility arrives in metres regardless of units. */
const toDist = (m) => (isImperial() ? m / 1609.344 : m / 1000);
const distUnit = () => (isImperial() ? "mi" : "km");

const round = (n) => Math.round(n);
const temp = (c) => `${round(toTemp(c))}${tempUnit()}`;

/* ------------------------------------------------------------
   Formatting helpers
   ------------------------------------------------------------ */
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

/** Render a UTC timestamp as wall-clock time in the target city. */
function cityDate(unixSeconds, offsetSeconds) {
  return new Date((unixSeconds + offsetSeconds) * 1000);
}

function fmtTime(unixSeconds, offsetSeconds, opts = {}) {
  return cityDate(unixSeconds, offsetSeconds).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    ...opts,
  });
}

/** Hour only — e.g. "3 PM". Kept separate so no option is passed as undefined. */
function fmtHour(unixSeconds, offsetSeconds) {
  return cityDate(unixSeconds, offsetSeconds).toLocaleTimeString("en-US", {
    hour: "numeric",
    timeZone: "UTC",
  });
}

function fmtDate(unixSeconds, offsetSeconds, opts = {}) {
  return cityDate(unixSeconds, offsetSeconds).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...opts,
  });
}

/** Stable YYYY-MM-DD key in the city's own timezone. */
function cityDayKey(unixSeconds, offsetSeconds) {
  return cityDate(unixSeconds, offsetSeconds).toISOString().slice(0, 10);
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m daylight`;
}

function windDirection(deg) {
  if (typeof deg !== "number") return "";
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(deg / 22.5) % 16];
}

function iconUrl(code, size = "@2x") {
  return `https://openweathermap.org/img/wn/${code}${size}.png`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/* ------------------------------------------------------------
   Theme
   ------------------------------------------------------------ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toLight = theme === "dark";
  els.themeBtn.setAttribute("aria-label", `Switch to ${toLight ? "light" : "dark"} theme`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0d12" : "#f4f1ec");
}

function initTheme() {
  const saved = readStore(STORE_THEME);
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  applyTheme(saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark");
}

/* ------------------------------------------------------------
   Condition photographs
   ------------------------------------------------------------
   Six source photos, each ~300x180. They are shown in the 240px
   hero band and in the ~150-190px filmstrip cards, so they stay
   at or below roughly 1.5x their native size and read sharp.
   ------------------------------------------------------------ */
const CONDITIONS = {
  clear:        { photo: "images/clear.jpg",         key: "clear" },
  clouds:       { photo: "images/clouds.jpg",        key: "clouds" },
  rain:         { photo: "images/rain.jpg",          key: "rain" },
  drizzle:      { photo: "images/rain.jpg",          key: "drizzle" },
  snow:         { photo: "images/snow.jpg",          key: "snow" },
  thunderstorm: { photo: "images/thunderstorms.jpg", key: "thunderstorm" },
  mist:         { photo: "images/mist.jpg",          key: "mist" },
  fog:          { photo: "images/mist.jpg",          key: "mist" },
  haze:         { photo: "images/mist.jpg",          key: "mist" },
  smoke:        { photo: "images/mist.jpg",          key: "mist" },
  dust:         { photo: "images/mist.jpg",          key: "mist" },
  sand:         { photo: "images/mist.jpg",          key: "mist" },
  ash:          { photo: "images/mist.jpg",          key: "mist" },
  squall:       { photo: "images/thunderstorms.jpg", key: "thunderstorm" },
  tornado:      { photo: "images/thunderstorms.jpg", key: "thunderstorm" },
};

const FALLBACK = { photo: "images/clouds.jpg", key: "clouds" };

function conditionOf(mainWeather) {
  return CONDITIONS[String(mainWeather).toLowerCase()] || FALLBACK;
}

/**
 * Fill the hero band. The photo only fades in once it has decoded, and the
 * condition key goes on <html> so the accent colour follows the weather.
 */
function setFeature(mainWeather, description) {
  const cond = conditionOf(mainWeather);
  document.documentElement.dataset.cond = cond.key;
  els.heroBadge.textContent = mainWeather || "—";

  if (cond.photo === state.photoSrc) return; // same condition — don't restart the fade
  state.photoSrc = cond.photo;

  els.heroPhoto.classList.remove("is-ready");
  els.heroPhoto.alt = description ? `${description} — illustrative photograph` : "";

  const img = new Image();
  img.onload = () => {
    if (state.photoSrc !== cond.photo) return; // a newer condition won the race
    els.heroPhoto.src = cond.photo;
    els.heroPhoto.classList.add("is-ready");
  };
  img.onerror = () => { state.photoSrc = null; };
  img.src = cond.photo;
}

/* ------------------------------------------------------------
   View switching
   ------------------------------------------------------------ */
function showError(message) {
  els.status.textContent = message;
  els.status.hidden = false;
}

function clearError() {
  els.status.hidden = true;
  els.status.textContent = "";
}

function setLoading(isLoading) {
  els.skeleton.hidden = !isLoading;
  if (isLoading) {
    els.empty.hidden = true;
    els.result.hidden = true;
    clearError();
  }
}

/* ------------------------------------------------------------
   Live local clock
   ------------------------------------------------------------ */
function startClock(offsetSeconds) {
  clearInterval(state.clockTimer);

  const tick = () => {
    const nowUtc = Math.floor(Date.now() / 1000);
    const date = fmtDate(nowUtc, offsetSeconds, {
      weekday: "long", day: "numeric", month: "short",
    });
    const time = fmtTime(nowUtc, offsetSeconds, { second: "2-digit" });
    els.clock.textContent = `${date} · ${time} local`;
  };

  tick();
  state.clockTimer = setInterval(tick, 1000);
}

/* ------------------------------------------------------------
   Data fetching
   ------------------------------------------------------------ */
/**
 * With a proxy configured the key stays server-side and is never put on the
 * query string; the Worker appends it. Otherwise fall back to a direct call.
 */
function buildUrl(path, query) {
  if (PROXY_URL) {
    return `${PROXY_URL}/${path}?${new URLSearchParams(query)}`;
  }
  return `${API_BASE}/${path}?${new URLSearchParams({ ...query, appid: API_KEY })}`;
}

const isConfigured = () => Boolean(PROXY_URL || API_KEY);

/**
 * Combine our cancellation signal with a timeout, where supported.
 * OpenWeather's /forecast endpoint is routinely slow (5-18s observed),
 * so this ceiling is deliberately generous.
 */
function withTimeout(signal, ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.any && AbortSignal.timeout) {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  }
  return signal; // older browsers keep manual cancellation only
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      res.status === 401 ? "Invalid API key — a new OpenWeather key can take up to 2 hours to activate."
      : res.status === 404 ? "City not found. Try adding a country code, e.g. Nairobi,KE."
      : res.status === 429 ? "Too many requests. Wait a moment and try again."
      : capitalize(data.message || `Request failed (${res.status}).`);
    throw new Error(message);
  }
  return data;
}

/** Short-lived response cache — repeat searches and recents feel instant. */
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

async function fetchCached(url, signal) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const data = await fetchJson(url, signal);
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** A superseded request aborts silently; a timeout is a real failure worth reporting. */
function isCancelled(err) {
  return Boolean(err) && err.name === "AbortError";
}

function describeError(err) {
  if (!err) return "Something went wrong. Check your connection.";
  if (err.name === "TimeoutError") return "The weather service is taking too long. Try again.";
  if (err instanceof TypeError) return "Could not reach the weather service. Check your connection.";
  return err.message || "Something went wrong. Check your connection.";
}

function releaseController(signal) {
  if (state.controller && state.controller.signal === signal) state.controller = null;
}

/* ------------------------------------------------------------
   Shareable links — ?city=Nairobi or ?lat=..&lon=..
   ------------------------------------------------------------ */
function syncUrl(query) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("city");
    url.searchParams.delete("lat");
    url.searchParams.delete("lon");

    if (query.q) url.searchParams.set("city", query.q);
    else if (query.lat != null) {
      url.searchParams.set("lat", query.lat);
      url.searchParams.set("lon", query.lon);
    }
    history.replaceState(null, "", url);
  } catch { /* file:// and other opaque origins reject history writes */ }
}

function queryFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const city = params.get("city");
    if (city) return { q: city };

    const lat = params.get("lat");
    const lon = params.get("lon");
    if (lat && lon) return { lat, lon };
  } catch { /* ignore */ }
  return null;
}

/* ------------------------------------------------------------
   Load pipeline
   ------------------------------------------------------------ */
const SETUP_HINT =
  "No weather credentials found. Copy config.example.js to config.js, then add " +
  "your Worker URL (recommended) or an OpenWeather key.";

async function loadWeather(query, label = null) {
  // A fresh clone has no config.js, so say what to do instead of firing 401s.
  if (!isConfigured()) {
    setLoading(false);
    els.empty.hidden = !els.result.hidden;
    showError(SETUP_HINT);
    return;
  }

  // Cancel any request still in flight so a fast typist never sees stale data.
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  const { signal } = state.controller;

  state.lastQuery = query;
  state.lastLabel = label;
  state.todayRange = null;
  closeAutocomplete();
  setLoading(true);

  const weatherUrl = buildUrl("data/2.5/weather", { ...query, units: FETCH_UNITS });
  const forecastUrl = buildUrl("data/2.5/forecast", { ...query, units: FETCH_UNITS });

  // Both requests start together, but we render current conditions the moment
  // they land instead of waiting on the much slower /forecast call.
  const currentPromise = fetchCached(weatherUrl, withTimeout(signal, 20000));
  const forecastPromise = fetchCached(forecastUrl, withTimeout(signal, 30000));

  // Nothing downstream awaits this yet, so swallow it here to avoid an
  // unhandled rejection while the current-conditions call is still pending.
  forecastPromise.catch(() => {});

  let current;
  try {
    current = await currentPromise;
  } catch (err) {
    if (isCancelled(err)) return;
    setLoading(false);
    // Keep any existing results on screen; only fall back to the empty state
    // if there was nothing there to begin with.
    els.empty.hidden = !els.result.hidden;
    if (els.result.hidden) document.title = DEFAULT_TITLE;
    showError(describeError(err));
    releaseController(signal);
    return;
  }

  state.data.current = current;
  state.data.slots = null;
  state.data.air = null;

  renderCurrent();
  setFeature(current.weather?.[0]?.main, current.weather?.[0]?.description);
  startClock(current.timezone ?? 0);

  rememberSearch(label || `${current.name}${current.sys?.country ? "," + current.sys.country : ""}`);
  writeStore(STORE_LAST, JSON.stringify({ query, label }));
  syncUrl(query);

  loadAirQuality(current.coord, signal);

  // Forecast panels shimmer in place until the slow call resolves.
  showForecastPending();

  try {
    const forecast = await forecastPromise;
    if (signal.aborted) return;
    state.data.slots = forecast?.list ?? [];
    renderForecast();
  } catch (err) {
    if (isCancelled(err)) return;
    showForecastUnavailable();
  } finally {
    releaseController(signal);
  }
}

/** Air quality is a bonus panel — a failure here must never disturb the page. */
async function loadAirQuality(coord, signal) {
  if (!coord || typeof coord.lat !== "number" || typeof coord.lon !== "number") return;

  const url = buildUrl("data/2.5/air_pollution", { lat: coord.lat, lon: coord.lon });
  try {
    const data = await fetchCached(url, withTimeout(signal, 15000));
    if (signal.aborted) return;
    state.data.air = data?.list?.[0] ?? null;
    renderAir();
  } catch {
    state.data.air = null;
    renderAir();
  }
}

/* ------------------------------------------------------------
   Rendering — current conditions
   ------------------------------------------------------------ */
function renderCurrent() {
  const current = state.data.current;
  if (!current) return;

  const offset = current.timezone ?? 0;
  const weather = current.weather?.[0] ?? {};

  setLoading(false);
  clearError();
  els.empty.hidden = true;
  els.result.hidden = false;

  /* Hero */
  els.heroCity.textContent =
    state.lastLabel || [current.name, current.sys?.country].filter(Boolean).join(", ");
  els.heroTemp.textContent = round(toTemp(current.main.temp));
  els.heroUnit.textContent = tempUnit();
  els.heroDesc.textContent = capitalize(weather.description || weather.main || "—");
  els.heroFeels.textContent = temp(current.main.feels_like);

  // /weather reports temp_min === temp_max === temp for a single city point,
  // so today's real high and low come from the forecast buckets instead.
  // Late in the local day the forecast has no slots left for today, so the
  // range is unknowable on the free tier — hide it rather than show em-dashes.
  els.heroRange.hidden = !state.todayRange;
  if (state.todayRange) {
    els.heroMax.textContent = temp(state.todayRange.max);
    els.heroMin.textContent = temp(state.todayRange.min);
  }

  if (weather.icon) {
    els.heroIcon.src = iconUrl(weather.icon, "@4x");
    els.heroIcon.alt = weather.description || "";
    els.heroIcon.hidden = false;
  } else {
    els.heroIcon.hidden = true;
  }

  document.title = `${temp(current.main.temp)} · ${current.name} — WeatherX`;

  /* Tiles */
  const humidity = current.main.humidity ?? 0;
  els.mHumidity.textContent = `${humidity}%`;
  els.humidityBar.style.width = `${humidity}%`;

  // Unit lives in the sub-label so the value never wraps beside the compass.
  const speed = current.wind?.speed ?? 0;
  els.mWind.textContent = toSpeed(speed).toFixed(1);
  const dir = windDirection(current.wind?.deg);
  els.mWindDir.textContent = dir ? `${speedUnit()} · from ${dir}` : speedUnit();
  // OpenWeather's deg is the direction the wind blows *from*, which is where
  // the arrow head points.
  els.compassNeedle.style.transform = `rotate(${current.wind?.deg ?? 0}deg)`;

  els.mPressure.textContent = current.main.pressure ?? "—";

  els.mVisibility.textContent =
    typeof current.visibility === "number"
      ? `${toDist(current.visibility).toFixed(1)} ${distUnit()}`
      : "—";

  const clouds = current.clouds?.all ?? 0;
  els.mClouds.textContent = `${clouds}%`;
  els.cloudBar.style.width = `${clouds}%`;

  renderSun(current.sys?.sunrise, current.sys?.sunset, offset);
}

/* ---- Sun arc ---- */
function renderSun(sunrise, sunset, offset) {
  els.mSunrise.textContent = sunrise ? fmtTime(sunrise, offset) : "—";
  els.mSunset.textContent = sunset ? fmtTime(sunset, offset) : "—";

  const arcLength = Math.PI * 52; // semicircle of r=52 in the SVG viewBox
  els.sunProgress.style.strokeDasharray = arcLength;

  if (!sunrise || !sunset || sunset <= sunrise) {
    els.dayLength.textContent = "—";
    els.sunProgress.style.strokeDashoffset = arcLength;
    els.sunDot.setAttribute("cx", 8);
    els.sunDot.setAttribute("cy", 58);
    return;
  }

  els.dayLength.textContent = fmtDuration(sunset - sunrise);

  const now = Date.now() / 1000;
  const progress = Math.min(Math.max((now - sunrise) / (sunset - sunrise), 0), 1);
  const isDay = now >= sunrise && now <= sunset;

  els.sunProgress.style.strokeDashoffset = arcLength * (1 - progress);

  // Centre (60, 58), radius 52; theta sweeps pi -> 0 across the day.
  const theta = Math.PI * (1 - progress);
  els.sunDot.setAttribute("cx", (60 + 52 * Math.cos(theta)).toFixed(2));
  els.sunDot.setAttribute("cy", (58 - 52 * Math.sin(theta)).toFixed(2));
  els.sunDot.classList.toggle("is-night", !isDay);
}

/* ---- Air quality ---- */
const AQI_LABELS = ["—", "Good", "Fair", "Moderate", "Poor", "Very poor"];

function renderAir() {
  const air = state.data.air;
  const aqi = air?.main?.aqi;

  if (!aqi) {
    els.mAqi.textContent = "—";
    els.mAqiSub.textContent = "unavailable";
    els.aqiBar.style.width = "0%";
    els.aqiBar.removeAttribute("data-aqi");
    return;
  }

  els.mAqi.textContent = AQI_LABELS[aqi] ?? "—";
  const pm25 = air.components?.pm2_5;
  els.mAqiSub.textContent =
    typeof pm25 === "number" ? `PM2.5 ${pm25.toFixed(1)} µg/m³` : `AQI ${aqi} of 5`;
  els.aqiBar.style.width = `${(aqi / 5) * 100}%`;
  els.aqiBar.dataset.aqi = String(aqi);
}

/* ------------------------------------------------------------
   Rendering — forecast
   ------------------------------------------------------------ */
function renderForecast() {
  const slots = state.data.slots;
  if (!slots) return;

  if (slots.length === 0) {
    showForecastUnavailable();
    return;
  }

  const current = state.data.current;
  const offset = current?.timezone ?? 0;

  els.forecastNote.hidden = true;
  els.hourlyPanel.hidden = false;
  els.dailyPanel.hidden = false;

  const hours = buildHours(slots, current);
  renderHourly(hours, offset);
  renderSpark(hours.map((h) => h.temp));
  renderDaily(slots, offset, current);
}

/** Shimmer placeholders sized to the real cards, so nothing jumps on arrival. */
function showForecastPending() {
  els.forecastNote.hidden = true;
  els.hourlyPanel.hidden = false;
  els.dailyPanel.hidden = false;
  els.spark.toggleAttribute("hidden", true);
  els.trendHint.textContent = "";

  els.hourly.replaceChildren();
  for (let i = 0; i < 8; i++) {
    const node = document.createElement("div");
    node.className = "sk hour--sk";
    els.hourly.appendChild(node);
  }

  els.daily.replaceChildren();
  for (let i = 0; i < 5; i++) {
    const row = document.createElement("li");
    row.className = "sk day--sk";
    els.daily.appendChild(row);
  }
}

function showForecastUnavailable() {
  els.hourlyPanel.hidden = true;
  els.dailyPanel.hidden = true;
  els.forecastNote.hidden = false;
}

/**
 * The first /forecast slot is a *future* 3-hour block, so labelling it "Now"
 * misreports the present. Real current conditions lead the strip instead.
 */
function buildHours(slots, current) {
  const hours = slots.slice(0, 8).map((slot) => ({
    dt: slot.dt,
    temp: slot.main.temp,
    icon: slot.weather?.[0]?.icon ?? "01d",
    desc: slot.weather?.[0]?.description ?? "",
    pop: slot.pop,
    isNow: false,
  }));

  if (current?.main) {
    hours.unshift({
      dt: current.dt ?? Math.floor(Date.now() / 1000),
      temp: current.main.temp,
      icon: current.weather?.[0]?.icon ?? "01d",
      desc: current.weather?.[0]?.description ?? "",
      pop: null,
      isNow: true,
    });
  }
  return hours;
}

function renderHourly(hours, offset) {
  els.hourly.replaceChildren();

  for (const hour of hours) {
    const node = document.createElement("div");
    node.className = "hour" + (hour.isNow ? " is-now" : "");

    const time = document.createElement("span");
    time.className = "hour__time";
    time.textContent = hour.isNow ? "Now" : fmtHour(hour.dt, offset);

    const icon = document.createElement("img");
    icon.className = "hour__icon";
    icon.loading = "lazy";
    icon.width = 40;
    icon.height = 40;
    icon.src = iconUrl(hour.icon);
    icon.alt = hour.desc;

    const value = document.createElement("span");
    value.className = "hour__temp";
    value.textContent = temp(hour.temp);

    const pop = document.createElement("span");
    pop.className = "hour__pop";
    pop.textContent = hour.pop >= 0.1 ? `${Math.round(hour.pop * 100)}%` : "";

    node.append(time, icon, value, pop);
    els.hourly.appendChild(node);
  }
}

/** Smooth temperature trend across the next 24 hours. */
function renderSpark(temps) {
  els.spark.replaceChildren();

  if (temps.length < 2) {
    els.spark.toggleAttribute("hidden", true);
    els.trendHint.textContent = "";
    return;
  }
  els.spark.toggleAttribute("hidden", false);

  const W = 600, H = 90, PAD = 16;
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 1);

  const points = temps.map((t, i) => [
    (i / (temps.length - 1)) * W,
    H - PAD - ((t - min) / span) * (H - PAD * 2),
  ]);

  // Cubic segments through vertical control points give a clean, wobble-free curve.
  let line = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mid = ((x0 + x1) / 2).toFixed(1);
    line += ` C${mid},${y0.toFixed(1)} ${mid},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }

  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", {
    id: "sparkFill", x1: "0", y1: "0", x2: "0", y2: "1",
  });
  // Stop colours live in CSS: var() is unreliable inside presentation attributes.
  grad.append(
    svgEl("stop", { offset: "0%", class: "spark__stop-top" }),
    svgEl("stop", { offset: "100%", class: "spark__stop-bottom" })
  );
  defs.appendChild(grad);

  const area = svgEl("path", {
    d: `${line} L${W},${H} L0,${H} Z`,
    fill: "url(#sparkFill)",
    stroke: "none",
  });

  const stroke = svgEl("path", {
    d: line,
    class: "spark__line",
    "vector-effect": "non-scaling-stroke",
  });

  els.spark.append(defs, area, stroke);
  els.trendHint.textContent = `High ${temp(max)} · Low ${temp(min)}`;
}

function renderDaily(slots, offset, current) {
  els.daily.replaceChildren();

  // Bucket the 3-hourly slots into the city's own calendar days.
  const buckets = new Map();
  for (const slot of slots) {
    const key = cityDayKey(slot.dt, offset);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(slot);
  }

  const todayKey = cityDayKey(Math.floor(Date.now() / 1000), offset);

  const days = [...buckets.entries()]
    // A trailing day with only a slot or two has a meaningless min/max, so drop it.
    // Today is exempt: it is naturally partial and we widen it with live readings below.
    .filter(([key, entries]) => key === todayKey || entries.length >= 3)
    .map(([key, entries]) => {
      const temps = entries.map((e) => e.main.temp);

      // By late in the day only one forecast slot remains, which would render a
      // flat range; the live reading keeps today's band honest. (The free tier
      // only forecasts forward, so a low already past this morning is not known.)
      if (key === todayKey && current?.main) temps.push(current.main.temp);

      // The slot nearest midday best represents the day's look.
      const midday = entries.reduce((best, e) => {
        const hour = cityDate(e.dt, offset).getUTCHours();
        const bestHour = cityDate(best.dt, offset).getUTCHours();
        return Math.abs(hour - 13) < Math.abs(bestHour - 13) ? e : best;
      }, entries[0]);

      return {
        key,
        dt: entries[0].dt,
        min: Math.min(...temps),
        max: Math.max(...temps),
        icon: midday.weather?.[0]?.icon ?? "01d",
        desc: midday.weather?.[0]?.description ?? "",
        main: midday.weather?.[0]?.main ?? "",
        isToday: key === todayKey,
      };
    })
    .slice(0, 6);

  // Guard against Math.min(...[]) === Infinity if every bucket was filtered out.
  if (days.length === 0) {
    showForecastUnavailable();
    return;
  }

  // Today's real high/low is only knowable here — patch it back into the hero.
  const today = days.find((d) => d.isToday);
  if (today) {
    state.todayRange = { min: today.min, max: today.max };
    els.heroMax.textContent = temp(today.max);
    els.heroMin.textContent = temp(today.min);
  }
  els.heroRange.hidden = !today;

  // Each day is a photo card: the condition photograph carries the forecast.
  for (const day of days) {
    const li = document.createElement("li");
    li.className = "fday" + (day.isToday ? " is-today" : "");

    const photo = document.createElement("img");
    photo.className = "fday__photo";
    photo.loading = "lazy";
    photo.decoding = "async";
    photo.width = 300;
    photo.height = 180;
    photo.src = conditionOf(day.main).photo;
    photo.alt = "";

    const wash = document.createElement("div");
    wash.className = "fday__wash";

    const name = document.createElement("span");
    name.className = "fday__name";
    name.textContent = day.isToday ? "Today" : fmtDate(day.dt, offset, { weekday: "short" });

    const foot = document.createElement("div");
    foot.className = "fday__foot";

    const desc = document.createElement("span");
    desc.className = "fday__desc";
    desc.textContent = capitalize(day.desc);

    const range = document.createElement("div");
    range.className = "fday__range";

    const max = document.createElement("span");
    max.className = "fday__max";
    max.textContent = temp(day.max);

    const min = document.createElement("span");
    min.className = "fday__min";
    min.textContent = temp(day.min);

    range.append(max, min);
    foot.append(desc, range);
    li.append(photo, wash, name, foot);
    li.title = `${capitalize(day.desc)} · high ${temp(day.max)}, low ${temp(day.min)}`;
    els.daily.appendChild(li);
  }
}

/** Repaint everything from cached metric data — no network, no flicker. */
function rerender() {
  if (!state.data.current) return;
  renderCurrent();
  renderAir();
  if (state.data.slots) renderForecast();
}

/* ------------------------------------------------------------
   City autocomplete (OpenWeather geocoding)
   ------------------------------------------------------------ */
const ac = {
  items: [],
  index: -1,
  timer: null,
  controller: null,
};

function closeAutocomplete() {
  ac.items = [];
  ac.index = -1;
  els.ac.hidden = true;
  els.ac.replaceChildren();
  els.input.setAttribute("aria-expanded", "false");
  els.input.removeAttribute("aria-activedescendant");
}

function placeLabel(place) {
  return [place.name, place.state, place.country].filter(Boolean).join(", ");
}

async function searchPlaces(term) {
  if (ac.controller) ac.controller.abort();
  ac.controller = new AbortController();

  const url = buildUrl("geo/1.0/direct", { q: term, limit: 6 });
  try {
    const places = await fetchCached(url, withTimeout(ac.controller.signal, 8000));
    if (!Array.isArray(places) || places.length === 0) {
      closeAutocomplete();
      return;
    }
    renderAutocomplete(places);
  } catch {
    // A failed lookup just means no suggestions; plain search still works.
    closeAutocomplete();
  }
}

function renderAutocomplete(places) {
  ac.items = places;
  ac.index = -1;
  els.ac.replaceChildren();

  places.forEach((place, i) => {
    const li = document.createElement("li");
    li.className = "ac__item";
    li.id = `ac-opt-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");

    const name = document.createElement("span");
    name.className = "ac__name";
    name.textContent = place.name;

    const meta = document.createElement("span");
    meta.className = "ac__meta";
    meta.textContent = [place.state, place.country].filter(Boolean).join(", ");

    li.append(name, meta);
    // pointerdown beats the input's blur, so the click always registers.
    li.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      choosePlace(i);
    });
    els.ac.appendChild(li);
  });

  els.ac.hidden = false;
  els.input.setAttribute("aria-expanded", "true");
}

function moveActive(delta) {
  if (ac.items.length === 0) return;
  const next = (ac.index + delta + ac.items.length) % ac.items.length;
  setActive(next);
}

function setActive(index) {
  const options = [...els.ac.children];
  options.forEach((li, i) => {
    const on = i === index;
    li.classList.toggle("is-active", on);
    li.setAttribute("aria-selected", String(on));
  });
  ac.index = index;
  if (options[index]) {
    els.input.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  }
}

function choosePlace(index) {
  const place = ac.items[index];
  if (!place) return;
  const label = placeLabel(place);
  els.input.value = place.name;
  closeAutocomplete();
  els.input.blur();
  loadWeather({ lat: place.lat, lon: place.lon }, label);
}

/* ------------------------------------------------------------
   Recent searches
   ------------------------------------------------------------ */
function getRecents() {
  try {
    const parsed = JSON.parse(readStore(STORE_RECENTS) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberSearch(label) {
  if (!label) return;
  const list = getRecents().filter((x) => x.toLowerCase() !== label.toLowerCase());
  list.unshift(label);
  writeStore(STORE_RECENTS, JSON.stringify(list.slice(0, 6)));
  renderRecents();
}

function forgetSearch(label) {
  const list = getRecents().filter((x) => x.toLowerCase() !== label.toLowerCase());
  writeStore(STORE_RECENTS, JSON.stringify(list));
  renderRecents();
}

function renderRecents() {
  const list = getRecents();
  els.recents.hidden = list.length === 0;
  els.recentsChips.replaceChildren();

  for (const label of list) {
    const chip = document.createElement("span");
    chip.className = "chip";

    const go = document.createElement("button");
    go.type = "button";
    go.className = "chip__go";
    go.textContent = label;
    go.addEventListener("click", () => {
      els.input.value = label;
      loadWeather({ q: label });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip__x";
    remove.setAttribute("aria-label", `Remove ${label} from recents`);
    remove.textContent = "×";
    remove.addEventListener("click", () => forgetSearch(label));

    chip.append(go, remove);
    els.recentsChips.appendChild(chip);
  }
}

/* ------------------------------------------------------------
   Events
   ------------------------------------------------------------ */
els.form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (ac.index >= 0) {
    choosePlace(ac.index);
    return;
  }

  const city = els.input.value.trim();
  if (!city) {
    showError("Type a city name to search.");
    els.input.focus();
    return;
  }
  els.input.blur();
  loadWeather({ q: city });
});

els.input.addEventListener("input", () => {
  const term = els.input.value.trim();
  clearTimeout(ac.timer);

  if (term.length < 2) {
    closeAutocomplete();
    return;
  }
  ac.timer = setTimeout(() => searchPlaces(term), 280);
});

els.input.addEventListener("keydown", (event) => {
  if (els.ac.hidden) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeAutocomplete();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!els.form.contains(event.target)) closeAutocomplete();
});

els.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported by this browser.");
    return;
  }

  clearError();
  closeAutocomplete();
  els.geoBtn.classList.add("is-busy");

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      els.geoBtn.classList.remove("is-busy");
      loadWeather({ lat: coords.latitude.toFixed(4), lon: coords.longitude.toFixed(4) });
    },
    (err) => {
      els.geoBtn.classList.remove("is-busy");
      showError(
        err.code === err.PERMISSION_DENIED
          ? "Location permission denied. Search by city instead."
          : "Could not determine your location."
      );
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
});

function syncUnitButtons() {
  document.querySelectorAll(".unit-toggle__btn").forEach((btn) => {
    const active = btn.dataset.unit === state.unit;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

document.querySelectorAll(".unit-toggle__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const unit = btn.dataset.unit;
    if (unit === state.unit) return;

    state.unit = unit;
    writeStore(STORE_UNIT, unit);
    syncUnitButtons();
    rerender(); // cached metric data — no refetch needed
  });
});

els.themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  writeStore(STORE_THEME, next);
});

els.retryForecast.addEventListener("click", () => {
  if (state.lastQuery) loadWeather(state.lastQuery, state.lastLabel);
});

els.suggestions.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-city]");
  if (!btn) return;
  els.input.value = btn.dataset.city;
  loadWeather({ q: btn.dataset.city });
});

// "/" focuses search, Escape clears it.
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== els.input) {
    event.preventDefault();
    els.input.focus();
    els.input.select();
  } else if (event.key === "Escape" && document.activeElement === els.input && els.ac.hidden) {
    els.input.value = "";
    els.input.blur();
  }
});

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
(function init() {
  initTheme();
  syncUnitButtons();
  renderRecents();

  if (!isConfigured()) {
    showError(SETUP_HINT);
    return;
  }

  // A shared link wins over whatever was last viewed on this device.
  const linked = queryFromUrl();
  if (linked) {
    if (linked.q) els.input.value = linked.q;
    loadWeather(linked);
    return;
  }

  const last = readStore(STORE_LAST);
  if (!last) return;

  try {
    const saved = JSON.parse(last);
    // Tolerate the older format, which stored the bare query object.
    const query = saved?.query ?? saved;
    const label = saved?.label ?? null;

    if (query && typeof query === "object" && (query.q || (query.lat && query.lon))) {
      if (query.q) els.input.value = query.q;
      loadWeather(query, label);
    }
  } catch { /* ignore malformed cache */ }
})();
