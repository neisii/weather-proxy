import { errorResponse } from "../utils/errors";
import { jsonResponse } from "../utils/response";

export async function handleOpenMeteo(url: URL): Promise<Response> {
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  if (!lat || !lon) {
    return errorResponse(
      "MISSING_PARAMETER",
      "lat and lon parameters are required",
      400,
    );
  }

  try {
    // 프론트엔드 어댑터가 기대하는 파라미터 형식 사용
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        "PROVIDER_ERROR",
        "Failed to fetch weather data",
        response.status,
        "openmeteo",
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error("Open-Meteo API error:", error);
    return errorResponse("FETCH_ERROR", "Failed to fetch from Open-Meteo", 502);
  }
}
