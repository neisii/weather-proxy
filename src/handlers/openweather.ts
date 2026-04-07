import { Env } from '../types/env';
import { errorResponse } from '../utils/errors';
import { jsonResponse } from '../utils/response';

export async function handleOpenWeatherCurrent(
  url: URL,
  env: Env
): Promise<Response> {
  const city = url.searchParams.get('city');

  if (!city) {
    return errorResponse('MISSING_PARAMETER', 'city parameter is required', 400);
  }

  try {
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${env.OPENWEATHER_API_KEY}&units=metric&lang=kr`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        'PROVIDER_ERROR',
        data.message || 'Failed to fetch weather data',
        response.status,
        'openweather'
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error('OpenWeather API error:', error);
    return errorResponse('FETCH_ERROR', 'Failed to fetch from OpenWeather', 502);
  }
}

export async function handleOpenWeatherForecast(
  url: URL,
  env: Env
): Promise<Response> {
  const city = url.searchParams.get('city');

  if (!city) {
    return errorResponse('MISSING_PARAMETER', 'city parameter is required', 400);
  }

  try {
    const apiUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${env.OPENWEATHER_API_KEY}&units=metric&lang=kr`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      return errorResponse(
        'PROVIDER_ERROR',
        data.message || 'Failed to fetch forecast data',
        response.status,
        'openweather'
      );
    }

    return jsonResponse(data);
  } catch (error) {
    console.error('OpenWeather Forecast API error:', error);
    return errorResponse('FETCH_ERROR', 'Failed to fetch from OpenWeather', 502);
  }
}
