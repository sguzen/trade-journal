import { bad, handler } from "@/server/api";

/**
 * Authenticated proxy to the Trading Manager Pro API.
 *
 * TMP owns accounts, firm rules and payouts; the journal never computes those
 * numbers, it asks for them. TMP has no auth of its own and publishes no host
 * port — it is reachable only on the compose network — so this route is the
 * single way in, and `handler` applies the same session HMAC check as every
 * other /api route.
 *
 * This must stay a route handler. A next.config rewrite would be served before
 * route handlers run, and the middleware only checks that the session cookie
 * is non-empty (the Edge runtime has no Node crypto), so a rewrite would hand
 * out campaign state to anyone presenting `journal_session=anything`.
 */
const TMP_ORIGIN = process.env.TMP_ORIGIN ?? "http://tmp:8503";

/** Hop-by-hop and auth headers that must not be relayed to TMP. */
const STRIPPED = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "host",
  "content-length",
]);

type Params = { params: Promise<{ path: string[] }> };

const proxy = async (request: Request, { params }: Params): Promise<Response> => {
  const { path } = await params;
  if (!path?.length) return bad("Missing TMP path", 404);
  // Segments arrive already decoded; re-encoding keeps a crafted segment from
  // escaping the /api prefix or smuggling a query string.
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, TMP_ORIGIN);
  target.search = new URL(request.url).search;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!STRIPPED.has(key.toLowerCase())) headers.set(key, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    // A dead or unreachable TMP container is an upstream failure, not a 500
    // from the journal itself.
    return bad("Trading Manager Pro is unreachable", 502);
  }

  const out = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) out.set("content-type", contentType);
  out.set("Cache-Control", "private, no-store");

  return new Response(response.body, { status: response.status, headers: out });
};

export const GET = handler(proxy);
export const POST = handler(proxy);
export const PUT = handler(proxy);
export const PATCH = handler(proxy);
export const DELETE = handler(proxy);
