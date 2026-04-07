import { errorResponse } from "../utils/errors";
import { jsonResponse } from "../utils/response";

export async function handleOpenMeteo(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  if (!lat || !lon) {
    return errorResponse(
      "MISSING_PARAMETER",
      "lat and lon parameters are required",
      400,
      undefined,
      corsHeaders,
    );
  }

  // Validate lat/lon are valid numbers
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return errorResponse(
      "INVALID_PARAMETER",
      "lat must be between -90 and 90, lon must be between -180 and 180",
      400,
      undefined,
      corsHeaders,
    );
  }

  try {
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        "PROVIDER_ERROR",
        "Failed to fetch weather data",
        response.status,
        "openmeteo",
        corsHeaders,
      );
    }

    return jsonResponse(data, 200, corsHeaders);
  } catch (error) {
    console.error("Open-Meteo API error:", error);
    return errorResponse("FETCH_ERROR", "Failed to fetch from Open-Meteo", 502, undefined, corsHeaders);
  }
}
