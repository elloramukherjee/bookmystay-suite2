import { ChevronDown, KeyRound, LogOut, MessageSquareText, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { MODULE_TABS, moduleForPath } from '../routes/navigation';
import { cn, initials, ROLE_LABELS, whatsappLink } from '../utils/format';
import { AnnouncementBar } from './AnnouncementBar';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { Logo } from './Logo';

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-parchment-alt"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-forest-100 text-label-md text-forest ring-2 ring-line">
          {initials(user.name)}
        </span>
        <span className="hidden flex-col text-left leading-tight xl:flex">
          <span className="text-label-lg text-ink">{user.name}</span>
          <span className="text-body-sm text-slate">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-sage xl:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white shadow-ambient animate-fade-in">
          <div className="border-b border-line px-4 py-3">
            <p className="text-label-lg text-ink">{user.name}</p>
            <p className="truncate text-body-sm text-slate">{user.email}</p>
          </div>
          <Link
            role="menuitem"
            to="/app/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-body-md hover:bg-parchment-alt"
          >
            <Settings className="size-4 text-sage" aria-hidden /> Hotel settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-body-md hover:bg-parchment-alt"
          >
            <KeyRound className="size-4 text-sage" aria-hidden /> Change password
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-body-md text-danger hover:bg-danger-50"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

/**
 * Staff app header, matching the Stitch chrome: logo · property identity · three module pill tabs ·
 * WhatsApp hotline · user. Module tabs collapse into the mobile bottom navigation below `lg`.
 */
export function AppHeader() {
  const { hotel, can } = useAuth();
  const { pathname } = useLocation();
  const active = moduleForPath(pathname);

  return (
    <header className="sticky top-0 z-40 bg-white/95 shadow-soft backdrop-blur-md">
      <AnnouncementBar city={hotel?.city} />
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:h-20 lg:px-10">
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden sm:block">
            <Logo to="/app" />
          </div>
          <div className="sm:hidden">
            <Logo to="/app" compact />
          </div>
          {hotel && (
            <>
              <div className="hidden h-9 w-px bg-line md:block lg:hidden 2xl:block" aria-hidden />
              <div className="hidden min-w-0 items-center gap-3 md:flex lg:hidden 2xl:flex">
                <div className="min-w-0">
                  <p className="truncate font-serif text-label-lg text-forest">{hotel.name}</p>
                  <p className="text-body-sm text-slate">{hotel.city}</p>
                </div>
                <span className="num shrink-0 rounded-full bg-forest-50 px-2.5 py-1 text-label-sm text-forest">{hotel.totalRooms} Rooms</span>
              </div>
            </>
          )}
        </div>

        <nav aria-label="Modules" className="hidden items-center rounded-full bg-forest-50 p-1 lg:flex">
          {MODULE_TABS.filter((t) => can(t.permission)).map((tab) => (
            <NavLink
              key={tab.key}
              to={tab.to}
              className={cn(
                'rounded-full px-4 py-2 font-serif text-label-lg whitespace-nowrap transition-colors',
                active === tab.key ? 'bg-forest text-white shadow-ambient' : 'text-forest-soft hover:text-forest',
              )}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {hotel?.whatsapp && (
            <a
              href={whatsappLink(hotel.whatsapp)}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-full bg-forest px-4 py-2.5 text-label-md text-white hover:bg-forest-deep xl:flex"
            >
              <MessageSquareText className="size-4" aria-hidden />
              WhatsApp Direct Hotline
            </a>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
