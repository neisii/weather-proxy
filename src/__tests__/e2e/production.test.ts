import { describe, it, expect } from "vitest";

const BASE_URL = "https://weather-proxy.neisii.workers.dev";

const CITIES = ["seoul", "busan", "incheon", "daegu", "gwangju", "daejeon", "ulsan", "jeju"];

const FIELD_RANGES = {
  temp:       { min: -80,  max: 60   },
  humidity:   { min: 0,    max: 100  },
  wind_speed: { min: 0,    max: 120  },
};

function inRange(value: number, field: keyof typeof FIELD_RANGES): boolean {
  const { min, max } = FIELD_RANGES[field];
  return value >= min && value <= max;
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0]!;
}

// ─── 1. 기본 동작 ─────────────────────────────────────────────────────────────

describe("기본 동작", () => {
  it("GET /api/healthz — status: ok", async () => {
    const res = await fetch(`${BASE_URL}/api/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /api/weather/cities — 8개 도시 반환", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/cities`);
    expect(res.status).toBe(200);
    const body = await res.json() as { cities: unknown[] };
    expect(body.cities).toHaveLength(8);
  });
});

// ─── 2. 현재 날씨 ─────────────────────────────────────────────────────────────

describe("현재 날씨 — 8개 도시", () => {
  for (const cityId of CITIES) {
    it(`GET /api/weather/current?cityId=${cityId} — 정상 집계`, async () => {
      const res = await fetch(`${BASE_URL}/api/weather/current?cityId=${cityId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        weather: { temp: number; humidity: number; wind_speed: number };
        providers_used: string[];
        incomplete_data: boolean;
      };
      expect(body.providers_used.length).toBeGreaterThanOrEqual(1);
      expect(inRange(body.weather.temp, "temp")).toBe(true);
      expect(inRange(body.weather.humidity, "humidity")).toBe(true);
      expect(inRange(body.weather.wind_speed, "wind_speed")).toBe(true);
    });
  }

  it("cityId 누락 — 400", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/current`);
    expect(res.status).toBe(400);
  });

  it("존재하지 않는 cityId — 400", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/current?cityId=invalid`);
    expect(res.status).toBe(400);
  });
});

// ─── 3. 예보 ─────────────────────────────────────────────────────────────────

describe("예보", () => {
  for (const days of [1, 2, 3]) {
    it(`GET /api/weather/forecast?cityId=seoul&days=${days} — ${days}일 반환`, async () => {
      const res = await fetch(`${BASE_URL}/api/weather/forecast?cityId=seoul&days=${days}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        days: Array<{ date: string; weather: { temp: number; humidity: number; wind_speed: number } }>;
        providers_used: string[];
      };
      expect(body.days).toHaveLength(days);
      expect(body.providers_used.length).toBeGreaterThanOrEqual(1);
    });
  }

  it("days[0].date — 오늘 KST 날짜", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/forecast?cityId=seoul&days=1`);
    const body = await res.json() as { days: Array<{ date: string }> };
    expect(body.days[0]!.date).toBe(todayKST());
  });

  it("예보 필드 범위 검증 — seoul days=3", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/forecast?cityId=seoul&days=3`);
    const body = await res.json() as {
      days: Array<{ weather: { temp: number; humidity: number; wind_speed: number } }>;
    };
    for (const day of body.days) {
      expect(inRange(day.weather.temp, "temp")).toBe(true);
      expect(inRange(day.weather.humidity, "humidity")).toBe(true);
      expect(inRange(day.weather.wind_speed, "wind_speed")).toBe(true);
    }
  });

  it("8개 도시 forecast 정상 응답", async () => {
    const results = await Promise.all(
      CITIES.map((cityId) =>
        fetch(`${BASE_URL}/api/weather/forecast?cityId=${cityId}&days=1`).then((r) => r.status)
      )
    );
    expect(results.every((s) => s === 200)).toBe(true);
  });

  it("cityId 누락 — 400", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/forecast`);
    expect(res.status).toBe(400);
  });
});

// ─── 4. 캐시 동작 ─────────────────────────────────────────────────────────────

describe("캐시 동작", () => {
  it("forecast 재요청 시 cached_at이 ISO 8601 문자열", async () => {
    // Cloudflare Workers는 isolate가 여러 개라 두 요청이 다른 isolate를 타면
    // 각자 캐시를 보유 — cached_at 동일 비교는 프로덕션에서 보장 불가.
    // cached_at 필드 존재 여부와 형식만 검증한다.
    const res = await fetch(`${BASE_URL}/api/weather/forecast?cityId=busan&days=3`);
    const body = await res.json() as { cached_at: string };
    expect(body.cached_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("days=2와 days=3은 독립 캐시 엔트리 (cached_at 다를 수 있음)", async () => {
    const [r2, r3] = await Promise.all([
      fetch(`${BASE_URL}/api/weather/forecast?cityId=daegu&days=2`).then((r) => r.json() as Promise<{ days: unknown[] }>),
      fetch(`${BASE_URL}/api/weather/forecast?cityId=daegu&days=3`).then((r) => r.json() as Promise<{ days: unknown[] }>),
    ]);
    expect(r2.days).toHaveLength(2);
    expect(r3.days).toHaveLength(3);
  });
});

// ─── 5. 인증 ─────────────────────────────────────────────────────────────────

describe("인증", () => {
  it("X-API-Key 없이 /api/weather/forecast/debug — 401", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/forecast/debug?cityId=seoul`);
    expect(res.status).toBe(401);
  });

  it("잘못된 X-API-Key — 401", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/forecast/debug?cityId=seoul`, {
      headers: { "X-API-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("X-API-Key 없이 /api/openweather/current — 401", async () => {
    const res = await fetch(`${BASE_URL}/api/openweather/current?cityId=seoul`);
    expect(res.status).toBe(401);
  });
});

// ─── 6. 엣지케이스 ───────────────────────────────────────────────────────────

describe("엣지케이스", () => {
  it("POST 요청 — 405", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/current`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("존재하지 않는 경로 — 401 (인증 게이트 우선)", async () => {
    const res = await fetch(`${BASE_URL}/api/unknown`);
    expect(res.status).toBe(401);
  });

  it("CORS preflight — 204", async () => {
    const res = await fetch(`${BASE_URL}/api/weather/current`, {
      method: "OPTIONS",
      headers: { Origin: "https://cycling-advisor.onrender.com" },
    });
    expect(res.status).toBe(204);
  });
});
