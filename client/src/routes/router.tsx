import { lazy, Suspense, type ReactNode } from 'react';
import { Outlet, ScrollRestoration, type RouteObject } from 'react-router';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PublicLayout } from '../layouts/PublicLayout';
import { NotFoundPage, RouteErrorPage } from '../pages/NotFoundPage';
import { HomePage } from '../pages/public/HomePage';
import { PropertyDetailsPage } from '../pages/public/PropertyDetailsPage';
import { NAV_ITEMS } from './navigation';
import { RequireAuth, RequirePermission } from './ProtectedRoute';

// Guests on 3G only download the public site; staff screens load on demand.
const LoginPage = lazy(() => import('../pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const OwnerLayout = lazy(() => import('../layouts/OwnerLayout').then((m) => ({ default: m.OwnerLayout })));
const OwnerDashboard = lazy(() => import('../pages/owner/OwnerDashboard').then((m) => ({ default: m.OwnerDashboard })));
const StaffManagementPage = lazy(() => import('../pages/owner/StaffManagementPage').then((m) => ({ default: m.StaffManagementPage })));
const HotelSettingsPage = lazy(() => import('../pages/owner/HotelSettingsPage').then((m) => ({ default: m.HotelSettingsPage })));
// Booking funnel pages: split so the landing/property pages stay light on 3G.
const RoomListingPage = lazy(() => import('../pages/public/RoomListingPage').then((m) => ({ default: m.RoomListingPage })));
const BookingPage = lazy(() => import('../pages/public/BookingPage').then((m) => ({ default: m.BookingPage })));
const PaymentPage = lazy(() => import('../pages/public/PaymentPage').then((m) => ({ default: m.PaymentPage })));
const BookingConfirmationPage = lazy(() => import('../pages/public/BookingConfirmationPage').then((m) => ({ default: m.BookingConfirmationPage })));
const GuestBookingLookupPage = lazy(() => import('../pages/guest/GuestBookingLookupPage').then((m) => ({ default: m.GuestBookingLookupPage })));
const RoomManagementPage = lazy(() => import('../pages/owner/RoomManagementPage').then((m) => ({ default: m.RoomManagementPage })));
const RatesAvailabilityPage = lazy(() => import('../pages/owner/RatesAvailabilityPage').then((m) => ({ default: m.RatesAvailabilityPage })));
const BookingManagementPage = lazy(() => import('../pages/owner/BookingManagementPage').then((m) => ({ default: m.BookingManagementPage })));
const ReceptionistDashboard = lazy(() => import('../pages/owner/ReceptionistDashboard').then((m) => ({ default: m.ReceptionistDashboard })));
const ConversationDetailsPage = lazy(() => import('../pages/owner/ConversationDetailsPage').then((m) => ({ default: m.ConversationDetailsPage })));
const KnowledgeBasePage = lazy(() => import('../pages/owner/KnowledgeBasePage').then((m) => ({ default: m.KnowledgeBasePage })));
const GuestChatPage = lazy(() => import('../pages/guest/GuestChatPage').then((m) => ({ default: m.GuestChatPage })));
const GuestCRMPage = lazy(() => import('../pages/owner/GuestCRMPage').then((m) => ({ default: m.GuestCRMPage })));
const GuestDetailsPage = lazy(() => import('../pages/owner/GuestDetailsPage').then((m) => ({ default: m.GuestDetailsPage })));
const ModulePendingPage = lazy(() => import('../pages/owner/ModulePendingPage').then((m) => ({ default: m.ModulePendingPage })));

const page = (node: ReactNode) => <Suspense fallback={<LoadingSkeleton variant="lines" count={6} className="py-6" />}>{node}</Suspense>;

const IMPLEMENTED: Record<string, ReactNode> = {
  '/app': <OwnerDashboard />,
  '/app/staff': <StaffManagementPage />,
  '/app/settings': <HotelSettingsPage />,
  '/app/bookings': <BookingManagementPage />,
  '/app/rooms': <RoomManagementPage />,
  '/app/rates': <RatesAvailabilityPage />,
  '/app/receptionist': <ReceptionistDashboard />,
  '/app/receptionist/knowledge': <KnowledgeBasePage />,
  '/app/guests': <GuestCRMPage />,
};

const staffRoutes: RouteObject[] = NAV_ITEMS.map((item) => {
  const element = item.available ? IMPLEMENTED[item.to] : <ModulePendingPage item={item} />;
  const guarded = <RequirePermission permission={item.permission}>{page(element)}</RequirePermission>;
  return item.to === '/app' ? { index: true, element: guarded } : { path: item.to.replace('/app/', ''), element: guarded };
});

/** Root: every navigation starts at the top of the page (back/forward restores the previous position). */
function Root() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/h/:slug', element: <PropertyDetailsPage /> },
          { path: '/h/:slug/rooms', element: page(<RoomListingPage />) },
          { path: '/h/:slug/book', element: page(<BookingPage />) },
          { path: '/booking/:id/pay', element: page(<PaymentPage />) },
          { path: '/booking/:id', element: page(<BookingConfirmationPage />) },
          { path: '/my-booking', element: page(<GuestBookingLookupPage />) },
          { path: '/h/:slug/chat', element: page(<GuestChatPage />) },
        ],
      },
      { path: '/login', element: page(<LoginPage />) },
      {
        path: '/app',
        element: <RequireAuth />,
        children: [
          {
            element: page(<OwnerLayout />),
            children: [
              ...staffRoutes,
              { path: 'guests/:id', element: <RequirePermission permission="guests.read">{page(<GuestDetailsPage />)}</RequirePermission> },
              { path: 'receptionist/:id', element: <RequirePermission permission="conversations.read">{page(<ConversationDetailsPage />)}</RequirePermission> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <PublicLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
    ],
  },
];
