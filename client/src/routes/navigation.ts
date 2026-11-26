import { BedDouble, BookOpen, BookOpenCheck, CalendarRange, LayoutDashboard, MessagesSquare, Settings, UserCog, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '../types/api';

export type ModuleKey = 'overview' | 'booking' | 'receptionist' | 'crm' | 'admin';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  module: ModuleKey;
  /** False until the phase that builds this screen ships; the route then shows a "not enabled yet" state. */
  available: boolean;
  phase: number;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/app',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: 'hotel.read',
    module: 'overview',
    available: true,
    phase: 1,
    description: 'Today at your property',
  },
  {
    to: '/app/bookings',
    label: 'Bookings',
    icon: BookOpenCheck,
    permission: 'bookings.read',
    module: 'booking',
    available: true,
    phase: 2,
    description: 'Direct and OTA reservations, payments and confirmations',
  },
  {
    to: '/app/rooms',
    label: 'Rooms',
    icon: BedDouble,
    permission: 'rooms.read',
    module: 'booking',
    available: true,
    phase: 2,
    description: 'Room types, photos, amenities and physical rooms',
  },
  {
    to: '/app/rates',
    label: 'Rates & Availability',
    icon: CalendarRange,
    permission: 'rates.manage',
    module: 'booking',
    available: true,
    phase: 2,
    description: 'Nightly prices, stop-sell and inventory from your phone',
  },
  {
    to: '/app/receptionist',
    label: 'Concierge Desk',
    icon: MessagesSquare,
    permission: 'conversations.read',
    module: 'receptionist',
    available: true,
    phase: 3,
    description: 'AI receptionist conversations, escalations and staff takeover',
  },
  {
    to: '/app/receptionist/knowledge',
    label: 'Knowledge base',
    icon: BookOpen,
    permission: 'conversations.read',
    module: 'receptionist',
    available: true,
    phase: 3,
    description: 'FAQs the AI receptionist may answer from',
  },
  {
    to: '/app/guests',
    label: 'Guests',
    icon: Users,
    permission: 'guests.read',
    module: 'crm',
    available: true,
    phase: 4,
    description: 'Guest profiles, stay history, quick check-in and follow-ups',
  },
  {
    to: '/app/staff',
    label: 'Staff',
    icon: UserCog,
    permission: 'staff.read',
    module: 'admin',
    available: true,
    phase: 1,
    description: 'Team accounts and roles',
  },
  {
    to: '/app/settings',
    label: 'Hotel Settings',
    icon: Settings,
    permission: 'hotel.read',
    module: 'admin',
    available: true,
    phase: 1,
    description: 'Property profile, policies and booking rules',
  },
];

/** The three product modules shown as pill tabs in the header (Stitch). */
export const MODULE_TABS: { key: Exclude<ModuleKey, 'overview' | 'admin'>; label: string; short: string; to: string; permission: Permission }[] = [
  { key: 'booking', label: '1. Direct Booking Engine', short: 'Bookings', to: '/app/bookings', permission: 'bookings.read' },
  { key: 'receptionist', label: '2. AI Receptionist Desk', short: 'Concierge', to: '/app/receptionist', permission: 'conversations.read' },
  { key: 'crm', label: '3. Hotel Guest CRM', short: 'Guests', to: '/app/guests', permission: 'guests.read' },
];

export const SECTION_LABELS: Record<ModuleKey, string> = {
  overview: 'Overview',
  booking: 'Direct Booking',
  receptionist: 'AI Receptionist',
  crm: 'Guest CRM',
  admin: 'Property',
};

export function moduleForPath(pathname: string): ModuleKey {
  const match = [...NAV_ITEMS].sort((a, b) => b.to.length - a.to.length).find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  return match?.module ?? 'overview';
}
