/**
 * Lab tool proxy routes — browser function calls to lab-manager.
 *
 * When OpenAI Realtime emits a function_call via the WebRTC data channel,
 * the browser calls these endpoints to execute the tool, then sends the
 * result back to OpenAI via the data channel.
 *
 * All endpoints proxy to lab-manager at LAB_MANAGER_URL (default: http://localhost:8000).
 */

import type * as http from 'node:http';
import { jsonResponse, parseJsonBody } from './helpers.js';
import type { RouteContext } from './types.js';
import { proxyFetch } from '../../utils/http.js';

function labManagerUrl(): string {
  return (process.env.LAB_MANAGER_URL || 'http://localhost:8000').replace(/\/$/, '');
}

function labManagerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/json' };
  const key = process.env.LAB_MANAGER_API_KEY;
  if (key) h['X-API-Key'] = key;
  return h;
}

async function proxyGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${labManagerUrl()}/api/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const resp = await proxyFetch(url.toString(), { headers: labManagerHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`lab-manager ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function proxyPost(path: string, body?: unknown): Promise<unknown> {
  const resp = await proxyFetch(`${labManagerUrl()}/api/v1${path}`, {
    method: 'POST',
    headers: { ...labManagerHeaders(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`lab-manager ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export async function handleLabToolRoutes(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  url: string,
): Promise<boolean> {
  if (!url.startsWith('/api/lab/')) return false;

  const { logger } = ctx;
  const parsed = new URL(url, `http://${req.headers.host || 'localhost'}`);
  const path = parsed.pathname;

  try {
    // GET /api/lab/summary
    if (method === 'GET' && path === '/api/lab/summary') {
      const data = await proxyGet('/jarvis/summary');
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/alerts?severity=...
    if (method === 'GET' && path === '/api/lab/alerts') {
      const params: Record<string, string> = { resolved: 'false' };
      const severity = parsed.searchParams.get('severity');
      if (severity) params.severity = severity;
      const data = await proxyGet('/alerts', params);
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/search?query=...
    if (method === 'GET' && path === '/api/lab/search') {
      const query = parsed.searchParams.get('query') || parsed.searchParams.get('q') || '';
      if (!query) {
        jsonResponse(res, 400, { error: 'query parameter required' });
        return true;
      }
      const data = await proxyGet('/search', { q: query });
      jsonResponse(res, 200, data);
      return true;
    }

    // POST /api/lab/ask {question}
    if (method === 'POST' && path === '/api/lab/ask') {
      const body = await parseJsonBody(req);
      const question = body.question as string;
      if (!question) {
        jsonResponse(res, 400, { error: 'question field required' });
        return true;
      }
      const data = await proxyPost('/ask', { question });
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/inventory?status=...&location=...
    if (method === 'GET' && path === '/api/lab/inventory') {
      const params: Record<string, string> = { page_size: '20' };
      const status = parsed.searchParams.get('status');
      const location = parsed.searchParams.get('location');
      if (status) params.status = status;
      if (location) params.location = location;
      const data = await proxyGet('/inventory', params);
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/low-stock
    if (method === 'GET' && path === '/api/lab/low-stock') {
      const data = await proxyGet('/inventory/low-stock');
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/devices?status=...
    if (method === 'GET' && path === '/api/lab/devices') {
      const params: Record<string, string> = {};
      const status = parsed.searchParams.get('status');
      if (status) params.status = status;
      const data = await proxyGet('/devices', params);
      jsonResponse(res, 200, data);
      return true;
    }

    // GET /api/lab/orders?status=...
    if (method === 'GET' && path === '/api/lab/orders') {
      const params: Record<string, string> = {};
      const status = parsed.searchParams.get('status');
      if (status) params.status = status;
      const data = await proxyGet('/orders', params);
      jsonResponse(res, 200, data);
      return true;
    }
  } catch (err: any) {
    logger.error({ err, path }, 'Lab tool proxy error');
    jsonResponse(res, 502, { error: `Lab manager unavailable: ${err.message}` });
    return true;
  }

  return false;
}
