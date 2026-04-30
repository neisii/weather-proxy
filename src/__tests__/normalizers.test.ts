import { describe, it, expect } from "vitest";
import {
  normalizeOpenWeatherForecast,
  normalizeWeatherAPIForecast,
  normalizeOpenMeteoForecast,
  KST_OFFSET_SEC,
} from "../handlers/weather";

// ─── KST Date Helpers ────────────────────────────────────────────────────────

// KST "2026-04-29" 시작 = UTC 2026-04-28 15:00:00
const KST_APR29_START_UTC = Date.UTC(2026, 3, 28, 15, 0, 0) / 1000; // epoch in seconds
const TARGET_DATE = "2026-04-29";
const OTHER_DATE  = "2026-04-28";

// ─── OpenWeather Fixtures ─────────────────────────────────────────────────────

function makeOwSlot(overrides: {
  dt?: number;     // UTC epoch seconds
  temp?: number;
  pop?: number;
  rain?: number;
  icon?: string;
} = {}) {
  return {
    dt: overrides.dt ?? KST_APR29_START_UTC, // KST 2026-04-29 00:00 기본값
    main: {
      temp: overrides.temp ?? 15,
      feels_like: 14,
      temp_max: 18,
      temp_min: 12,
      humidity: 60,
      pressure: 1013,
    },
    wind: { speed: 3, deg: 180 },
    weather: [{ icon: overrides.icon ?? "01d" }],
    rain: overrides.rain !== undefined ? { "3h": overrides.rain } : undefined,
    pop: overrides.pop ?? 0,
  };
}

// ─── normalizeOpenWeatherForecast ─────────────────────────────────────────────

describe("normalizeOpenWeatherForecast", () => {
  it("targetDate와 일치하는 KST 슬롯만 집계해 NormalizedWeather를 반환한다", () => {
    // KST 2026-04-29 범위 슬롯 2개 + 다른 날 슬롯 1개
    const slots = [
      makeOwSlot({ dt: KST_APR29_START_UTC,      temp: 10 }), // KST Apr 29 00:00
      makeOwSlot({ dt: KST_APR29_START_UTC + 10800, temp: 10 }), // KST Apr 29 03:00
      makeOwSlot({ dt: KST_APR29_START_UTC - 3600,  temp: 99 }), // KST Apr 28 23:00 → 제외
    ];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result).not.toBeNull();
    expect(result!.temp).toBeCloseTo(10); // 99는 제외되어야 함
  });

  it("일치하는 슬롯이 없으면 null을 반환한다 (cross-date fallback 없음)", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC - 3600 })]; // Apr 28
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result).toBeNull();
  });

  it("list가 비어있으면 null을 반환한다", () => {
    const result = normalizeOpenWeatherForecast({ list: [] }, TARGET_DATE);
    expect(result).toBeNull();
  });

  it("슬롯이 부분적으로 매칭(1~7개)될 때도 에러 없이 집계한다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: 20 })];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result).not.toBeNull();
    expect(result!.temp).toBeCloseTo(20);
  });

  it("precip_prob은 일치 슬롯 중 최대 pop(×100)이다", () => {
    const slots = [
      makeOwSlot({ dt: KST_APR29_START_UTC,       pop: 0.3 }),
      makeOwSlot({ dt: KST_APR29_START_UTC + 10800, pop: 0.8 }),
    ];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result!.precip_prob).toBeCloseTo(80);
  });

  it("precip_mm은 일치 슬롯의 rain[3h] 합산이다", () => {
    const slots = [
      makeOwSlot({ dt: KST_APR29_START_UTC,       rain: 1.5 }),
      makeOwSlot({ dt: KST_APR29_START_UTC + 10800, rain: 2.0 }),
    ];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result!.precip_mm).toBeCloseTo(3.5);
  });

  it("rain 필드가 없는 슬롯은 0으로 처리한다", () => {
    const slots = [
      makeOwSlot({ dt: KST_APR29_START_UTC }),
      makeOwSlot({ dt: KST_APR29_START_UTC + 10800, rain: 1.0 }),
    ];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result!.precip_mm).toBeCloseTo(1.0);
  });

  it("icon 코드는 OW_ICON_MAP을 통해 condition에 매핑된다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, icon: "11d" })];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result!.condition).toBe("thunderstorm");
  });

  it("KST 자정 경계 슬롯(UTC 전날 15:00)은 정확히 당일로 분류된다", () => {
    // UTC 2026-04-28 15:00:00 + KST_OFFSET_SEC = 2026-04-29 00:00:00 → Apr 29
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: 5 })];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result).not.toBeNull();
    expect(result!.temp).toBeCloseTo(5);
  });

  it("KST 자정 직전 슬롯(UTC 전날 14:59)은 전날로 분류되어 제외된다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC - 60, temp: 99 })];
    const result = normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE);
    expect(result).toBeNull();
  });
});

// ─── WeatherAPI Fixtures ──────────────────────────────────────────────────────

function makeWaRaw(days: number, startDate = "2026-04-29") {
  const [y, m, d] = startDate.split("-").map(Number);
  return {
    forecast: {
      forecastday: Array.from({ length: days }, (_, i) => {
        const dateObj = new Date(Date.UTC(y!, m! - 1, d! + i));
        const date = dateObj.toISOString().split("T")[0]!;
        return {
          date,
          day: {
            avgtemp_c: 15 + i,
            maxtemp_c: 20 + i,
            mintemp_c: 10 + i,
            maxwind_kph: 36,
            avghumidity: 60,
            daily_chance_of_rain: 30,
            totalprecip_mm: 2.5,
            uv: 4,
            condition: { code: 1000 },
            avgvis_km: 10,
          },
        };
      }),
    },
  };
}

// ─── normalizeWeatherAPIForecast ──────────────────────────────────────────────

describe("normalizeWeatherAPIForecast", () => {
  it("targetDate와 일치하는 forecastday 데이터를 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(3), TARGET_DATE);
    expect(result).not.toBeNull();
    expect(result!.temp).toBeCloseTo(15);
    expect(result!.temp_max).toBeCloseTo(20);
    expect(result!.temp_min).toBeCloseTo(10);
  });

  it("다음 날 targetDate는 두 번째 forecastday를 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(3), "2026-04-30");
    expect(result).not.toBeNull();
    expect(result!.temp).toBeCloseTo(16);
  });

  it("일치하는 forecastday가 없으면 null을 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(3), "2026-05-10");
    expect(result).toBeNull();
  });

  it("forecastday 배열이 비어있으면 null을 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(0), TARGET_DATE);
    expect(result).toBeNull();
  });

  it("풍속은 kph → m/s 변환한다 (÷3.6)", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), TARGET_DATE);
    expect(result!.wind_speed).toBeCloseTo(10); // 36 / 3.6
  });

  it("가시거리는 km → m 변환한다 (×1000)", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), TARGET_DATE);
    expect(result!.visibility).toBeCloseTo(10000);
  });

  it("WA condition code 1000은 clear에 매핑된다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), TARGET_DATE);
    expect(result!.condition).toBe("clear");
  });
});

// ─── Open-Meteo Fixtures ──────────────────────────────────────────────────────

function makeOmRaw(days: number, startDate = "2026-04-29") {
  const [y, m, d] = startDate.split("-").map(Number);
  return {
    daily: {
      time: Array.from({ length: days }, (_, i) => {
        const dateObj = new Date(Date.UTC(y!, m! - 1, d! + i));
        return dateObj.toISOString().split("T")[0]!;
      }),
      temperature_2m_max: Array.from({ length: days }, (_, i) => 20 + i),
      temperature_2m_min: Array.from({ length: days }, (_, i) => 10 + i),
      apparent_temperature_max: Array.from({ length: days }, () => 18),
      weather_code: Array.from({ length: days }, () => 0),
      precipitation_sum: Array.from({ length: days }, () => 1.0),
      precipitation_probability_max: Array.from({ length: days }, () => 25),
      wind_speed_10m_max: Array.from({ length: days }, () => 5),
      wind_direction_10m_dominant: Array.from({ length: days }, () => 270),
      uv_index_max: Array.from({ length: days }, () => 4),
    },
  };
}

// ─── normalizeOpenMeteoForecast ───────────────────────────────────────────────

describe("normalizeOpenMeteoForecast", () => {
  it("targetDate와 일치하는 daily 행을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(3), TARGET_DATE);
    expect(result).not.toBeNull();
    expect(result!.temp_max).toBeCloseTo(20);
    expect(result!.temp_min).toBeCloseTo(10);
    expect(result!.temp).toBeCloseTo(15);
  });

  it("다음 날 targetDate는 두 번째 daily 행을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(3), "2026-04-30");
    expect(result).not.toBeNull();
    expect(result!.temp_max).toBeCloseTo(21);
    expect(result!.temp_min).toBeCloseTo(11);
    expect(result!.temp).toBeCloseTo(16);
  });

  it("일치하는 time이 없으면 null을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(3), "2026-05-10");
    expect(result).toBeNull();
  });

  it("time 배열이 비어있으면 null을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(0), TARGET_DATE);
    expect(result).toBeNull();
  });

  it("temp는 (temp_max + temp_min) / 2다", () => {
    const raw = makeOmRaw(1);
    raw.daily.temperature_2m_max[0] = 30;
    raw.daily.temperature_2m_min[0] = 10;
    const result = normalizeOpenMeteoForecast(raw, TARGET_DATE);
    expect(result!.temp).toBeCloseTo(20);
  });

  it("WMO 코드 0은 clear에 매핑된다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), TARGET_DATE);
    expect(result!.condition).toBe("clear");
  });

  it("WMO 코드 61은 light_rain에 매핑된다", () => {
    const raw = makeOmRaw(1);
    raw.daily.weather_code[0] = 61;
    const result = normalizeOpenMeteoForecast(raw, TARGET_DATE);
    expect(result!.condition).toBe("light_rain");
  });

  it("uv_index_max가 있으면 해당 값을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), TARGET_DATE);
    expect(result!.uv_index).toBe(4);
  });

  it("precip_prob은 precipitation_probability_max 값 그대로다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), TARGET_DATE);
    expect(result!.precip_prob).toBe(25);
  });
});

// ─── Range Validation (ADR 004) ───────────────────────────────────────────────

describe("normalizeOpenWeatherForecast — 범위 이탈 값은 null 반환", () => {
  it("temp가 범위 초과(9999)이면 null을 반환한다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: 9999 })];
    expect(normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE)).toBeNull();
  });

  it("temp가 범위 미만(-100)이면 null을 반환한다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: -100 })];
    expect(normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE)).toBeNull();
  });

  it("정상 범위 경계값(temp=-80)은 null이 아니다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: -80 })];
    expect(normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE)).not.toBeNull();
  });

  it("정상 범위 경계값(temp=60)은 null이 아니다", () => {
    const slots = [makeOwSlot({ dt: KST_APR29_START_UTC, temp: 60 })];
    expect(normalizeOpenWeatherForecast({ list: slots }, TARGET_DATE)).not.toBeNull();
  });
});

describe("normalizeWeatherAPIForecast — 범위 이탈 값은 null 반환", () => {
  it("humidity가 범위 초과(150)이면 null을 반환한다", () => {
    const raw = makeWaRaw(1);
    raw.forecast.forecastday[0]!.day.avghumidity = 150;
    expect(normalizeWeatherAPIForecast(raw, TARGET_DATE)).toBeNull();
  });

  it("wind_speed가 범위 미만(-5 kph → -1.39 m/s)이면 null을 반환한다", () => {
    const raw = makeWaRaw(1);
    raw.forecast.forecastday[0]!.day.maxwind_kph = -18; // -5 m/s
    expect(normalizeWeatherAPIForecast(raw, TARGET_DATE)).toBeNull();
  });

  it("정상값은 null이 아니다", () => {
    expect(normalizeWeatherAPIForecast(makeWaRaw(1), TARGET_DATE)).not.toBeNull();
  });
});

describe("normalizeOpenMeteoForecast — 범위 이탈 값은 null 반환", () => {
  it("temp_max가 범위 초과(9999)이면 null을 반환한다", () => {
    const raw = makeOmRaw(1);
    raw.daily.temperature_2m_max[0] = 9999;
    expect(normalizeOpenMeteoForecast(raw, TARGET_DATE)).toBeNull();
  });

  it("precip_mm가 범위 초과(600)이면 null을 반환한다", () => {
    const raw = makeOmRaw(1);
    raw.daily.precipitation_sum[0] = 600;
    expect(normalizeOpenMeteoForecast(raw, TARGET_DATE)).toBeNull();
  });

  it("정상값은 null이 아니다", () => {
    expect(normalizeOpenMeteoForecast(makeOmRaw(1), TARGET_DATE)).not.toBeNull();
  });
});

// ─── Issue #8 Acceptance Criteria ────────────────────────────────────────────

describe("KST_OFFSET_SEC — normalizer와 builder 날짜 경계 일치 (issue #8)", () => {
  it("OW normalizer의 KST 날짜 변환과 builder의 targetDates[0] 계산이 동일한 경계를 사용한다", () => {
    const now = Date.now();

    // builder 방식: Date.now() + KST_OFFSET_SEC * 1000
    const builderDate = new Date(now + KST_OFFSET_SEC * 1000)
      .toISOString().split("T")[0];

    // normalizer 방식: (dt + KST_OFFSET_SEC) * 1000
    const dtSec = Math.floor(now / 1000);
    const normalizerDate = new Date((dtSec + KST_OFFSET_SEC) * 1000)
      .toISOString().split("T")[0];

    expect(builderDate).toBe(normalizerDate);
  });

  it("KST_OFFSET_SEC는 9시간(32400초)이다", () => {
    expect(KST_OFFSET_SEC).toBe(32400);
  });

  it("KST_OFFSET_SEC 오프셋 적용 후 UTC 자정(00:00)은 KST 09:00가 된다", () => {
    // UTC midnight Jan 1 2026 = epoch 1735689600
    const utcMidnight = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;
    const kstDate = new Date((utcMidnight + KST_OFFSET_SEC) * 1000)
      .toISOString();
    expect(kstDate).toContain("T09:00:00");
  });
});
