import { LayoutDashboard, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { NAV_ITEMS, type NavItem } from '../routes/navigation';
import { cn } from '../utils/format';
import { Modal } from './Modal';

const PRIMARY_TABS = ['/app', '/app/bookings', '/app/receptionist', '/app/guests'];

/**
 * Fixed bottom bar for phones (DESIGN.md: 4 tabs + forest active markers), plus a "More" sheet for the
 * remaining sections. Lives inside the 80px bottom safe area.
 */
export function MobileNavigation() {
  const { can, logout } = useAuth();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const allowed = NAV_ITEMS.filter((i) => can(i.permission));
  const tabs = PRIMARY_TABS.map((to) => allowed.find((i) => i.to === to)).filter((i): i is NavItem => Boolean(i));
  const rest = allowed.filter((i) => !PRIMARY_TABS.includes(i.to));
  const moreActive = rest.some((i) => pathname.startsWith(i.to));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-ambient backdrop-blur-md lg:hidden"
      >
        <ul className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
          {tabs.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/app'}
                className={({ isActive }) =>
                  cn('relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-forest' : 'text-sage')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-forest" aria-hidden />}
                    {item.to === '/app' ? <LayoutDashboard className="size-5" aria-hidden /> : <item.icon className="size-5" aria-hidden />}
                    <span className="truncate">{item.to === '/app' ? 'Home' : item.label.split(' ')[0]}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'relative flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                moreActive ? 'text-forest' : 'text-sage',
              )}
            >
              {moreActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-forest" aria-hidden />}
              <Menu className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="flex flex-col gap-1 pb-2">
          {rest.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn('flex items-center gap-3 rounded-xl px-3 py-3', isActive ? 'bg-forest-50 text-forest' : 'text-ink hover:bg-parchment-alt')
                }
              >
                <item.icon className="size-5 text-forest" aria-hidden />
                <span className="flex-1">
                  <span className="block text-label-lg">{item.label}</span>
                  <span className="block text-body-sm text-slate">{item.description}</span>
                </span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-danger hover:bg-danger-50"
            >
              <LogOut className="size-5" aria-hidden />
              <span className="text-label-lg">Sign out</span>
            </button>
          </li>
        </ul>
      </Modal>
    </>
  );
}
