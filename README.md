# weather-proxy

Cloudflare Workers 기반 날씨 데이터 집계 프록시 서버.  
OpenWeather, WeatherAPI, Open-Meteo 세 provider의 데이터를 가중치 평균으로 집계해 반환한다.

**프로덕션:** `https://weather-proxy.neisii.workers.dev`  
**서비스 대상:** 대한민국 8개 도시 (서울·부산·인천·대구·광주·대전·울산·제주)

---

## 아키텍처

```
클라이언트
  └─ /api/weather/current     ─┐
  └─ /api/weather/forecast     ├─ aggregateWeather()  ←  OW + WA + OM 병렬 fetch
  └─ /api/weather/cities       │                          가중치 평균 집계
  └─ /api/healthz             ─┘                          in-memory 캐시
```

provider별 기본 가중치:

| 필드 | OpenWeather | WeatherAPI | Open-Meteo |
|---|---|---|---|
| 기온 | 0.40 | 0.15 | 0.45 |
| 풍속 | 0.25 | 0.15 | 0.60 |
| 습도 | 0.30 | 0.70 | 0.00 |

provider가 실패하거나 이상값을 반환하면 weight를 나머지에 재분배해 집계를 계속한다.

---

## 엔드포인트

### 공개 (인증 불필요)

#### `GET /api/healthz`
```json
{ "status": "ok" }
```

#### `GET /api/weather/cities`
```json
{
  "cities": [
    { "id": "seoul", "name": "서울", "lat": 37.5683, "lon": 126.9778 },
    ...
  ]
}
```

#### `GET /api/weather/current?cityId={id}`

```json
{
  "weather": {
    "temp": 21.9,
    "feels_like": 21.2,
    "temp_max": 24.1,
    "temp_min": 19.3,
    "humidity": 45,
    "pressure": 1013,
    "wind_speed": 3.2,
    "wind_deg": 180,
    "condition": "partly_cloudy",
    "precip_mm": 0,
    "precip_prob": 0,
    "uv_index": 4.2,
    "visibility": 10000
  },
  "confidence": { "temp": 0.95, "wind": 0.88, "humidity": 0.92, "overall": 0.92 },
  "providers_used": ["openweather", "weatherapi", "openmeteo"],
  "providers_failed": [],
  "incomplete_data": false,
  "cached_at": "2026-04-30T06:03:33.580Z"
}
```

캐시 TTL: **5분**

#### `GET /api/weather/forecast?cityId={id}&days={1|2|3}`

```json
{
  "days": [
    { "date": "2026-04-30", "weather": { ... } },
    { "date": "2026-05-01", "weather": { ... } },
    { "date": "2026-05-02", "weather": { ... } }
  ],
  "providers_used": ["openweather", "weatherapi", "openmeteo"],
  "providers_failed": [],
  "incomplete_data": false,
  "cached_at": "2026-04-30T06:03:33.580Z"
}
```

- `days` 기본값: `3` (최대 3)
- 날짜는 KST 기준 `YYYY-MM-DD`
- 캐시 TTL: **30분** (provider 모델 갱신 주기 ~6시간 대비 최적화)

---

### 인증 필요 (`X-API-Key` 헤더)

개발자 디버깅 및 provider 원본 응답 확인용. 클라이언트 앱에서는 사용하지 않는다.

| 엔드포인트 | 용도 |
|---|---|
| `GET /api/weather/forecast/debug?cityId={id}&days={n}` | per-provider 집계 원본 데이터 |
| `GET /api/openweather/current?cityId={id}` | OpenWeather raw passthrough |
| `GET /api/openweather/forecast?cityId={id}` | OpenWeather raw passthrough |
| `GET /api/weatherapi/current?cityId={id}` | WeatherAPI raw passthrough |
| `GET /api/weatherapi/forecast?cityId={id}` | WeatherAPI raw passthrough |
| `GET /api/openmeteo?cityId={id}` | Open-Meteo raw passthrough |

```bash
curl -H "X-API-Key: $PROXY_API_KEY" \
  "https://weather-proxy.neisii.workers.dev/api/weather/forecast/debug?cityId=seoul&days=3"
```

인증 실패 시 `401 Unauthorized`.

---

## 로컬 개발

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.dev.vars` 파일 생성 (git 제외됨):

```bash
OPENWEATHER_API_KEY=your_openweather_key
WEATHERAPI_API_KEY=your_weatherapi_key
PROXY_API_KEY=your_proxy_secret
```

### 3. 개발 서버 실행

```bash
npm run dev
# http://localhost:8787
```

---

## 테스트

```bash
# 단위 테스트 (normalizer, aggregation — 61개)
npm test

# 프로덕션 E2E 테스트 (27개, 실제 프로덕션 타격)
npm run test:e2e
```

E2E 테스트 커버리지: 8개 도시 전체, days=1/2/3, KST 날짜 정합성, 필드 범위 검증, 인증, CORS, 엣지케이스.

---

## 배포

```bash
# Secrets 설정 (최초 1회)
wrangler secret put OPENWEATHER_API_KEY
wrangler secret put WEATHERAPI_API_KEY
wrangler secret put PROXY_API_KEY

# 배포
npm run deploy
```

---

## 프로젝트 구조

```
src/
├── index.ts                  라우터 — 경로 디스패치, 2-tier 인증 게이트
├── handlers/
│   ├── weather.ts            집계 핵심 로직 (normalizer, aggregation, cache, handler)
│   ├── openweather.ts        OW raw passthrough
│   ├── weatherapi.ts         WA raw passthrough
│   ├── openmeteo.ts          OM raw passthrough
│   └── health.ts             /api/healthz
├── types/env.ts              Worker env 타입
├── utils/
│   ├── cors.ts               CORS 헤더
│   └── errors.ts             에러 응답 형식
└── __tests__/
    ├── aggregation.test.ts   단위 테스트
    ├── normalizers.test.ts   단위 테스트
    ├── forecast-debug.test.ts 단위 테스트
    └── e2e/
        └── production.test.ts E2E 테스트
docs/
├── decisions/                ADR (001~004)
└── *.md                      설계 문서, 엣지케이스 분석
```

---

## 모니터링

```bash
# 실시간 로그
npm run tail
```

Cloudflare Dashboard → Workers & Pages → weather-proxy → Analytics

---

## 라이선스

MIT
