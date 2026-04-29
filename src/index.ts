import { Env } from './types/env';
import { handleOpenWeatherCurrent, handleOpenWeatherForecast } from './handlers/openweather';
import { handleWeatherAPICurrent, handleWeatherAPIForecast } from './handlers/weatherapi';
import { handleOpenMeteo } from './handlers/openmeteo';
import { handleCities, handleWeatherCurrent, handleWeatherForecast } from './handlers/weather';
import { handleHealth } from './handlers/health';
import { handleOptions, getCorsHeaders } from './utils/cors';
import { errorResponse } from './utils/errors';

const AGGREGATED_PATHS: ReadonlySet<string> = new Set([
  '/api/healthz',
  '/api/weather/cities',
  '/api/weather/current',
  '/api/weather/forecast',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS;

    if (request.method === 'OPTIONS') {
      return handleOptions(origin, allowedOrigins);
    }

    if (request.method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Only GET requests are allowed', 405);
    }

    const corsHeaders = getCorsHeaders(origin, allowedOrigins);
    const url = new URL(request.url);
    const path = url.pathname;

    const isAggregatedEndpoint = AGGREGATED_PATHS.has(path);

    // Raw provider passthrough endpoints require X-API-Key.
    // Frontend-facing aggregated endpoints are protected by CORS allowlist only.
    if (!isAggregatedEndpoint) {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROXY_API_KEY) {
        return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401, undefined, corsHeaders);
      }
    }

    try {
      // Aggregated frontend API
      if (path === '/api/healthz') {
        return handleHealth(corsHeaders);
      }
      if (path === '/api/weather/cities') {
        return handleCities(corsHeaders);
      }
      if (path === '/api/weather/current') {
        return await handleWeatherCurrent(url, env, corsHeaders);
      }
      if (path === '/api/weather/forecast') {
        return await handleWeatherForecast(url, env, corsHeaders);
      }

      // Raw provider passthroughs (auth-gated)
      if (path === '/api/openweather/current') {
        return await handleOpenWeatherCurrent(url, env, corsHeaders);
      }
      if (path === '/api/openweather/forecast') {
        return await handleOpenWeatherForecast(url, env, corsHeaders);
      }
      if (path === '/api/weatherapi/current') {
        return await handleWeatherAPICurrent(url, env, corsHeaders);
      }
      if (path === '/api/weatherapi/forecast') {
        return await handleWeatherAPIForecast(url, env, corsHeaders);
      }
      if (path === '/api/openmeteo') {
        return await handleOpenMeteo(url, corsHeaders);
      }

      return errorResponse('NOT_FOUND', 'Endpoint not found', 404, undefined, corsHeaders);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500, undefined, corsHeaders);
    }
  },
};
