import { Env } from './types/env';
import { handleOpenWeatherCurrent, handleOpenWeatherForecast } from './handlers/openweather';
import { handleWeatherAPICurrent, handleWeatherAPIForecast } from './handlers/weatherapi';
import { handleOpenMeteo } from './handlers/openmeteo';
import { handleOptions, getCorsHeaders } from './utils/cors';
import { errorResponse } from './utils/errors';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(origin, allowedOrigins);
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Only GET requests are allowed', 405);
    }

    const corsHeaders = getCorsHeaders(origin, allowedOrigins);

    // API key authentication
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== env.PROXY_API_KEY) {
      return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401, undefined, corsHeaders);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // OpenWeatherMap routing
      if (path === '/api/openweather/current') {
        return await handleOpenWeatherCurrent(url, env, corsHeaders);
      }
      if (path === '/api/openweather/forecast') {
        return await handleOpenWeatherForecast(url, env, corsHeaders);
      }

      // WeatherAPI routing
      if (path === '/api/weatherapi/current') {
        return await handleWeatherAPICurrent(url, env, corsHeaders);
      }
      if (path === '/api/weatherapi/forecast') {
        return await handleWeatherAPIForecast(url, env, corsHeaders);
      }

      // Open-Meteo routing
      if (path === '/api/openmeteo') {
        return await handleOpenMeteo(url, corsHeaders);
      }

      // 404 Not Found
      return errorResponse('NOT_FOUND', 'Endpoint not found', 404, undefined, corsHeaders);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500, undefined, corsHeaders);
    }
  },
};
