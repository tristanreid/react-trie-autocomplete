/**
 * Server utilities for serving packed radix tries.
 *
 * Works with Express, Next.js API routes, Hono, or any framework that
 * uses standard (req, res) handlers.
 *
 * No React dependency — safe to import on the server only.
 *
 * @example Express
 * ```typescript
 * import { createTrieHandler } from '@tristanreid/react-trie-autocomplete/server';
 *
 * const cities = [
 *   { text: 'New York', score: 0.95 },
 *   { text: 'New Orleans', score: 0.85 },
 * ];
 *
 * app.get('/api/cities.trie', createTrieHandler(cities));
 * ```
 *
 * @example Next.js API Route
 * ```typescript
 * import { packTrie } from '@tristanreid/react-trie-autocomplete/pack';
 *
 * export async function GET() {
 *   const cities = await db.query('SELECT name, population FROM cities');
 *   const packed = packTrie(cities.map(c => ({ text: c.name, score: c.population })));
 *   return new Response(packed, {
 *     headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' },
 *   });
 * }
 * ```
 */

import { packTrie, type PackOptions } from './pack.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface TrieHandlerOptions extends PackOptions {
  /**
   * Cache-Control header value.
   * Default: "public, max-age=3600" (1 hour).
   * Set to null to omit the header.
   */
  cacheControl?: string | null;

  /**
   * Additional response headers.
   */
  headers?: Record<string, string>;
}

/** Minimal response interface compatible with Express/Connect/Hono. */
interface ServerResponse {
  setHeader?(name: string, value: string): void;
  writeHead?(statusCode: number, headers?: Record<string, string>): void;
  end(data?: string): void;
  statusCode?: number;
}

/** Minimal request interface (not used, but included for handler signature). */
interface ServerRequest {
  [key: string]: unknown;
}

// ─── Handler factory ────────────────────────────────────────────────

/**
 * Create a request handler that serves a packed radix trie.
 *
 * The trie is packed once on first request and cached in memory.
 * Subsequent requests serve the cached packed string.
 *
 * @param data - Array of entries to pack (string[] or { text, score? }[])
 * @param options - Handler options
 * @returns A (req, res) handler function
 */
export function createTrieHandler(
  data: string[] | Array<{ text: string; score?: number }>,
  options?: TrieHandlerOptions,
): (req: ServerRequest, res: ServerResponse) => void {
  // Normalize string[] to entry[]
  const entries: Array<{ text: string; score?: number }> = Array.isArray(data)
    ? data.map((item) => (typeof item === 'string' ? { text: item } : item))
    : [];

  // Lazy-pack on first request
  let cached: string | null = null;

  const cacheControl = options?.cacheControl !== undefined
    ? options.cacheControl
    : 'public, max-age=3600';

  const extraHeaders = options?.headers ?? {};

  return (_req: ServerRequest, res: ServerResponse) => {
    if (!cached) {
      cached = packTrie(entries, options);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    };

    if (cacheControl !== null) {
      headers['Cache-Control'] = cacheControl;
    }

    if (res.writeHead) {
      res.writeHead(200, headers);
    } else if (res.setHeader) {
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
      if (res.statusCode !== undefined) {
        res.statusCode = 200;
      }
    }

    res.end(cached);
  };
}

/**
 * Create a Web API Response object containing the packed trie.
 *
 * Works with Next.js App Router, Cloudflare Workers, Deno, Bun, etc.
 *
 * @param data - Array of entries to pack
 * @param options - Handler options
 * @returns A Response object
 */
export function createTrieResponse(
  data: string[] | Array<{ text: string; score?: number }>,
  options?: TrieHandlerOptions,
): Response {
  const entries: Array<{ text: string; score?: number }> = Array.isArray(data)
    ? data.map((item) => (typeof item === 'string' ? { text: item } : item))
    : [];

  const packed = packTrie(entries, options);

  const cacheControl = options?.cacheControl !== undefined
    ? options.cacheControl
    : 'public, max-age=3600';

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    ...(options?.headers ?? {}),
  };

  if (cacheControl !== null) {
    headers['Cache-Control'] = cacheControl;
  }

  return new Response(packed, { headers });
}
