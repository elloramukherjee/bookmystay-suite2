import { GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type Part } from '@google/genai';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * The only module that talks to Google Gemini. Everything else depends on this small interface, so the
 * model, SDK or provider can change without touching business logic — and tests mock the SDK here.
 *
 * Server-side only: the API key never leaves the backend.
 */

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface LlmTurn {
  role: 'user' | 'model';
  text: string;
}

export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ReplyResult {
  text: string;
  toolCalls: ExecutedToolCall[];
  latencyMs: number;
  model: string;
}

export class GeminiUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: 'not_configured' | 'timeout' | 'api_error' | 'empty_response',
  ) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) throw new GeminiUnavailableError('GEMINI_API_KEY is not configured', 'not_configured');
  client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

export const isGeminiConfigured = () => Boolean(env.GEMINI_API_KEY);

const MAX_TOOL_ROUNDS = 4;
/** WhatsApp-fast: beyond this (GEMINI_TIMEOUT_MS, default 12s) the guest gets a holding reply and staff are pulled in. */
export const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 900;

/** 429 / 5xx from Google are usually momentary; anything else (bad key, unknown model) is not retried. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return /"code":\s*(429|5\d\d)|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(String((err as Error)?.message ?? ''));
}

/**
 * One receptionist turn with function calling. The model may call tools (availability, service requests,
 * escalation); each call is executed against our database and the result fed back, up to a bounded number
 * of rounds, before the final text answer.
 */
export async function generateReceptionistReply(opts: {
  systemInstruction: string;
  history: LlmTurn[];
  tools: LlmTool[];
  handleTool: ToolHandler;
  timeoutMs?: number;
}): Promise<ReplyResult> {
  const ai = getClient();
  const model = env.GEMINI_MODEL;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const thinkingConfig = env.GEMINI_THINKING_LEVEL ? { thinkingLevel: ThinkingLevel[env.GEMINI_THINKING_LEVEL] } : undefined;

  const contents: Content[] = opts.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  const executed: ExecutedToolCall[] = [];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const request = (useModel: string) =>
        ai.models.generateContent({
          model: useModel,
          contents,
          config: {
            systemInstruction: opts.systemInstruction,
            tools: opts.tools.length
              ? [{ functionDeclarations: opts.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
              : undefined,
            temperature: 0.3,
            // Generous: "thinking" models spend output tokens on reasoning before the reply. Reply length is
            // governed by the prompt; a truncated reply is rejected below rather than sent.
            maxOutputTokens: 4096,
            abortSignal: controller.signal,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        });
      let response;
      try {
        try {
          response = await request(model);
        } catch (err) {
          // One quick retry for transient overload/rate limiting — on the fallback model if configured —
          // still inside the overall deadline.
          if (controller.signal.aborted || !isTransient(err)) throw err;
          const retryModel = env.GEMINI_FALLBACK_MODEL ?? model;
          logger.warn({ model, retryModel }, 'Gemini overloaded; retrying once');
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          response = await request(retryModel);
        }
      } catch (err) {
        if (controller.signal.aborted) throw new GeminiUnavailableError('Gemini timed out', 'timeout');
        logger.error({ err: { message: (err as Error).message } }, 'Gemini API error');
        throw new GeminiUnavailableError('Gemini request failed', 'api_error');
      }

      const calls: FunctionCall[] = response.functionCalls ?? [];
      if (calls.length && round < MAX_TOOL_ROUNDS) {
        const modelParts: Part[] = response.candidates?.[0]?.content?.parts ?? calls.map((c) => ({ functionCall: c }));
        contents.push({ role: 'model', parts: modelParts });
        const responses: Part[] = [];
        for (const call of calls) {
          const name = call.name ?? 'unknown';
          const args = (call.args ?? {}) as Record<string, unknown>;
          let result: Record<string, unknown>;
          try {
            result = await opts.handleTool(name, args);
          } catch (err) {
            logger.warn({ tool: name, err: { message: (err as Error).message } }, 'Tool execution failed');
            result = { ok: false, error: 'The hotel system could not complete this. Offer to connect the guest with staff.' };
          }
          executed.push({ name, args, result });
          responses.push({ functionResponse: { id: call.id, name, response: result } });
        }
        contents.push({ role: 'user', parts: responses });
        continue;
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        // MAX_TOKENS, SAFETY, RECITATION…: a cut-off or filtered answer could state half a fact — never send it.
        logger.warn({ finishReason, model }, 'Gemini reply not complete; not sending it');
        throw new GeminiUnavailableError(`Gemini finished with ${finishReason}`, 'empty_response');
      }
      const text = toChatFormatting(response.text ?? '');
      if (!text) throw new GeminiUnavailableError('Gemini returned an empty response', 'empty_response');
      return { text, toolCalls: executed, latencyMs: Date.now() - started, model };
    }
    throw new GeminiUnavailableError('Too many tool rounds', 'empty_response');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat channels aren't Markdown: WhatsApp uses *bold* and _italic_, and the web chat shows plain text.
 * Normalise the common Markdown the model produces.
 */
export function toChatFormatting(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Test hook: drop the cached client (e.g. after changing env in a test). */
export function resetGeminiClient(): void {
  client = null;
}
