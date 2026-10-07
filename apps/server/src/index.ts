import Fastify from 'fastify';
import { PNG } from 'pngjs';
import { SEEDS, renderSprite, type Sprite } from '@coloxel/render';

export function spriteToPng(sprite: Sprite): Buffer {
  const png = new PNG({ width: sprite.width, height: sprite.height });
  png.data = Buffer.from(sprite.data);
  return PNG.sync.write(png);
}

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ ok: true }));

  // Server-side render of the example objects. Phase 1 replaces this with
  // /api/items/:id.png backed by PostgreSQL (see docs/phase-1-alpha-solo.md).
  app.get<{ Params: { index: string } }>('/api/seeds/:index.png', async (req, reply) => {
    const seed = SEEDS[Number(req.params.index)];
    if (!seed) return reply.code(404).send({ error: 'Objet introuvable' });
    return reply.type('image/png').send(spriteToPng(renderSprite(seed.parts)));
  });

  return app;
}
