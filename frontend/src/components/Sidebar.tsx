import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FilePlus, History, Bot, Stethoscope, ShoppingCart, LogOut, Settings } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import Logo from './Logo';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/new-test', label: 'New Test', icon: FilePlus },
  { href: '/history', label: 'History & Reports', icon: History },
  { href: '/chatbot', label: 'AI Assistant', icon: Bot },
  { href: '/consult', label: 'Consult Doctor', icon: Stethoscope },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
];

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAuth();

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <Logo size="md" />
      </div>
      <nav className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.label}
            to={item.href}
            className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors ${
              location.pathname.startsWith(item.href)
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-200 space-y-2">
         <Link
            to="/profile"
            className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors ${
              location.pathname.startsWith('/profile')
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <Settings size={20} />
            <span className="font-medium">Profile</span>
        </Link>
         <button
            onClick={logout}
            className="w-full flex items-center space-x-3 px-4 py-2 rounded-lg text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
