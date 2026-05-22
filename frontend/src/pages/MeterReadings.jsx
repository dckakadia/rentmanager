import React, { useState, useEffect, useRef } from 'react';
import { getAllLatestReadings, recordMeterReading, getMeterReadings, updateMeterReading, deleteMeterReading } from '../services/api';
import { generateMeterCollectionSheet } from '../utils/pdfGenerator';
import { 
  Zap, 
  Search, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  History,
  Building2,
  Calendar,
  Clock,
  Trash2,
  Printer
} from 'lucide-react';

export default function MeterReadings() {
  const [readings, setReadings] = useState([]);
  const inputRefs = useRef({}); // Store refs to inputs by index
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState(null);
  const [currentEntries, setCurrentEntries] = useState({}); // { propertyId: value }
  const [batchDate, setBatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [showHistoryModal, setShowHistoryModal] = useState(null); // property object
  const [historyList, setHistoryList] = useState([]);
  const [editingReading, setEditingReading] = useState(null); // id of reading being edited

  useEffect(() => {
    fetchReadings();
  }, []);

  const fetchHistory = async (propertyId) => {
    try {
      setLoading(true);
      console.log('Fetching history for property:', propertyId);
      const res = await getMeterReadings(propertyId);
      console.log('History response:', res.data);
      // Only show last 3 for modification as requested
      setHistoryList(res.data.slice(0, 3));
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateHistory = async (id, updatedData) => {
    try {
      setLoading(true);
      await updateMeterReading(id, updatedData);
      setMessage({ type: 'success', text: 'Historical reading updated successfully!' });
      setEditingReading(null);
      await fetchHistory(showHistoryModal.id);
      await fetchReadings();
    } catch (err) {
      console.error('Failed to update history:', err);
      setMessage({ type: 'error', text: 'Failed to update historical reading.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHistory = async (id) => {
    if (!window.confirm('Are you sure you want to delete this reading? This cannot be undone.')) return;
    try {
      setLoading(true);
      await deleteMeterReading(id);
      setMessage({ type: 'success', text: 'Historical reading deleted!' });
      await fetchHistory(showHistoryModal.id);
      await fetchReadings();
    } catch (err) {
      console.error('Failed to delete history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPast = async (propertyId, data) => {
    try {
      setLoading(true);
      await recordMeterReading({
        property_id: propertyId,
        current_reading: parseFloat(data.current_reading),
        reading_date: data.reading_date
      });
      setMessage({ type: 'success', text: 'Historical reading added successfully!' });
      await fetchHistory(propertyId);
      await fetchReadings();
    } catch (err) {
      console.error('Failed to add past reading:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReadings = async () => {
    try {
      setLoading(true);
      const res = await getAllLatestReadings();
      setReadings(res.data);
    } catch (err) {
      console.error('Failed to fetch readings:', err);
      setMessage({ type: 'error', text: 'Failed to load meter data.' });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (propertyId, value) => {
    setCurrentEntries(prev => ({
      ...prev,
      [propertyId]: value
    }));
  };

  const handleSaveAll = async () => {
    const entriesToSave = Object.entries(currentEntries).filter(([_, value]) => value && !isNaN(value) && parseFloat(value) > 0);
    
    if (entriesToSave.length === 0) {
      alert('No valid readings entered to save.');
      return;
    }

    if (!window.confirm(`Are you sure you want to save ${entriesToSave.length} readings at once?`)) return;

    try {
      setLoading(true);
      setMessage(null);
      const date = batchDate;
      
      const savePromises = entriesToSave.map(([propertyId, value]) => 
        recordMeterReading({
          property_id: parseInt(propertyId),
          current_reading: parseFloat(value),
          reading_date: date
        })
      );

      await Promise.all(savePromises);
      
      setMessage({ type: 'success', text: `Successfully saved ${entriesToSave.length} readings!` });
      await fetchReadings();
      setCurrentEntries({}); // Clear all inputs
    } catch (err) {
      console.error('Bulk save failed:', err);
      setMessage({ type: 'error', text: 'Failed to save some readings. Please check your connection.' });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = index + 1;
      if (inputRefs.current[nextIndex]) {
        inputRefs.current[nextIndex].focus();
        inputRefs.current[nextIndex].select();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = index - 1;
      if (inputRefs.current[prevIndex]) {
        inputRefs.current[prevIndex].focus();
        inputRefs.current[prevIndex].select();
      }
    }
  };

  const handleSave = async (propertyId, customData = null) => {
    const value = customData ? customData.current_reading : currentEntries[propertyId];
    const date = customData ? customData.reading_date : new Date().toISOString().split('T')[0];

    if (!value || isNaN(value)) {
      alert('Please enter a valid reading number');
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      await recordMeterReading({
        property_id: propertyId,
        current_reading: parseFloat(value),
        reading_date: date
      });
      
      setMessage({ type: 'success', text: `Reading saved for ${readings.find(r => r.id === propertyId)?.room_number}` });
      
      // Update local state to reflect new last reading if it's the latest
      await fetchReadings();

      // Clear input
      if (!customData) {
        setCurrentEntries(prev => {
          const next = { ...prev };
          delete next[propertyId];
          return next;
        });
      } else {
        setShowHistoryModal(null);
      }
    } catch (err) {
      console.error('Save failed:', err);
      setMessage({ type: 'error', text: 'Failed to save reading.' });
    } finally {
      setLoading(false);
    }
  };

  const uniqueDates = [...new Set(readings.flatMap(r => (r.history || []).map(h => h.date)))]
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, 4)
    .reverse();

  const filteredReadings = readings.filter(r => 
    r.room_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.tenant_name && r.tenant_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (r.meter_number && r.meter_number.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="p-8 w-full max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Zap className="text-blue-600" fill="currentColor" size={36} /> Meter Readings
          </h1>
          <p className="text-gray-500 mt-1 font-medium italic">Enter and track electricity usage for all properties.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="date" 
              value={batchDate}
              onChange={(e) => setBatchDate(e.target.value)}
              className="bg-white border-2 border-gray-100 rounded-2xl pl-12 pr-4 py-3 font-bold text-gray-900 outline-none focus:border-blue-500 transition-all shadow-sm"
            />
          </div>
          <div className="relative flex-1 md:flex-initial">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-48 bg-white border-2 border-gray-100 rounded-2xl pl-12 pr-4 py-3 font-bold text-gray-900 outline-none focus:border-blue-500 transition-all shadow-sm"
            />
          </div>
          <button 
            onClick={() => generateMeterCollectionSheet(filteredReadings)}
            className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-gray-100 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest shadow-sm hover:border-gray-200 hover:bg-gray-50 transition-all"
          >
            <Printer size={18} />
            Print Sheet
          </button>
          <button 
            onClick={handleSaveAll}
            disabled={loading || Object.keys(currentEntries).length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-400 disabled:shadow-none transition-all"
          >
            <Save size={18} />
            {loading ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-8 p-4 rounded-2xl flex items-center gap-3 border animate-in slide-in-from-top-2 ${
          message.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <p className="font-bold">{message.text}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="px-4 py-2.5 text-xs font-black uppercase tracking-widest whitespace-nowrap">Unit / Meter No.</th>
                
                {uniqueDates.length > 0 ? (
                  uniqueDates.map(date => {
                    const parts = date.split('-');
                    const formattedDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : date;
                    return (
                      <th key={date} className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-center whitespace-nowrap">
                        <span className="text-gray-400 font-bold">Past Reading</span><br/>({formattedDate})
                      </th>
                    );
                  })
                ) : (
                  <th className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-center">Past Readings</th>
                )}
                <th className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-center">Current Entry</th>
                <th className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-center">Consumption</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && readings.length === 0 ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={uniqueDates.length > 0 ? 4 + uniqueDates.length : 5} className="px-6 py-8 h-12 bg-gray-50/50"></td>
                  </tr>
                ))
              ) : filteredReadings.length === 0 ? (
                <tr>
                  <td colSpan={uniqueDates.length > 0 ? 4 + uniqueDates.length : 5} className="px-6 py-20 text-center text-gray-400 font-bold italic">
                    No properties found matching your search.
                  </td>
                </tr>
              ) : filteredReadings.map((reading, index) => {
                const currentVal = currentEntries[reading.id] || '';
                const consumption = currentVal && !isNaN(currentVal) 
                  ? parseFloat(currentVal) - (reading.last_reading || 0)
                  : 0;

                return (
                  <tr key={reading.id} className="hover:bg-blue-50/20 transition-colors group">
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-black text-gray-900 text-sm tracking-tight">{reading.room_number}</p>
                            {reading.meter_number && (
                              <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                                M: {reading.meter_number}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter leading-none mt-0.5">
                            {reading.tenant_name || <span className="text-rose-400 italic font-medium">Vacant</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    {uniqueDates.length > 0 ? (
                      uniqueDates.map(date => {
                        const hist = (reading.history || []).find(h => h.date === date);
                        return (
                          <td key={date} className="px-4 py-1.5 text-center">
                            {hist ? (
                              <span className="font-black text-gray-700 text-sm">{hist.reading}</span>
                            ) : (
                              <span className="text-gray-300 font-bold">-</span>
                            )}
                          </td>
                        );
                      })
                    ) : (
                      <td className="px-4 py-1.5 text-center">
                        <span className="font-black text-gray-700 text-sm">{reading.last_reading || 0}</span>
                        <p className="text-[9px] text-gray-400 font-bold uppercase mt-0">
                          {reading.last_reading_date ? new Date(reading.last_reading_date).toLocaleDateString() : 'Initial'}
                        </p>
                      </td>
                    )}
                    <td className="px-3 py-1 text-center">
                      <input 
                        ref={el => inputRefs.current[index] = el}
                        type="number" 
                        step="0.01"
                        placeholder="—"
                        value={currentVal}
                        onChange={(e) => handleInputChange(reading.id, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        className="w-[110px] bg-white border border-gray-300 rounded-none px-2 py-1 font-bold text-blue-700 outline-none focus:border-blue-500 focus:border-2 focus:bg-blue-50/40 transition-all text-center text-sm"
                      />
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      <span className={`font-black text-sm ${
                        consumption < 0 ? 'text-rose-600' : 
                        consumption > 0 ? 'text-blue-600' : 
                        'text-gray-300'
                      }`}>
                        {consumption > 0 ? `+${consumption.toFixed(2)}` : consumption > 0 || consumption < 0 ? consumption.toFixed(2) : '—'}
                      </span>
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter leading-none mt-0">kWh</p>
                    </td>
                    <td className="px-3 py-1 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button 
                          onClick={() => {
                            setShowHistoryModal(reading);
                            fetchHistory(reading.id);
                          }}
                          className="p-1.5 text-gray-400 rounded hover:bg-gray-100 hover:text-gray-600 transition-all"
                          title="View History & Edit"
                        >
                          <History size={15} />
                        </button>
                        <button 
                          onClick={() => handleSave(reading.id)}
                          disabled={!currentVal || loading}
                          className={`p-1.5 rounded transition-all ${
                            currentVal 
                              ? 'bg-blue-600 text-white hover:bg-blue-700' 
                              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                          }`}
                        >
                          <Save size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reading History & Edit Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-400">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
                  <History size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">Reading History</h2>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Last 3 Readings for {showHistoryModal.room_number}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowHistoryModal(null)}
                className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center transition-colors text-gray-400"
              >
                ✕
              </button>
            </div>

            <div className="p-8">
              <div className="space-y-4">
                {historyList.map((reading) => (
                  <div key={reading.id} className="p-4 rounded-2xl border-2 border-gray-50 bg-white hover:border-blue-100 transition-all">
                    {editingReading === reading.id ? (
                      <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Reading Value</label>
                          <input 
                            type="number"
                            defaultValue={reading.current_reading}
                            id={`edit-val-${reading.id}`}
                            className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 font-black text-blue-600 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex-1 space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date</label>
                          <input 
                            type="date"
                            defaultValue={reading.reading_date}
                            id={`edit-date-${reading.id}`}
                            className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 font-black text-gray-900 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              const val = document.getElementById(`edit-val-${reading.id}`).value;
                              const date = document.getElementById(`edit-date-${reading.id}`).value;
                              handleUpdateHistory(reading.id, { current_reading: parseFloat(val), reading_date: date });
                            }}
                            className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-600 transition-all"
                          >
                            Update
                          </button>
                          <button 
                            onClick={() => setEditingReading(null)}
                            className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xl font-black text-gray-900">{reading.current_reading}</p>
                          <p className="text-xs font-bold text-gray-400 flex items-center gap-1">
                            <Calendar size={12} /> {new Date(reading.reading_date).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-black text-blue-600">+{reading.units_consumed} Units</p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Consumed</p>
                          </div>
                          <button 
                            onClick={() => setEditingReading(reading.id)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => handleDeleteHistory(reading.id)}
                            className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {historyList.length === 0 && (
                  <p className="text-center py-10 text-gray-400 font-bold italic">No history found for this property.</p>
                )}
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-4">Add Manual Past Reading</h3>
                <div className="flex flex-col md:flex-row gap-4 items-end bg-gray-50 p-6 rounded-3xl">
                   <div className="flex-1 space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Reading Value</label>
                      <input type="number" id="new-past-val" placeholder="0.00" className="w-full bg-white border-2 border-gray-100 rounded-xl px-4 py-2 font-black text-gray-900 outline-none focus:border-blue-500" />
                   </div>
                   <div className="flex-1 space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Reading Date</label>
                      <input type="date" id="new-past-date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full bg-white border-2 border-gray-100 rounded-xl px-4 py-2 font-black text-gray-900 outline-none focus:border-blue-500" />
                   </div>
                   <button 
                    onClick={() => {
                      const val = document.getElementById('new-past-val').value;
                      const date = document.getElementById('new-past-date').value;
                      if (!val) return alert('Enter a value');
                      handleAddPast(showHistoryModal.id, { current_reading: val, reading_date: date });
                      document.getElementById('new-past-val').value = '';
                    }}
                    className="px-6 py-2.5 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg"
                   >
                     Add
                   </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
