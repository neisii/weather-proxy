# ADR 004 — Normalizer: 물리적 범위 이탈 값 차단

**상태:** 채택  
**날짜:** 2026-04-30

---

## 상황

세 provider(OW/WA/OM) normalizer에 값 범위 검증이 없다.  
`temp=9999` 같은 이상값이 유입되면 검증 없이 가중평균에 포함되어 집계 결과가 오염된다.  
(`docs/cache-risk-and-discussion.md` 파생 논의 3 참조)

---

## 선택지

### 방안 1: 이상값 clamp (반환 전 범위 초과 시 min/max로 고정)

```typescript
temp: Math.max(-80, Math.min(60, raw.main.temp))
```

### 방안 2: 이상값 차단 — 검증 실패 시 null/throw (채택)

```typescript
if (!isNormalizedWeatherValid(result)) return null;  // forecast
if (!isNormalizedWeatherValid(result)) throw new Error("RangeValidationError: ...");  // current
```

---

## 결정 이유

**방안 1(clamp) 기각:**

clamp는 이상값을 경계값으로 바꿔 집계에 포함한다. `temp=9999` → `temp=60` 이 되어 집계를 왜곡한다.  
또한 provider가 실제로 비정상 상태임에도 성공으로 처리되어 `incomplete_data: false`가 반환된다.

**방안 2 채택:**

이상값을 반환한 provider는 "데이터 없음"과 동일하게 처리한다.

- **forecast normalizer:** 기존 `null` 반환 패턴(ADR 002)을 그대로 활용.  
  상위 레이어(`aggregateWeather`)가 해당 provider를 실패로 처리하고 weight를 재분배한다.

- **current normalizer:** `throw`로 처리.  
  fetcher(`fetchXxxCurrent`)가 reject되면 `handleWeatherCurrent`의 `Promise.allSettled`가 `data: null`로 처리한다.  
  return type 변경 없이 기존 에러 경로를 재사용할 수 있다.

두 경우 모두 나머지 provider로 집계가 계속되며, 3개 모두 실패 시 기존 `503` 응답이 반환된다.

---

## 물리적 범위 상수

```typescript
const FIELD_RANGES = {
  temp:       { min: -80,  max: 60   },  // 섭씨 — 지구 관측 극값 기준
  humidity:   { min: 0,    max: 100  },  // %
  wind_speed: { min: 0,    max: 120  },  // m/s — 변환 후 기준 (÷3.6 이후 적용)
  pressure:   { min: 870,  max: 1085 },  // hPa
  precip_mm:  { min: 0,    max: 500  },  // mm/일
  uv_index:   { min: 0,    max: 20   },  // UV index
};
```

`wind_speed`는 WA/OM이 kph → m/s 변환(`÷3.6`)한 후에 검증한다.  
변환 전 kph 값에 범위를 적용하면 120 m/s ≈ 432 kph로 계산해야 하므로 변환 후 단일 기준을 유지한다.

검증 대상 필드: `temp`, `temp_max`, `temp_min`, `humidity`, `wind_speed`, `pressure`, `precip_mm`, `uv_index`(null 허용).

---

## 결과 및 트레이드오프

**장점:**
- 이상값이 집계에 포함되지 않음
- provider 응답 이상을 `providers_failed`, `incomplete_data: true`로 명시적 노출
- `/api/weather/forecast/debug`에서 `data: null` + `error` 필드로 원인 추적 가능

**단점:**
- 세 provider 모두 동시에 이상값을 반환하면 `503` 응답  
  (이상값을 그대로 서빙하는 것보다 낫다는 판단)

**적용 위치:**

| 함수 | 처리 방식 | 위치 |
|---|---|---|
| `normalizeOpenWeatherCurrent` | throw | `weather.ts:236` |
| `normalizeWeatherAPICurrent` | throw | `weather.ts:303` |
| `normalizeOpenMeteoCurrent` | throw | `weather.ts:377` |
| `normalizeOpenWeatherForecast` | return null | `weather.ts:264` |
| `normalizeWeatherAPIForecast` | return null | `weather.ts:337` |
| `normalizeOpenMeteoForecast` | return null | `weather.ts:412` |
