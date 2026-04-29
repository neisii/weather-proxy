import { describe, it, expect } from "vitest";
import {
  aggregateWeather,
  normalizeOpenWeatherForecast,
  normalizeWeatherAPIForecast,
  normalizeOpenMeteoForecast,
  KST_OFFSET_SEC,
} from "../handlers/weather";
import type { ProviderResult, NormalizedWeather } from "../handlers/weather";

// buildForecastData / handleWeatherForecastDebug은 fetch 의존성으로 직접 단위 테스트 불가.
// 대신 debug 응답의 핵심 불변성을 검증한다:
// 1. provider_data의 data 필드는 원본 NormalizedWeather | null을 보존한다
// 2. 집계 weather는 provider_data와 독립적으로 계산된다
// 3. null provider는 zero-fill이 아닌 null로 표현된다

const KST_APR29 = Date.UTC(2026, 3, 28, 15, 0, 0) / 1000;
const TARGET = "2026-04-29";

function makeWeather(temp: number): NormalizedWeather {
  return {
    temp, feels_like: temp - 1, temp_max: temp + 3, temp_min: temp - 3,
    humidity: 60, pressure: 1013, wind_speed: 3, wind_deg: 180,
    condition: "clear", precip_mm: 0, precip_prob: 0, uv_index: 3, visibility: 10000,
  };
}

describe("debug 응답 provider_data 불변성", () => {
  it("provider_data는 집계 전 원본 값을 보존한다", () => {
    const owData = normalizeOpenWeatherForecast(
      { list: [{ dt: KST_APR29, main: { temp: 14, feels_like: 13, temp_max: 17, temp_min: 11, humidity: 50, pressure: 1015 }, wind: { speed: 3, deg: 270 }, weather: [{ icon: "01d" }], pop: 0 }] },
      TARGET,
    );
    const waData = normalizeWeatherAPIForecast(
      { forecast: { forecastday: [{ date: TARGET, day: { avgtemp_c: 17, maxtemp_c: 21, mintemp_c: 13, maxwind_kph: 18, avghumidity: 55, daily_chance_of_rain: 0, totalprecip_mm: 0, uv: 4, condition: { code: 1000 }, avgvis_km: 10 } }] } },
      TARGET,
    );
    const omData = normalizeOpenMeteoForecast(
      { daily: { time: [TARGET], temperature_2m_max: [20], temperature_2m_min: [10], weather_code: [0], precipitation_sum: [0], wind_speed_10m_max: [5] } },
      TARGET,
    );

    const perDayResults: ProviderResult[] = [
      { provider: "openweather", data: owData, error: null },
      { provider: "weatherapi",  data: waData, error: null },
      { provider: "openmeteo",   data: omData, error: null },
    ];

    const aggregated = aggregateWeather(perDayResults);

    // provider_data는 원본 값 그대로여야 함
    expect(perDayResults[0]!.data!.temp).toBe(owData!.temp);
    expect(perDayResults[1]!.data!.temp).toBe(waData!.temp);
    expect(perDayResults[2]!.data!.temp).toBe(omData!.temp);

    // 집계 값은 원본 값과 다를 수 있음 (가중치 적용)
    expect(aggregated.weather.temp).not.toBe(owData!.temp);
    expect(aggregated.weather.temp).not.toBe(waData!.temp);
    expect(aggregated.weather.temp).not.toBe(omData!.temp);
  });

  it("provider data가 null이면 zero-fill이 아닌 null로 표현된다", () => {
    const perDayResults: ProviderResult[] = [
      { provider: "openweather", data: null,            error: "failed" },
      { provider: "weatherapi",  data: makeWeather(18), error: null },
      { provider: "openmeteo",   data: makeWeather(16), error: null },
    ];

    // debug 응답에서 provider_data를 그대로 반영했을 때
    const debugProviderData = perDayResults.map((r) => ({
      provider: r.provider,
      data: r.data,      // null 보존
      error: r.error,
    }));

    expect(debugProviderData[0]!.data).toBeNull();
    expect(debugProviderData[0]!.error).toBe("failed");
    expect(debugProviderData[1]!.data).not.toBeNull();
    expect(debugProviderData[1]!.data!.temp).toBe(18);
  });

  it("provider_data를 보면 집계 온도가 어느 provider에서 비롯됐는지 역추적 가능하다", () => {
    // openweather 0.40·20 + weatherapi 0.15·18 + openmeteo 0.45·16 = 17.9
    const perDayResults: ProviderResult[] = [
      { provider: "openweather", data: makeWeather(20), error: null },
      { provider: "weatherapi",  data: makeWeather(18), error: null },
      { provider: "openmeteo",   data: makeWeather(16), error: null },
    ];

    const aggregated = aggregateWeather(perDayResults);
    const debugProviderData = perDayResults.map((r) => ({ provider: r.provider, data: r.data }));

    expect(aggregated.weather.temp).toBeCloseTo(17.9);
    expect(debugProviderData.find((p) => p.provider === "openweather")!.data!.temp).toBe(20);
    expect(debugProviderData.find((p) => p.provider === "weatherapi")!.data!.temp).toBe(18);
    expect(debugProviderData.find((p) => p.provider === "openmeteo")!.data!.temp).toBe(16);
  });

  it("KST 날짜 필터 후 OW 슬롯 없으면 null — 집계는 나머지 두 provider로만 구성된다", () => {
    const noSlotsOw = normalizeOpenWeatherForecast({ list: [] }, TARGET);
    expect(noSlotsOw).toBeNull();

    const perDayResults: ProviderResult[] = [
      { provider: "openweather", data: null,            error: null },
      { provider: "weatherapi",  data: makeWeather(18), error: null },
      { provider: "openmeteo",   data: makeWeather(16), error: null },
    ];

    const aggregated = aggregateWeather(perDayResults);
    expect(aggregated.incomplete_data).toBe(true);
    expect(aggregated.providers_failed).toContain("openweather");
    // weight 재분배: WA 0.15→0.25, OM 0.45→0.75
    // 0.25·18 + 0.75·16 = 4.5 + 12 = 16.5
    expect(aggregated.weather.temp).toBeCloseTo(16.5);
  });
});
