export function jsonResponse(data: any, status: number = 200, corsHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(corsHeaders ?? {}),
    },
  });
}
