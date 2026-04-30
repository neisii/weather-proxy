# CLAUDE.md — weather-proxy

Cloudflare Workers 기반 날씨 데이터 집계 프록시 서버.  
OpenWeather, WeatherAPI, Open-Meteo 세 provider의 예보를 가중치 평균으로 집계해 반환한다.  
서비스 대상: **대한민국 8개 도시만** (서울·부산·인천·대구·광주·대전·울산·제주).

---

## 핵심 파일 맵

```
src/index.ts                  라우터 — 경로 디스패치, X-API-Key 인증 게이트
src/handlers/weather.ts       메인 로직 전체 (936줄, 아래 구획 참조)
src/handlers/openweather.ts   OW raw passthrough 핸들러
src/handlers/weatherapi.ts    WA raw passthrough 핸들러
src/handlers/openmeteo.ts     OM raw passthrough 핸들러
src/handlers/health.ts        /api/healthz
src/types/env.ts              Worker env 타입 (API 키, 설정값)
src/utils/cors.ts             CORS 헤더 생성
src/utils/errors.ts           에러 응답 형식
src/__tests__/                단위 테스트 (vitest, Node.js 환경)
docs/                         설계 문서, 엣지케이스 분석, 플로우 다이어그램
```

### weather.ts 내부 구획

```
Line   3 : City registry & VALID_CITY_IDS
Line  51 : Types (NormalizedWeather, ProviderResult, AggregatedWeather, Forecast*)
Line 133 : Condition code maps (OW icon, WMO, WeatherAPI code)
Line 234 : Normalizers — current(OW/WA/OM), forecast(OW/WA/OM)
Line 450 : Upstream fetch functions (fetchWithTimeout 포함)
Line 525 : KST_OFFSET_SEC 상수 (단일 소스)
Line 530 : Aggregation (aggregateWeather, redistributeWeights, weightedAvg)
Line 658 : In-memory cache (currentCache, forecastCache)
Line 674 : Response helpers (jsonResponse, apiError)
Line 693 : Route handlers (handleWeatherCurrent)
Line 776 : Forecast core (buildForecastData, parseForecastParams,
           handleWeatherForecast, handleWeatherForecastDebug)
```

---

## 요청 → 응답 데이터 변환 체인

```
provider raw JSON
  └─ normalizeXxxForecast(raw, targetDate)  →  NormalizedWeather | null
       └─ ProviderResult[]  →  aggregateWeather()
            └─ AggregatedWeather
                 └─ buildForecastData()
                      └─ ForecastDayFull[]
                           ├─ handleWeatherForecast()       → ForecastResponseShape
                           └─ handleWeatherForecastDebug()  → ForecastDebugResponseShape
```

---

## 인증 구조

```
AGGREGATED_PATHS (X-API-Key 불필요)     그 외 모든 경로 (X-API-Key 필수)
  /api/healthz                            /api/weather/forecast/debug
  /api/weather/cities                     /api/openweather/*
  /api/weather/current                    /api/weatherapi/*
  /api/weather/forecast                   /api/openmeteo
```

새 엔드포인트를 `AGGREGATED_PATHS`에 추가하면 인증이 우회된다. **디버그/내부 엔드포인트는 추가하지 않는다.**

---

## 절대 불변 규칙 (invariants)

**1. KST 오프셋은 단 하나의 상수에서만 온다**
```typescript
export const KST_OFFSET_SEC = 9 * 60 * 60;  // weather.ts:527
```
`9 * 3600`이나 `9 * 60 * 60`을 코드에 직접 작성 금지. forecast builder와 OW normalizer 두 곳이 반드시 이 상수를 공유해야 날짜 경계가 일치한다. → [ADR 001](docs/decisions/001-kst-fixed-offset.md)

**2. Forecast normalizer는 null을 반환해야 한다**
```typescript
if (dayItems.length === 0) return null;  // 기본값 객체 반환 금지
```
해당 날짜에 데이터가 없으면 `null`. 기본값 객체(temp=20 등)를 반환하면 다른 날짜 데이터가 집계에 섞인다(cross-date 오염). → [ADR 002](docs/decisions/002-null-not-fallback.md)

**3. 모든 날짜 계산은 KST 기준**
`targetDate`는 `YYYY-MM-DD` KST 문자열. `new Date().toISOString()` 직접 사용 금지 — UTC 날짜를 반환한다.

**4. Normalizer는 물리적 범위 이탈 값을 차단한다**
```typescript
// forecast: return null → weight 재분배
// current:  throw       → Promise.allSettled가 data: null 처리
if (!isNormalizedWeatherValid(result)) return null;
```
이상값(temp=9999 등)을 clamp하거나 집계에 포함하지 않는다. 검증 범위는 `FIELD_RANGES` 상수(단일 소스). → [ADR 004](docs/decisions/004-normalizer-range-validation.md)

---

## 알려진 기존 타입 에러

`npx tsc --noEmit` 실행 시 아래 4건이 항상 존재한다. 요청 없이 수정 금지.
```
src/handlers/openweather.ts(25,9): error TS18046
src/handlers/openweather.ts(59,9): error TS18046
src/handlers/weatherapi.ts(25,9):  error TS18046
src/handlers/weatherapi.ts(59,9):  error TS18046
```

---

## 미결 항목

- [x] `FORECAST_CACHE_TTL_MS` 30분으로 상향 (`CACHE_TTL_MS` 단일 상수 분리)
- [x] normalizer 값 범위 검증 (`temp`, `humidity`, `wind_speed` 물리적 범위) → ADR 004

---

## 인증 키 사용 맥락

`PROXY_API_KEY`(`X-API-Key` 헤더)는 아래 엔드포인트에만 필요하다. 클라이언트 앱(cycling-advisor.onrender.com)은 이 엔드포인트를 호출하지 않으며, **개발자가 직접 provider 원본 응답을 확인할 때만 쓰인다.**

| 엔드포인트 | 용도 |
|---|---|
| `/api/weather/forecast/debug` | per-provider raw 집계 데이터 확인 (디버그) |
| `/api/openweather/current`, `/api/openweather/forecast` | OpenWeather 원본 응답 passthrough |
| `/api/weatherapi/current`, `/api/weatherapi/forecast` | WeatherAPI 원본 응답 passthrough |
| `/api/openmeteo` | Open-Meteo 원본 응답 passthrough |

인증 게이트 구현: `src/index.ts:38–42`

---

## 설계 문서

| 파일 | 내용 |
|---|---|
| `docs/forecast-edge-cases.md` | 예보 버그 원인 분석 및 엣지케이스 목록 |
| `docs/cache-risk-and-discussion.md` | 캐시 TTL, EC-2/CC-5 리스크, 설계 논의 |
| `docs/flow-current-weather.md` | `/api/weather/current` 요청 플로우 |
| `docs/flow-forecast-weather.md` | `/api/weather/forecast` 요청 플로우 |
| `docs/decisions/` | 아키텍처 결정 기록 (ADR) |
