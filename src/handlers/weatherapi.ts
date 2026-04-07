import { Env } from '../types/env';
import { errorResponse } from '../utils/errors';
import { jsonResponse } from '../utils/response';

export async function handleWeatherAPICurrent(
  url: URL,
  env: Env
): Promise<Response> {
  const city = url.searchParams.get('city');

  if (!city) {
    return errorResponse('MISSING_PARAMETER', 'city parameter is required', 400);
  }

  try {
    const apiUrl = `https://api.weatherapi.com/v1/current.json?key=${env.WEATHERAPI_API_KEY}&q=${encodeURIComponent(city)}&aqi=no`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        'PROVIDER_ERROR',
        data.error?.message || 'Failed to fetch weather data',
        response.status,
        'weatherapi'
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error('WeatherAPI error:', error);
    return errorResponse('FETCH_ERROR', 'Failed to fetch from WeatherAPI', 502);
  }
}

export async function handleWeatherAPIForecast(
  url: URL,
  env: Env
): Promise<Response> {
  const city = url.searchParams.get('city');

  if (!city) {
    return errorResponse('MISSING_PARAMETER', 'city parameter is required', 400);
  }

  try {
    const apiUrl = `https://api.weatherapi.com/v1/forecast.json?key=${env.WEATHERAPI_API_KEY}&q=${encodeURIComponent(city)}&days=3&aqi=no`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        'PROVIDER_ERROR',
        data.error?.message || 'Failed to fetch forecast data',
        response.status,
        'weatherapi'
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error('WeatherAPI Forecast error:', error);
    return errorResponse('FETCH_ERROR', 'Failed to fetch from WeatherAPI', 502);
  }
}
