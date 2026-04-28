# Forecast Edge Cases, Corner Cases & Trade-offs

## Scenario: `GET /api/weather/forecast?cityId=seoul&days=3`
### Target period: 2026-04-26 ~ 2026-04-28

---

## Upstream API Calls

One request triggers **3 parallel upstream calls** via `Promise.allSettled`.
Timeout per call: **4000ms** (independent).

### 1. OpenWeather

```
https://api.openweathermap.org/data/2.5/forecast
  ?q=seoul
  &appid=<OPENWEATHER_API_KEY>
  &units=metric
  &lang=kr
```

| Parameter | Value | Notes |
|---|---|---|
| `q` | `seoul` | `city.id` — no encoding needed |
| `appid` | `<KEY>` | Injected from Worker env |
| `units` | `metric` | °C, m/s |
| `lang` | `kr` | Korean description text; does not affect icon code |

Response: `list[]` — up to 40 slots, 3-hour intervals, UTC epoch `dt` field.

### 2. WeatherAPI

```
https://api.weatherapi.com/v1/forecast.json
  ?key=<WEATHERAPI_API_KEY>
  &q=seoul
  &days=3
  &aqi=no
```

| Parameter | Value | Notes |
|---|---|---|
| `key` | `<KEY>` | Injected from Worker env |
| `q` | `seoul` | City name |
| `days` | `3` | Today + 2 days; returns `forecastday[0..2]` |
| `aqi` | `no` | Air quality excluded |

Response: `forecast.forecastday[]` — 3 daily summary objects, `date` field = local-time date string.

### 3. Open-Meteo

```
https://api.open-meteo.com/v1/forecast
  ?latitude=37.5665
  &longitude=126.978
  &timezone=Asia%2FSeoul
  &daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max
  &forecast_days=3
```

| Parameter | Value | Notes |
|---|---|---|
| `latitude` | `37.5665` | Seoul coordinates |
| `longitude` | `126.978` | Seoul coordinates |
| `timezone` | `Asia%2FSeoul` | KST — `daily.time[]` returns KST date strings |
| `daily` | 9 fields | max/min temp, apparent temp, weather code, precipitation, wind, UV |
| `forecast_days` | `3` | Today + 2 days |

Response: `daily.time[]` = `["2026-04-26", "2026-04-27", "2026-04-28"]` (KST).

### Call Structure

```
GET /api/weather/forecast?cityId=seoul&days=3
  │
  └── Promise.allSettled([
        OW  → api.openweathermap.org/data/2.5/forecast?q=seoul&units=metric&lang=kr&...
        WA  → api.weatherapi.com/v1/forecast.json?q=seoul&days=3&aqi=no&...
        OM  → api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&timezone=Asia%2FSeoul&...
      ])
```

---

## Two Active Bugs

| Bug | Location | Cause |
|---|---|---|
| **A** — Date label error | `weather.ts:849` `toISOString().split("T")[0]` | Worker runs in UTC; KST is UTC+9. From **00:00–08:59 KST** the UTC date is one day behind KST |
| **B** — OpenWeather slot misalignment | `weather.ts:258` `slice(dayIndex * 8, +8)` | `list[]` starts at current request time, not calendar midnight. `dayIndex * 8` is a time offset, not a date boundary |

---

## Bug A — Date Label: Active Window by Request Time

| Request Time (KST) | UTC | `day[0].date` output | Actual KST date | Correct? |
|---|---|---|---|---|
| 00:01 | Apr 25 15:01 | `"2026-04-25"` | `2026-04-26` | ❌ one day behind |
| 03:00 | Apr 25 18:00 | `"2026-04-25"` | `2026-04-26` | ❌ one day behind |
| 08:59 | Apr 25 23:59 | `"2026-04-25"` | `2026-04-26` | ❌ one day behind |
| 09:00 | Apr 26 00:00 | `"2026-04-26"` | `2026-04-26` | ✅ |
| 12:00 | Apr 26 03:00 | `"2026-04-26"` | `2026-04-26` | ✅ |
| 23:59 | Apr 26 14:59 | `"2026-04-26"` | `2026-04-26` | ✅ |

**Bug A active window: 00:00–08:59 KST daily (9 hours).**

During this window the entire response shifts by one day:
`days[0].date = "2026-04-25"`, `days[1].date = "2026-04-26"`, `days[2].date = "2026-04-27"`.

---

## Bug B — OpenWeather Slot Misalignment by Request Time

OpenWeather `list[0]` starts at the next 3-hour UTC boundary after the request.
`slice(dayIndex * 8, dayIndex * 8 + 8)` = 8 slots × 3h = 24h rolling window, **not** aligned to calendar midnight.

### Request at 09:00 KST (= Apr 26 00:00 UTC)

| dayIndex | Slots | OW actual coverage (KST) | WA / OM reference | Contamination |
|---|---|---|---|---|
| 0 `"04-26"` | 0–7 | Apr 26 09:00 → Apr 27 06:00 | Apr 26 full day | ⚠️ Apr 27 data mixed in |
| 1 `"04-27"` | 8–15 | Apr 27 09:00 → Apr 28 06:00 | Apr 27 full day | ⚠️ Apr 28 data mixed in |
| 2 `"04-28"` | 16–23 | Apr 28 09:00 → Apr 29 06:00 | Apr 28 full day | ⚠️ Apr 29 data mixed in |

### Request at 21:00 KST (= Apr 26 12:00 UTC)

| dayIndex | Slots | OW actual coverage (KST) | Contamination |
|---|---|---|---|
| 0 `"04-26"` | 0–7 | Apr 26 21:00 → Apr 27 18:00 | ❌ Apr 27 is majority |
| 1 `"04-27"` | 8–15 | Apr 27 21:00 → Apr 28 18:00 | ❌ Apr 28 is majority |
| 2 `"04-28"` | 16–23 | Apr 28 21:00 → Apr 29 18:00 | ❌ **Apr 29 only — Apr 28 daytime absent** |

---

## Aggregation Contamination by Weight

Temperature weights: OpenWeather **0.40**, Open-Meteo **0.45**, WeatherAPI **0.15**

### 2026-04-26 (dayIndex=0), request at 21:00 KST

| Provider | Data actually contributed | Weight | Contamination |
|---|---|---|---|
| OpenWeather | Apr 26 21:00 → Apr 27 18:00 | 0.40 | **Apr 27 at 40%** |
| Open-Meteo | Apr 26 full day (KST) | 0.45 | Clean |
| WeatherAPI | Apr 26 full day (local) | 0.15 | Clean |

### 2026-04-28 (dayIndex=2), request at 21:00 KST — worst case

| Provider | Data actually contributed | Weight | Contamination |
|---|---|---|---|
| OpenWeather | Apr 28 21:00 → Apr 29 18:00 | 0.40 | **Apr 29 at 40%; Apr 28 daytime absent** |
| Open-Meteo | Apr 28 full day (KST) | 0.45 | Clean |
| WeatherAPI | Apr 28 full day (local) | 0.15 | Clean |

---

## Edge Cases

### EC-1: Exactly at midnight KST (00:00:00)

- `toISOString()` = `"2026-04-25T15:00:00.000Z"` → `day[0].date = "2026-04-25"` ❌
- OW `list[0].dt` ≈ Apr 26 00:00 KST → `slice(0,8)` covers Apr 26 00:00–21:00 KST
- **Data correctly covers Apr 26, but label reads Apr 25** — Bugs A and B cancel partially but the label is still wrong.

### EC-2: Cache boundary crossing midnight (23:58 → 00:03 KST)

- Cache written at 23:58 KST: key = `"seoul:3"`, `day[0].date = "2026-04-26"`, TTL = +5 min
- Cache HIT at 00:01 KST: still Fresh → returns `day[0].date = "2026-04-26"`
- Actual KST date is already Apr 27 → **stale yesterday served as today for up to 5 minutes post-midnight**

### EC-3: OpenWeather 5-day limit (late Apr 26 requests for Apr 28)

- OW API provides up to 40 slots (5 days × 8)
- Request at Apr 26 23:00 KST: slot 16 = Apr 28 23:00 KST; slot 23 = Apr 29 20:00 KST
- `slice(16, 24)` may contain fewer than 8 items near the 5-day boundary
- Current code aggregates the partial slice without error — **fewer slots skew averages** (e.g. temp mean from 4 slots instead of 8)

### EC-4: OpenWeather returns zero slots for Apr 28 (fallback trigger)

- Possible when request is at Apr 26 23:xx KST and dayIndex=2 falls entirely outside the 5-day window
- `dayItems.length === 0` → existing fallback uses `r.list[0]` (the current-time slot)
- **Apr 28 forecast is filled with present conditions** — the most severe data corruption case

### EC-5: OpenWeather failure improves accuracy (paradox)

- OW fetch fails → `owDays = null` → weight redistributed proportionally
- Temperature: OM 0.45 + WA 0.15 → redistributed to OM **0.75** / WA **0.25**
- **Apr 28 temperature aggregate becomes more accurate when OpenWeather is unavailable** because the contaminated 40% weight is removed

---

## Corner Cases

### CC-1: `days=1` request — today only

- Cache key `"seoul:1"` is independent from `"seoul:3"`
- Only `dayIndex=0` used — contamination is minimal compared to dayIndex=2
- OW slot still starts at current time, not midnight; partial misalignment persists

### CC-2: `condition` field — 100% from OpenWeather regardless

- `condition` uses winner-take-all, OpenWeather weight = 1.00
- OW supplies the icon from the middle slot of the potentially wrong-day slice
- **`condition` for Apr 28 is derived from Apr 29 night slots** when requested late in the day
- If OW fails: OM and WA both have weight 0.00 → redistributed equally → first successful provider wins

### CC-3: `humidity` is not fully immune

- humidity weights: OW **0.30** / WA **0.70** / OM 0.00
- OW contributes wrong-day humidity at 30% weight
- WA provides correct calendar-day humidity at 70% weight → **humidity is 30% contaminated**, not clean

### CC-4: Provider geography mismatch

- OpenWeather and WeatherAPI are queried by city name string `"seoul"`
- Open-Meteo is queried by coordinates `latitude=37.5665&longitude=126.978`
- Each API may resolve "seoul" to a slightly different administrative point
- **Inter-provider stddev partially reflects coordinate mismatch**, not just forecast model disagreement — confidence scores are slightly inflated

### CC-5: `days=2` cache miss after `days=3` hit

- A prior `days=3` fetch already contains Apr 26 + Apr 27 data in memory
- A subsequent `days=2` request checks key `"seoul:2"` — **separate cache entry, always a miss**
- The two requests fetch all 3 providers again independently; no partial cache reuse

---

## Trade-offs

| Trade-off | Current choice | Cost | Alternative cost |
|---|---|---|---|
| **Slot grouping** | `index × 8` (simple) | Calendar day misalignment grows with time-of-day | Date-based filter (correct; minor code increase) |
| **Date label** | UTC `toISOString()` | 00:00–08:59 KST daily label error | `Date.now() + 9h` offset (trivial fix) |
| **Cache TTL** | 5 minutes | Up to 5 min stale at midnight boundary | Shorter TTL raises upstream API costs |
| **Cache key** | `cityId:days` only | Cross-midnight stale for ≤5 min | `cityId:days:kstDate` causes unbounded Map growth (no active eviction) |
| **OW empty-slot fallback** | Use `r.list[0]` | Present-moment data silently fills a future date | Return `null` and let weight redistribution handle it (safer) |
| **OW weight 0.40 hardcoded** | Fixed regardless of data quality | Misaligned data receives 40% trust | Dynamic quality scoring (significant complexity) |
| **Partial OW slice allowed** | Aggregate however many slots match | Fewer slots skew daily averages | Enforce minimum slot count before aggregating |
| **Provider failure handling** | Per-request, no retry | A transient OW failure loses 40% weight permanently for that cache cycle | Retry with backoff (increases latency, timeout risk) |

---

## Per-Date Risk Summary (2026-04-26 ~ 2026-04-28)

| Date | Bug A risk | Bug B risk | Worst-case scenario |
|---|---|---|---|
| **Apr 26** | 00:00–08:59 KST | Worsens as day progresses | Request at 21:00 KST: OW day0 is effectively Apr 27 data at 40% weight |
| **Apr 27** | Same 9-hour window | Same rolling pattern | Stale Apr 26 cache may HIT until 00:05 KST; OW data drifts similarly |
| **Apr 28** | Same 9-hour window | **Most severe** — OW 5-day boundary proximity | Late Apr 26 request triggers `r.list[0]` fallback; Apr 28 forecast = current conditions |
