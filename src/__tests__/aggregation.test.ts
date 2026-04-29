import { describe, it, expect } from "vitest";
import {
  weightedAvg,
  redistributeWeights,
  aggregateWeather,
} from "../handlers/weather";
import type { ProviderResult, NormalizedWeather } from "../handlers/weather";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseWeather: NormalizedWeather = {
  temp: 15,
  feels_like: 14,
  temp_max: 18,
  temp_min: 12,
  humidity: 60,
  pressure: 1013,
  wind_speed: 3,
  wind_deg: 180,
  condition: "clear",
  precip_mm: 0,
  precip_prob: 0,
  uv_index: 3,
  visibility: 10000,
};

function makeResult(
  provider: ProviderResult["provider"],
  overrides: Partial<NormalizedWeather> = {},
  error: string | null = null,
): ProviderResult {
  return {
    provider,
    data: error ? null : { ...baseWeather, ...overrides },
    error,
  };
}

// ─── weightedAvg ─────────────────────────────────────────────────────────────

describe("weightedAvg", () => {
  it("균등 가중치 평균을 반환한다", () => {
    expect(weightedAvg([{ v: 10, w: 0.5 }, { v: 20, w: 0.5 }])).toBe(15);
  });

  it("불균등 가중치에 맞게 평균을 계산한다", () => {
    expect(weightedAvg([{ v: 10, w: 0.8 }, { v: 20, w: 0.2 }])).toBeCloseTo(12);
  });

  it("가중치 합이 0이면 0을 반환한다 (÷0 방어)", () => {
    expect(weightedAvg([{ v: 10, w: 0 }, { v: 20, w: 0 }])).toBe(0);
  });

  it("단일 값은 그대로 반환한다", () => {
    expect(weightedAvg([{ v: 15, w: 1.0 }])).toBe(15);
  });
});

// ─── redistributeWeights ─────────────────────────────────────────────────────

describe("redistributeWeights", () => {
  it("실패 provider가 없으면 원본 weights를 그대로 반환한다", () => {
    const weights = { openmeteo: 0.45, openweather: 0.40, weatherapi: 0.15 };
    const result = redistributeWeights(weights, new Set());
    expect(result).toEqual(weights);
  });

  it("openweather 탈락 시 weight를 비율대로 나머지에 분배한다", () => {
    const weights = { openmeteo: 0.45, openweather: 0.40, weatherapi: 0.15 };
    const result = redistributeWeights(weights, new Set(["openweather"]));
    expect(result["openweather"]).toBe(0);
    expect(result["openmeteo"]).toBeCloseTo(0.75);
    expect(result["weatherapi"]).toBeCloseTo(0.25);
    expect((result["openmeteo"] ?? 0) + (result["weatherapi"] ?? 0)).toBeCloseTo(1);
  });

  it("weatherapi 탈락 시 비율대로 분배한다", () => {
    const weights = { openmeteo: 0.45, openweather: 0.40, weatherapi: 0.15 };
    const result = redistributeWeights(weights, new Set(["weatherapi"]));
    expect(result["weatherapi"]).toBe(0);
    const total = (result["openmeteo"] ?? 0) + (result["openweather"] ?? 0);
    expect(total).toBeCloseTo(1);
    expect(result["openmeteo"] ?? 0).toBeGreaterThan(result["openweather"] ?? 0);
  });

  it("전체 실패 시 active가 없으므로 원본 weights를 반환한다", () => {
    const weights = { a: 0.5, b: 0.5 };
    const result = redistributeWeights(weights, new Set(["a", "b"]));
    expect(result).toEqual(weights);
  });

  it("active의 weight 합이 0이면 균등 분배(1/N)한다", () => {
    const weights = { openmeteo: 0.00, openweather: 0.30, weatherapi: 0.70 };
    const result = redistributeWeights(weights, new Set(["openweather", "weatherapi"]));
    expect(result["openmeteo"]).toBeCloseTo(1);
  });
});

// ─── aggregateWeather ─────────────────────────────────────────────────────────

describe("aggregateWeather", () => {
  it("3개 provider 모두 성공 시 정상 집계한다", () => {
    const results = [
      makeResult("openweather", { temp: 20 }),
      makeResult("weatherapi", { temp: 18 }),
      makeResult("openmeteo", { temp: 16 }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.providers_used).toHaveLength(3);
    expect(agg.providers_failed).toHaveLength(0);
    expect(agg.incomplete_data).toBe(false);
    expect(agg.weather.temp).toBeCloseTo(17.9);
  });

  it("1개 provider 실패 시 weight 재분배하고 incomplete_data를 true로 설정한다", () => {
    const results = [
      makeResult("openweather", {}, "fetch error"),
      makeResult("weatherapi", { temp: 18 }),
      makeResult("openmeteo", { temp: 16 }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.providers_failed).toContain("openweather");
    expect(agg.incomplete_data).toBe(true);
    expect(agg.providers_used).toHaveLength(2);
  });

  it("전체 실패 시 throws한다", () => {
    const results = [
      makeResult("openweather", {}, "err"),
      makeResult("weatherapi", {}, "err"),
      makeResult("openmeteo", {}, "err"),
    ];
    expect(() => aggregateWeather(results)).toThrow();
  });

  it("condition은 가중치 최고 provider(openweather)에서 가져온다", () => {
    const results = [
      makeResult("openweather", { condition: "thunderstorm" }),
      makeResult("weatherapi", { condition: "clear" }),
      makeResult("openmeteo", { condition: "cloudy" }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.weather.condition).toBe("thunderstorm");
  });

  it("openweather 실패 시 condition은 남은 provider 중 weight 높은 쪽에서 가져온다", () => {
    const results = [
      makeResult("openweather", {}, "err"),
      makeResult("weatherapi", { condition: "clear" }),
      makeResult("openmeteo", { condition: "cloudy" }),
    ];
    const agg = aggregateWeather(results);
    expect(["clear", "cloudy"]).toContain(agg.weather.condition);
  });

  it("uv_index가 일부 null이면 non-null 값의 평균을 반환한다", () => {
    const results = [
      makeResult("openweather", { uv_index: null }),
      makeResult("weatherapi", { uv_index: null }),
      makeResult("openmeteo", { uv_index: 6 }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.weather.uv_index).toBeCloseTo(6);
  });

  it("uv_index가 모두 null이면 null을 반환한다", () => {
    const results = [
      makeResult("openweather", { uv_index: null }),
      makeResult("weatherapi", { uv_index: null }),
      makeResult("openmeteo", { uv_index: null }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.weather.uv_index).toBeNull();
  });

  it("visibility가 모두 null이면 null을 반환한다", () => {
    const results = [
      makeResult("openweather", { visibility: null }),
      makeResult("weatherapi", { visibility: null }),
      makeResult("openmeteo", { visibility: null }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.weather.visibility).toBeNull();
  });

  it("confidence 점수는 0 이상 1 이하다", () => {
    const results = [
      makeResult("openweather", { temp: 10 }),
      makeResult("weatherapi", { temp: 20 }),
      makeResult("openmeteo", { temp: 30 }),
    ];
    const agg = aggregateWeather(results);
    expect(agg.confidence.temp).toBeGreaterThanOrEqual(0);
    expect(agg.confidence.temp).toBeLessThanOrEqual(1);
    expect(agg.confidence.overall).toBeGreaterThanOrEqual(0);
    expect(agg.confidence.overall).toBeLessThanOrEqual(1);
  });
});
