import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { useAuth as useOidcAuth } from 'react-oidc-context';
import type { EmployeePublic } from '@renewal/types';
import { getCurrentUser } from '../api/client.js';

interface AuthContextValue {
  user: EmployeePublic | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isSupervisor: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** The raw Zitadel access token for API calls */
  accessToken: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Extract roles from Zitadel token claims.
 * Roles are in the format: { "role_name": { "org_id": "org_name" } }
 */
function extractRoles(user: ReturnType<typeof useOidcAuth>['user']): string[] {
  if (!user?.profile) return [];
  const rolesClaim = user.profile['urn:zitadel:iam:org:project:roles'] as
    | Record<string, unknown>
    | undefined;
  return rolesClaim ? Object.keys(rolesClaim) : [];
}

export function AuthProvider({ children }: AuthProviderProps) {
  const oidcAuth = useOidcAuth();
  const [employee, setEmployee] = useState<EmployeePublic | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract roles and check for admin (admin = supervisor)
  const roles = extractRoles(oidcAuth.user);
  const isAdmin = roles.includes('admin');

  // Sync Zitadel token to localStorage for API client
  useEffect(() => {
    if (oidcAuth.user?.access_token) {
      localStorage.setItem('token', oidcAuth.user.access_token);
    } else if (!oidcAuth.isLoading) {
      localStorage.removeItem('token');
    }
  }, [oidcAuth.user?.access_token, oidcAuth.isLoading]);

  // Fetch employee data when OIDC auth completes
  useEffect(() => {
    const fetchEmployee = async () => {
      if (!oidcAuth.isAuthenticated || !oidcAuth.user?.access_token) {
        setEmployee(null);
        return;
      }

      setEmployeeLoading(true);
      try {
        const response = await getCurrentUser();
        if (!response.employee) {
          setError('No employee account found. Contact your administrator.');
          setEmployee(null);
          return;
        }
        setEmployee(response.employee);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch employee:', err);
        setError('Failed to load user data');
        setEmployee(null);
      } finally {
        setEmployeeLoading(false);
      }
    };

    fetchEmployee();
  }, [oidcAuth.isAuthenticated, oidcAuth.user?.access_token]);

  const login = useCallback(async () => {
    // Store current location for redirect after auth
    sessionStorage.setItem('returnTo', window.location.pathname);
    await oidcAuth.signinRedirect();
  }, [oidcAuth]);

  const logout = useCallback(async () => {
    setEmployee(null);
    await oidcAuth.signoutRedirect();
  }, [oidcAuth]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // We're loading if OIDC is loading, employee is being fetched,
  // or we're authenticated but haven't fetched employee data yet (closes race condition gap)
  const awaitingEmployee = oidcAuth.isAuthenticated && !employee && !error;
  const loading = oidcAuth.isLoading || employeeLoading || awaitingEmployee;

  // User is authenticated only if OIDC is authenticated AND we have employee data
  const isAuthenticated = oidcAuth.isAuthenticated && !!employee;

  // Supervisor = admin role from Zitadel (employee.isSupervisor always false)
  const isSupervisor = isAdmin;

  const value: AuthContextValue = {
    user: employee,
    loading,
    error: error || (oidcAuth.error?.message ?? null),
    isAuthenticated,
    isSupervisor,
    login,
    logout,
    clearError,
    accessToken: oidcAuth.user?.access_token ?? null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
