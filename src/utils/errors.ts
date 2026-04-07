import { corsHeaders } from './cors';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    provider?: string;
  };
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  provider?: string
): Response {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      ...(provider && { provider }),
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}
