# Weather Proxy - Cloudflare Workers

Weather API 프록시 서버 - API 키를 안전하게 보호하면서 여러 날씨 API를 통합 제공

## 🎯 목적

- **보안**: API 키를 클라이언트에 노출하지 않음
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
```

⚠️ **주의**: `.dev.vars` 파일은 git에 커밋하지 마세요! (이미 .gitignore에 포함됨)

### 3. 로컬 개발 서버 실행

```bash
npm run dev
```

서버가 `http://localhost:8787`에서 실행됩니다.

### 4. 테스트

```bash
# OpenWeatherMap
curl "http://localhost:8787/api/openweather/current?city=Seoul"

# WeatherAPI
curl "http://localhost:8787/api/weatherapi/current?city=Seoul"

# Open-Meteo
curl "http://localhost:8787/api/openmeteo?lat=37.5683&lon=126.9778"
```

## 📚 API 문서

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
- `lat` (required): 위도
- `lon` (required): 경도

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

### API 키 관리

**로컬 개발:**
- `.dev.vars` 파일에 저장
- Git에 커밋하지 않음

**프로덕션 배포:**
```bash
# Cloudflare Secrets로 안전하게 저장
wrangler secret put OPENWEATHER_API_KEY
wrangler secret put WEATHERAPI_API_KEY
```

### CORS

- 개발: 모든 origin 허용 (`*`)
- 프로덕션: 특정 도메인만 허용하도록 `src/utils/cors.ts` 수정 권장

```typescript
// 프로덕션용 CORS 설정 예시
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://neisii.github.io',
  // ...
};
```

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
```

### 3. 배포

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
│   ├── index.ts              # 메인 Worker (라우팅)
│   ├── handlers/
│   │   ├── openweather.ts    # OpenWeatherMap 핸들러
│   │   ├── weatherapi.ts     # WeatherAPI 핸들러
│   │   └── openmeteo.ts      # Open-Meteo 핸들러
│   ├── utils/
│   │   ├── cors.ts           # CORS 헤더
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

### "Missing required field: OPENWEATHER_API_KEY"

**원인**: API 키가 설정되지 않음

**해결:**
```bash
# 로컬: .dev.vars 파일 생성
echo "OPENWEATHER_API_KEY=your_key" > .dev.vars

# 프로덕션: Secrets 설정
wrangler secret put OPENWEATHER_API_KEY
```

### CORS 에러

**원인**: CORS 헤더 설정 문제

**해결:** `src/utils/cors.ts`에서 허용할 origin 확인

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
- [프로젝트 설계 문서](../02-weather-app/docs/CLOUDFLARE_WORKERS_DESIGN.md)
- [백엔드 프록시 결정 문서](../02-weather-app/docs/BACKEND_PROXY_DECISION.md)
