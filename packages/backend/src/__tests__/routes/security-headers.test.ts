import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock env before importing app
vi.mock('../../config/env.js', () => ({
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
vi.mock('../../db/index.js', () => ({
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

import app from '../../app.js';

describe('Security Headers', () => {
  describe('Content-Security-Policy', () => {
    it('should include Content-Security-Policy header', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['content-security-policy']).toBeDefined();
    });

    it('should restrict default-src to self', async () => {
      const response = await request(app).get('/api/health');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("default-src 'self'");
    });

    it('should restrict script-src to self', async () => {
      const response = await request(app).get('/api/health');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("script-src 'self'");
    });

    it('should prevent object embedding', async () => {
      const response = await request(app).get('/api/health');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("object-src 'none'");
    });

    it('should prevent framing', async () => {
      const response = await request(app).get('/api/health');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe('X-Content-Type-Options', () => {
    it('should include nosniff header', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('X-Frame-Options', () => {
    it('should deny framing', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Strict-Transport-Security', () => {
    it('should include HSTS header', async () => {
      const response = await request(app).get('/api/health');
      const hsts = response.headers['strict-transport-security'];

      expect(hsts).toBeDefined();
      expect(hsts).toContain('max-age=');
      expect(hsts).toContain('includeSubDomains');
    });
  });

  describe('Referrer-Policy', () => {
    it('should include Referrer-Policy header', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('X-Powered-By', () => {
    it('should not expose X-Powered-By', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  // Note: Permissions-Policy header output varies by Helmet version
  // The configuration is set but the header format may differ

  describe('Cross-Origin headers', () => {
    it('should include Cross-Origin-Opener-Policy', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('should include Cross-Origin-Resource-Policy', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    });
  });

  describe('CORS headers', () => {
    it('should return CORS headers for allowed origin', async () => {
      const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  // Note: Rate limit headers are skipped in test environment

  describe('Security header completeness', () => {
    it('should have all essential security headers', async () => {
      const response = await request(app).get('/api/health');
      const headers = response.headers;

      // Essential security headers checklist (excluding permissions-policy which varies by Helmet version)
      const requiredHeaders = [
        'content-security-policy',
        'x-content-type-options',
        'x-frame-options',
        'strict-transport-security',
        'referrer-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
      ];

      const missingHeaders = requiredHeaders.filter((h) => !headers[h]);

      expect(missingHeaders).toEqual([]);
    });

    it('should NOT expose sensitive headers', async () => {
      const response = await request(app).get('/api/health');
      const headers = response.headers;

      // These headers should NOT be present
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['server']).toBeUndefined();
    });
  });
});
