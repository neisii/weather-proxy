# Request Flow: GET /api/weather/forecast

Source: `src/handlers/weather.ts` — `handleWeatherForecast()`

```
                    ┌──────────────────────────────────────┐
                    │  GET /api/weather/forecast            │
                    │  ?cityId=seoul&days=3                 │
                    └───────────────────┬──────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────┐
                    │  handleWeatherForecast()              │
                    │  src/handlers/weather.ts:780          │
                    └───────────────────┬──────────────────┘
                                        │
                    ┌───────────────────▼──────────────────┐
                    │  Validate cityId                      │
                    │  VALID_CITY_IDS.has(cityIdRaw)        │
                    └───────────────────┬──────────────────┘
                                        │
                             ┌──────────┴──────────┐
                           valid                invalid
                             │                    │
                             │            ┌───────▼────────┐
                             │            │  400 Bad Request│
                             │            │  invalid_city   │
                             │            └────────────────┘
                             ▼
                    ┌──────────────────────────────────────┐
                    │  Parse days param                     │
                    │  default = 3                          │
                    │  valid range: 1 – 3 (integer)         │
                    └───────────────────┬──────────────────┘
                                        │
                             ┌──────────┴──────────┐
                           valid                invalid
                             │                    │
                             │            ┌───────▼────────┐
                             │            │  400 Bad Request│
                             │            │  invalid_params │
                             │            └────────────────┘
                             ▼
                    ┌──────────────────────────────────────┐
                    │  getCityByName(cityIdRaw)             │
                    │  key = city.id + days                 │
                    │  e.g. "seoul:3"                       │
                    └───────────────────┬──────────────────┘
                                        │
                    ┌───────────────────▼──────────────────┐
                    │  forecastCache.get(key)               │
                    │  isFresh(entry)?                      │
                    │  TTL = 5 min                          │
                    └───────────────────┬──────────────────┘
                                        │
                             ┌──────────┴──────────┐
                           HIT                    MISS
                             │                    │
                             ▼                    ▼
                  ┌────────────────┐   ┌──────────────────────────────────────────┐
                  │  200 OK        │   │  Promise.allSettled([...])               │
                  │  Forecast      │   │  3 providers fetched in parallel          │
                  │  (cached)      │   └────────────┬────────────┬────────────────┘
                  └────────────────┘                │            │            │
                                                    │            │            │
                      ┌─────────────────────────────┘            │            └──────────────────────────────┐
                      ▼                                           ▼                                           ▼
       ┌──────────────────────────────┐        ┌─────────────────────────────┐        ┌──────────────────────────────┐
       │  fetchOpenWeatherForecast()  │        │  fetchWeatherAPIForecast()  │        │  fetchOpenMeteoForecast()    │
       │  /data/2.5/forecast          │        │  /v1/forecast.json          │        │  /v1/forecast                │
       │  units=metric  lang=kr       │        │  days=3  aqi=no             │        │  timezone=Asia/Seoul         │
       │                              │        │                             │        │  forecast_days=3             │
       │  returns 40 slots (3h each)  │        │  returns 3 daily summaries  │        │  returns 3 daily arrays      │
       └──────────────┬───────────────┘        └─────────────┬───────────────┘        └──────────────┬───────────────┘
                      │                                       │                                        │
                      │  [0,1,2].map(i =>)                    │  [0,1,2].map(i =>)                    │  [0,1,2].map(i =>)
                      ▼                                       ▼                                        ▼
       ┌──────────────────────────────┐        ┌─────────────────────────────┐        ┌──────────────────────────────┐
       │  normalizeOpenWeather        │        │  normalizeWeatherAPI        │        │  normalizeOpenMeteo          │
       │  Forecast(raw, dayIndex)     │        │  Forecast(raw, dayIndex)    │        │  Forecast(raw, dayIndex)     │
       │                              │        │                             │        │                              │
       │  dayStart = dayIndex * 8     │        │  forecastday[dayIndex]      │        │  d.time[dayIndex]            │
       │  slice(dayStart, +8)         │        │                             │        │  d.temp_max[dayIndex]        │
       │  ─────────────────────       │        │  if !day → fallback default │        │  d.weather_code[dayIndex]    │
       │  avg temp                    │        │                             │        │  etc.                        │
       │  max pop                     │        │  avgtemp_c                  │        │                              │
       │  sum rain                    │        │  maxtemp_c / mintemp_c      │        │  if !d.time[i] → fallback    │
       │  middle-item icon            │        │  avghumidity                │        │  default                     │
       │  if empty → fallback default │        │  maxwind_kph                │        │                              │
       └──────────────┬───────────────┘        └─────────────┬───────────────┘        └──────────────┬───────────────┘
                      │                                       │                                        │
                      │  NormalizedWeather[3]                 │  NormalizedWeather[3]                  │  NormalizedWeather[3]
                      │  or fallback per index                │  or fallback per index                 │  or fallback per index
                      │                                       │                                        │
                      └───────────────────────────────────────┼────────────────────────────────────────┘
                                                              │
                                                              ▼
                                            ┌─────────────────────────────────┐
                                            │  owDays / waDays / omDays        │
                                            │  fulfilled → NormalizedWeather[] │
                                            │  rejected  → null                │
                                            └────────────────┬────────────────┘
                                                             │
                                            ┌────────────────▼────────────────┐
                                            │  Track providers                 │
                                            │  successfulProviders[]           │
                                            │  failedProviders[]               │
                                            └────────────────┬────────────────┘
                                                             │
                                                  ┌──────────┴──────────┐
                                             ≥1 success            all null
                                                  │                    │
                                                  │             ┌──────▼──────┐
                                                  │             │  503        │
                                                  │             │  provider_  │
                                                  │             │  unavailable│
                                                  │             └─────────────┘
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  numDays = min(days, 3)                  │
                                   │  today = new Date()  (UTC)               │
                                   └──────────────┬──────────────────────────┘
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  Array.from({ length: numDays }, (_, i) │
                                   │  Repeat for i = 0, 1, 2                 │
                                   └──────────────┬──────────────────────────┘
                                                  │
                          ╔═══════════════════════▼════════════════════════╗
                          ║  Per-day loop  (i = 0 → numDays-1)            ║
                          ║                                                ║
                          ║  date = new Date(today)                        ║
                          ║  date.setDate(date.getDate() + i)              ║
                          ║  dateStr = date.toISOString().split("T")[0]   ║
                          ║  ── UTC date string ──────────────────────    ║
                          ║                                                ║
                          ║  perDayResults = [                             ║
                          ║    { openweather, owDays?.[i] ?? null },       ║
                          ║    { weatherapi,  waDays?.[i] ?? null },       ║
                          ║    { openmeteo,   omDays?.[i] ?? null },       ║
                          ║  ]                                             ║
                          ╚═══════════════════════╤════════════════════════╝
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  aggregateWeather(perDayResults)         │
                                   └──────────────┬──────────────────────────┘
                                                  │
                                       ┌──────────┴──────────┐
                                  ≥1 success            all null (throws)
                                       │                    │
                                       │             ┌──────▼────────────────────┐
                                       │             │  Hardcoded fallback day    │
                                       │             │  temp=20, humid=60, etc.  │
                                       │             │  confidence all 0          │
                                       │             │  incomplete_data: true     │
                                       │             └──────┬────────────────────┘
                                       │                    │
                                       └────────────────────┘
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  { date: dateStr,                        │
                                   │    weather: aggregated.weather }         │
                                   └──────────────┬──────────────────────────┘
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  ForecastResponseShape                   │
                                   │  {                                       │
                                   │    days: forecastDays[],                 │
                                   │    providers_used: [...],                │
                                   │    providers_failed: [...],              │
                                   │    incomplete_data: bool,                │
                                   │    cached_at: ISO string (UTC)           │
                                   │  }                                       │
                                   └──────────────┬──────────────────────────┘
                                                  │
                                   ┌──────────────▼──────────────────────────┐
                                   │  forecastCache.set(                      │
                                   │    "cityId:days",                        │
                                   │    { data, expires_at: now + 300_000 }  │
                                   │  )                                       │
                                   └──────────────┬──────────────────────────┘
                                                  │
                                                  ▼
                                        ┌─────────────────┐
                                        │  200 OK          │
                                        │  days[]          │
                                        │  + providers_used│
                                        │  + cached_at     │
                                        └─────────────────┘
```

## Key Differences from `/api/weather/current`

| Aspect | `/current` | `/forecast` |
|---|---|---|
| Cache key | `"cityId"` | `"cityId:days"` |
| Cache stores | `AggregatedWeather` | `ForecastResponseShape` (N days) |
| Provider fetch | Single point-in-time | Array of N daily values |
| Normalization | One value per provider | N values per provider, indexed |
| Per-provider unit | Raw current reading | 3h slots aggregated (OW) / daily summary (WA, OM) |
| All-providers-fail | 503 response | Hardcoded fallback day object, `confidence = 0` |
| Date label | N/A | `new Date().toISOString().split("T")[0]` — UTC |
| Aggregation calls | Once | Once per day × N days |

## Notes

- All three provider fetches run concurrently. A single provider failure only affects the weight redistribution for that day — the other two providers still contribute.
- `days` is part of the cache key: `"seoul:1"`, `"seoul:2"`, and `"seoul:3"` are independent cache entries with independent TTLs.
- OpenWeather's normalizer slices `list` by fixed index (`dayIndex * 8`), assuming 8 slots of 3h data per day starting from the current time. WeatherAPI and Open-Meteo use pre-built calendar-day summaries at `forecastday[dayIndex]` and `daily.*[dayIndex]` respectively.
- The date label is derived from UTC (`toISOString()`), while Open-Meteo is fetched with `timezone=Asia/Seoul`. Between midnight and 09:00 KST, these may produce different date strings for the same index.
- `incomplete_data: true` is set at the response level when any provider failed at the fetch layer, regardless of per-day fallback behavior.
