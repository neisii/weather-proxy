# Weather Proxy — Cloudflare Workers

Weather API 프록시 서버. API 키를 클라이언트에 노출하지 않고 여러 날씨 API를 통합·집계하여 프론트엔드에 단일 인터페이스로 제공합니다.

## 목적

- **보안**: API 키를 클라이언트에 노출하지 않음
- **집계**: 3개 제공자의 결과를 가중 평균으로 통합
- **성능**: Cloudflare 글로벌 엣지 네트워크 + 인메모리 캐시 (5분 TTL)
- **무료**: 일일 100,000 requests 무료 제공

## 지원 업스트림 API

| 제공자 | 역할 |
|---|---|
| OpenWeatherMap | 현재 날씨 + 예보 |
| WeatherAPI.com | 현재 날씨 + 예보 |
| Open-Meteo | 현재 날씨 + 예보 (API 키 불필요) |

---

## API 엔드포인트

### 두 가지 엔드포인트 계층

| 계층 | 경로 접두사 | 인증 |
|---|---|---|
| **집계 API** (프론트엔드용) | `/api/healthz`, `/api/weather/*` | CORS allowlist만 적용 |
| **원시 패스스루** (내부용) | `/api/openweather/*`, `/api/weatherapi/*`, `/api/openmeteo` | `X-API-Key` 헤더 필수 |

---

### 집계 API (프론트엔드용)

#### Health Check

```
GET /api/healthz
```

```json
{ "status": "ok" }
```

#### 도시 목록

```
GET /api/weather/cities
```

지원 도시: `seoul`, `busan`, `incheon`, `daegu`, `gwangju`, `daejeon`, `ulsan`, `jeju`

```json
{
  "cities": [
    { "id": "seoul", "name_ko": "서울", "name_en": "Seoul", "lat": 37.5665, "lon": 126.978 }
  ]
}
```

#### 현재 날씨 (집계)

```
GET /api/weather/current?cityId={cityId}
```

**Parameters:**
- `cityId` (required): 도시 ID (예: `seoul`, `busan`)

**Response:**
```json
{
  "weather": {
    "temp": 14.2,
    "feels_like": 12.8,
    "temp_max": 16.0,
    "temp_min": 11.5,
    "humidity": 63,
    "pressure": 1015,
    "wind_speed": 3.2,
    "wind_deg": 270,
    "condition": "partly_cloudy",
    "precip_mm": 0,
    "precip_prob": 5,
    "uv_index": 3.1,
    "visibility": 10000
  },
  "confidence": {
    "temp": 0.94,
    "wind": 0.87,
    "humidity": 0.91,
    "overall": 0.91
  },
  "providers_used": ["openweather", "weatherapi", "openmeteo"],
  "providers_failed": [],
  "incomplete_data": false,
  "cached_at": "2025-04-17T10:00:00.000Z",
  "provider_data": [...]
}
```

`condition` 가능한 값: `clear`, `partly_cloudy`, `cloudy`, `overcast`, `drizzle`, `light_rain`, `moderate_rain`, `heavy_rain`, `thunderstorm`, `snow`, `blizzard`, `fog`, `haze`, `extreme`

#### 날씨 예보 (집계)

```
GET /api/weather/forecast?cityId={cityId}&days={days}
```

**Parameters:**
- `cityId` (required): 도시 ID
- `days` (optional): 예보 일수 (1–3, 기본값 3)

**Response:**
```json
{
  "days": [
    { "date": "2025-04-17", "weather": { ... } },
    { "date": "2025-04-18", "weather": { ... } },
    { "date": "2025-04-19", "weather": { ... } }
  ],
  "providers_used": ["openweather", "weatherapi", "openmeteo"],
  "providers_failed": [],
  "incomplete_data": false,
  "cached_at": "2025-04-17T10:00:00.000Z"
}
```

---

### 원시 패스스루 (내부/디버그용)

모든 요청에 `X-API-Key: {PROXY_API_KEY}` 헤더 필요.

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/openweather/current?city={city}` | OpenWeatherMap 현재 날씨 |
| `GET /api/openweather/forecast?city={city}` | OpenWeatherMap 예보 |
| `GET /api/weatherapi/current?city={city}` | WeatherAPI 현재 날씨 |
| `GET /api/weatherapi/forecast?city={city}` | WeatherAPI 예보 |
| `GET /api/openmeteo?lat={lat}&lon={lon}` | Open-Meteo |

```bash
curl -H "X-API-Key: your_proxy_secret_key_here" \
  "http://localhost:8787/api/openweather/current?city=Seoul"
```

---

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. 로컬 환경 변수 설정

`.dev.vars` 파일 생성:

```bash
OPENWEATHER_API_KEY=your_openweather_key_here
WEATHERAPI_API_KEY=your_weatherapi_key_here
PROXY_API_KEY=your_proxy_secret_key_here
```

> `.dev.vars`는 git에 커밋하지 마세요. (이미 `.gitignore`에 포함됨)

### 3. 로컬 개발 서버 실행

```bash
npm run dev
# http://localhost:8787
```

---

## 배포

### 1. Cloudflare 로그인

```bash
wrangler login
```

### 2. Secrets 설정

```bash
wrangler secret put OPENWEATHER_API_KEY
wrangler secret put WEATHERAPI_API_KEY
wrangler secret put PROXY_API_KEY
```

### 3. ALLOWED_ORIGINS 설정

`wrangler.toml`의 `ALLOWED_ORIGINS`에 프론트엔드 도메인을 콤마로 구분하여 입력:

```toml
[vars]
ALLOWED_ORIGINS = "https://yourdomain.com,https://preview.yourdomain.pages.dev"
```

### 4. 배포

```bash
npm run deploy
```

---

## 보안 모델

### 인증 계층

| 엔드포인트 | 보호 방식 |
|---|---|
| `/api/weather/*`, `/api/healthz` | CORS allowlist (`ALLOWED_ORIGINS`)로 브라우저 요청만 허용 |
| `/api/openweather/*`, `/api/weatherapi/*`, `/api/openmeteo` | `X-API-Key` 헤더 검증 |

### API 키 관리

**로컬 개발:** `.dev.vars` 파일에 저장 (Git 제외)

**프로덕션:** Cloudflare Secrets로 저장 (`wrangler secret put`)

### CORS

`wrangler.toml`의 `ALLOWED_ORIGINS`로 제어:
- 단일 도메인: `"https://yourdomain.com"`
- 복수 도메인: `"https://yourdomain.com,https://preview.pages.dev"`
- 개발용 전체 허용: `"*"`

---

## 프로젝트 구조

```
weather-proxy/
├── src/
│   ├── index.ts              # 메인 Worker (라우팅, 인증 분기)
│   ├── handlers/
│   │   ├── weather.ts        # 집계 API 핸들러 (현재 날씨 + 예보)
│   │   ├── health.ts         # Health check 핸들러
│   │   ├── openweather.ts    # OpenWeatherMap 패스스루
│   │   ├── weatherapi.ts     # WeatherAPI 패스스루
│   │   └── openmeteo.ts      # Open-Meteo 패스스루
│   ├── utils/
│   │   ├── cors.ts           # CORS 헤더 (origin allowlist)
│   │   ├── errors.ts         # 에러 응답 포맷
│   │   └── response.ts       # 응답 포맷
│   └── types/
│       └── env.ts            # 환경 변수 타입
├── wrangler.toml             # Cloudflare 설정
├── package.json
└── tsconfig.json
```

---

## 모니터링

```bash
# 실시간 로그
npm run tail
```

Cloudflare Dashboard → Workers & Pages → weather-proxy → Observability 탭에서 요청 수, 에러율, Duration, Traces 확인.

---

## 문제 해결

### 401 Unauthorized

원시 패스스루 엔드포인트에 `X-API-Key` 헤더가 없거나 값이 틀림.

```bash
curl -H "X-API-Key: your_proxy_secret_key_here" "http://localhost:8787/api/openweather/current?city=Seoul"
```

### CORS 에러

요청 origin이 `ALLOWED_ORIGINS`에 없음. `wrangler.toml`에 프론트엔드 도메인 추가 후 재배포.

### 503 provider_unavailable

3개 업스트림 제공자 모두 응답 실패. API 키 확인 및 `wrangler tail`로 상세 로그 확인.

### "Missing required field: OPENWEATHER_API_KEY"

```bash
wrangler secret put OPENWEATHER_API_KEY
```

---

## 사용량

### Cloudflare Workers Free Tier

- 일일 **100,000 requests** (매일 00:00 UTC 리셋)
- 집계 엔드포인트는 5분 캐시 적용으로 실제 업스트림 호출 횟수 절감

---

## 라이선스

MIT
