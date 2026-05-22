import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import PropertyDetail from './pages/PropertyDetail';
import Tenants from './pages/Tenants';
import TenantsLedger from './pages/TenantsLedger';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import MeterReadings from './pages/MeterReadings';
import PowerControl from './pages/PowerControl';
import BillGeneration from './pages/BillGeneration';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { Menu, Home, Users, CreditCard, PieChart, Building2, Bell, Settings as SettingsIcon, Zap, Receipt, LogOut } from 'lucide-react';
import './styles/globals.css';

function SidebarLink({ to, icon: Icon, children }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(`${to}/`));

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
        isActive 
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      <Icon size={20} className={isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'} />
      <span className="font-bold text-sm tracking-wide">{children}</span>
    </Link>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [adminName, setAdminName] = React.useState('Admin Owner');

  React.useEffect(() => {
    fetch('/api/settings', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.system && data.system.admin_name) {
          setAdminName(data.system.admin_name);
        }
      })
      .catch(err => console.error('Failed to fetch settings in App:', err));
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Even if request fails, redirect to login
    }
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen bg-gray-50 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-gray-900 text-white p-6 
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:relative md:translate-x-0 transition-transform duration-300 ease-in-out
        border-r border-gray-800 flex flex-col
      `}>
        <div className="flex items-center gap-3 mb-10 px-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Building2 className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-black tracking-tighter">RentManager <span className="text-blue-500 text-xs">v1.0</span></h1>
        </div>

        <nav className="space-y-2 flex-1">
          <p className="px-4 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4">Main Menu</p>
          <SidebarLink to="/" icon={PieChart}>Dashboard</SidebarLink>
          <SidebarLink to="/properties" icon={Home}>Properties</SidebarLink>
          <SidebarLink to="/tenants" icon={Users}>Tenants</SidebarLink>
          <SidebarLink to="/tenants-ledger" icon={CreditCard}>Tenants Ledger</SidebarLink>
          <SidebarLink to="/meter-readings" icon={Zap}>Meter Readings</SidebarLink>
          <SidebarLink to="/bill-generation" icon={Receipt}>Bill Generation</SidebarLink>
          <SidebarLink to="/reports" icon={Bell}>Reports</SidebarLink>
          <SidebarLink to="/power-control" icon={Zap}>Power Control</SidebarLink>
          <SidebarLink to="/settings" icon={SettingsIcon}>Settings</SidebarLink>
        </nav>

        {/* Bottom: user info + logout */}
        <div className="mt-auto pt-6 border-t border-gray-800">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-9 h-9 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-lg shadow-blue-900/40 flex-shrink-0">
              {adminName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-white truncate">{adminName}</p>
              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Admin</p>
            </div>
          </div>
          <button
            id="logout-button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200 group"
          >
            <LogOut size={18} className="text-gray-500 group-hover:text-red-400 transition-colors" />
            <span className="font-bold text-sm tracking-wide">Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-20 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 flex items-center justify-between relative z-40 flex-shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <Menu size={24} />
          </button>
          
          <div className="flex-1 max-w-xl mx-8 hidden md:block">
            {/* Global Search could go here */}
          </div>

          <div className="flex items-center gap-6">
            <button className="p-2.5 text-gray-400 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all relative">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="h-8 w-px bg-gray-100"></div>
            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-black text-gray-900">{adminName}</p>
                <p className="text-[10px] font-bold text-emerald-500 uppercase">Verified Account</p>
              </div>
              <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-200">
                {adminName.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto scroll-smooth">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/properties/:id" element={<PropertyDetail />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants-ledger" element={<TenantsLedger />} />
            <Route path="/meter-readings" element={<MeterReadings />} />
            <Route path="/bill-generation" element={<BillGeneration />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/power-control" element={<PowerControl />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* Public route — no auth required */}
        <Route path="/login" element={<Login />} />

        {/* All other routes — require login */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppContent />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
