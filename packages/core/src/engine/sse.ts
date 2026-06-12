import type { GenerationEvent } from '../protocol.js';

/**
 * Parses a `text/event-stream` response body into typed generation
 * events. Hand-rolled because EventSource cannot POST a body.
 */
export async function* readGenerationStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by a blank line.
      for (;;) {
        const sep = buffer.indexOf('\n\n');
        if (sep === -1) break;
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const data = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        yield JSON.parse(data) as GenerationEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
