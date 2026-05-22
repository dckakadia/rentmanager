import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getElectricityReport } from '../services/api';
import { generateElectricityReportPdf } from '../utils/pdfGenerator';
import { 
  Calendar, 
  Download,
  Zap,
  Activity,
} from 'lucide-react';

export default function Reports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [electricityData, setElectricityData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchReportsData();
  }, [selectedMonth]);

  const fetchReportsData = async () => {
    try {
      setLoading(true);
      const elecRes = await getElectricityReport(selectedMonth);
      setElectricityData(elecRes.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  // Pending collections feature removed — no-op placeholder kept intentionally.

  if (loading && electricityData.length === 0) {
    return (
      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          <div className="h-28 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-28 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-28 bg-gray-200 rounded-lg animate-pulse" />
        </div>
        <div className="h-64 bg-gray-200 rounded-lg animate-pulse" />
      </div>
    );
  }
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  const totalConsumption = electricityData.reduce((sum, i) => sum + (i.units_consumed || 0), 0);
  const totalCost = electricityData.reduce((sum, i) => sum + (i.cost || 0), 0);
  const totalPendingAmount = 0;

  const filteredData = electricityData.filter((item) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      String(item.room_number || '').toLowerCase().includes(term) ||
      String(item.tenant_name || '').toLowerCase().includes(term) ||
      String(item.meter_number || '').toLowerCase().includes(term)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));
  const paginatedData = filteredData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const exportCsv = () => {
    if (!electricityData || electricityData.length === 0) return;
    const headers = ['Unit', 'Meter No.', 'Tenant', 'Previous', 'Current', 'Units', 'Cost'];
    const rows = electricityData.map((i) => [
      i.room_number,
      i.meter_number || '-',
      i.tenant_name || '-',
      i.previous_reading || 0,
      i.current_reading || 0,
      i.units_consumed || 0,
      i.cost || 0,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `electricity-report-${selectedMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Monthly Reports</h1>
          <p className="text-gray-500 mt-1">Financial performance and expense breakdown</p>
        </div>

        <div className="flex items-center gap-3 bg-white p-2 rounded-lg shadow-sm border">
          <Calendar size={18} className="text-gray-400 ml-2" />
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border-none focus:ring-0 text-gray-700 font-semibold"
          />
        </div>
      </div>

      {/* KPI Cards — compact side-by-side icon + value layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
        <div className="card group hover:bg-blue-600 transition-all duration-300 shadow-sm hover:shadow-xl">
          <div className="flex items-center gap-4 py-1">
            <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 group-hover:bg-blue-500 group-hover:text-white transition-colors flex-shrink-0">
              <Zap size={22} />
            </div>
            <div>
              <p className="text-[11px] font-black text-gray-400 group-hover:text-blue-100 uppercase tracking-widest transition-colors">Total Energy Billed</p>
              <h3 className="text-4xl font-black text-gray-900 group-hover:text-white transition-colors leading-tight">₹{totalCost.toLocaleString()}</h3>
            </div>
          </div>
        </div>

        <div className="card group hover:bg-emerald-600 transition-all duration-300 shadow-sm hover:shadow-xl">
          <div className="flex items-center gap-4 py-1">
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition-colors flex-shrink-0">
              <Activity size={22} />
            </div>
            <div>
              <p className="text-[11px] font-black text-gray-400 group-hover:text-emerald-100 uppercase tracking-widest transition-colors">Consumption</p>
              <h3 className="text-4xl font-black text-gray-900 group-hover:text-white transition-colors leading-tight">{totalConsumption} <span className="text-2xl font-black">KWh</span></h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
        <div className="card animate-in slide-in-from-bottom-4 duration-500 shadow-lg border-t-4 border-t-blue-500">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-black flex items-center gap-2">
              <Zap className="text-amber-500" fill="currentColor" size={18} />
              Monthly Electricity Report
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => generateElectricityReportPdf(electricityData, selectedMonth)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-md hover:shadow-lg transition-all"
              >
                <Download size={15} /> Print Report
              </button>
              <button
                onClick={exportCsv}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 hover:text-gray-900 text-xs font-black uppercase tracking-wider rounded-lg shadow-sm hover:shadow transition-all"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="px-2">
            <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
              <input
                type="text"
                placeholder="Search unit, tenant or meter..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full md:w-56 focus:outline-none focus:border-blue-400 transition-colors"
              />
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Rows:</label>
                <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="border rounded-lg px-2 py-1">
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b-2 border-gray-200">
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-700">Unit</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-700">Meter No.</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-700">Tenant</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-center text-gray-700">Previous</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-center text-gray-700">Current</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-center text-gray-700">Units</th>
                    <th className="px-4 py-2 text-xs font-black uppercase tracking-widest text-right text-gray-700">Cost (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-2 font-black text-gray-900 text-sm">{item.room_number}</td>
                      <td className="px-4 py-2 text-xs font-bold text-gray-400">{item.meter_number || '-'}</td>
                      <td className="px-4 py-2 text-sm font-bold text-gray-600">{item.tenant_name || <span className="text-gray-300 italic">Vacant</span>}</td>
                      <td className="px-4 py-2 text-center font-bold text-gray-500 text-sm">{item.previous_reading || 0}</td>
                      <td className="px-4 py-2 text-center font-black text-gray-900 text-sm">{item.current_reading || 0}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-lg font-black text-xs ${item.units_consumed > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-300'}`}>
                          {item.units_consumed || 0}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-black text-blue-600 text-sm">₹{(item.cost || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-900 text-white font-black">
                    <td colSpan="5" className="px-4 py-2.5 text-right uppercase tracking-widest text-xs">Total Consumption</td>
                    <td className="px-4 py-2.5 text-center text-amber-400">{totalConsumption}</td>
                    <td className="px-4 py-2.5 text-right">₹{totalCost.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">Showing {paginatedData.length} of {filteredData.length} entries</p>
              <div className="flex items-center gap-2">
                <button disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
                <div className="text-sm text-gray-700">{currentPage} / {totalPages}</div>
                <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
