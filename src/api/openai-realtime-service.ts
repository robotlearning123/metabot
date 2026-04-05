/**
 * OpenAI Realtime Voice Service — WebRTC-based real-time voice conversations
 * 
 * Uses OpenAI's Realtime API (gpt-realtime-1.5) for native audio processing.
 * This is an alternative to Volcengine RTC with higher quality but higher cost.
 * 
 * Protocol: WebRTC (SDP offer/answer exchange)
 * Model: gpt-realtime-1.5 (default) or gpt-realtime-mini
 */

import * as crypto from 'node:crypto';
import type { Logger } from '../utils/logger.js';

// ---------- Types ----------

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
  /** WebRTC SDP answer from OpenAI */
  sdpAnswer?: string;
  /** ICE servers for WebRTC connection */
  iceServers?: RTCIceServer[];
}

export interface StartOpenAiRealtimeParams {
  /** System prompt for the AI agent */
  systemPrompt?: string;
  /** Voice to use (alloy, echo, fable, onyx, nova, shimmer, ash, sage, coral) */
  voice?: string;
  /** Model to use (gpt-realtime-1.5, gpt-realtime-mini) */
  model?: string;
  /** WebRTC SDP offer from client */
  sdpOffer: string;
  /** Claude session chatId */
  chatId?: string;
  /** Bot name */
  botName?: string;
  /** Temperature (0-1) */
  temperature?: number;
  /** Max tokens per response */
  maxTokens?: number;
}

export interface StartOpenAiRealtimeResult {
  sessionId: string;
  callId: string;
  sdpAnswer: string;
  iceServers: RTCIceServer[];
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

  /** Check if OpenAI Realtime is configured */
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  /**
   * Start a new OpenAI Realtime voice session
   * 
   * This initiates a WebRTC connection with OpenAI's Realtime API.
   * The client must provide an SDP offer, and we return an SDP answer.
   */
  async startSession(params: StartOpenAiRealtimeParams): Promise<StartOpenAiRealtimeResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const sessionId = crypto.randomUUID();
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const model = params.model || 'gpt-realtime-1.5';
    const voice = params.voice || 'alloy';

    this.logger.info({ sessionId, callId, model, voice }, 'Starting OpenAI Realtime session');

    // Call OpenAI Realtime API to get SDP answer
    const realtimeUrl = new URL('https://api.openai.com/v1/realtime');
    realtimeUrl.searchParams.set('model', model);

    const response = await fetch(realtimeUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: params.sdpOffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Realtime API error: ${response.status} ${error}`);
    }

    // Get SDP answer from response body
    const sdpAnswer = await response.text();
    
    // Extract ICE servers from response headers if available
    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' }, // Fallback STUN
    ];

    // Create session
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

    return {
      sessionId,
      callId,
      sdpAnswer,
      iceServers,
      model,
      voice,
    };
  }

  /**
   * Stop an active session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.status = 'stopped';
    session.stoppedAt = Date.now();

    this.logger.info({ sessionId, callId: session.callId }, 'OpenAI Realtime session stopped');
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): OpenAiRealtimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): OpenAiRealtimeSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Add transcript entry
   */
  addTranscript(sessionId: string, speaker: 'user' | 'assistant', text: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.transcript.push({
        speaker,
        text,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Clean up old sessions
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status === 'stopped' && session.stoppedAt && (now - session.stoppedAt) > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }
}

// Singleton instance
let service: OpenAiRealtimeService | null = null;

export function getOpenAiRealtimeService(logger: Logger): OpenAiRealtimeService {
  if (!service) {
    service = new OpenAiRealtimeService(logger);
  }
  return service;
}
