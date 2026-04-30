# ADR 003 — 캐시: Cloudflare KV 대신 in-memory Map 사용

**상태:** 채택 (재검토 조건 있음)  
**날짜:** 2026-04-29

---

## 상황

날씨 데이터를 반복 요청마다 provider에 재호출하지 않도록 캐싱이 필요하다.  
Cloudflare Workers 환경에서 사용 가능한 캐시 수단을 선택해야 한다.

---

## 선택지

### 방안 1: in-memory Map (채택)
```typescript
const forecastCache = new Map<string, CacheEntry<ForecastResponseShape>>();
```
- V8 모듈 스코프에 선언. isolate가 살아있는 동안 유지
- 읽기/쓰기 ~0ms

### 방안 2: Cloudflare KV
- Cloudflare의 분산 Key-Value 스토리지
- 읽기 1~50ms (리전 의존), 쓰기 ~10ms
- 전역 일관성 최대 60초 지연

### 방안 3: Cloudflare Cache API
- HTTP 응답 캐시. Workers에서 접근 가능
- URL 기반 키잉

---

## 결정 이유

**방안 1 채택:**

1. **읽기 지연 0ms**  
   캐시 조회에 네트워크 홉이 없다. 방안 2는 매 요청마다 50ms가 추가된다.

2. **현재 규모에서 충분**  
   8개 도시 × 3가지 days 조합 = 최대 24개 forecast 엔트리 + 8개 current 엔트리.  
   총 32개 키를 in-memory로 관리하는 데 메모리 부담이 없다.

3. **복잡도 최소화**  
   KV 바인딩 설정, `wrangler.toml` 변경, 비동기 읽기/쓰기 처리, KV 오류 처리 코드가 불필요하다.

4. **KV의 전역 일관성 지연 문제**  
   KV는 쓰기 후 전역 전파에 최대 60초가 걸린다.  
   서울 PoP에서 기록한 캐시가 도쿄 PoP에 즉시 반영되지 않아 복수 isolate 환경에서 동일 요청이 다른 응답을 받을 수 있다.

---

## 결과 및 트레이드오프

**장점:**
- 조회 지연 없음
- 추가 Cloudflare 서비스 비용 없음
- 코드 단순

**단점:**
- **isolate 단위 캐시** — Cloudflare는 요청별로 다른 isolate를 사용할 수 있다. 두 isolate가 동시에 같은 도시 요청을 받으면 각자 provider를 호출한다. cold start 시 항상 캐시 MISS
- **persistent하지 않음** — Worker 재시작/업데이트 배포 시 캐시 전체 초기화
- **능동 eviction 없음** — TTL 만료 여부는 읽기 시점에만 체크. 만료된 엔트리가 메모리에 잔류

**현재 TTL:**
- `CACHE_TTL_MS = 5 * 60 * 1000` (5분, current/forecast 공용)
- forecast는 provider 모델 갱신 주기(~6시간) 대비 과도하게 짧음 → **30분으로 상향 예정** (미결 항목)

**재검토 조건:**
아래 중 하나 이상 해당되면 KV 또는 Durable Objects 전환 검토:
- OW 무료 플랜(1,000 calls/day) 한도에 실제로 근접
- isolate 간 캐시 공유가 필요한 수준의 트래픽 발생
- 캐시를 배포 사이에도 유지해야 하는 요구사항 발생
