import { Construction } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import type { NavItem } from '../../routes/navigation';

/** Honest placeholder for screens whose backend ships in a later phase. No fake data. */
export function ModulePendingPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader eyebrow="Not enabled yet" title={item.label} description={item.description} />
      <div className="card">
        <EmptyState
          icon={<Construction className="size-6" />}
          title={`${item.label} arrives in phase ${item.phase}`}
          description="This screen will show live data from your property once its module is built and enabled. Nothing here is simulated."
          action={
            <Link to="/app" className="text-label-lg text-forest underline underline-offset-4">
              Back to dashboard
            </Link>
          }
        />
      </div>
    </>
  );
}
