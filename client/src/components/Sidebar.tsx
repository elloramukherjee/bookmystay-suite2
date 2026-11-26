import { NavLink } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { NAV_ITEMS, SECTION_LABELS, type ModuleKey } from '../routes/navigation';
import { cn } from '../utils/format';

const ORDER: ModuleKey[] = ['overview', 'booking', 'receptionist', 'crm', 'admin'];

/** Desktop sub-navigation; permission-filtered so each role only sees what it can open. */
export function Sidebar() {
  const { can } = useAuth();
  const visible = NAV_ITEMS.filter((i) => can(i.permission));

  return (
    <aside
      className="sticky top-[112px] hidden h-[calc(100vh-112px)] w-64 shrink-0 overflow-y-auto border-r border-line bg-parchment py-6 pr-3 pl-6 lg:block"
      aria-label="Sections"
    >
      <nav className="flex flex-col gap-6">
        {ORDER.map((section) => {
          const items = visible.filter((i) => i.module === section);
          if (!items.length) return null;
          return (
            <div key={section}>
              <p className="eyebrow mb-2 px-3">{SECTION_LABELS[section]}</p>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/app'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-full px-3 py-2.5 text-label-lg transition-colors',
                          isActive ? 'bg-forest text-white' : 'text-slate hover:bg-forest-50 hover:text-forest',
                        )
                      }
                    >
                      <item.icon className="size-[18px] shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
                      {!item.available && (
                        <span className="shrink-0 text-[10px] font-bold text-sage" title={`Ships in phase ${item.phase}`}>
                          P{item.phase}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
