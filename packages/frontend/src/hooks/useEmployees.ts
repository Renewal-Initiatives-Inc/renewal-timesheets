import { useState, useEffect, useCallback } from 'react';
import type { EmployeeWithDocStatus, EmployeeDetailResponse, DashboardAlert } from '@renewal/types';
import {
  getEmployees,
  getEmployee,
  getDashboardEmployees,
  getDashboardAlerts,
  getDashboardStats,
  ApiRequestError,
} from '../api/client.js';

interface UseEmployeesOptions {
  status?: 'active' | 'archived' | 'all';
  search?: string;
}

interface UseEmployeesResult {
  employees: EmployeeWithDocStatus[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook for fetching employee list
 */
export function useEmployees(options: UseEmployeesOptions = {}): UseEmployeesResult {
  const [employees, setEmployees] = useState<EmployeeWithDocStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getEmployees(options);
      setEmployees(response.employees);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Failed to load employees');
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.status, options.search]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  return { employees, loading, error, refetch: fetchEmployees };
}

interface UseEmployeeResult {
  employee: EmployeeDetailResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook for fetching a single employee with full details
 */
export function useEmployee(id: string | undefined): UseEmployeeResult {
  const [employee, setEmployee] = useState<EmployeeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployee = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await getEmployee(id);
      setEmployee(response);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Failed to load employee');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchEmployee();
  }, [fetchEmployee]);

  return { employee, loading, error, refetch: fetchEmployee };
}

interface UseDashboardResult {
  employees: EmployeeWithDocStatus[];
  alerts: DashboardAlert[];
  stats: {
    totalEmployees: number;
    completeDocumentation: number;
    missingDocumentation: number;
    expiringDocuments: number;
    pendingReviewCount: number;
    byAgeBand: {
      '12-13': number;
      '14-15': number;
      '16-17': number;
      '18+': number;
    };
  } | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook for fetching dashboard data
 */
export function useDashboard(): UseDashboardResult {
  const [employees, setEmployees] = useState<EmployeeWithDocStatus[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [stats, setStats] = useState<UseDashboardResult['stats']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empResponse, alertResponse, statsResponse] = await Promise.all([
        getDashboardEmployees(),
        getDashboardAlerts(),
        getDashboardStats(),
      ]);
      setEmployees(empResponse.employees);
      setAlerts(alertResponse.alerts);
      setStats(statsResponse.stats);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return { employees, alerts, stats, loading, error, refetch: fetchDashboard };
}

