import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../App';
import { ApiError, tokenStore } from '../../services/api';
import { authService } from '../../services/auth.service';
import { meFixture } from '../../test/fixtures';
import { ChangePasswordDialog } from '../ChangePasswordDialog';

vi.mock('../../services/auth.service', () => ({ authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn(), changePassword: vi.fn() } }));

const renderDialog = (onClose = vi.fn()) => {
  render(
    <AppProviders queryClient={createQueryClient()}>
      <ChangePasswordDialog onClose={onClose} />
    </AppProviders>,
  );
  return onClose;
};
const fill = async (current: string, next: string, confirm = next) => {
  await userEvent.type(screen.getByLabelText(/^Current password/), current);
  await userEvent.type(screen.getByLabelText(/^New password/), next);
  await userEvent.type(screen.getByLabelText(/^Confirm new password/), confirm);
};

beforeEach(() => vi.clearAllMocks());

describe('ChangePasswordDialog', () => {
  it('blocks submission until the confirmation matches', async () => {
    renderDialog();
    await fill('OldDesk2025pass', 'NewDesk2026pass', 'NewDesk2026pasz');
    expect(screen.getByText('Passwords don’t match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  it('shows the server’s field error for a wrong current password', async () => {
    vi.mocked(authService.changePassword).mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Your current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }]),
    );
    renderDialog();
    await fill('wrong-one-1', 'NewDesk2026pass');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
  });

  it('keeps this device signed in with the new session', async () => {
    vi.mocked(authService.changePassword).mockResolvedValue({ accessToken: 'fresh-token', expiresIn: 900, user: meFixture('owner').user });
    const onClose = renderDialog();
    await fill('OldDesk2025pass', 'NewDesk2026pass');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(authService.changePassword).toHaveBeenCalledWith('OldDesk2025pass', 'NewDesk2026pass');
    expect(tokenStore.get()).toBe('fresh-token');
  });
});
