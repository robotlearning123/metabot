/**
 * OpenAI Realtime function calling definitions for LabClaw lab-manager.
 *
 * These tool schemas are sent to the browser, which injects them into the
 * Realtime session via data channel `session.update`. When the model calls
 * a function, the browser executes it by hitting MetaBot's /api/lab/* proxy.
 */

export const LAB_SYSTEM_PROMPT = `You are Jarvis, the AI lab assistant for Shen Lab at Harvard/MGH.
You help scientists with inventory, alerts, orders, devices, and lab operations.
Respond concisely in the same language the user speaks (Chinese or English).
When asked about lab state, use the available tools to query real data.
Keep responses to 1-3 spoken sentences. Do not use markdown or formatting.
If a tool returns JSON, summarize the key information verbally.`;

export interface RealtimeToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const LAB_TOOLS: RealtimeToolDef[] = [
  {
    type: 'function',
    name: 'lab_summary',
    description: 'Get today\'s lab summary: alerts, expiring items, pending documents, recent orders. Use when user asks "what\'s happening?" or "morning briefing".',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'lab_alerts',
    description: 'List active lab alerts (expiry, low stock, pending review). Use when user asks about alerts or problems.',
    parameters: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['critical', 'warning', 'info'],
          description: 'Filter by severity. Omit for all.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'lab_search',
    description: 'Search across all lab data: vendors, products, inventory, orders, documents. Use when user asks about a specific item.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "PBS", "antibody", "Fisher")' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'lab_ask',
    description: 'Ask a natural language question about lab data. AI queries the database. Use for complex questions like "how many items expire this month?"',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question about lab operations' },
      },
      required: ['question'],
    },
  },
  {
    type: 'function',
    name: 'lab_inventory',
    description: 'List inventory items. Use when user wants to see what\'s in stock.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['available', 'opened', 'expired', 'disposed'],
          description: 'Filter by status. Omit for all.',
        },
        location: { type: 'string', description: 'Filter by storage location.' },
      },
    },
  },
  {
    type: 'function',
    name: 'lab_low_stock',
    description: 'List items below minimum stock level. Use when user asks "what\'s running low?" or "what do we need to order?"',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'lab_devices',
    description: 'List lab devices and their status. Use when user asks about instruments or equipment.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['online', 'offline', 'error'],
          description: 'Filter by device status. Omit for all.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'lab_orders',
    description: 'List orders with optional status filter. Use when user asks about orders or deliveries.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'ordered', 'received', 'cancelled'],
          description: 'Filter by order status. Omit for all.',
        },
      },
    },
  },
];

/**
 * Map tool name to the MetaBot proxy endpoint path.
 * Browser uses this to know which URL to call for each function.
 */
export const TOOL_ENDPOINT_MAP: Record<string, { method: string; path: string }> = {
  lab_summary:   { method: 'GET',  path: '/api/lab/summary' },
  lab_alerts:    { method: 'GET',  path: '/api/lab/alerts' },
  lab_search:    { method: 'GET',  path: '/api/lab/search' },
  lab_ask:       { method: 'POST', path: '/api/lab/ask' },
  lab_inventory: { method: 'GET',  path: '/api/lab/inventory' },
  lab_low_stock: { method: 'GET',  path: '/api/lab/low-stock' },
  lab_devices:   { method: 'GET',  path: '/api/lab/devices' },
  lab_orders:    { method: 'GET',  path: '/api/lab/orders' },
};
