# AGENTS.md — weather-proxy

AI 에이전트가 이 프로젝트에서 작업할 때 필요한 환경, 테스트, 배포, 규칙, 주의사항.

---

## Runtime caveat

이 프로젝트는 **Cloudflare Workers (V8 isolate)** 위에서 실행된다. Node.js가 아니다.

- `fs`, `path`, `process`, `Buffer` 등 Node.js 내장 API 없음
- `@cloudflare/workers-types`가 `Request`, `Response`, `fetch`, `caches` 등을 CF 버전으로 오버라이드 — `tsconfig.json`에서 전역으로 주입됨
- 테스트는 Node.js 환경(`vitest`)에서 실행. `tsconfig.test.json`이 CF 타입을 제거해 충돌을 방지
- `"moduleResolution": "bundler"` — wrangler가 번들링 담당. `node_modules` 직접 해석 안 함
- TypeScript `"noEmit": true` — 컴파일 아티팩트 없음

---

## Dev environment tips

```bash
npm run dev       # wrangler dev → http://localhost:8787
npm run tail      # wrangler tail — 프로덕션 실시간 로그 스트리밍
npx tsc --noEmit  # 타입 체크 (에밋 없음)
```

로컬 개발에 `.dev.vars` 파일이 필수다. 없으면 provider 호출이 전부 실패한다.

```
# .dev.vars (예시, 실제 키 입력 필요)
OPENWEATHER_API_KEY=...
WEATHERAPI_API_KEY=...
PROXY_API_KEY=...
```

`.dev.vars`는 `.gitignore`에 포함돼 있다. **절대 커밋하지 말 것.**

---

## Testing instructions

```bash
npm test                          # 전체 테스트 1회 실행
npm run test:watch                # 감시 모드
npx vitest run -t "<test name>"   # 특정 테스트만 실행
npx tsc --noEmit                  # 타입 에러 확인
```

- 테스트 파일 위치: `src/__tests__/**/*.test.ts`
- 테스트할 함수에 `export`가 없으면 임포트 불가. 신규 테스트 작성 전 확인할 것
- **기존 타입 에러 4건** (`src/handlers/openweather.ts`, `src/handlers/weatherapi.ts`) 이 있다. `npx tsc --noEmit` 결과에서 이 4건 외 신규 에러가 없으면 정상. 요청 없이 수정 금지
- 코드를 변경하면 관련 테스트도 추가하거나 업데이트할 것

---

## Deployment

```bash
npm run deploy                        # wrangler deploy → 프로덕션 배포
wrangler secret put OPENWEATHER_API_KEY  # 시크릿 설정
wrangler secret put WEATHERAPI_API_KEY
wrangler secret put PROXY_API_KEY
```

- `ALLOWED_ORIGINS`는 `wrangler.toml` `[vars]` 섹션에서 관리
  - 로컬: `"*"` (전체 허용)
  - 프로덕션: 실제 도메인으로 제한
- **주의:** Cloudflare 대시보드에서 `ALLOWED_ORIGINS`(또는 다른 변수)를 변경하면 새 Worker 버전이 자동 배포된다. 미적용 코드가 있다면 그 시점에 함께 배포된다

---

## PR & commit instructions

**Conventional Commits** 형식을 따른다.

```
<type>(<scope>): <subject>

<body>

closes #<issue>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

타입: `feat` `fix` `docs` `chore` `test` `refactor`

브랜치 네이밍: `feat/<name>` `fix/<name>` `test/<name>` `docs/<name>`

커밋 전 체크리스트:
- [ ] `npm test` 전체 통과
- [ ] `npx tsc --noEmit` 신규 에러 없음

PR 제목은 커밋 메시지 첫 줄과 동일하게 유지한다.

---

## Project-specific gotchas

### KST 오프셋 상수

```typescript
// src/handlers/weather.ts
export const KST_OFFSET_SEC = 9 * 60 * 60;
```

- 이 상수 하나만 사용한다. `9 * 3600`이나 `9 * 60 * 60`을 코드에 직접 작성 금지
- forecast builder와 OW normalizer 두 곳이 반드시 같은 상수를 참조해야 날짜 경계가 일치한다
- 어느 한 곳만 바꾸면 날짜 라벨과 슬롯 필터링이 어긋나며 런타임 에러 없이 조용히 틀린 결과를 반환한다

### Forecast normalizer 반환 타입

```typescript
normalizeOpenWeatherForecast(raw, targetDate): NormalizedWeather | null
normalizeWeatherAPIForecast(raw, targetDate):  NormalizedWeather | null
normalizeOpenMeteoForecast(raw, targetDate):   NormalizedWeather | null
```

- `null` = 해당 날짜에 매칭되는 데이터 없음. 에러가 아니라 정상 케이스
- `null`이 반환되면 `aggregateWeather`가 weight 재분배로 자동 처리
- `null` 대신 기본값 객체(temp=20 등)를 반환하면 다른 날짜 데이터가 집계에 섞인다 (cross-date 오염) — **절대 금지**

### 인증 게이트 (src/index.ts)

```typescript
const AGGREGATED_PATHS: ReadonlySet<string> = new Set([
  '/api/healthz',
  '/api/weather/cities',
  '/api/weather/current',
  '/api/weather/forecast',
]);
```

- 이 목록에 있는 경로는 `X-API-Key` 헤더 불필요
- 그 외 모든 경로는 `X-API-Key`가 없으면 자동 401
- 새 디버그/내부 엔드포인트는 이 목록에 추가하지 않는다 (auth-gated로 유지)

### 캐시

- in-memory `Map` 기반, isolate 단위 — Worker 재시작(cold start) 시 초기화됨
- 캐시 키: `"cityId:days"` (forecast), `"cityId"` (current)
- TTL: `CACHE_TTL_MS = 5 * 60 * 1000` (5분, forecast 상향 예정)
- 능동 eviction 없음. TTL 만료 여부는 읽기 시점에만 확인

### docs/ 참고

코드 변경 전 관련 문서를 확인할 것.

| 파일 | 내용 |
|---|---|
| `forecast-edge-cases.md` | 예보 버그 원인 분석 및 엣지케이스 |
| `cache-risk-and-discussion.md` | 캐시 TTL, EC-2/CC-5 리스크, 설계 논의 |
| `flow-current-weather.md` | `/api/weather/current` 요청 플로우 |
| `flow-forecast-weather.md` | `/api/weather/forecast` 요청 플로우 |
