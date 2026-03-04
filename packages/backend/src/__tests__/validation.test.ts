import { describe, it, expect } from 'vitest';
import { employeeListQuerySchema } from '../validation/employee.schema.js';
import { documentUploadSchema, safetyTrainingSchema } from '../validation/document.schema.js';

describe('Validation Schemas', () => {
  describe('employeeListQuerySchema', () => {
    it('should default status to active', () => {
      const result = employeeListQuerySchema.parse({});
      expect(result.status).toBe('active');
    });

    it('should accept status: active', () => {
      const result = employeeListQuerySchema.safeParse({ status: 'active' });
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('active');
    });

    it('should accept status: archived', () => {
      const result = employeeListQuerySchema.safeParse({ status: 'archived' });
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('archived');
    });

    it('should accept status: all', () => {
      const result = employeeListQuerySchema.safeParse({ status: 'all' });
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('all');
    });

    it('should reject invalid status', () => {
      const result = employeeListQuerySchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should accept search parameter', () => {
      const result = employeeListQuerySchema.safeParse({ search: 'john' });
      expect(result.success).toBe(true);
      expect(result.data?.search).toBe('john');
    });
  });

  describe('documentUploadSchema', () => {
    it('should accept valid parental_consent type', () => {
      const result = documentUploadSchema.safeParse({ type: 'parental_consent' });
      expect(result.success).toBe(true);
    });

    it('should accept valid work_permit type', () => {
      const result = documentUploadSchema.safeParse({ type: 'work_permit' });
      expect(result.success).toBe(true);
    });

    it('should accept valid safety_training type', () => {
      const result = documentUploadSchema.safeParse({ type: 'safety_training' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid document type', () => {
      const result = documentUploadSchema.safeParse({ type: 'invalid_type' });
      expect(result.success).toBe(false);
    });

    it('should accept valid expiresAt date', () => {
      const result = documentUploadSchema.safeParse({
        type: 'work_permit',
        expiresAt: '2025-12-31',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid date format', () => {
      const result = documentUploadSchema.safeParse({
        type: 'work_permit',
        expiresAt: '12-31-2025',
      });
      expect(result.success).toBe(false);
    });

    it('should reject date with wrong separator', () => {
      const result = documentUploadSchema.safeParse({
        type: 'work_permit',
        expiresAt: '2025/12/31',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('safetyTrainingSchema', () => {
    it('should accept valid UUID', () => {
      const result = safetyTrainingSchema.safeParse({
        employeeId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = safetyTrainingSchema.safeParse({
        employeeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty employeeId', () => {
      const result = safetyTrainingSchema.safeParse({
        employeeId: '',
      });
      expect(result.success).toBe(false);
    });
  });
});
