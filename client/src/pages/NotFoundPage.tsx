import { Compass, TriangleAlert } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { EmptyState } from '../components/EmptyState';

export function NotFoundPage() {
  return (
    <div className="page-container py-20">
      <EmptyState
        icon={<Compass className="size-6" />}
        title="This page doesn’t exist"
        description="The link may be outdated or mistyped."
        action={
          <Link to="/" className="text-label-lg text-forest underline underline-offset-4">
            Go to the homepage
          </Link>
        }
      />
    </div>
  );
}

/** Route-level error boundary: an unexpected render error never blanks the whole app. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <div className="page-container py-20">
      <EmptyState
        tone="error"
        icon={<TriangleAlert className="size-6" />}
        title="Something went wrong on this screen"
        description="Please reload. If it keeps happening, tell your property owner what you were doing."
        action={
          <button type="button" onClick={() => window.location.reload()} className="text-label-lg text-forest underline underline-offset-4">
            Reload
          </button>
        }
      />
    </div>
  );
}
