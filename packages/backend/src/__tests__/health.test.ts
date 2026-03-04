import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock env before importing app
vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    FRONTEND_URL: 'http://localhost:5173',
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    JWT_EXPIRES_IN: '7d',
    POSTMARK_API_KEY: undefined,
    EMAIL_FROM: 'test@test.com',
    PASSWORD_RESET_EXPIRES_HOURS: 24,
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MINUTES: 30,
    APP_URL: 'http://localhost:5173',
  },
}));

// Mock database to avoid needing DATABASE_URL
vi.mock('../db/index.js', () => ({
  db: {
    query: {
      employees: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })),
  },
  schema: {
    employees: {},
  },
}));

import app from '../app.js';

describe('GET /api/health', () => {
  it('returns 200 status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });

  it('returns correct response shape', async () => {
    const response = await request(app).get('/api/health');
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('returns valid ISO8601 timestamp', async () => {
    const response = await request(app).get('/api/health');
    const timestamp = response.body.timestamp;
    const parsed = new Date(timestamp);
    expect(parsed.toISOString()).toBe(timestamp);
  });
});
