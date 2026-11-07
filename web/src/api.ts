import {
  AgentEvent,
  GenerateDishResponse,
  GenerateLogoResponse,
  GenerateMenuCardResponse,
  InterviewAnswer,
  Prediction,
  Resident,
  Restaurant,
  type AgentChatRequest,
  type AgentOptimizeRequest,
  type AskResidentRequest,
  type GenerateDishRequest,
  type GenerateLogoRequest,
  type GenerateMenuCardRequest,
  type SimulateRequest,
} from '@mise/shared'
import { z } from 'zod'

/** One typed function per endpoint. Every response is validated with its contract schema. */

async function request<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`)
  return schema.parse(await res.json())
}

const post = <S extends z.ZodType>(schema: S, path: string, body: unknown, signal?: AbortSignal) =>
  request(schema, path, { method: 'POST', body: JSON.stringify(body), signal })

/** POST an SSE endpoint and call onEvent for each AgentEvent. Resolves when the stream ends. */
async function stream(path: string, body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) onEvent(AgentEvent.parse(JSON.parse(data)))
    }
  }
}

export const api = {
  agentChat: (body: AgentChatRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) =>
    stream('/api/agent/chat', body, onEvent, signal),

  agentOptimize: (body: AgentOptimizeRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) =>
    stream('/api/agent/optimize', body, onEvent, signal),

  generateDish: (body: GenerateDishRequest, signal?: AbortSignal) =>
    post(GenerateDishResponse, '/api/generate/dish', body, signal),

  generateLogo: (body: GenerateLogoRequest, signal?: AbortSignal) =>
    post(GenerateLogoResponse, '/api/generate/logo', body, signal),

  generateMenuCard: (body: GenerateMenuCardRequest, signal?: AbortSignal) =>
    post(GenerateMenuCardResponse, '/api/generate/menu-card', body, signal),

  cityRestaurants: (signal?: AbortSignal) => request(z.array(Restaurant), '/api/city/restaurants', { signal }),

  cityResidents: (sample: number, signal?: AbortSignal) =>
    request(z.array(Resident), `/api/city/residents?sample=${sample}`, { signal }),

  simulate: (body: SimulateRequest, signal?: AbortSignal) => post(Prediction, '/api/simulate', body, signal),

  askResident: (id: string, body: AskResidentRequest, signal?: AbortSignal) =>
    post(InterviewAnswer, `/api/residents/${encodeURIComponent(id)}/ask`, body, signal),
}
