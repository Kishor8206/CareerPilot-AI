import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Bot, Briefcase, Building2, ClipboardCheck, Code2, Compass, FileText,
  GraduationCap, LayoutDashboard, LogOut, type LucideIcon, Menu, MessageSquare, Moon,
  Settings, Shield, Sun, Target, TrendingUp, UserCircle, Users, X,
} from 'lucide-react';
import { UserRole } from '@careerpilot/shared';
import { Badge, Button } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { useTheme } from '@/hooks/useTheme';
import { initials } from '@/utils/format';
import { cn } from '@/utils/cn';
import { NotificationPanel } from '@/components/domain/NotificationPanel';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

/**
 * Navigation is defined once and filtered by role, so a user never sees a link
 * they cannot use. The API enforces the same rules independently - this is a
 * usability measure, not the security boundary.
 */
const NAV_ITEMS: NavItem[] = [
  // Student
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.STUDENT] },
  { to: '/profile', label: 'Profile', icon: UserCircle, roles: [UserRole.STUDENT] },
  { to: '/resume', label: 'Resume & ATS', icon: FileText, roles: [UserRole.STUDENT] },
  { to: '/job-matching', label: 'Job Matching', icon: Target, roles: [UserRole.STUDENT] },
  { to: '/assessments', label: 'Assessments', icon: ClipboardCheck, roles: [UserRole.STUDENT] },
  { to: '/coding', label: 'Coding Practice', icon: Code2, roles: [UserRole.STUDENT] },
  { to: '/interview', label: 'AI Interview', icon: Bot, roles: [UserRole.STUDENT] },
  { to: '/readiness', label: 'Readiness', icon: TrendingUp, roles: [UserRole.STUDENT] },
  { to: '/career', label: 'Career Plan', icon: Target, roles: [UserRole.STUDENT] },
  { to: '/alumni', label: 'Find a Mentor', icon: Users, roles: [UserRole.STUDENT] },
  { to: '/mentorship', label: 'My Mentorship', icon: GraduationCap, roles: [UserRole.STUDENT] },
  { to: '/reports', label: 'Reports', icon: FileText, roles: [UserRole.STUDENT] },

  // Alumni
  { to: '/alumni/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.ALUMNI] },
  { to: '/alumni/profile', label: 'My Profile', icon: UserCircle, roles: [UserRole.ALUMNI] },
  { to: '/alumni/requests', label: 'Requests', icon: Bell, roles: [UserRole.ALUMNI] },
  { to: '/alumni/sessions', label: 'Sessions', icon: GraduationCap, roles: [UserRole.ALUMNI] },
  { to: '/alumni/feedback', label: 'Feedback Given', icon: MessageSquare, roles: [UserRole.ALUMNI] },

  // Placement officer
  { to: '/placement/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.PLACEMENT_OFFICER] },
  { to: '/placement/students', label: 'Students', icon: Users, roles: [UserRole.PLACEMENT_OFFICER] },
  { to: '/placement/analytics', label: 'Analytics', icon: BarChart3, roles: [UserRole.PLACEMENT_OFFICER] },
  { to: '/placement/reports', label: 'Reports', icon: FileText, roles: [UserRole.PLACEMENT_OFFICER] },

  // Admin
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.ADMIN] },
  { to: '/admin/users', label: 'Users', icon: Users, roles: [UserRole.ADMIN] },
  { to: '/admin/alumni', label: 'Alumni Verification', icon: Shield, roles: [UserRole.ADMIN] },
  { to: '/admin/companies', label: 'Companies', icon: Building2, roles: [UserRole.ADMIN] },
  { to: '/admin/jobs', label: 'Job Descriptions', icon: Briefcase, roles: [UserRole.ADMIN] },
  { to: '/admin/ai', label: 'AI & Knowledge Base', icon: Bot, roles: [UserRole.ADMIN] },
  { to: '/admin/audit', label: 'Audit Log', icon: Shield, roles: [UserRole.ADMIN] },
];

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { unreadCount } = useNotifications();

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);

  // Close the mobile drawer on navigation, so a tap does not leave it covering
  // the page the user just opened.
  React.useEffect(() => {
    setSidebarOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  const items = React.useMemo(
    () => (user ? NAV_ITEMS.filter((item) => item.roles.includes(user.role)) : []),
    [user],
  );

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const roleLabel = {
    STUDENT: 'Student',
    ALUMNI: 'Alumni Mentor',
    PLACEMENT_OFFICER: 'Placement Officer',
    ADMIN: 'Administrator',
    RECRUITER: 'Recruiter',
  }[user?.role ?? 'STUDENT'];

  return (
    <div className="min-h-screen bg-background">
      {/* Skip link: the first tab stop for keyboard users. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <aside
        className={cn(
          'app-chrome fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Compass className="size-5 text-primary" aria-hidden />
          <span className="font-semibold tracking-tight">CareerPilot AI</span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-thin p-3" aria-label="Main navigation">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/alumni'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials(user?.fullName ?? '?')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          </div>

          {user?.role === UserRole.ALUMNI && user.alumniVerification !== 'VERIFIED' && (
            <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2">
              <p className="text-xs text-warning">
                Verification {user.alumniVerification?.toLowerCase()}. You can mentor students once an
                administrator verifies your employment.
              </p>
            </div>
          )}

          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={handleLogout}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="app-chrome fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="app-chrome sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            {import.meta.env.VITE_DEMO_MODE === 'true' && (
              <Badge variant="warning" className="mr-2 hidden sm:inline-flex">
                Demo mode
              </Badge>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                aria-expanded={notificationsOpen}
              >
                <Bell className="size-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && <NotificationPanel onClose={() => setNotificationsOpen(false)} />}
            </div>

            <Link
              to="/settings"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Settings and privacy"
            >
              <Settings className="size-4" />
            </Link>
          </div>
        </header>

        <main id="main-content" className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
