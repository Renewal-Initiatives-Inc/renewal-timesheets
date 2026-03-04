import { z } from 'zod';

/**
 * Schema for employee list query params.
 */
export const employeeListQuerySchema = z.object({
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  search: z.string().optional(),
});

// Export types
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
