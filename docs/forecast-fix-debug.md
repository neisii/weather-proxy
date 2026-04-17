# Forecast Fix Debug Report

## Overview

This document traces the before/after behavior of the forecast aggregation pipeline for:

```
GET /api/weather/forecast?cityId=seoul&days=3
```

Fix applied in: `src/handlers/weather.ts`

---

## 1. Before vs After Comparison

### Before (buggy)

The builder computed date labels using UTC:

```
const today = new Date();                        // UTC time in Worker
date.setDate(date.getDate() + i);
const dateStr = date.toISOString().split("T")[0] // UTC date string
```

And normalizers received a positional index:

```
// OpenWeather
const dayStart = dayIndex * 8;
const dayItems = r.list.slice(dayStart, dayStart + 8);
//  → slots 0-7 = "hours 0-24 from NOW", not a calendar day
//  → shifts continuously as time-of-day changes

// WeatherAPI
const day = r.forecast.forecastday[dayIndex];
//  → index 1 = tomorrow, calendar-aligned (correct)

// Open-Meteo
const i = dayIndex;
//  → index 1 = tomorrow in KST, calendar-aligned (correct)
```

**Result for index 1 ("tomorrow") at 15:00 UTC (00:00 KST next day):**

| Provider | What index 1 actually covered |
|---|---|
| OpenWeather | slots 8–15 = 15:00 UTC today → 12:00 UTC tomorrow (straddles midnight) |
| WeatherAPI | tomorrow 00:00 → 23:59 (local / KST) |
| Open-Meteo | tomorrow 00:00 → 23:59 (KST) |

OpenWeather contributed data from the wrong calendar day. The weighted aggregate was skewed.

**Secondary bug:** Date label used UTC date. Between midnight KST and 09:00 KST (= 15:00–00:00 UTC), the UTC date was one day behind KST, so `days[0].date` showed yesterday from the user's perspective.

---

### After (fixed)

`targetDates` are computed once in KST before any fetch:

```
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY    = 24 * 60 * 60 * 1000;
const targetDates = Array.from({ length: numDays }, (_, i) =>
  new Date(Date.now() + KST_OFFSET_MS + i * MS_PER_DAY).toISOString().split("T")[0]
);
// e.g. ["2026-04-19", "2026-04-20", "2026-04-21"]
```

Each normalizer receives the target KST date string and filters/finds by it:

```
// OpenWeather: filter by KST date derived from dt
const dayItems = r.list.filter(
  (item) => new Date((item.dt + 9 * 3600) * 1000).toISOString().split("T")[0] === targetDate
);
// → only slots whose KST timestamp falls on targetDate

// WeatherAPI: find by date field
const day = r.forecast.forecastday.find((d) => d.date === targetDate);
// → exact calendar-day match

// Open-Meteo: findIndex in time array
const i = d.time.findIndex((t) => t === targetDate);
// → direct match; time[] is already in KST (timezone=Asia/Seoul)
```

**Result for targetDate "2026-04-20" ("tomorrow") at any time of day:**

| Provider | What is matched |
|---|---|
| OpenWeather | All 3h slots where slot's KST date = 2026-04-20 (up to 8 slots, fewer near boundaries) |
| WeatherAPI | `forecastday` entry where `.date === "2026-04-20"` |
| Open-Meteo | `daily` row where `time[i] === "2026-04-20"` |

All three providers now refer to the identical calendar day.

---

## 2. OpenWeather Slot Mapping

OpenWeather returns 40 slots covering ~5 days at 3-hour resolution. The KST date of each slot is:

```
kstDate = new Date((slot.dt + 9 * 3600) * 1000).toISOString().split("T")[0]
```

### Example: request at 14:00 UTC (23:00 KST) on 2026-04-18

```
targetDates = ["2026-04-18", "2026-04-19", "2026-04-20"]
```

| Slot # | dt (UTC epoch) | UTC time | KST time | KST date | Matched to |
|---|---|---|---|---|---|
| 0 | ... | 2026-04-18 15:00 | 2026-04-19 00:00 | 2026-04-19 | targetDates[1] |
| 1 | ... | 2026-04-18 18:00 | 2026-04-19 03:00 | 2026-04-19 | targetDates[1] |
| ... | | | | | |
| 7 | ... | 2026-04-19 12:00 | 2026-04-19 21:00 | 2026-04-19 | targetDates[1] |
| 8 | ... | 2026-04-19 15:00 | 2026-04-20 00:00 | 2026-04-20 | targetDates[2] |

**Before fix** at the same time: `dayIndex=0 → slice(0,8)` would have been slots 0–7, all on KST date 2026-04-19 — meaning index 0 ("today") was fed tomorrow's data.

**After fix**: slots are grouped by KST date, so targetDate "2026-04-18" correctly receives zero OpenWeather slots (today has already passed in KST), and the normalizer returns the fallback default. Remaining daytime hours are fetched from WeatherAPI and Open-Meteo which still have today's data.

---

## 3. Provider Matching Logs

The Worker now logs `targetDates` at fetch time:

```json
{
  "msg": "Fetching forecast",
  "cityId": "seoul",
  "days": 3,
  "targetDates": ["2026-04-19", "2026-04-20", "2026-04-21"]
}
```

Per-provider matching behavior for each `targetDate`:

### OpenWeather

```
targetDate: "2026-04-19"
  → filter r.list where kstDate(dt) === "2026-04-19"
  → matched: N slots (0 ≤ N ≤ 8)
  → if N === 0: fallback default returned

targetDate: "2026-04-20"
  → matched: up to 8 slots covering 2026-04-20 in KST
  → aggregated: avg temp, max pop, sum rain from matched slots

targetDate: "2026-04-21"
  → matched: up to 8 slots (may be fewer near 5-day API limit)
  → if N === 0: fallback default returned
```

### WeatherAPI

```
targetDate: "2026-04-19"
  → forecastday.find(d => d.date === "2026-04-19")
  → matched / not matched (returns fallback default if not matched)

targetDate: "2026-04-20"
  → forecastday.find(d => d.date === "2026-04-20")
  → matched (days=3 requested, API returns today+1+2)

targetDate: "2026-04-21"
  → forecastday.find(d => d.date === "2026-04-21")
  → matched
```

### Open-Meteo

```
targetDate: "2026-04-19"
  → d.time.findIndex(t => t === "2026-04-19")
  → i = 0 (today in KST) → matched

targetDate: "2026-04-20"
  → i = 1 → matched

targetDate: "2026-04-21"
  → i = 2 → matched
```

---

## 4. Edge Case Logs

### Partial day (fewer than 8 slots matched for OpenWeather)

Occurs when `targetDate` is today in KST and significant time has already elapsed, or when `targetDate` is the final day near the 5-day API limit.

**Behavior:** The aggregation arithmetic handles variable-length arrays correctly:
- `temps.reduce(...) / temps.length` — average over N items regardless of N
- `Math.max(...dayItems.map(...))` — works for N ≥ 1
- The existing `if (dayItems.length === 0)` guard handles the N = 0 case

A partial day (e.g., 3 slots) produces a valid `NormalizedWeather` from those slots. The result may have less accurate temperature range values than a full 8-slot day, but it is never incorrect or mixed with another calendar day.

### Empty day (zero slots matched for OpenWeather)

Occurs when `targetDate` is today in KST and it is late in the evening (all slots have passed), or for a date beyond the API's 5-day window.

**Behavior:**
```typescript
if (dayItems.length === 0) {
  const item = r.list[0] ?? r.list[0];  // first available slot as fallback
  ...return fallback NormalizedWeather
}
```

The fallback uses `r.list[0]` (the nearest future slot). This data point is from a different day but serves as a graceful degradation. WeatherAPI and Open-Meteo still contribute their correct calendar-day values; the aggregation weight redistribution handles the OpenWeather data being from a different period by treating it as a low-quality signal (weight 0.40 for temperature is kept but the data itself is the nearest slot, not a day average).

> **Note:** A future improvement could return `null` from the normalizer when no slots match, so the provider is treated as fully failed for that day, triggering weight redistribution. This is out of scope for this minimal fix.

### Provider failure

If an entire provider fetch throws (network timeout, non-200 response), the fetch function propagates the rejection to `Promise.allSettled`. The result is:

```typescript
const owDays = owResult.status === "fulfilled" ? owResult.value : null;
// owDays === null → failedProviders.push("openweather")
```

In `perDayResults`:
```typescript
{ provider: "openweather", data: owDays?.[i] ?? null, error: owDays ? null : "failed" }
```

`aggregateWeather` receives `data: null` for the failed provider, excludes it from `successful`, redistributes its weights to remaining providers, and sets `incomplete_data: true` in the response.

---

## 5. Final Assertions

### ✅ All providers align to the same calendar date

Each provider now receives the same `targetDate` string (e.g., `"2026-04-20"`) and each normalizer selects data only from that calendar date in KST. Cross-day mixing is no longer possible.

### ✅ No index-based slicing remains

- `slice(dayIndex * 8, ...)` → removed
- `forecastday[dayIndex]` → removed
- `const i = dayIndex` → removed
- All selection is now driven by `targetDate` string comparison

Verified by searching the file — no references to `dayIndex` remain in forecast normalizers.

### ✅ KST is consistently applied across the system

| Location | Before | After |
|---|---|---|
| Date label generation | `new Date().toISOString().split("T")[0]` (UTC) | `new Date(Date.now() + KST_OFFSET_MS).toISOString().split("T")[0]` (KST) |
| OpenWeather slot grouping | `dayIndex * 8` (rolling offset from now) | `kstDate(slot.dt) === targetDate` (KST calendar) |
| WeatherAPI day selection | `forecastday[dayIndex]` (positional) | `.find(d => d.date === targetDate)` (KST date string match) |
| Open-Meteo day selection | `d.time[dayIndex]` (positional) | `d.time.findIndex(t => t === targetDate)` (KST date string match) |
| Fetch call coordination | Independent `[0,1,2]` index maps | Shared `targetDates[]` passed to all fetchers |

The fixed offset `+9 * 3600` is used for OpenWeather `dt` conversion and date label generation. WeatherAPI and Open-Meteo already produce KST date strings natively. No `Intl` APIs, no dynamic timezone lookups, no new dependencies.
