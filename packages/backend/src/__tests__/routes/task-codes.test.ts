import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock all dependencies before importing app
vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      employees: {
        findFirst: vi.fn(),
      },
      taskCodes: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      taskCodeRates: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
  },
  schema: {
    employees: {},
    taskCodes: {},
    taskCodeRates: {},
  },
}));

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

// Mock JWT verification
vi.mock('../../utils/jwt.js', () => ({
  signToken: vi.fn(() => 'mock-jwt-token'),
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-supervisor-token') {
      return { sessionId: 'session-1', employeeId: 'emp-supervisor' };
    }
    if (token === 'valid-employee-token') {
      return { sessionId: 'session-2', employeeId: 'emp-regular' };
    }
    throw new Error('Invalid token');
  }),
}));

import { db } from '../../db/index.js';
import app from '../../app.js';

describe('Task Codes API Routes', () => {
  beforeEach(() => {
    // Reset all mocks including their implementation queues
    vi.mocked(db.query.employees.findFirst).mockReset();
    vi.mocked(db.query.taskCodes.findFirst).mockReset();
    vi.mocked(db.query.taskCodes.findMany).mockReset();
    vi.mocked(db.query.taskCodeRates.findFirst).mockReset();
    vi.mocked(db.query.taskCodeRates.findMany).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.update).mockReset();
  });

  const supervisorUser = {
    id: 'emp-supervisor',
    name: 'Test Supervisor',
    email: 'supervisor@test.com',
    isSupervisor: true,
    status: 'active',
    dateOfBirth: '1990-01-01',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const regularUser = {
    id: 'emp-regular',
    name: 'Test Employee',
    email: 'employee@test.com',
    isSupervisor: false,
    status: 'active',
    dateOfBirth: '2008-01-01',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('GET /api/task-codes', () => {
    it('should return task codes for authenticated user', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);

      const mockTaskCodes = [
        {
          id: '1',
          code: 'F1',
          name: 'Field Work',
          description: null,
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'none',
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          minAgeAllowed: 12,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(db.query.taskCodes.findMany).mockResolvedValueOnce(mockTaskCodes as never);
      vi.mocked(db.query.taskCodeRates.findFirst).mockResolvedValueOnce({
        id: 'rate-1',
        taskCodeId: '1',
        hourlyRate: '8.00',
        effectiveDate: '2024-01-01',
        justificationNotes: null,
        createdAt: new Date(),
      } as never);

      const response = await request(app)
        .get('/api/task-codes')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(200);
      expect(response.body.taskCodes).toBeDefined();
      expect(response.body.taskCodes).toHaveLength(1);
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).get('/api/task-codes');

      expect(response.status).toBe(401);
    });

    it('should filter by isAgricultural', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findMany).mockResolvedValueOnce([] as never);

      const response = await request(app)
        .get('/api/task-codes?isAgricultural=true')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(200);
      expect(db.query.taskCodes.findMany).toHaveBeenCalled();
    });
  });

  describe('GET /api/task-codes/:id', () => {
    it('should return task code with rate history', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);

      const mockTaskCode = {
        id: '1',
        code: 'F1',
        name: 'Field Work',
        description: null,
        isAgricultural: true,
        isHazardous: false,
        supervisorRequired: 'none',
        soloCashHandling: false,
        drivingRequired: false,
        powerMachinery: false,
        minAgeAllowed: 12,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        rates: [
          {
            id: 'rate-1',
            taskCodeId: '1',
            hourlyRate: '8.00',
            effectiveDate: '2024-01-01',
            justificationNotes: 'Initial rate',
            createdAt: new Date(),
          },
        ],
      };

      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(mockTaskCode as never);
      vi.mocked(db.query.taskCodeRates.findFirst).mockResolvedValueOnce({
        id: 'rate-1',
        taskCodeId: '1',
        hourlyRate: '8.00',
        effectiveDate: '2024-01-01',
        justificationNotes: 'Initial rate',
        createdAt: new Date(),
      } as never);

      const response = await request(app)
        .get('/api/task-codes/1')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(200);
      expect(response.body.taskCode).toBeDefined();
      expect(response.body.taskCode.code).toBe('F1');
      expect(response.body.taskCode.rateHistory).toHaveLength(1);
    });

    it('should return 404 for non-existent task code', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .get('/api/task-codes/non-existent')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/task-codes', () => {
    it('should create task code for supervisor', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      // Check for duplicate code
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(null as never);

      const newTaskCode = {
        id: '1',
        code: 'T1',
        name: 'Test Task',
        description: null,
        isAgricultural: true,
        isHazardous: false,
        supervisorRequired: 'none',
        soloCashHandling: false,
        drivingRequired: false,
        powerMachinery: false,
        minAgeAllowed: 12,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([newTaskCode]),
        }),
      } as never);

      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([
            {
              id: 'rate-1',
              taskCodeId: '1',
              hourlyRate: '8.00',
              effectiveDate: new Date().toISOString().split('T')[0],
              justificationNotes: null,
              createdAt: new Date(),
            },
          ]),
        }),
      } as never);

      const response = await request(app)
        .post('/api/task-codes')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({
          code: 'T1',
          name: 'Test Task',
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'none',
          minAgeAllowed: 12,
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          initialRate: 8.0,
          rateEffectiveDate: new Date().toISOString().split('T')[0],
        });

      expect(response.status).toBe(201);
      expect(response.body.taskCode).toBeDefined();
    });

    it('should return 403 for non-supervisor', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(regularUser as never);

      const response = await request(app)
        .post('/api/task-codes')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          code: 'T1',
          name: 'Test Task',
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'none',
          minAgeAllowed: 12,
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          initialRate: 8.0,
          rateEffectiveDate: new Date().toISOString().split('T')[0],
        });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid data', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);

      const response = await request(app)
        .post('/api/task-codes')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({
          code: '', // Invalid: empty code
          name: 'Test',
          isAgricultural: true,
        });

      expect(response.status).toBe(400);
    });

    it('should return 409 for duplicate code', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce({
        id: '1',
        code: 'T1',
      } as never);

      const response = await request(app)
        .post('/api/task-codes')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({
          code: 'T1',
          name: 'Test Task',
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'none',
          minAgeAllowed: 12,
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          initialRate: 8.0,
          rateEffectiveDate: new Date().toISOString().split('T')[0],
        });

      expect(response.status).toBe(409);
    });
  });

  describe('PATCH /api/task-codes/:id', () => {
    it('should update task code for supervisor', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);

      const existingTaskCode = {
        id: '1',
        code: 'F1',
        name: 'Field Work',
        description: null,
        isAgricultural: true,
        isHazardous: false,
        supervisorRequired: 'none',
        soloCashHandling: false,
        drivingRequired: false,
        powerMachinery: false,
        minAgeAllowed: 12,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(existingTaskCode as never);

      const updatedTaskCode = {
        ...existingTaskCode,
        name: 'Updated Field Work',
        updatedAt: new Date(),
      };

      vi.mocked(db.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([updatedTaskCode]),
          }),
        }),
      } as never);

      vi.mocked(db.query.taskCodeRates.findFirst).mockResolvedValueOnce({
        id: 'rate-1',
        taskCodeId: '1',
        hourlyRate: '8.00',
        effectiveDate: '2024-01-01',
        justificationNotes: null,
        createdAt: new Date(),
      } as never);

      const response = await request(app)
        .patch('/api/task-codes/1')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({ name: 'Updated Field Work' });

      expect(response.status).toBe(200);
      expect(response.body.taskCode.name).toBe('Updated Field Work');
    });

    it('should return 403 for non-supervisor', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(regularUser as never);

      const response = await request(app)
        .patch('/api/task-codes/1')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({ name: 'Updated' });

      expect(response.status).toBe(403);
    });

    it('should return 404 for non-existent task code', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .patch('/api/task-codes/non-existent')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/task-codes/:id/rates', () => {
    it('should add rate for supervisor', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce({
        id: '1',
        code: 'F1',
      } as never);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0]!;

      const newRate = {
        id: 'rate-2',
        taskCodeId: '1',
        hourlyRate: '10.00',
        effectiveDate: tomorrowStr,
        justificationNotes: 'Rate increase',
        createdAt: new Date(),
      };

      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([newRate]),
        }),
      } as never);

      const response = await request(app)
        .post('/api/task-codes/1/rates')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({
          hourlyRate: 10.0,
          effectiveDate: tomorrowStr,
          justificationNotes: 'Rate increase',
        });

      expect(response.status).toBe(201);
      expect(response.body.rate).toBeDefined();
    });

    it('should return 400 for past effective date', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce({
        id: '1',
        code: 'F1',
      } as never);

      const response = await request(app)
        .post('/api/task-codes/1/rates')
        .set('Authorization', 'Bearer valid-supervisor-token')
        .send({
          hourlyRate: 10.0,
          effectiveDate: '2020-01-01',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/task-codes/:id/rates', () => {
    it('should return rate history', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce({
        id: '1',
        code: 'F1',
      } as never);

      const rates = [
        {
          id: 'rate-2',
          taskCodeId: '1',
          hourlyRate: '10.00',
          effectiveDate: '2024-06-01',
          justificationNotes: 'Rate increase',
          createdAt: new Date(),
        },
        {
          id: 'rate-1',
          taskCodeId: '1',
          hourlyRate: '8.00',
          effectiveDate: '2024-01-01',
          justificationNotes: 'Initial',
          createdAt: new Date(),
        },
      ];

      vi.mocked(db.query.taskCodeRates.findMany).mockResolvedValueOnce(rates as never);

      const response = await request(app)
        .get('/api/task-codes/1/rates')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(200);
      expect(response.body.rates).toHaveLength(2);
    });
  });

  describe('GET /api/task-codes/for-employee/:employeeId', () => {
    it('should return age-filtered task codes', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(supervisorUser as never);

      const mockEmployee = {
        id: 'emp-young',
        dateOfBirth: '2010-01-15',
        status: 'active',
      };

      // First call is for auth, second is for getTaskCodesForEmployee
      vi.mocked(db.query.employees.findFirst)
        .mockResolvedValueOnce(supervisorUser as never)
        .mockResolvedValueOnce(mockEmployee as never);

      const mockTaskCodes = [
        {
          id: '1',
          code: 'F1',
          name: 'Field Work',
          minAgeAllowed: 12,
          isActive: true,
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'none',
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(db.query.taskCodes.findMany).mockResolvedValueOnce(mockTaskCodes as never);
      vi.mocked(db.query.taskCodeRates.findFirst).mockResolvedValueOnce({
        id: 'rate-1',
        taskCodeId: '1',
        hourlyRate: '8.00',
        effectiveDate: '2024-01-01',
        justificationNotes: null,
        createdAt: new Date(),
      } as never);

      const response = await request(app)
        .get('/api/task-codes/for-employee/emp-young')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(200);
      expect(response.body.taskCodes).toBeDefined();
    });

    it('should return 404 for non-existent employee', async () => {
      vi.mocked(db.query.employees.findFirst)
        .mockResolvedValueOnce(supervisorUser as never)
        .mockResolvedValueOnce(null as never);

      const response = await request(app)
        .get('/api/task-codes/for-employee/non-existent')
        .set('Authorization', 'Bearer valid-supervisor-token');

      expect(response.status).toBe(404);
    });
  });
});
