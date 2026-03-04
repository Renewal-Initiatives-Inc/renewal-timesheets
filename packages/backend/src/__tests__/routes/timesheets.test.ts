import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock all dependencies before importing app
vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      employees: {
        findFirst: vi.fn(),
      },
      timesheets: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      timesheetEntries: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      taskCodes: {
        findFirst: vi.fn(),
      },
      taskCodeRates: {
        findFirst: vi.fn(),
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
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
  schema: {
    employees: {},
    timesheets: {},
    timesheetEntries: {},
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
    if (token === 'valid-employee-token') {
      return { sessionId: 'session-1', employeeId: 'emp-1' };
    }
    if (token === 'valid-other-employee-token') {
      return { sessionId: 'session-2', employeeId: 'emp-2' };
    }
    throw new Error('Invalid token');
  }),
}));

vi.mock('../../utils/timezone.js', () => ({
  getTodayET: vi.fn(() => '2024-06-12'),
  getWeekStartDate: vi.fn(() => '2024-06-09'),
  isDefaultSchoolDay: vi.fn((date: string) => {
    const d = new Date(date + 'T00:00:00');
    const day = d.getDay();
    return day !== 0 && day !== 6;
  }),
  timeToMinutes: vi.fn((time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours! * 60 + minutes!;
  }),
}));

vi.mock('../../utils/age.js', () => ({
  calculateAge: vi.fn(() => 16),
  checkBirthdayInWeek: vi.fn(() => ({ hasBirthday: false })),
  getWeeklyAges: vi.fn(() => new Map()),
}));

import { db } from '../../db/index.js';
import app from '../../app.js';

describe('Timesheets API Routes', () => {
  beforeEach(() => {
    vi.mocked(db.query.employees.findFirst).mockReset();
    vi.mocked(db.query.timesheets.findFirst).mockReset();
    vi.mocked(db.query.timesheets.findMany).mockReset();
    vi.mocked(db.query.timesheetEntries.findFirst).mockReset();
    vi.mocked(db.query.timesheetEntries.findMany).mockReset();
    vi.mocked(db.query.taskCodes.findFirst).mockReset();
    vi.mocked(db.query.taskCodeRates.findFirst).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.update).mockReset();
    vi.mocked(db.delete).mockReset();
  });

  const testEmployee = {
    id: 'emp-1',
    name: 'Test Employee',
    email: 'employee@test.com',
    isSupervisor: false,
    status: 'active',
    dateOfBirth: '2008-01-15',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('GET /api/timesheets', () => {
    it('should return employee timesheets', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheets = [
        {
          id: 'ts-1',
          employeeId: 'emp-1',
          weekStartDate: '2024-06-09',
          status: 'open',
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          supervisorNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(db.query.timesheets.findMany)
        .mockResolvedValueOnce(mockTimesheets as never)
        .mockResolvedValueOnce(mockTimesheets as never);

      const response = await request(app)
        .get('/api/timesheets')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.timesheets).toBeDefined();
      expect(response.body.timesheets).toHaveLength(1);
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).get('/api/timesheets');

      expect(response.status).toBe(401);
    });

    it('should filter by status', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);
      vi.mocked(db.query.timesheets.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never);

      const response = await request(app)
        .get('/api/timesheets?status=open')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(db.query.timesheets.findMany).toHaveBeenCalled();
    });
  });

  describe('GET /api/timesheets/current', () => {
    it('should return current week timesheet', async () => {
      // Auth middleware + getOrCreateTimesheet both need employee
      vi.mocked(db.query.employees.findFirst)
        .mockResolvedValueOnce(testEmployee as never) // auth middleware
        .mockResolvedValueOnce(testEmployee as never); // getOrCreateTimesheet

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        entries: [],
      };

      // For getOrCreateTimesheet (find existing) and getTimesheetWithEntries
      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never)
        .mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .get('/api/timesheets/current')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.weekStartDate).toBe('2024-06-09');
      expect(response.body.totals).toBeDefined();
      expect(response.body.totals.limits).toBeDefined();
    });
  });

  describe('GET /api/timesheets/week/:weekStartDate', () => {
    it('should return timesheet for specific week', async () => {
      // Auth middleware + getOrCreateTimesheet both need employee
      vi.mocked(db.query.employees.findFirst)
        .mockResolvedValueOnce(testEmployee as never)
        .mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        entries: [],
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never)
        .mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .get('/api/timesheets/week/2024-06-09')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.weekStartDate).toBe('2024-06-09');
    });

    it('should return 400 for invalid date format', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const response = await request(app)
        .get('/api/timesheets/week/invalid-date')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_DATE_FORMAT');
    });

    it('should return 400 for non-Sunday date', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const response = await request(app)
        .get('/api/timesheets/week/2024-06-10')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_WEEK_START_DATE');
    });
  });

  describe('GET /api/timesheets/:id', () => {
    it('should return timesheet by ID', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        entries: [],
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // for validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // for getTimesheetWithEntries

      const response = await request(app)
        .get('/api/timesheets/ts-1')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('ts-1');
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .get('/api/timesheets/ts-1')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('TIMESHEET_ACCESS_DENIED');
    });

    it('should return 404 for non-existent timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);
      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .get('/api/timesheets/non-existent')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/timesheets/:id/entries', () => {
    it('should create entry successfully', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const taskCodeUuid = '550e8400-e29b-41d4-a716-446655440000';

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
      };

      const mockTaskCode = {
        id: taskCodeUuid,
        code: 'F1',
        name: 'Field Work',
        isActive: true,
      };

      const newEntry = {
        id: 'entry-1',
        timesheetId: 'ts-1',
        workDate: '2024-06-10',
        taskCodeId: taskCodeUuid,
        startTime: '09:00',
        endTime: '17:00',
        hours: '8.00',
        isSchoolDay: true,
        schoolDayOverrideNote: null,
        supervisorPresentName: null,
        mealBreakConfirmed: null,
        createdAt: new Date(),
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // createEntry
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(mockTaskCode as never);
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([newEntry]),
        }),
      } as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: '2024-06-10',
          taskCodeId: taskCodeUuid,
          startTime: '09:00',
          endTime: '17:00',
          isSchoolDay: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.entry).toBeDefined();
      expect(response.body.entry.id).toBe('entry-1');
    });

    it('should return 400 for invalid data', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: 'invalid',
          taskCodeId: 'not-a-uuid',
        });

      expect(response.status).toBe(400);
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: '2024-06-10',
          taskCodeId: '550e8400-e29b-41d4-a716-446655440000',
          startTime: '09:00',
          endTime: '17:00',
          isSchoolDay: true,
        });

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/timesheets/:id/entries/:entryId', () => {
    it('should update entry successfully', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        status: 'open',
      };

      const existingEntry = {
        id: 'entry-1',
        timesheetId: 'ts-1',
        workDate: '2024-06-10',
        taskCodeId: 'tc-1',
        startTime: '09:00',
        endTime: '17:00',
        hours: '8.00',
        isSchoolDay: true,
        schoolDayOverrideNote: null,
        supervisorPresentName: null,
        mealBreakConfirmed: null,
        createdAt: new Date(),
        timesheet: mockTimesheet,
      };

      const updatedEntry = {
        ...existingEntry,
        startTime: '08:00',
        endTime: '16:00',
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);
      vi.mocked(db.query.timesheetEntries.findFirst)
        .mockResolvedValueOnce(existingEntry as never) // getEntryById
        .mockResolvedValueOnce(existingEntry as never); // updateEntry
      vi.mocked(db.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([updatedEntry]),
          }),
        }),
      } as never);

      const response = await request(app)
        .patch('/api/timesheets/ts-1/entries/entry-1')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          startTime: '08:00',
          endTime: '16:00',
        });

      expect(response.status).toBe(200);
      expect(response.body.entry.startTime).toBe('08:00');
    });

    it('should return 404 for entry not in timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
      };

      const existingEntry = {
        id: 'entry-1',
        timesheetId: 'ts-other', // Different timesheet
        createdAt: new Date(),
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);
      vi.mocked(db.query.timesheetEntries.findFirst).mockResolvedValueOnce(existingEntry as never);

      const response = await request(app)
        .patch('/api/timesheets/ts-1/entries/entry-1')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          startTime: '08:00',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('ENTRY_NOT_FOUND');
    });
  });

  describe('DELETE /api/timesheets/:id/entries/:entryId', () => {
    it('should delete entry successfully', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        status: 'open',
      };

      const existingEntry = {
        id: 'entry-1',
        timesheetId: 'ts-1',
        createdAt: new Date(),
        timesheet: mockTimesheet,
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);
      vi.mocked(db.query.timesheetEntries.findFirst)
        .mockResolvedValueOnce(existingEntry as never) // getEntryById
        .mockResolvedValueOnce(existingEntry as never); // deleteEntry
      vi.mocked(db.delete).mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(undefined),
      } as never);

      const response = await request(app)
        .delete('/api/timesheets/ts-1/entries/entry-1')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(204);
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .delete('/api/timesheets/ts-1/entries/entry-1')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/timesheets/:id/totals', () => {
    it('should return totals for timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockEntries = [
        { workDate: '2024-06-10', hours: '8.00' },
        { workDate: '2024-06-11', hours: '4.00' },
      ];

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // getTimesheetById
      vi.mocked(db.query.timesheetEntries.findMany)
        .mockResolvedValueOnce(mockEntries as never) // getDailyTotals
        .mockResolvedValueOnce(mockEntries as never); // getWeeklyTotal

      const response = await request(app)
        .get('/api/timesheets/ts-1/totals')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.daily).toBeDefined();
      expect(response.body.weekly).toBeDefined();
      expect(response.body.limits).toBeDefined();
    });
  });

  describe('GET /api/timesheets/:id/week-info', () => {
    it('should return week information', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // getTimesheetById

      const response = await request(app)
        .get('/api/timesheets/ts-1/week-info')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(200);
      expect(response.body.weekStartDate).toBe('2024-06-09');
      expect(response.body.dates).toBeDefined();
      expect(response.body.dates).toHaveLength(7);
    });
  });

  describe('POST /api/timesheets/:id/submit', () => {
    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).post('/api/timesheets/ts-1/submit');

      expect(response.status).toBe(401);
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/submit')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('TIMESHEET_ACCESS_DENIED');
    });

    it('should return 400 for non-editable timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'submitted', // Already submitted
        submittedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        supervisorNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // getTimesheetById

      const response = await request(app)
        .post('/api/timesheets/ts-1/submit')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('TIMESHEET_ALREADY_SUBMITTED');
    });

    it('should return 404 for non-existent timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);
      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/submit')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/timesheets/:id/validate', () => {
    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).post('/api/timesheets/ts-1/validate');

      expect(response.status).toBe(401);
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/validate')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('TIMESHEET_ACCESS_DENIED');
    });

    it('should return 404 for non-existent timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);
      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/validate')
        .set('Authorization', 'Bearer valid-employee-token');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/timesheets/:id/entries/preview', () => {
    const taskCodeUuid = '550e8400-e29b-41d4-a716-446655440000';

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .post('/api/timesheets/ts-1/entries/preview')
        .send({
          workDate: '2024-06-10',
          startTime: '16:00',
          endTime: '18:00',
          taskCodeId: taskCodeUuid,
          isSchoolDay: true,
        });

      expect(response.status).toBe(401);
    });

    it('should return 403 for access denied', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-other', // Different employee
      };

      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(mockTimesheet as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries/preview')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: '2024-06-10',
          startTime: '16:00',
          endTime: '18:00',
          taskCodeId: taskCodeUuid,
          isSchoolDay: true,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('TIMESHEET_ACCESS_DENIED');
    });

    it('should return 404 for non-existent timesheet', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);
      vi.mocked(db.query.timesheets.findFirst).mockResolvedValueOnce(null as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries/preview')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: '2024-06-10',
          startTime: '16:00',
          endTime: '18:00',
          taskCodeId: taskCodeUuid,
          isSchoolDay: true,
        });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid request schema', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries/preview')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: 'invalid-date',
          startTime: 'not-a-time',
          taskCodeId: 'not-a-uuid',
        });

      expect(response.status).toBe(400);
    });

    it('should return 200 with valid preview for valid entry', async () => {
      vi.mocked(db.query.employees.findFirst).mockResolvedValueOnce(testEmployee as never);

      const mockTimesheet = {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStartDate: '2024-06-09',
        status: 'open',
        employee: {
          id: 'emp-1',
          dateOfBirth: '2008-01-15', // 16 years old
        },
      };

      const mockTaskCode = {
        id: taskCodeUuid,
        code: 'C1',
        name: 'Customer Service',
        isActive: true,
        isHazardous: false,
        minAgeRequirement: null,
        supervisorRequired: 'never',
      };

      vi.mocked(db.query.timesheets.findFirst)
        .mockResolvedValueOnce(mockTimesheet as never) // validateTimesheetAccess
        .mockResolvedValueOnce(mockTimesheet as never); // previewEntryCompliance
      vi.mocked(db.query.taskCodes.findFirst).mockResolvedValueOnce(mockTaskCode as never);
      vi.mocked(db.query.timesheetEntries.findMany)
        .mockResolvedValueOnce([] as never) // Daily entries
        .mockResolvedValueOnce([] as never); // Weekly entries

      const response = await request(app)
        .post('/api/timesheets/ts-1/entries/preview')
        .set('Authorization', 'Bearer valid-employee-token')
        .send({
          workDate: '2024-06-10',
          startTime: '16:00',
          endTime: '18:00',
          taskCodeId: taskCodeUuid,
          isSchoolDay: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBeDefined();
      expect(response.body.violations).toBeDefined();
      expect(response.body.warnings).toBeDefined();
      expect(response.body.limits).toBeDefined();
      expect(response.body.requirements).toBeDefined();
    });
  });
});
