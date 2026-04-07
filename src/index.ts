import { Env } from './types/env';
import { handleOpenWeatherCurrent, handleOpenWeatherForecast } from './handlers/openweather';
import { handleWeatherAPICurrent, handleWeatherAPIForecast } from './handlers/weatherapi';
import { handleOpenMeteo } from './handlers/openmeteo';
import { handleOptions } from './utils/cors';
import { errorResponse } from './utils/errors';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // OpenWeatherMap 라우팅
      if (path === '/api/openweather/current') {
        return await handleOpenWeatherCurrent(url, env);
      }
      if (path === '/api/openweather/forecast') {
        return await handleOpenWeatherForecast(url, env);
      }

      // WeatherAPI 라우팅
      if (path === '/api/weatherapi/current') {
        return await handleWeatherAPICurrent(url, env);
      }
      if (path === '/api/weatherapi/forecast') {
        return await handleWeatherAPIForecast(url, env);
      }

      // Open-Meteo 라우팅
      if (path === '/api/openmeteo') {
        return await handleOpenMeteo(url);
      }

      // 404 Not Found
      return errorResponse('NOT_FOUND', 'Endpoint not found', 404);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
    }
  },
};
