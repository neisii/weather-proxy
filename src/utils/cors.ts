export function getCorsHeaders(origin?: string | null, allowedOrigins?: string): Record<string, string> {
  let allowOrigin = '';

  if (!allowedOrigins) {
    // If no allowlist configured, deny all cross-origin requests
    allowOrigin = '';
  } else if (allowedOrigins === '*') {
    allowOrigin = '*';
  } else {
    const origins = allowedOrigins.split(',').map((o) => o.trim());
    if (origin && origins.includes(origin)) {
      allowOrigin = origin;
    }
  }

  return {
    ...(allowOrigin && { 'Access-Control-Allow-Origin': allowOrigin }),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleOptions(origin?: string | null, allowedOrigins?: string): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin, allowedOrigins),
  });
}
