import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getPendingReviewCount, ApiRequestError } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';

interface ReviewCountContextValue {
  count: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const ReviewCountContext = createContext<ReviewCountContextValue | null>(null);

export function ReviewCountProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isSupervisor } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPendingReviewCount();
      setCount(response.count);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Failed to load pending review count');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && isSupervisor) {
      fetchCount();
    } else {
      setCount(0);
    }
  }, [isAuthenticated, isSupervisor, fetchCount]);

  return (
    <ReviewCountContext.Provider value={{ count, loading, error, refresh: fetchCount }}>
      {children}
    </ReviewCountContext.Provider>
  );
}

export function useReviewCount(): ReviewCountContextValue {
  const context = useContext(ReviewCountContext);
  if (!context) {
    throw new Error('useReviewCount must be used within a ReviewCountProvider');
  }
  return context;
}
