import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { StaffTakeoverPanel } from '../../components/StaffTakeoverPanel';

/** Full-screen conversation for phones (the desk shows the same panel side-by-side on desktop). */
export function ConversationDetailsPage() {
  const { id = '' } = useParams();
  return (
    <>
      <Link to="/app/receptionist" className="mb-4 inline-flex items-center gap-1 text-label-md text-forest">
        <ArrowLeft className="size-4" aria-hidden /> All conversations
      </Link>
      <StaffTakeoverPanel conversationId={id} />
    </>
  );
}
