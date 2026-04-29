# Request Flow: GET /api/weather/current

Source: `src/handlers/weather.ts` — `handleWeatherCurrent()`

```
                    ┌─────────────────────────────────┐
                    │  GET /api/weather/current        │
                    │  ?cityId=seoul                   │
                    └────────────────┬────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │  handleWeatherCurrent()          │
                    │  src/handlers/weather.ts:676     │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │  Validate cityId                 │
                    │  VALID_CITY_IDS.has(cityIdRaw)   │
                    └────────────────┬────────────────┘
                                     │
                          ┌──────────┴──────────┐
                        valid                invalid
                          │                    │
                          │            ┌───────▼────────┐
                          │            │  400 Bad Request│
                          │            │  invalid_city / │
                          │            │  invalid_params │
                          │            └────────────────┘
                          ▼
                    ┌─────────────────────────────────┐
                    │  getCityByName(cityIdRaw)        │
                    │  key = city.id  e.g. "seoul"     │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │  currentCache.get(key)           │
                    │  isFresh(entry)?                 │
                    │  TTL = 5 min                     │
                    └────────────────┬────────────────┘
                                     │
                          ┌──────────┴──────────┐
                        HIT                    MISS
                          │                    │
                          ▼                    ▼
               ┌──────────────────┐   ┌────────────────────────────────────────┐
               │  200 OK          │   │  Promise.allSettled([...])             │
               │  AggregatedWeather│   │  3 providers fetched in parallel       │
               │  (cached)        │   └──────────┬──────────┬──────────┬───────┘
               └──────────────────┘              │          │          │
                                                 │          │          │
                          ┌──────────────────────┘          │          └──────────────────────┐
                          ▼                                  ▼                                 ▼
             ┌────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
             │  fetchOpenWeather      │      │  fetchWeatherAPICurrent  │      │  fetchOpenMeteoCurrent   │
             │  Current()             │      │  ()                      │      │  ()                      │
             │  /data/2.5/weather     │      │  /v1/current.json        │      │  /v1/forecast            │
             │  units=metric          │      │  aqi=no                  │      │  current=...             │
             │  lang=kr               │      │                          │      │  timezone=auto           │
             └───────────┬────────────┘      └────────────┬─────────────┘      └─────────────┬────────────┘
                         │                               │                                   │
                         ▼                               ▼                                   ▼
             ┌────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
             │ normalizeOpenWeather   │      │ normalizeWeatherAPI       │      │ normalizeOpenMeteo       │
             │ Current(raw)           │      │ Current(raw)              │      │ Current(raw)             │
             │                        │      │                           │      │                          │
             │ OW_ICON_MAP[icon]      │      │ WA_CODE_MAP[code]        │      │ WMO_MAP[wmo]             │
             └───────────┬────────────┘      └────────────┬─────────────┘      └─────────────┬────────────┘
                         │                               │                                   │
                         │  fulfilled → data             │  fulfilled → data                 │  fulfilled → data
                         │  rejected  → null             │  rejected  → null                 │  rejected  → null
                         └───────────────────────────────┼───────────────────────────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────┐
                                          │  ProviderResult[3]       │
                                          │  { provider, data, error }│
                                          └─────────────┬────────────┘
                                                        │
                                          ┌─────────────▼────────────┐
                                          │  aggregateWeather()      │
                                          │  line 548                │
                                          └─────────────┬────────────┘
                                                        │
                                             ┌──────────┴──────────┐
                                        ≥1 success            all null
                                             │                    │
                                             │             ┌──────▼──────┐
                                             │             │  throw      │
                                             │             │  All        │
                                             │             │  Providers  │
                                             │             │  Failed     │
                                             │             └──────┬──────┘
                                             │                    │
                                             │             ┌──────▼──────┐
                                             │             │  503        │
                                             │             │  provider_  │
                                             │             │  unavailable│
                                             │             └─────────────┘
                                             │
                          ┌──────────────────▼─────────────────────┐
                          │  redistributeWeights(failedSet)         │
                          │  per factor                             │
                          │                                         │
                          │  temperature  openmeteo 0.45            │
                          │               openweather 0.40          │
                          │               weatherapi 0.15           │
                          │                                         │
                          │  wind_speed   openmeteo 0.60            │
                          │               openweather 0.25          │
                          │               weatherapi 0.15           │
                          │                                         │
                          │  humidity     openweather 0.30          │
                          │               weatherapi 0.70           │
                          │               openmeteo 0.00            │
                          │                                         │
                          │  condition    openweather 1.00          │
                          │               openmeteo 0.00            │
                          │               weatherapi 0.00           │
                          └──────────────────┬─────────────────────┘
                                             │
                          ┌──────────────────▼─────────────────────┐
                          │  weightedAvg() per field                │
                          │                                         │
                          │  temp, feels_like, temp_max, temp_min  │
                          │    → temperature weights                │
                          │                                         │
                          │  wind_speed, wind_deg                  │
                          │    → wind_speed weights                 │
                          │                                         │
                          │  humidity                               │
                          │    → humidity weights                   │
                          │                                         │
                          │  pressure, precip_mm, precip_prob      │
                          │    → equal weight (1/N providers)       │
                          │                                         │
                          │  condition                              │
                          │    → winner-take-all (highest weight)  │
                          │                                         │
                          │  uv_index, visibility                   │
                          │    → simple mean (non-null only)        │
                          └──────────────────┬─────────────────────┘
                                             │
                          ┌──────────────────▼─────────────────────┐
                          │  Confidence scores (stddev-based)       │
                          │                                         │
                          │  temp_conf  = max(0, 1 − σtemp/5)      │
                          │  wind_conf  = max(0, 1 − σwind/3)      │
                          │  humid_conf = max(0, 1 − σhumid/20)    │
                          │  overall    = mean(above three)        │
                          └──────────────────┬─────────────────────┘
                                             │
                          ┌──────────────────▼─────────────────────┐
                          │  currentCache.set(                      │
                          │    key,                                 │
                          │    { data: aggregated,                  │
                          │      expires_at: now + 300_000 }        │
                          │  )                                      │
                          └──────────────────┬─────────────────────┘
                                             │
                                             ▼
                                   ┌─────────────────┐
                                   │  200 OK          │
                                   │  AggregatedWeather│
                                   │  + confidence    │
                                   │  + provider_data │
                                   │  + cached_at     │
                                   └─────────────────┘
```

## Notes

- All three provider fetches run concurrently via `Promise.allSettled` — a single provider timeout (4 s) does not block the others.
- Cache key is `city.id` only (e.g. `"seoul"`). TTL is 5 minutes, lazily evicted on next read.
- Weight redistribution is proportional: a failed provider's weight is spread across surviving providers in proportion to their original share.
- `condition` is winner-take-all, not averaged, because it is a categorical string enum.
- `uv_index` and `visibility` use a simple unweighted mean and are excluded from confidence scoring.
