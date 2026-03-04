import { Router, Request, Response } from 'express';
import { requireAuth, requireSupervisor } from '../middleware/auth.middleware.js';
import {
  listEmployees,
  getEmployeeById,
  getEmployeeDocuments,
  getRequiredDocuments,
  EmployeeError,
} from '../services/employee.service.js';
import { getDocumentationStatus } from '../services/documentation-status.service.js';
import { employeeListQuerySchema } from '../validation/employee.schema.js';

const router: Router = Router();

/**
 * GET /api/employees
 * List all employees with documentation status summary.
 * Query params: status (active/archived/all), search (name/email)
 */
router.get('/', requireAuth, requireSupervisor, async (req: Request, res: Response) => {
  const queryResult = employeeListQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid query parameters',
      details: queryResult.error.errors,
    });
    return;
  }

  const employees = await listEmployees(queryResult.data);

  res.json({ employees });
});

/**
 * GET /api/employees/:id
 * Get a single employee with full documentation details.
 */
router.get('/:id', requireAuth, requireSupervisor, async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const employee = await getEmployeeById(id);

    if (!employee) {
      res.status(404).json({
        error: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee not found',
      });
      return;
    }

    // Get full documentation details
    const documents = await getEmployeeDocuments(id);
    const requiredDocuments = getRequiredDocuments(employee.age);
    const documentationStatus = await getDocumentationStatus(id);

    res.json({
      employee,
      documents,
      requiredDocuments,
      documentationStatus,
    });
  } catch (error) {
    if (error instanceof EmployeeError) {
      const statusCode = error.code === 'EMPLOYEE_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
});

// PATCH /:id and DELETE /:id removed — employee data managed in app-portal

/**
 * GET /api/employees/:id/documents
 * List all documents for an employee.
 */
router.get(
  '/:id/documents',
  requireAuth,
  requireSupervisor,
  async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const documents = await getEmployeeDocuments(id);

      res.json({ documents });
    } catch (error) {
      if (error instanceof EmployeeError) {
        const statusCode = error.code === 'EMPLOYEE_NOT_FOUND' ? 404 : 400;
        res.status(statusCode).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }
  }
);

/**
 * GET /api/employees/:id/documentation-status
 * Get documentation compliance status for an employee.
 * Can be accessed by any authenticated user (for self-check).
 */
router.get('/:id/documentation-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    // Allow employees to view their own status, supervisors can view anyone's
    if (!req.zitadelUser?.isAdmin && req.employee!.id !== id) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You can only view your own documentation status',
      });
      return;
    }

    const employee = await getEmployeeById(id);

    if (!employee) {
      res.status(404).json({
        error: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee not found',
      });
      return;
    }

    const documentationStatus = await getDocumentationStatus(id);
    const requiredDocuments = getRequiredDocuments(employee.age);

    res.json({
      documentationStatus,
      requiredDocuments,
    });
  } catch (error) {
    if (error instanceof EmployeeError) {
      const statusCode = error.code === 'EMPLOYEE_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
});

export default router;
