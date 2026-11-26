import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { faqService } from '../../services/chat.service';
import type { FaqView } from '../../types/chat';

const CATEGORIES: { key: FaqView['category']; label: string }[] = [
  { key: 'arrival', label: 'Arrival & departure' },
  { key: 'amenities', label: 'Amenities' },
  { key: 'dining', label: 'Dining' },
  { key: 'services', label: 'Services' },
  { key: 'local', label: 'Local tips' },
  { key: 'policies', label: 'Policies' },
  { key: 'other', label: 'Other' },
];

function FaqForm({ faq, onClose }: { faq?: FaqView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [category, setCategory] = useState<FaqView['category']>(faq?.category ?? 'other');
  const [published, setPublished] = useState(faq?.published ?? true);
  const save = useMutation({
    mutationFn: () => {
      const input = { question: question.trim(), answer: answer.trim(), category, published, keywords: faq?.keywords ?? [] };
      return faq ? faqService.update(faq.id, input) : faqService.create(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['faqs'] });
      toast.success('The AI receptionist will use this from the next message.', faq ? 'Answer updated' : 'Answer added');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t save'),
  });
  const valid = question.trim().length >= 5 && answer.trim().length >= 2;
  return (
    <Modal
      open
      onClose={onClose}
      title={faq ? 'Edit answer' : 'Add a question guests ask'}
      description="Write the answer exactly as you'd want a guest told. The AI only states facts written here, in policies, or in hotel settings."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Question" placeholder="Do you have a gym?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
        <TextAreaField label="Answer" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={2000} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as FaqView['category'])}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Visible to the AI" value={published ? 'yes' : 'no'} onChange={(e) => setPublished(e.target.value === 'yes')}>
            <option value="yes">Published — AI can use it</option>
            <option value="no">Draft — hidden from the AI</option>
          </SelectField>
        </div>
      </div>
    </Modal>
  );
}

export function KnowledgeBasePage() {
  const { can } = useAuth();
  const canEdit = can('policies.manage');
  const queryClient = useQueryClient();
  const toast = useToast();
  const faqs = useQuery({ queryKey: ['faqs'], queryFn: faqService.list });
  const [editing, setEditing] = useState<FaqView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FaqView | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => faqService.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['faqs'] });
      setDeleting(null);
      toast.success('Removed from the knowledge base.');
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t remove'),
  });

  return (
    <>
      <Link to="/app/receptionist" className="mb-4 inline-flex items-center gap-1 text-label-md text-forest">
        <ArrowLeft className="size-4" aria-hidden /> Concierge desk
      </Link>
      <PageHeader
        eyebrow="AI receptionist"
        title="Knowledge base"
        description="Everything the AI may tell guests. If an answer isn't here, in your policies or in hotel settings, the AI hands the chat to your team instead of guessing."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add question
            </Button>
          )
        }
      />
      {faqs.isLoading ? (
        <LoadingSkeleton variant="table" count={5} label="Loading knowledge base" />
      ) : faqs.error ? (
        <div className="card">
          <EmptyState tone="error" title="Couldn’t load" description={errorMessage(faqs.error)} />
        </div>
      ) : !faqs.data?.length ? (
        <div className="card">
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="No answers yet"
            description="Add the questions guests ask most — Wi-Fi, breakfast, parking, directions."
            action={canEdit && <Button onClick={() => setEditing('new')}>Add question</Button>}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {CATEGORIES.map((cat) => {
            const items = faqs.data!.filter((f) => f.category === cat.key);
            if (!items.length) return null;
            return (
              <section key={cat.key} aria-labelledby={`cat-${cat.key}`}>
                <h2 id={`cat-${cat.key}`} className="mb-2 text-headline-sm">
                  {cat.label}
                </h2>
                <ul className="card divide-y divide-line">
                  {items.map((f) => (
                    <li key={f.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-label-lg text-ink">
                          {f.question}
                          {!f.published && <StatusBadge tone="warning">Draft</StatusBadge>}
                        </p>
                        <p className="mt-1 text-body-sm text-slate">{f.answer}</p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(f)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete: ${f.question}`} onClick={() => setDeleting(f)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-body-sm text-slate">
            Policies (cancellation, pets, parking…) also feed the AI — edit them under{' '}
            <Link to="/app/settings" className="text-forest underline">
              Hotel settings
            </Link>
            .
          </p>
        </div>
      )}
      {editing && <FaqForm faq={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this answer?"
        message="The AI will no longer use it. Guests asking this will be handed to staff."
        tone="danger"
        confirmLabel="Remove"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
