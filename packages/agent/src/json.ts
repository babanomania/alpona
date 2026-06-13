/** Extracts the first JSON object from a model response. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model response');
  return JSON.parse(text.slice(start, end + 1));
}
