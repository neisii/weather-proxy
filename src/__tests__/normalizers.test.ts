import { describe, it, expect } from "vitest";
import {
  normalizeOpenWeatherForecast,
  normalizeWeatherAPIForecast,
  normalizeOpenMeteoForecast,
} from "../handlers/weather";

// ─── OpenWeather Fixtures ─────────────────────────────────────────────────────

function makeOwSlot(overrides: {
  dt?: number;
  temp?: number;
  pop?: number;
  rain?: number;
  icon?: string;
} = {}) {
  return {
    dt: overrides.dt ?? 1745712000,
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

function makeOwRaw(slots: ReturnType<typeof makeOwSlot>[]) {
  return { list: slots };
}

// ─── normalizeOpenWeatherForecast ─────────────────────────────────────────────

describe("normalizeOpenWeatherForecast", () => {
  it("dayIndex=0에 해당하는 슬롯(0~7)의 temp 평균을 반환한다", () => {
    const slots = Array.from({ length: 16 }, (_, i) =>
      makeOwSlot({ temp: i < 8 ? 10 : 20 })
    );
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 0);
    expect(result.temp).toBeCloseTo(10);
  });

  it("dayIndex=1은 슬롯 8~15를 사용한다", () => {
    const slots = Array.from({ length: 16 }, (_, i) =>
      makeOwSlot({ temp: i < 8 ? 10 : 20 })
    );
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 1);
    expect(result.temp).toBeCloseTo(20);
  });

  it("list가 비어있으면 fallback(temp=20 등 기본값)을 반환한다", () => {
    const result = normalizeOpenWeatherForecast(makeOwRaw([]), 0);
    // 빈 list 시 r.list[0]이 undefined → 기본값 사용
    expect(result.temp).toBe(20);
    expect(result.condition).toBe("cloudy");
  });

  it("슬롯 수가 8 미만인 partial slice도 에러 없이 집계한다", () => {
    // dayIndex=2이지만 list 길이가 17 → slice(16, 24) = [slot16]
    const slots = Array.from({ length: 17 }, (_, i) => makeOwSlot({ temp: 15 + i }));
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 2);
    expect(result.temp).toBeCloseTo(31); // 마지막 슬롯 temp
    expect(result.precip_mm).toBeDefined();
  });

  it("precip_prob은 슬롯 중 최대 pop(×100)을 반환한다", () => {
    const slots = [
      makeOwSlot({ pop: 0.3 }),
      makeOwSlot({ pop: 0.8 }),
      makeOwSlot({ pop: 0.5 }),
    ];
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 0);
    expect(result.precip_prob).toBeCloseTo(80);
  });

  it("precip_mm은 슬롯의 rain[3h] 합산이다", () => {
    const slots = [
      makeOwSlot({ rain: 1.5 }),
      makeOwSlot({ rain: 2.0 }),
      makeOwSlot({ rain: 0.5 }),
    ];
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 0);
    expect(result.precip_mm).toBeCloseTo(4.0);
  });

  it("rain 필드가 없는 슬롯은 0으로 처리한다", () => {
    const slots = [makeOwSlot(), makeOwSlot({ rain: 1.0 })];
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 0);
    expect(result.precip_mm).toBeCloseTo(1.0);
  });

  it("OW icon은 OW_ICON_MAP으로 condition에 매핑된다", () => {
    const slots = [makeOwSlot({ icon: "11d" })]; // thunderstorm
    const result = normalizeOpenWeatherForecast(makeOwRaw(slots), 0);
    expect(result.condition).toBe("thunderstorm");
  });
});

// ─── WeatherAPI Fixtures ──────────────────────────────────────────────────────

function makeWaRaw(days: number) {
  return {
    forecast: {
      forecastday: Array.from({ length: days }, (_, i) => ({
        day: {
          avgtemp_c: 15 + i,
          maxtemp_c: 20 + i,
          mintemp_c: 10 + i,
          maxwind_kph: 36,
          avghumidity: 60,
          daily_chance_of_rain: 30,
          totalprecip_mm: 2.5,
          uv: 4,
          condition: { code: 1000 }, // clear
          avgvis_km: 10,
        },
      })),
    },
  };
}

// ─── normalizeWeatherAPIForecast ──────────────────────────────────────────────

describe("normalizeWeatherAPIForecast", () => {
  it("dayIndex=0에 해당하는 forecastday 데이터를 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(3), 0);
    expect(result.temp).toBeCloseTo(15);
    expect(result.temp_max).toBeCloseTo(20);
    expect(result.temp_min).toBeCloseTo(10);
  });

  it("dayIndex=1은 두 번째 forecastday를 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(3), 1);
    expect(result.temp).toBeCloseTo(16);
  });

  it("forecastday가 없으면 fallback(temp=20 등)을 반환한다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(0), 0);
    expect(result.temp).toBe(20);
    expect(result.condition).toBe("cloudy");
  });

  it("풍속은 kph → m/s 변환한다 (÷3.6)", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), 0);
    expect(result.wind_speed).toBeCloseTo(10); // 36 / 3.6
  });

  it("가시거리는 km → m 변환한다 (×1000)", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), 0);
    expect(result.visibility).toBeCloseTo(10000); // 10 × 1000
  });

  it("WA condition code 1000은 clear에 매핑된다", () => {
    const result = normalizeWeatherAPIForecast(makeWaRaw(1), 0);
    expect(result.condition).toBe("clear");
  });
});

// ─── Open-Meteo Fixtures ──────────────────────────────────────────────────────

function makeOmRaw(days: number) {
  return {
    daily: {
      time: Array.from({ length: days }, (_, i) => `2026-04-${29 + i}`),
      temperature_2m_max: Array.from({ length: days }, (_, i) => 20 + i),
      temperature_2m_min: Array.from({ length: days }, (_, i) => 10 + i),
      apparent_temperature_max: Array.from({ length: days }, () => 18),
      weather_code: Array.from({ length: days }, () => 0), // clear
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
  it("dayIndex=0에 해당하는 daily 행을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(3), 0);
    expect(result.temp_max).toBeCloseTo(20);
    expect(result.temp_min).toBeCloseTo(10);
    expect(result.temp).toBeCloseTo(15); // (20+10)/2
  });

  it("dayIndex=1은 두 번째 행을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(3), 1);
    expect(result.temp_max).toBeCloseTo(21);
    expect(result.temp_min).toBeCloseTo(11);
    expect(result.temp).toBeCloseTo(16);
  });

  it("time 배열이 비어있으면 fallback(temp=20 등)을 반환한다", () => {
    const raw = makeOmRaw(0);
    const result = normalizeOpenMeteoForecast(raw, 0);
    expect(result.temp).toBe(20);
    expect(result.condition).toBe("cloudy");
  });

  it("temp는 (temp_max + temp_min) / 2다", () => {
    const raw = makeOmRaw(1);
    raw.daily.temperature_2m_max[0] = 30;
    raw.daily.temperature_2m_min[0] = 10;
    const result = normalizeOpenMeteoForecast(raw, 0);
    expect(result.temp).toBeCloseTo(20);
  });

  it("WMO 코드 0은 clear에 매핑된다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), 0);
    expect(result.condition).toBe("clear");
  });

  it("WMO 코드 61은 light_rain에 매핑된다", () => {
    const raw = makeOmRaw(1);
    raw.daily.weather_code[0] = 61;
    const result = normalizeOpenMeteoForecast(raw, 0);
    expect(result.condition).toBe("light_rain");
  });

  it("uv_index_max가 있으면 해당 값을 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), 0);
    expect(result.uv_index).toBe(4);
  });

  it("precip_prob은 precipitation_probability_max 값을 그대로 반환한다", () => {
    const result = normalizeOpenMeteoForecast(makeOmRaw(1), 0);
    expect(result.precip_prob).toBe(25);
  });
});
