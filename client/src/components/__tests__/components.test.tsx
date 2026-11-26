import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatINR, formatPhone, formatTime, whatsappLink } from '../../utils/format';
import { ConfirmDialog } from '../ConfirmDialog';
import { Modal } from '../Modal';
import { DataTable } from '../DataTable';
import { StatCard } from '../StatCard';

describe('format helpers', () => {
  it('formats paise as rupees in Indian grouping', () => {
    expect(formatINR(48_000_00)).toBe('₹48,000');
    expect(formatINR(1_42_80_000_00)).toBe('₹1,42,80,000');
  });
  it('formats times, phones and WhatsApp links', () => {
    expect(formatTime('13:00')).toBe('1:00 PM');
    expect(formatTime('00:30')).toBe('12:30 AM');
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(whatsappLink('+919876543210', 'Hi there')).toBe('https://wa.me/919876543210?text=Hi%20there');
  });
});

describe('DataTable', () => {
  const columns = [{ key: 'name', header: 'Name', render: (r: { name: string }) => r.name }];

  it('renders an empty state', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.name} empty={{ title: 'No staff yet' }} />);
    expect(screen.getByText('No staff yet')).toBeInTheDocument();
  });

  it('renders a loading skeleton before data arrives', () => {
    render(<DataTable columns={columns} rows={undefined} rowKey={(r) => r.name} loading caption="staff" />);
    expect(screen.getByRole('status', { name: 'Loading staff' })).toBeInTheDocument();
  });

  it('renders rows and paginates', async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ name: 'Asha' }, { name: 'Mohan' }]}
        rowKey={(r) => r.name}
        meta={{ page: 1, limit: 2, total: 5, totalPages: 3 }}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByRole('cell', { name: 'Asha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('ConfirmDialog', () => {
  it('confirms and cancels, and closes on Escape', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Deactivate Asha?"
        message="They will be signed out."
        confirmLabel="Deactivate"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Deactivate Asha?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('StatCard', () => {
  it('renders label, value and unit', () => {
    render(<StatCard label="Room inventory" value={24} unit="rooms" />);
    expect(screen.getByRole('heading', { name: 'Room inventory' })).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('rooms')).toBeInTheDocument();
  });
});

describe('Modal focus management', () => {
  it('does not steal focus back to the first field when the parent re-renders', async () => {
    function Parent() {
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const t = setInterval(() => setTick((n) => n + 1), 20);
        return () => clearInterval(t);
      }, []);
      return (
        <Modal open title={`Edit ${tick >= 0 ? 'rate' : ''}`} onClose={() => undefined}>
          <input aria-label="first" />
          <input aria-label="second" />
        </Modal>
      );
    }
    render(<Parent />);
    expect(screen.getByLabelText('first')).toHaveFocus();
    await userEvent.click(screen.getByLabelText('second'));
    await userEvent.type(screen.getByLabelText('second'), '5600');
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByLabelText('second')).toHaveFocus();
    expect(screen.getByLabelText('second')).toHaveValue('5600');
  });
});
