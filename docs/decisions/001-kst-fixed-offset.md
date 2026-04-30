# ADR 001 — KST 오프셋: Intl API 대신 고정 상수 사용

**상태:** 채택  
**날짜:** 2026-04-29

---

## 상황

OpenWeather forecast API는 `dt` 필드를 UTC epoch으로 반환한다.  
WeatherAPI와 Open-Meteo는 도시 로컬 시간(KST) 기준 날짜 문자열을 반환한다.  
세 provider의 날짜 경계를 통일하려면 UTC epoch을 KST 날짜 문자열로 변환해야 한다.

---

## 선택지

### 방안 1: 고정 오프셋 상수 (채택)
```typescript
export const KST_OFFSET_SEC = 9 * 60 * 60;
new Date((dt + KST_OFFSET_SEC) * 1000).toISOString().split("T")[0]
```

### 방안 2: OpenWeather 응답의 `city.timezone` 필드 사용
```typescript
const offset = r.city?.timezone ?? 9 * 60 * 60;
new Date((dt + offset) * 1000).toISOString().split("T")[0]
```

### 방안 3: `Intl.DateTimeFormat` API
```typescript
new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul" }).format(...)
```

---

## 결정 이유

**방안 1 채택:**

1. **서비스 범위가 한국 전용으로 고정**  
   지원 도시 8개(서울·부산·인천·대구·광주·대전·울산·제주) 모두 `Asia/Seoul` (UTC+9, DST 없음).  
   오프셋 값이 변하는 경우가 없다.

2. **KST는 DST가 없는 고정 오프셋**  
   `+9h`는 항상 맞다. Intl API 호출로 IANA 시간대 데이터베이스를 조회할 필요가 없다.

3. **방안 2는 OW 메타데이터 신뢰 의존**  
   2023년 OW API v2.5에서 `city.timezone = 0` 반환 버그가 커뮤니티에 보고됐다.  
   OW가 틀린 오프셋을 내려주면 날짜 분류가 조용히 틀린다. 방안 1은 이 위험이 없다.

4. **방안 3은 불필요한 복잡도**  
   IANA timezone 데이터베이스, `Intl` API의 V8 구현 차이 등 변수가 늘어난다.  
   `+9 * 60 * 60` 한 줄로 동일한 결과를 얻을 수 있다.

---

## 결과 및 트레이드오프

**장점:**
- 단순하고 예측 가능. V8 이외 런타임에서도 동일하게 동작
- OW 메타데이터 버그에 무관

**단점:**
- 한국 이외 도시를 지원할 경우 상수 하나로 처리 불가 → 코드 변경 필요  
  (현재는 한국 전용으로 확정돼 있으므로 허용된 제약)
- 한국이 미래에 DST를 재도입하면 상수 값 변경 필요  
  (1988년 폐지 후 현재까지 없음. 법적 변경 시 한 줄 수정으로 대응 가능)

**상수 위치:** `src/handlers/weather.ts:527`
