export function handleHealth(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
