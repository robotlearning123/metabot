/**
 * OpenAI Realtime Voice Service — WebRTC-based real-time voice conversations
 *
 * Uses OpenAI's Realtime API for native audio processing.
 * Alternative to Volcengine RTC with higher quality but higher cost.
 *
 * Protocol: WebRTC (SDP offer/answer exchange via /v1/realtime/calls)
 * Default model: gpt-realtime-mini (cost-efficient)
 */

import * as crypto from 'node:crypto';
import type { Logger } from '../utils/logger.js';

// ---------- Types ----------

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const VALID_MODELS = ['gpt-realtime-mini', 'gpt-realtime-1.5', 'gpt-realtime'] as const;
type RealtimeModel = (typeof VALID_MODELS)[number];

const MAX_SDP_LENGTH = 65536;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_SESSIONS = 50;
const MAX_ACTIVE_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface OpenAiRealtimeSession {
  id: string;
  callId: string;
  status: 'connecting' | 'active' | 'stopped';
  createdAt: number;
  stoppedAt?: number;
  chatId?: string;
  botName?: string;
  model: string;
  voice: string;
  transcript: Array<{
    speaker: 'user' | 'assistant';
    text: string;
    timestamp: number;
  }>;
  sdpAnswer?: string;
  iceServers?: IceServer[];
}

export interface StartOpenAiRealtimeParams {
  systemPrompt?: string;
  /** Voice: alloy, ash, ballad, coral, echo, sage, shimmer, verse, cedar, marin */
  voice?: string;
  /** Model: gpt-realtime-mini (default), gpt-realtime-1.5, gpt-realtime */
  model?: string;
  /** WebRTC SDP offer from client */
  sdpOffer: string;
  chatId?: string;
  botName?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StartOpenAiRealtimeResult {
  sessionId: string;
  callId: string;
  sdpAnswer: string;
  iceServers: IceServer[];
  model: string;
  voice: string;
}

// ---------- Service ----------

export class OpenAiRealtimeService {
  private sessions = new Map<string, OpenAiRealtimeSession>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: 'openai-realtime' });
  }

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async startSession(params: StartOpenAiRealtimeParams): Promise<StartOpenAiRealtimeResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    // Enforce session limit
    const activeSessions = [...this.sessions.values()].filter(s => s.status !== 'stopped').length;
    if (activeSessions >= MAX_SESSIONS) {
      throw Object.assign(new Error(`Too many active sessions (max ${MAX_SESSIONS})`), { statusCode: 429 });
    }

    // Validate SDP offer
    if (!params.sdpOffer || typeof params.sdpOffer !== 'string') {
      throw Object.assign(new Error('sdpOffer is required'), { statusCode: 400 });
    }
    if (params.sdpOffer.length > MAX_SDP_LENGTH) {
      throw Object.assign(new Error(`sdpOffer too large (max ${MAX_SDP_LENGTH} bytes)`), { statusCode: 400 });
    }
    if (!params.sdpOffer.trimStart().startsWith('v=0')) {
      throw Object.assign(new Error('Invalid SDP offer (must start with v=0)'), { statusCode: 400 });
    }

    // Validate model
    const model = (params.model || 'gpt-realtime-mini') as RealtimeModel;
    if (!VALID_MODELS.includes(model)) {
      throw Object.assign(
        new Error(`Invalid model: ${params.model}. Valid: ${VALID_MODELS.join(', ')}`),
        { statusCode: 400 },
      );
    }

    const sessionId = crypto.randomUUID();
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const voice = params.voice || 'coral';

    this.logger.info({ sessionId, callId, model, voice }, 'Starting OpenAI Realtime session');

    // GA endpoint: POST /v1/realtime/calls?model=...
    const realtimeUrl = new URL('https://api.openai.com/v1/realtime/calls');
    realtimeUrl.searchParams.set('model', model);

    const response = await fetch(realtimeUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/sdp',
      },
      body: params.sdpOffer,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error({ status: response.status, error }, 'OpenAI Realtime API error');
      throw Object.assign(
        new Error(`Voice session failed (${response.status})`),
        { statusCode: response.status >= 500 ? 502 : response.status },
      );
    }

    const sdpAnswer = await response.text();

    const iceServers: IceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    const session: OpenAiRealtimeSession = {
      id: sessionId,
      callId,
      status: 'active',
      createdAt: Date.now(),
      chatId: params.chatId,
      botName: params.botName,
      model,
      voice,
      transcript: [],
      sdpAnswer,
      iceServers,
    };

    this.sessions.set(sessionId, session);

    this.logger.info({ sessionId, callId, model }, 'OpenAI Realtime session started');

    return { sessionId, callId, sdpAnswer, iceServers, model, voice };
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 });
    }

    // Note: WebRTC sessions end when the peer connection closes.
    // OpenAI does not expose a server-side close API for WebRTC sessions.
    // The client must close its RTCPeerConnection to terminate the session.
    session.status = 'stopped';
    session.stoppedAt = Date.now();

    this.logger.info({ sessionId, callId: session.callId }, 'OpenAI Realtime session stopped (client must close RTCPeerConnection)');
  }

  getSession(sessionId: string): OpenAiRealtimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Omit<OpenAiRealtimeSession, 'sdpAnswer'>[] {
    return Array.from(this.sessions.values()).map(({ sdpAnswer: _, ...rest }) => rest);
  }

  addTranscript(sessionId: string, speaker: 'user' | 'assistant', text: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.transcript.push({ speaker, text, timestamp: Date.now() });
    }
  }

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      // Evict stopped sessions older than maxAgeMs
      if (session.status === 'stopped' && session.stoppedAt && (now - session.stoppedAt) > maxAgeMs) {
        this.sessions.delete(id);
        evicted++;
      }
      // Evict orphaned active/connecting sessions older than MAX_ACTIVE_AGE_MS
      if (session.status !== 'stopped' && (now - session.createdAt) > MAX_ACTIVE_AGE_MS) {
        session.status = 'stopped';
        session.stoppedAt = now;
        this.sessions.delete(id);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.info({ evicted, remaining: this.sessions.size }, 'Realtime session cleanup');
    }
  }
}
