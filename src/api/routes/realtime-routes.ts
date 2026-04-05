/**
 * OpenAI Realtime API routes — WebRTC SDP exchange + session management.
 *
 * POST /api/realtime/start  — SDP exchange, returns answer + tool defs
 * POST /api/realtime/stop   — Mark session stopped
 * GET  /api/realtime/sessions — List active sessions
 * GET  /api/realtime/config   — Check configuration status
 */

import type * as http from 'node:http';
import { jsonResponse, parseJsonBody } from './helpers.js';
import type { RouteContext } from './types.js';
import { LAB_TOOLS, LAB_SYSTEM_PROMPT, TOOL_ENDPOINT_MAP } from '../realtime-tool-defs.js';

export async function handleRealtimeRoutes(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  url: string,
): Promise<boolean> {
  const { realtimeService, logger } = ctx;

  // POST /api/realtime/start
  if (method === 'POST' && (url === '/api/realtime/start' || url.startsWith('/api/realtime/start?'))) {
    if (!realtimeService) {
      jsonResponse(res, 503, { error: 'OpenAI Realtime not configured. Set OPENAI_API_KEY.' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const sdpOffer = body.sdpOffer as string;
      if (!sdpOffer) {
        jsonResponse(res, 400, { error: 'sdpOffer is required' });
        return true;
      }

      const result = await realtimeService.startSession({
        sdpOffer,
        model: (body.model as string) || undefined,
        voice: (body.voice as string) || undefined,
        systemPrompt: (body.systemPrompt as string) || undefined,
        chatId: (body.chatId as string) || undefined,
        botName: (body.botName as string) || undefined,
        temperature: body.temperature as number | undefined,
        maxTokens: body.maxTokens as number | undefined,
      });

      // Return SDP answer + tool definitions for browser to inject via data channel
      jsonResponse(res, 200, {
        ...result,
        tools: LAB_TOOLS,
        toolEndpoints: TOOL_ENDPOINT_MAP,
        systemPrompt: (body.systemPrompt as string) || LAB_SYSTEM_PROMPT,
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      logger.error({ err }, 'Realtime start error');
      jsonResponse(res, status, { error: err.message });
    }
    return true;
  }

  // POST /api/realtime/stop
  if (method === 'POST' && (url === '/api/realtime/stop' || url.startsWith('/api/realtime/stop?'))) {
    if (!realtimeService) {
      jsonResponse(res, 503, { error: 'OpenAI Realtime not configured' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId as string;
      if (!sessionId) {
        jsonResponse(res, 400, { error: 'sessionId is required' });
        return true;
      }
      await realtimeService.stopSession(sessionId);
      jsonResponse(res, 200, { success: true });
    } catch (err: any) {
      logger.error({ err }, 'Realtime stop error');
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // GET /api/realtime/sessions
  if (method === 'GET' && url === '/api/realtime/sessions') {
    if (!realtimeService) {
      jsonResponse(res, 200, { sessions: [], configured: false });
      return true;
    }
    jsonResponse(res, 200, {
      sessions: realtimeService.listSessions(),
      configured: true,
    });
    return true;
  }

  // GET /api/realtime/config
  if (method === 'GET' && url === '/api/realtime/config') {
    jsonResponse(res, 200, {
      configured: realtimeService?.isConfigured() ?? false,
      model: 'gpt-realtime-mini',
      tools: LAB_TOOLS.length,
      hasLabManager: !!process.env.LAB_MANAGER_URL,
    });
    return true;
  }

  return false;
}
