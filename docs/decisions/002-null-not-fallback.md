# ADR 002 — Forecast normalizer: 기본값 객체 대신 null 반환

**상태:** 채택  
**날짜:** 2026-04-29

---

## 상황

각 forecast normalizer는 `targetDate`에 해당하는 데이터를 provider 응답에서 찾는다.  
OpenWeather는 3시간 슬롯을 KST 날짜로 필터링하고, WeatherAPI/Open-Meteo는 날짜 문자열로 검색한다.  
해당 날짜 데이터가 없는 경우(슬롯 없음, 날짜 불일치) 처리 방식을 결정해야 했다.

---

## 선택지

### 방안 1: 기본값 객체 반환 (이전 구현)
```typescript
if (dayItems.length === 0) {
  const item = r.list[0] ?? r.list[0];  // 현재 시각 슬롯으로 채움
  return { temp: item?.main.temp ?? 20, ... };
}
```

### 방안 2: null 반환 (채택)
```typescript
if (dayItems.length === 0) return null;
```

---

## 결정 이유

**방안 2 채택:**

**방안 1의 문제 — cross-date 오염:**

`r.list[0]`은 요청 시각 직후의 슬롯이다. `targetDate`가 이틀 뒤 날짜인데 현재 시각 슬롯으로 채우면, "모레 예보"가 "지금 기상"으로 오염된다.

```
요청 시각: Apr 26 23:00 KST
targetDate: "2026-04-28"
r.list[0].dt → Apr 26 23:00 KST 슬롯

결과: Apr 28 예보에 Apr 26 23:00 데이터 삽입 → 완전히 다른 날짜 데이터
```

이 오류는 런타임 예외가 없어 탐지하기 매우 어렵다.

**방안 2의 동작:**

`null`이 반환되면 상위 레이어(`aggregateWeather`)가 해당 provider를 실패로 처리하고 weight를 나머지 provider에 재분배한다.

```
OW null + WA 데이터 있음 + OM 데이터 있음
→ OW weight(0.40) 제거 후 WA/OM으로 비례 재분배
→ 정확한 날짜의 데이터만으로 집계
```

---

## 결과 및 트레이드오프

**장점:**
- 날짜 오염 완전 제거
- provider 실패(fetch 오류)와 데이터 없음(날짜 불일치)을 동일하게 처리 — 집계 레이어 단순화
- 문제 발생 시 `provider_data[].data === null`로 즉시 식별 가능 (`/api/weather/forecast/debug` 활용)

**단점:**
- OW가 5일 한계 근접 시 day[2]에서 null이 증가 → 해당 날짜의 OW 기여 없이 집계됨  
  (cross-date 오염보다는 낫다. weight 재분배가 올바르게 처리)
- 3개 provider 모두 null인 day는 하드코딩 기본값 객체가 반환됨 (`aggregateWeather` catch block)

**적용 위치:**
- `normalizeOpenWeatherForecast` — `src/handlers/weather.ts:264`
- `normalizeWeatherAPIForecast` — `src/handlers/weather.ts:337`
- `normalizeOpenMeteoForecast` — `src/handlers/weather.ts:412`
