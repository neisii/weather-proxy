# Weather Proxy - Cloudflare Workers

Weather API 프록시 서버 - API 키를 안전하게 보호하면서 여러 날씨 API를 통합 제공

## 🎯 목적

- **보안**: API 키를 클라이언트에 노출하지 않음
- **인증**: 프록시 자체도 API 키로 보호
- **통합**: 3개의 날씨 API를 단일 인터페이스로 제공
- **성능**: Cloudflare 글로벌 엣지 네트워크 활용
- **무료**: 일일 100,000 requests 무료 제공

## 📡 지원 API

1. **OpenWeatherMap** - Current + Forecast
2. **WeatherAPI.com** - Current + Forecast  
3. **Open-Meteo** - Current + Forecast (API 키 불필요)

## 🚀 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 설정

로컬 개발용 `.dev.vars` 파일 생성:

```bash
# .dev.vars
OPENWEATHER_API_KEY=your_openweather_key_here
WEATHERAPI_API_KEY=your_weatherapi_key_here
PROXY_API_KEY=your_proxy_secret_key_here
```

⚠️ **주의**: `.dev.vars` 파일은 git에 커밋하지 마세요! (이미 .gitignore에 포함됨)

### 3. 로컬 개발 서버 실행

```bash
npm run dev
```

서버가 `http://localhost:8787`에서 실행됩니다.

### 4. 테스트

모든 요청에 `X-API-Key` 헤더가 필요합니다:

```bash
# OpenWeatherMap
curl -H "X-API-Key: your_proxy_secret_key_here" \
  "http://localhost:8787/api/openweather/current?city=Seoul"

# WeatherAPI
curl -H "X-API-Key: your_proxy_secret_key_here" \
  "http://localhost:8787/api/weatherapi/current?city=Seoul"

# Open-Meteo
curl -H "X-API-Key: your_proxy_secret_key_here" \
  "http://localhost:8787/api/openmeteo?lat=37.5683&lon=126.9778"
```

## 📚 API 문서

### 공통 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `X-API-Key` | ✅ | 프록시 인증 키 (`PROXY_API_KEY` 값) |

인증 실패 시 `401 Unauthorized` 반환:
```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid or missing API key" } }
```

### OpenWeatherMap

#### Current Weather
```
GET /api/openweather/current?city={city}
```

**Parameters:**
- `city` (required): 도시 이름 (예: Seoul, Busan)

**Response:**
```json
{
  "coord": { "lon": 126.9778, "lat": 37.5683 },
  "weather": [...],
  "main": {
    "temp": 15.2,
    "feels_like": 14.5,
    "humidity": 65
  },
  "wind": { "speed": 3.5 },
  "name": "Seoul"
}
```

#### Forecast
```
GET /api/openweather/forecast?city={city}
```

### WeatherAPI

#### Current Weather
```
GET /api/weatherapi/current?city={city}
```

**Response:**
```json
{
  "location": {
    "name": "Seoul",
    "lat": 37.57,
    "lon": 126.98
  },
  "current": {
    "temp_c": 15.2,
    "condition": { "text": "Partly cloudy" },
    "wind_kph": 12.6,
    "humidity": 65
  }
}
```

#### Forecast
```
GET /api/weatherapi/forecast?city={city}
```

### Open-Meteo

```
GET /api/openmeteo?lat={lat}&lon={lon}
```

**Parameters:**
- `lat` (required): 위도 (-90 ~ 90)
- `lon` (required): 경도 (-180 ~ 180)

**Response:**
```json
{
  "current_weather": {
    "temperature": 15.2,
    "windspeed": 12.5,
    "weathercode": 0
  },
  "hourly": {
    "time": [...],
    "temperature_2m": [...]
  }
}
```

## 🔒 보안

### 인증 (Authentication)

모든 엔드포인트는 `X-API-Key` 헤더를 요구합니다.

- **로컬**: `.dev.vars`의 `PROXY_API_KEY` 값 사용
- **프로덕션**: Cloudflare Secret으로 설정 (`wrangler secret put PROXY_API_KEY`)
- 헤더 미포함 또는 값 불일치 시 → `401 Unauthorized`

프론트엔드에서 사용 예:
```javascript
fetch('https://weather-proxy.{subdomain}.workers.dev/api/openweather/current?city=Seoul', {
  headers: { 'X-API-Key': import.meta.env.VITE_PROXY_API_KEY }
})
```

### API 키 관리

**로컬 개발:**
- `.dev.vars` 파일에 저장
- Git에 커밋하지 않음

**프로덕션 배포:**
```bash
# Cloudflare Secrets로 안전하게 저장
wrangler secret put OPENWEATHER_API_KEY
wrangler secret put WEATHERAPI_API_KEY
wrangler secret put PROXY_API_KEY
```

### CORS

`wrangler.toml`의 `ALLOWED_ORIGINS` 변수로 제어합니다:

```toml
[vars]
ALLOWED_ORIGINS = "*"  # 개발용 (모든 origin 허용)
# ALLOWED_ORIGINS = "https://yourdomain.com"  # 프로덕션용
```

프로덕션에서는 실제 프론트엔드 도메인으로 변경하세요.

## 🚢 배포

### 1. Cloudflare 계정 로그인

```bash
wrangler login
```

### 2. Secrets 설정

```bash
wrangler secret put OPENWEATHER_API_KEY
# 프롬프트에 실제 API 키 입력

wrangler secret put WEATHERAPI_API_KEY
# 프롬프트에 실제 API 키 입력

wrangler secret put PROXY_API_KEY
# 프롬프트에 프록시 인증용 시크릿 키 입력
```

### 3. ALLOWED_ORIGINS 설정 (선택)

`wrangler.toml`에서 프론트엔드 도메인으로 변경:
```toml
ALLOWED_ORIGINS = "https://yourdomain.com"
```

### 4. 배포

```bash
npm run deploy
```

배포 후 Worker URL 확인:
```
https://weather-proxy.{your-subdomain}.workers.dev
```

## 📊 모니터링

### 실시간 로그

```bash
npm run tail
```

### Cloudflare Dashboard

1. [Cloudflare Dashboard](https://dash.cloudflare.com) 접속
2. Workers & Pages → weather-proxy 선택
3. Analytics 탭에서 메트릭 확인:
   - Requests
   - Success rate
   - Error rate
   - Duration

## 🔧 개발

### 프로젝트 구조

```
weather-proxy/
├── src/
│   ├── index.ts              # 메인 Worker (라우팅, 인증)
│   ├── handlers/
│   │   ├── openweather.ts    # OpenWeatherMap 핸들러
│   │   ├── weatherapi.ts     # WeatherAPI 핸들러
│   │   └── openmeteo.ts      # Open-Meteo 핸들러
│   ├── utils/
│   │   ├── cors.ts           # CORS 헤더 (origin allowlist)
│   │   ├── errors.ts         # 에러 핸들링
│   │   └── response.ts       # 응답 포맷
│   └── types/
│       └── env.ts            # 환경 변수 타입
├── wrangler.toml             # Cloudflare 설정
├── package.json
└── tsconfig.json
```

### 새 엔드포인트 추가

1. `src/handlers/`에 새 핸들러 생성
2. `src/index.ts`에 라우팅 추가
3. 로컬 테스트
4. 배포

## 📈 사용량 제한

### Cloudflare Workers Free Tier

- **일일 100,000 requests** (매일 00:00 UTC 리셋)
- 개인 사용: 하루 100번 검색 = 300 requests
- **여유도: 333배**

### 예상 사용량

**개인 사용:**
- 검색 10회/일 × 3 providers = 30 requests/일
- 월간: 900 requests

**소규모 공개 (100명):**
- 검색 5회/인 × 100명 × 3 providers = 1,500 requests/일
- 월간: 45,000 requests

**결론**: 무료 제한으로 충분히 운영 가능

## 🐛 문제 해결

### 401 Unauthorized

**원인**: `X-API-Key` 헤더가 없거나 값이 틀림

**해결:**
```bash
# 요청 시 헤더 포함 확인
curl -H "X-API-Key: your_proxy_secret_key_here" "http://localhost:8787/..."

# 로컬: .dev.vars에 PROXY_API_KEY 설정 확인
# 프로덕션: wrangler secret put PROXY_API_KEY
```

### "Missing required field: OPENWEATHER_API_KEY"

**원인**: API 키가 설정되지 않음

**해결:**
```bash
# 로컬: .dev.vars 파일에 키 추가
# 프로덕션: Secrets 설정
wrangler secret put OPENWEATHER_API_KEY
```

### CORS 에러

**원인**: 요청 origin이 `ALLOWED_ORIGINS`에 없음

**해결:** `wrangler.toml`의 `ALLOWED_ORIGINS`에 프론트엔드 도메인 추가

### 502 Bad Gateway

**원인**: 외부 API 호출 실패

**해결:**
- API 키 확인
- 외부 API 상태 확인
- 로그 확인 (`wrangler tail`)

## 📝 라이선스

MIT

## 🔗 관련 문서

- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
