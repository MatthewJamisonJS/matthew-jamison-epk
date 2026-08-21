import type { Ctx, Env } from '../types';

export type Params = Record<string, string>;
export type Handler = (
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Params,
) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/**
 * Hand-rolled router. No framework: the whole surface is nine routes and a
 * dependency here would outweigh the code it replaces.
 *
 * Patterns use `:name` for a single path segment. No wildcards, no regex --
 * an unmatched request is a generic 404, never a partial match.
 */
export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: Handler) {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler) {
    return this.add('POST', pattern, handler);
  }
  head(pattern: string, handler: Handler) {
    return this.add('HEAD', pattern, handler);
  }
  options(pattern: string, handler: Handler) {
    return this.add('OPTIONS', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Params } | null {
    const parts = split(pathname);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(':')) {
          if (part.length === 0) {
            ok = false;
            break;
          }
          params[seg.slice(1)] = part;
        } else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0).map(decodeSegment);
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // A malformed percent-escape is not a path we serve.
    return s;
  }
}
