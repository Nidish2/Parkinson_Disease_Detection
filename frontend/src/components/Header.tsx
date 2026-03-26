import { Bell, UserCircle, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect } from 'react';
import { mongodb } from '../lib/mongodbClient';

interface Notification {
  id: string;
  message: string;
  type: 'test' | 'appointment' | 'general';
  created_at: string;
  read: boolean;
}

const Header = () => {
  const { profile, user } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;

    // Check for new tests in localStorage
    const checkLocalTests = () => {
      const localTests = JSON.parse(localStorage.getItem('local_tests') || '[]');
      const recentTests = localTests.filter((t: any) => {
        const testTime = new Date(t.created_at).getTime();
        const now = Date.now();
        return (now - testTime) < 5 * 60 * 1000; // Last 5 minutes
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
    const interval = setInterval(checkLocalTests, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  return (
    <header className="bg-white border-b border-gray-200 p-4 flex justify-end items-center shadow-sm">
      <div className="flex items-center space-x-4">
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative text-gray-600 hover:text-gray-900 transition-colors"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length > 0 ? (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-sm text-gray-900">{notification.message}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(notification.created_at).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <p className="text-sm">No new notifications</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <UserCircle size={24} className="text-gray-600" />
          <span className="text-sm font-medium text-gray-900">{profile?.full_name || 'User'}</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
