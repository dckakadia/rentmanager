import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard, getCollectionStats } from '../services/api';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  Home, 
  AlertCircle, 
  DollarSign, 
  TrendingUp, 
  Users, 
  Zap, 
  ArrowUpRight,
  Plus,
  PieChart as PieChartIcon
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [nextRetryIn, setNextRetryIn] = useState(0);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Auto-retry when error occurs, up to 3 attempts
  useEffect(() => {
    let timer;
    if (error && retryCount < 3) {
      let countdown = 5; // seconds until next retry
      setNextRetryIn(countdown);
      timer = setInterval(() => {
        countdown -= 1;
        setNextRetryIn(countdown);
        if (countdown <= 0) {
          clearInterval(timer);
          setRetryCount(c => c + 1);
          fetchDashboardData();
        }
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [error, retryCount]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setRetryCount(0);
      const [dashResult, statsResult] = await Promise.allSettled([
        getDashboard(),
        getCollectionStats(),
      ]);

      if (dashResult.status === 'fulfilled') {
        setDashboard(dashResult.value.data || null);
        setError(null);
      } else {
        console.error('Error fetching dashboard:', dashResult.reason);
        const reason = dashResult.reason?.response?.data?.message || dashResult.reason?.message || 'Unknown network error';
        setError(`Failed to load dashboard data. ${reason}. Ensure the backend is running on port 5000.`);
      }

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value.data || []);
      } else {
        console.error('Error fetching collection stats:', statsResult.reason);
        setStats([]);
      }
    } catch (err) {
      console.error('Unexpected dashboard error:', err);
      setError(`Failed to load dashboard data. ${err?.message || 'Unknown error'}. Ensure the backend is running on port 5000.`);
      setStats([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
    </div>
  );

  if (error) return (
    <div className="p-8">
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-6 rounded-2xl flex items-center gap-4">
        <AlertCircle size={32} />
        <div>
          <h3 className="font-bold text-lg">Dashboard Unavailable</h3>
          <p>{error}</p>
          <div className="mt-2 flex items-center gap-4">
            <button onClick={() => { setRetryCount(0); setError(null); fetchDashboardData(); }} className="text-sm font-bold underline">Try Now</button>
            {retryCount < 3 ? (
              <div className="text-sm text-gray-600">Auto-retrying in {nextRetryIn}s (attempt {retryCount + 1}/3)</div>
            ) : (
              <div className="text-sm text-gray-600">Auto-retries exhausted. Click "Try Now" to retry.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const summary = dashboard?.summary || { total_properties: 0, occupied_count: 0, vacant_count: 0, power_off_count: 0 };
  const financial = dashboard?.financial || { expected_monthly_income: 0, actual_collections: 0, collection_percentage: 0, net_income: 0, electricity_expense: 0, sweeper_expense: 0 };


  return (
    <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Executive Overview</h1>
          <p className="text-gray-500 mt-1 font-medium">Welcome back! Here's what's happening with your properties today.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchDashboardData}
            className={`p-2.5 bg-white border border-gray-100 rounded-xl text-gray-400 hover:text-blue-600 transition-all shadow-sm ${loading ? 'animate-spin text-blue-600' : ''}`}
            title="Refresh Data"
          >
            <PieChartIcon size={20} />
          </button>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
        
        {/* Occupancy Card */}
        <div className="card group hover:bg-blue-600 transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-50 rounded-2xl group-hover:bg-blue-500 transition-colors">
              <Users className="text-blue-600 group-hover:text-white" size={24} />
            </div>
            <span className="text-xs font-bold text-blue-600 group-hover:text-blue-200 bg-blue-50 group-hover:bg-blue-500 px-2 py-1 rounded-full">
              +{summary.total_properties > 0 ? Math.round((summary.occupied_count/summary.total_properties)*100) : 0}%
            </span>
          </div>
          <p className="text-sm font-bold text-gray-400 group-hover:text-blue-100 uppercase tracking-widest">Total Occupancy</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-black text-gray-900 group-hover:text-white">{summary.occupied_count}</h3>
            <span className="text-lg font-bold text-gray-400 group-hover:text-blue-200">/ {summary.total_properties} Units</span>
          </div>
        </div>

        {/* Expected Income Card */}
        <div className="card group hover:bg-emerald-600 transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-emerald-50 rounded-2xl group-hover:bg-emerald-500 transition-colors">
              <DollarSign className="text-emerald-600 group-hover:text-white" size={24} />
            </div>
            <ArrowUpRight className="text-emerald-500 group-hover:text-emerald-200" size={20} />
          </div>
          <p className="text-sm font-bold text-gray-400 group-hover:text-emerald-100 uppercase tracking-widest">Expected Revenue</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-black text-gray-900 group-hover:text-white">₹{financial.expected_monthly_income.toLocaleString()}</h3>
          </div>
        </div>

        {/* Collections Card */}
        <div className="card group hover:bg-amber-500 transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-amber-50 rounded-2xl group-hover:bg-amber-400 transition-colors">
              <TrendingUp className="text-amber-600 group-hover:text-white" size={24} />
            </div>
            <span className="text-xs font-bold text-amber-600 group-hover:text-amber-100 bg-amber-50 group-hover:bg-amber-400 px-2 py-1 rounded-full">
              {financial.collection_percentage}%
            </span>
          </div>
          <p className="text-sm font-bold text-gray-400 group-hover:text-amber-50 uppercase tracking-widest">Realized Cash</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-black text-gray-900 group-hover:text-white">₹{financial.actual_collections.toLocaleString()}</h3>
          </div>
        </div>

        {/* Power Status Card */}
        <div className="card group hover:bg-rose-600 transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-rose-50 rounded-2xl group-hover:bg-rose-500 transition-colors">
              <Zap className="text-rose-600 group-hover:text-white" size={24} />
            </div>
            <span className="animate-pulse w-3 h-3 bg-rose-500 group-hover:bg-white rounded-full"></span>
          </div>
          <p className="text-sm font-bold text-gray-400 group-hover:text-rose-100 uppercase tracking-widest">Units Offline</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-black text-gray-900 group-hover:text-white">{summary.power_off_count}</h3>
            <span className="text-lg font-bold text-gray-400 group-hover:text-rose-200">Properties</span>
          </div>
        </div>
      </div>

      {/* Middle Section: Chart & Financials */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
        
        {/* Analytics Chart */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-gray-900">Collections Intelligence</h2>
            <div className="flex gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-400">
                <span className="w-3 h-3 bg-blue-600 rounded-full"></span> Expected
              </span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-400">
                <span className="w-3 h-3 bg-emerald-500 rounded-full"></span> Actual
              </span>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis 
                  dataKey="month" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }}
                  dx={-10}
                />
                <Tooltip 
                  cursor={{ fill: '#F9FAFB' }}
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: 'none', 
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    padding: '12px'
                  }}
                  formatter={(value) => [`₹${value.toLocaleString()}`, '']}
                />
                <Bar dataKey="expected" fill="#3B82F6" radius={[6, 6, 0, 0]} barSize={32} />
                <Bar dataKey="actual" fill="#10B981" radius={[6, 6, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Financial Breakdown */}
        <div className="card">
          <div className="flex items-start sm:items-center gap-2.5 mb-6">
            <div className="p-2 bg-purple-50 rounded-xl text-purple-600 flex-shrink-0">
              <PieChartIcon size={20} />
            </div>
            <h2 className="text-lg font-black text-gray-900 leading-tight">
              Income & Expense Breakdown
            </h2>
          </div>

          <div className="space-y-8">
            {/* Income Section */}
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Realized Income</h3>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-emerald-50/60 hover:bg-emerald-50 border border-emerald-100/50 rounded-xl transition-all duration-200">
                  <span className="font-bold text-emerald-800 text-sm">Expected Rent</span>
                  <span className="font-black text-emerald-950 text-base">₹{financial.expected_monthly_income.toLocaleString()}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-blue-50/60 hover:bg-blue-50 border border-blue-100/50 rounded-xl transition-all duration-200">
                  <span className="font-bold text-blue-800 text-sm">Actual Collections</span>
                  <span className="font-black text-blue-950 text-base">₹{financial.actual_collections.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Expenses Section */}
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Operating Expenses</h3>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-rose-50/60 hover:bg-rose-50 border border-rose-100/50 rounded-xl transition-all duration-200">
                  <span className="font-bold text-rose-800 text-sm">Electricity (Manual + Common)</span>
                  <span className="font-black text-rose-950 text-base">-₹{financial.electricity_expense.toLocaleString()}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-rose-50/60 hover:bg-rose-50 border border-rose-100/50 rounded-xl transition-all duration-200">
                  <span className="font-bold text-rose-800 text-sm">Sweeper</span>
                  <span className="font-black text-rose-950 text-base">-₹{financial.sweeper_expense.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Final Tally */}
            <div className="pt-6 border-t border-gray-100">
              <div className="flex justify-between items-center p-5 bg-gray-900 text-white rounded-2xl shadow-xl">
                <div>
                  <p className="text-xs opacity-70 uppercase font-bold">Monthly Balance</p>
                  <p className="text-2xl font-black">Net Income</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black">₹{financial.net_income.toLocaleString()}</p>
                  <p className="text-xs text-green-400 font-bold">Ready for withdrawal</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// Sub-components helpers
function ArrowRight({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function CheckCircle2({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  );
}
