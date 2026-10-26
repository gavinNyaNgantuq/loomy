import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('health (F0)', () => {
  it('GET /api/v1/health → 200 dengan bentuk tetap, tanpa bocor credential', async () => {
    const res = await request(createApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('loomy-api');
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(['up', 'down']).toContain(res.body.db);
    const raw = JSON.stringify(res.body).toLowerCase();
    for (const secret of ['password', 'secret', 'loomy', '127.0.0.1', '3306']) {
      // 'loomy' hanya boleh muncul sebagai service name, bukan kredensial:
      if (secret === 'loomy') continue;
      expect(raw).not.toContain(secret);
    }
  });
  it('route tak dikenal → 404', async () => {
    const res = await request(createApp()).get('/api/v1/tidak-ada');
    expect(res.status).toBe(404);
  });
});
