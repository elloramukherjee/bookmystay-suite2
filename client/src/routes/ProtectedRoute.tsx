import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../types/api';

/** Gate for the whole staff area: waits for session restore, then redirects anonymous visitors to login. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="page-container py-16">
        <LoadingSkeleton variant="stats" count={4} label="Restoring your session" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

/**
 * Per-page permission check. The server enforces the same permissions on every API call; this only
 * avoids showing screens a role can't use.
 */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="card">
        <EmptyState
          icon={<ShieldAlert className="size-6" />}
          title="This section isn't available for your role"
          description="Ask the property owner if you need access."
          action={
            <Link to="/app" className="text-label-lg text-forest underline underline-offset-4">
              Back to dashboard
            </Link>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}
