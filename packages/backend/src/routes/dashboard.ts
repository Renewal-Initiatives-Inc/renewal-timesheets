import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAuth, requireSupervisor } from '../middleware/auth.middleware.js';
import { listEmployees } from '../services/employee.service.js';
import { getDocumentationStatus } from '../services/documentation-status.service.js';
import { db, schema } from '../db/index.js';
import { calculateAge } from '../utils/age.js';
import { decryptDob } from '../utils/encryption.js';
import type { DashboardAlert, AlertType } from '@renewal/types';

const { employees, timesheets } = schema;

const router: Router = Router();

/**
 * GET /api/dashboard/employees
 * Get all employees with documentation status summary.
 * Same as /api/employees but optimized for dashboard display.
 */
router.get('/employees', requireAuth, requireSupervisor, async (req: Request, res: Response) => {
  const employeeList = await listEmployees({ status: 'active' });
  res.json({ employees: employeeList });
});

/**
 * GET /api/dashboard/alerts
 * Get actionable alerts for the supervisor.
 * Includes:
 * - Missing documents
 * - Expiring documents (within 30 days)
 * - Upcoming age transitions (14th birthday within 30 days)
 */
router.get('/alerts', requireAuth, requireSupervisor, async (req: Request, res: Response) => {
  const alerts: DashboardAlert[] = [];

  // Get all active employees
  const employeeList = await db.query.employees.findMany({
    where: eq(employees.status, 'active'),
  });

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]!;

  for (const employee of employeeList) {
    // Decrypt DOB (AES-256-GCM encrypted in DB)
    const plaintextDob = decryptDob(employee.dateOfBirth);
    const age = calculateAge(plaintextDob, todayStr);

    // Skip adults - no documentation requirements
    if (age >= 18) continue;

    // Get documentation status
    try {
      const docStatus = await getDocumentationStatus(employee.id);

      // Alert for missing documents
      for (const missingType of docStatus.missingDocuments) {
        const docLabel =
          missingType === 'parental_consent'
            ? 'parental consent form'
            : missingType === 'work_permit'
              ? 'work permit'
              : 'safety training verification';

        alerts.push({
          type: 'missing_document' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `Missing ${docLabel}`,
        });
      }

      // Alert for expiring documents
      for (const expiring of docStatus.expiringDocuments) {
        const docLabel =
          expiring.type === 'parental_consent'
            ? 'Parental consent'
            : expiring.type === 'work_permit'
              ? 'Work permit'
              : 'Safety training';

        alerts.push({
          type: 'expiring_document' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `${docLabel} expires in ${expiring.daysUntilExpiry} days`,
          dueDate: expiring.expiresAt,
        });
      }
    } catch {
      // If we can't get status, skip this employee
    }

    // Check for upcoming 14th birthday (age transition requiring work permit)
    if (age === 13) {
      // Check if 14th birthday is within next 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const dob = new Date(plaintextDob + 'T00:00:00');
      const birthday14 = new Date(dob);
      birthday14.setFullYear(birthday14.getFullYear() + 14);

      if (birthday14 >= today && birthday14 <= thirtyDaysFromNow) {
        const daysUntil = Math.ceil(
          (birthday14.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        alerts.push({
          type: 'age_transition' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `Turns 14 in ${daysUntil} days - will need work permit`,
          dueDate: birthday14.toISOString().split('T')[0],
        });
      }
    }
  }

  // Sort alerts by urgency (missing docs first, then by due date)
  alerts.sort((a, b) => {
    // Missing documents are most urgent
    if (a.type === 'missing_document' && b.type !== 'missing_document') return -1;
    if (a.type !== 'missing_document' && b.type === 'missing_document') return 1;

    // Then sort by due date
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }

    // Items without due dates go last
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;

    return 0;
  });

  res.json({ alerts });
});

/**
 * GET /api/dashboard/stats
 * Get summary statistics for the dashboard.
 */
router.get('/stats', requireAuth, requireSupervisor, async (req: Request, res: Response) => {
  const employeeList = await listEmployees({ status: 'active' });

  // Count pending (submitted) timesheets
  const pendingTimesheets = await db.query.timesheets.findMany({
    where: eq(timesheets.status, 'submitted'),
  });

  const stats = {
    totalEmployees: employeeList.length,
    completeDocumentation: employeeList.filter((e) => e.documentation.isComplete).length,
    missingDocumentation: employeeList.filter((e) => !e.documentation.isComplete).length,
    expiringDocuments: employeeList.reduce((sum, e) => sum + e.documentation.expiringCount, 0),
    pendingReviewCount: pendingTimesheets.length,
    byAgeBand: {
      '12-13': employeeList.filter((e) => e.ageBand === '12-13').length,
      '14-15': employeeList.filter((e) => e.ageBand === '14-15').length,
      '16-17': employeeList.filter((e) => e.ageBand === '16-17').length,
      '18+': employeeList.filter((e) => e.ageBand === '18+').length,
    },
  };

  res.json({ stats });
});

export default router;
