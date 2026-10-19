// OpenAI access. The API key never leaves the server.
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'
import { config } from '../config'
import { HttpError } from '../errors'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!config.openaiApiKey) {
    throw new HttpError(503, 'חיבור ה-AI לא הוגדר. יש להוסיף OPENAI_API_KEY בהגדרות השרת.', 'ai_not_configured')
  }
  client ??= new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl, maxRetries: 2, timeout: 90_000 })
  return client
}

export interface AiCallInput<S extends z.ZodType> {
  instructions: string
  input: { role: 'user' | 'assistant'; content: string }[]
  schema: S
  schemaName: string
}

/** Calls the model with a strict JSON schema and returns the parsed, validated result. */
export async function callStructured<S extends z.ZodType>(args: AiCallInput<S>): Promise<z.infer<S>> {
  const openai = getClient()
  try {
    const response = await openai.responses.parse({
      model: config.openaiModel,
      instructions: args.instructions,
      input: args.input,
      text: { format: zodTextFormat(args.schema, args.schemaName) },
      store: false,
    })
    if (!response.output_parsed) throw new HttpError(502, 'ה-AI לא החזיר תשובה תקינה. נסו שוב.', 'ai_empty')
    return response.output_parsed as z.infer<S>
  } catch (e) {
    throw mapAiError(e)
  }
}

function mapAiError(e: unknown): Error {
  if (e instanceof HttpError) return e
  if (e instanceof OpenAI.RateLimitError) {
    const code = (e.error as any)?.code ?? (e as any).code
    if (code === 'insufficient_quota') return new HttpError(402, 'נגמרה יתרת השימוש בחשבון OpenAI. יש לבדוק חיוב בחשבון.', 'ai_quota')
    return new HttpError(429, 'ה-AI עמוס כרגע (הגבלת שימוש). נסו שוב בעוד רגע.', 'ai_rate_limited')
  }
  if (e instanceof OpenAI.AuthenticationError) return new HttpError(503, 'מפתח ה-API של OpenAI לא תקין. יש לעדכן את OPENAI_API_KEY.', 'ai_auth')
  if (e instanceof OpenAI.NotFoundError) return new HttpError(503, `המודל "${config.openaiModel}" לא זמין בחשבון. יש לעדכן את OPENAI_MODEL.`, 'ai_model')
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new HttpError(504, 'ה-AI לא הגיב בזמן. נסו שוב.', 'ai_timeout')
  if (e instanceof OpenAI.APIConnectionError) return new HttpError(502, 'אין חיבור לשירות ה-AI. נסו שוב.', 'ai_connection')
  if (e instanceof OpenAI.APIError) return new HttpError(502, `שגיאה משירות ה-AI (${e.status ?? '?'}). נסו שוב.`, 'ai_error')
  console.error('[ai] unexpected error', e)
  return new HttpError(502, 'שגיאה לא צפויה בבקשת ה-AI', 'ai_error')
}
