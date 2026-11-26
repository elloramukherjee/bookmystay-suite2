import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import { ApiError, errorMessage, tokenStore } from '../services/api';
import { authService } from '../services/auth.service';
import { Button } from './Button';
import { TextField } from './FormField';
import { Modal } from './Modal';

/**
 * Self-service password change. The server signs out every other device and returns a fresh session
 * for this one, so the user stays signed in here.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== next;
  const change = useMutation({
    mutationFn: () => authService.changePassword(current, next),
    onSuccess: (session) => {
      tokenStore.set(session.accessToken);
      toast.success('Password changed. Other devices have been signed out.');
      onClose();
    },
  });
  const fieldErrors = change.error instanceof ApiError ? change.error.fieldErrors : {};

  return (
    <Modal
      open
      onClose={onClose}
      title="Change password"
      description="At least 10 characters, with letters and numbers. You’ll stay signed in here; other devices will be signed out."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="change-password" loading={change.isPending} disabled={!current || next.length < 10 || next !== confirm}>
            Change password
          </Button>
        </>
      }
    >
      <form
        id="change-password"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        {change.error && !Object.keys(fieldErrors).length && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-body-sm text-danger">
            {errorMessage(change.error)}
          </p>
        )}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={fieldErrors.currentPassword}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={fieldErrors.newPassword}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords don’t match' : undefined}
        />
      </form>
    </Modal>
  );
}
