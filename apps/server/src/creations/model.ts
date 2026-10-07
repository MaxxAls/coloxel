/** Sends a prompt to the model and returns its raw text answer. Throws on any failure. */
export type RecipeModel = (prompt: string) => Promise<string>;

const API_URL = 'https://api.anthropic.com/v1/messages';

export function anthropicModel(apiKey: string, model: string): RecipeModel {
  return async (prompt) => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`model API answered ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('model API returned no text');
    return text;
  };
}

/** Model from ANTHROPIC_API_KEY and GENERATOR_MODEL, or null when not configured. */
export function modelFromEnv(): RecipeModel | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.GENERATOR_MODEL?.trim();
  return key && model ? anthropicModel(key, model) : null;
}
