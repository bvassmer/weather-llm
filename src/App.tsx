import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

function App() {
  const location = useLocation();

  const onWidePage =
    location.pathname === '/' ||
    location.pathname.startsWith('/prompt') ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/alerts') ||
    location.pathname.startsWith('/queue') ||
    location.pathname.startsWith('/email-templates');

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `btn btn-ghost btn-sm ${isActive ? 'btn-active' : ''}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-primary/20 bg-base-100/50 bg-primary/10 backdrop-blur-md backdrop-saturate-150">
        <div className="navbar mx-auto max-w-6xl px-4">
          <div className="flex-1">
            <Link to="/" className="text-lg font-semibold whitespace-nowrap">
              Weather LLM
            </Link>
          </div>
          <div className="flex-none">
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navItemClass}>
                Prompt
              </NavLink>
              <NavLink to="/alerts" className={navItemClass}>
                Alerts
              </NavLink>
              <NavLink to="/queue" className={navItemClass}>
                Queue
              </NavLink>
              <NavLink to="/email-templates" className={navItemClass}>
                Email Preview
              </NavLink>
              <NavLink to="/settings" className={navItemClass}>
                Settings
              </NavLink>
            </nav>
          </div>
        </div>
      </header>
      <main className={onWidePage ? 'mx-auto max-w-6xl p-6' : 'mx-auto max-w-3xl p-6'}>
        <Outlet />
      </main>
    </div>
  );
}

export default App;