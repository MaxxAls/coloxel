import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/index';

describe('server', () => {
  it('answers health', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true });
  });

  it('renders a seed object to PNG', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/seeds/0.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });

  it('404s on an unknown seed', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/seeds/99.png' });
    expect(res.statusCode).toBe(404);
  });
});
