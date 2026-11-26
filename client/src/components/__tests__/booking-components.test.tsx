import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityResult, BookingAmounts } from '../../types/booking';
import { DateRangePicker } from '../DateRangePicker';
import { GuestCountSelector, type GuestCounts } from '../GuestCountSelector';
import { PricingBreakdown } from '../PricingBreakdown';
import { RoomCard } from '../RoomCard';

const amounts: BookingAmounts = {
  nightly: [
    { date: '2026-12-10', ratePaise: 480_000 },
    { date: '2026-12-11', ratePaise: 480_000 },
  ],
  subtotalPaise: 960_000,
  directDiscountPercent: 10,
  directDiscountPaise: 96_000,
  promoCode: null,
  promoDiscountPaise: 0,
  taxablePaise: 864_000,
  taxRatePercent: 5,
  taxPaise: 43_200,
  totalPaise: 907_200,
  otaEquivalentPaise: 1_239_000,
};

describe('PricingBreakdown', () => {
  it('shows each line from the server quote and the saving vs OTA', () => {
    render(<PricingBreakdown amounts={amounts} nights={2} rooms={1} roomName="Deluxe Courtyard Suite" />);
    expect(screen.getByText('₹9,600')).toBeInTheDocument();
    expect(screen.getByText('−₹960')).toBeInTheDocument();
    expect(screen.getByText('GST (5%)')).toBeInTheDocument();
    expect(screen.getByText('₹432')).toBeInTheDocument();
    expect(screen.getByText('₹9,072')).toBeInTheDocument();
    expect(screen.getByText(/₹3,318 lower than OTA/)).toBeInTheDocument();
  });
});

describe('DateRangePicker', () => {
  function Harness({ onChange }: { onChange: (v: { checkIn: string; checkOut: string }) => void }) {
    const [v, setV] = useState({ checkIn: '2026-12-10', checkOut: '2026-12-12' });
    return (
      <DateRangePicker
        {...v}
        min="2026-12-01"
        onChange={(r) => {
          setV(r);
          onChange(r);
        }}
      />
    );
  }

  it('pushes check-out forward when check-in moves past it and shows nights', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: '2026-12-15' } });
    expect(onChange).toHaveBeenLastCalledWith({ checkIn: '2026-12-15', checkOut: '2026-12-16' });
  });
});

describe('GuestCountSelector', () => {
  it('keeps at least one adult per room', async () => {
    function Harness() {
      const [v, setV] = useState<GuestCounts>({ adults: 1, children: 0, rooms: 1 });
      return (
        <>
          <GuestCountSelector value={v} onChange={setV} />
          <output data-testid="v">{JSON.stringify(v)}</output>
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'More rooms' }));
    expect(screen.getByTestId('v')).toHaveTextContent('{"adults":2,"children":0,"rooms":2}');
    expect(screen.getByRole('button', { name: 'Fewer children' })).toBeDisabled();
  });
});

describe('RoomCard', () => {
  const result = (bookable: boolean): AvailabilityResult => ({
    roomType: {
      id: 'rt1',
      name: 'Deluxe Courtyard Suite',
      slug: 'deluxe',
      description: '',
      sizeSqft: 380,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      bedType: 'King',
      view: 'Courtyard',
      amenities: ['Rain shower'],
      photos: [],
      tags: ['Courtyard view'],
      directPrivilege: 'Early check-in',
      baseRatePaise: 480_000,
      otaRatePaise: 590_000,
    },
    available: bookable ? 1 : 0,
    bookable,
    reason: bookable ? null : 'Sold out for these dates',
    ratePlans: [{ ratePlan: { id: 'p1', name: 'Room only', code: 'EP', mealPlan: 'EP', refundable: true }, quote: amounts }],
  });

  it('shows direct vs OTA price per night and books the chosen plan', async () => {
    const onBook = vi.fn();
    render(<RoomCard result={result(true)} nights={2} rooms={1} selectedPlanId="p1" onSelectPlan={vi.fn()} onBook={onBook} />);
    expect(screen.getByText('₹4,536')).toBeInTheDocument(); // (8,640 + 432) / 2
    expect(screen.getByText('OTA ₹6,195')).toBeInTheDocument();
    expect(screen.getByText('Only 1 left for your dates')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Select & proceed/ }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ ratePlan: expect.objectContaining({ id: 'p1' }) }));
  });

  it('explains why a room cannot be booked', () => {
    render(<RoomCard result={result(false)} nights={2} rooms={1} selectedPlanId={null} onSelectPlan={vi.fn()} onBook={vi.fn()} />);
    expect(screen.getByText('Sold out for these dates')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select & proceed/ })).not.toBeInTheDocument();
  });
});
