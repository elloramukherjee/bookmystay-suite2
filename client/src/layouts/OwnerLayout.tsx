import { Outlet } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { MobileNavigation } from '../components/MobileNavigation';
import { OfflineSyncBanner } from '../components/OfflineSyncBanner';
import { Sidebar } from '../components/Sidebar';

export function OwnerLayout() {
  return (
    <div className="min-h-screen bg-parchment">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-full focus:bg-forest focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <AppHeader />
      <div className="flex">
        <Sidebar />
        {/* pb-28 keeps content clear of the fixed mobile bottom navigation */}
        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 lg:px-10 lg:pt-8 lg:pb-12">
          <div className="mx-auto max-w-[1200px]">
            <OfflineSyncBanner />
            <Outlet />
          </div>
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}
