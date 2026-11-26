import { LogIn, MessageCircle, Ticket } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { AnnouncementBar } from '../components/AnnouncementBar';
import { AppFooter } from '../components/AppFooter';
import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { usePublicHotel } from '../hooks/usePublicHotel';
import { whatsappLink } from '../utils/format';

export function PublicLayout() {
  const { status } = useAuth();
  const { data: hotel } = usePublicHotel();

  return (
    <div className="flex min-h-screen flex-col bg-parchment">
      <header className="sticky top-0 z-40 bg-white/95 shadow-soft backdrop-blur-md">
        <AnnouncementBar city={hotel?.address.city} />
        <div className="page-container flex h-16 items-center justify-between gap-3 lg:h-20">
          <Logo to="/" subtitle="Book direct with independent hotels" />
          <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Site">
            <Link to="/my-booking" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-label-md text-forest hover:bg-parchment-alt">
              <Ticket className="size-4" aria-hidden />
              <span className="hidden sm:inline">My booking</span>
            </Link>
            {hotel?.contact.whatsapp && (
              <a
                href={whatsappLink(hotel.contact.whatsapp, `Namaste! I have a question about staying at ${hotel.name}.`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-full border-[1.5px] border-emerald bg-white px-4 text-label-md text-emerald hover:bg-emerald-50"
              >
                <MessageCircle className="size-4" aria-hidden />
                <span className="hidden sm:inline">Chat with Host</span>
                <span className="sm:hidden">Chat</span>
              </a>
            )}
            <Link
              to={status === 'authenticated' ? '/app' : '/login'}
              className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-label-md text-slate hover:bg-parchment-alt"
            >
              <LogIn className="size-4" aria-hidden />
              <span className="hidden sm:inline">{status === 'authenticated' ? 'Staff desk' : 'Staff login'}</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
