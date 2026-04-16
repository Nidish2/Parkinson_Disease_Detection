import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FilePlus, History, Bot, LogOut, Settings, Activity, Layers, Menu, X, Bell, UserCircle, Sun, Moon, Stethoscope, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getDashboardRouteForRole } from '../services/healthcareApi';

interface Notification {
  id: string;
  message: string;
  type: 'test' | 'appointment' | 'general';
  created_at: string;
  read: boolean;
}

type ThemeMode = 'light' | 'dark';

const Navbar = () => {
  const location = useLocation();
  const { profile, user, logout } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const dashboardHref = getDashboardRouteForRole(user?.role);
  const navItems = user?.role === 'doctor'
    ? [
        { href: '/doctor-dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/chatbot', label: 'AI', icon: Bot },
      ]
    : user?.role === 'admin'
      ? [
          { href: '/admin-dashboard', label: 'Dashboard', icon: ShieldCheck },
          { href: '/chatbot', label: 'AI', icon: Bot },
        ]
      : [
          { href: '/patient-dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { href: '/new-test', label: 'New Test', icon: FilePlus },
          { href: '/comprehensive-screening', label: 'Fusion Score', icon: Layers },
          { href: '/therapy', label: 'Therapy', icon: Activity },
          { href: '/history', label: 'History', icon: History },
          { href: '/consult', label: 'Consult', icon: Stethoscope },
          { href: '/chatbot', label: 'AI', icon: Bot },
        ];

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme: ThemeMode = storedTheme === 'dark' || storedTheme === 'light'
      ? storedTheme
      : (prefersDark ? 'dark' : 'light');

    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
  }, []);

  useEffect(() => {
    if (!user) return;
    const checkLocalTests = () => {
      const localTests = JSON.parse(localStorage.getItem('local_tests') || '[]');
      const recentTests = localTests.filter((t: any) => {
        const testTime = new Date(t.created_at).getTime();
        return (Date.now() - testTime) < 5 * 60 * 1000;
      });
      const testNotifications: Notification[] = recentTests.map((t: any) => ({
        id: `test-${t.id}`,
        message: `New ${t.test_type} test completed`,
        type: 'test' as const,
        created_at: t.created_at,
        read: false,
      }));
      setNotifications(testNotifications);
    };
    checkLocalTests();
    const interval = setInterval(checkLocalTests, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const markAsRead = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem('theme', next);
      return next;
    });
  };

  return (
    <>
      <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4">
        <nav className="w-full max-w-6xl bg-background/70 backdrop-blur-md border border-border/50 shadow-soft rounded-full px-4 py-2 flex items-center justify-between transition-all duration-300">
          
          {/* Logo */}
          <Link to={user ? dashboardHref : '/'} className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-full flex items-center justify-center shadow-inner-soft">
               <span className="text-white font-serif font-bold text-xl">N</span>
            </div>
            <span className="font-serif font-bold text-xl hidden sm:block text-foreground">NeuroCare</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  to={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>

             {/* Notifications */}
             <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-4 w-80 bg-background/95 backdrop-blur-xl rounded-[2rem] shadow-float border border-border/50 overflow-hidden transform origin-top-right transition-all">
                  <div className="p-4 border-b border-border/50">
                    <h3 className="font-serif font-bold text-foreground">Notifications</h3>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length > 0 ? (
                      notifications.map((notification) => (
                        <div key={notification.id} className={`p-4 border-b border-border/30 hover:bg-muted/30 transition-colors ${!notification.read ? 'bg-primary/5' : ''}`}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-foreground">{notification.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">{new Date(notification.created_at).toLocaleString()}</p>
                            </div>
                            <button onClick={() => markAsRead(notification.id)} className="text-muted-foreground hover:text-foreground">
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center text-muted-foreground text-sm">No new notifications</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile/Menu Desktop */}
            <div className="hidden sm:flex items-center gap-3 pl-2 border-l border-border/50">
               <Link to="/profile" className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors">
                  <UserCircle size={24} className="text-primary" />
                  <span className="max-w-[100px] truncate">{profile?.full_name || user?.full_name || 'User'}</span>
               </Link>
               <button onClick={logout} className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                 <LogOut size={18} />
               </button>
            </div>

            {/* Mobile Menu Toggle */}
            <button 
              className="lg:hidden h-10 w-10 rounded-full flex items-center justify-center text-foreground hover:bg-muted/50"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
            >
              {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>
      </div>

      {/* Mobile Full Screen Menu */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-xl pt-24 px-4 pb-8 overflow-y-auto animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="max-w-md mx-auto space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.href}
                onClick={() => setIsMobileOpen(false)}
                className="flex items-center gap-4 px-6 py-4 rounded-[2rem] text-lg font-serif font-semibold bg-background/60 border border-border/50 hover:bg-primary/10 hover:text-primary transition-colors"
              >
                <item.icon size={24} className="text-primary" />
                <span>{item.label}</span>
              </Link>
            ))}
            <div className="mt-8 pt-8 border-t border-border/50 grid grid-cols-2 gap-4">
              <Link to="/profile" onClick={() => setIsMobileOpen(false)} className="flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-background/60 border border-border/50 font-semibold hover:bg-muted">
                 <Settings size={18} /> Profile
              </Link>
              <button onClick={() => { setIsMobileOpen(false); logout(); }} className="flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-destructive/10 border border-destructive/20 text-destructive font-semibold hover:bg-destructive/20">
                 <LogOut size={18} /> Logout
              </button>
            </div>
            <button
              onClick={toggleTheme}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-background/60 border border-border/50 font-semibold hover:bg-muted transition-colors"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
