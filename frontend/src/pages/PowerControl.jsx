import React, { useState, useEffect } from 'react';
import { getPowerStatus, turnPowerOn, turnPowerOff, testRelay, getSettings, updateSettings, triggerOverdueCutoff, getOverdueCutoffCandidates, getRetryLogs } from '../services/api';
import { Zap, AlertTriangle, ShieldCheck, Clock, RefreshCw, CheckCircle2, XCircle, Play, Settings2 } from 'lucide-react';

export default function PowerControl() {
  const [properties, setProperties] = useState([]);
  const [settings, setSettings] = useState(null);
  const [pendingSettings, setPendingSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [cuttingOff, setCuttingOff] = useState(false);
  const [previewUnits, setPreviewUnits] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [cutoffResult, setCutoffResult] = useState(null);
  const [retrying, setRetrying] = useState({});
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(3);
  const [retryBaseDelayMs, setRetryBaseDelayMs] = useState(500);
  const [retryLogsByProperty, setRetryLogsByProperty] = useState({});
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statusRes, settingsRes] = await Promise.all([
        getPowerStatus(),
        getSettings()
      ]);
      setProperties(statusRes.data);
      setSettings(settingsRes.data.system);
      setPendingSettings(settingsRes.data.system);
    } catch (err) {
      console.error('Error fetching power data:', err);
      setError('Failed to load power control data');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncStatus = async () => {
    try {
      setSyncing(true);
      const statusRes = await getPowerStatus();
      setProperties(statusRes.data);
      setSuccess('Hardware status synced with Home Assistant');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error syncing power status:', err);
      setError('Failed to sync hardware status');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSyncing(false);
    }
  };

  const handleTest = async (propertyId) => {
    try {
      setTestingId(propertyId);
      await testRelay(propertyId);
      setSuccess(`Relay test successful for Property #${propertyId}`);
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError('Relay test failed. Please check Home Assistant connection.');
      setTimeout(() => setError(null), 5000);
    } finally {
      setTestingId(null);
    }
  };

  const handlePendingUpdate = (field, value) => {
    setPendingSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      await updateSettings(pendingSettings);
      setSettings(pendingSettings);
      setSuccess('Automation settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };
  
  const handleManualCutoff = async () => {
    // Fetch preview list and show modal for confirmation
    try {
      setPreviewLoading(true);
      const res = await getOverdueCutoffCandidates();
      setPreviewUnits((res && (res.data?.units || res.data || res.units)) || []);
      setShowPreview(true);
    } catch (err) {
      console.error('Failed to fetch cutoff preview:', err);
      setError('Failed to load preview for overdue cutoffs.');
      setTimeout(() => setError(null), 5000);
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmManualCutoff = async () => {
    try {
      setCuttingOff(true);
      const res = await triggerOverdueCutoff();
      // keep modal open and display detailed results
      const data = res.data || { units: [], failed: [], message: '', ha_sync: {} };
      setCutoffResult(data);

      // Only show success when there are units cut off AND there were no failures recorded
      const total = data.count || (data.units && data.units.length) || 0;
      const failedCount = data.failed_count || (data.failed && data.failed.length) || 0;

      if (total === 0) {
        setSuccess('No overdue units found.');
        setTimeout(() => setSuccess(null), 3000);
      } else if (failedCount === 0) {
        setSuccess(data.message || `Power cut off for ${total}/${total} units.`);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        // Partial or complete failure: surface as an error so operator inspects logs
        setError(data.message || `Cutoff completed with ${failedCount}/${total} failures. Check logs.`);
        setTimeout(() => setError(null), 7000);
      }

      // refresh list to reflect new states
      await fetchData();

      // if backend returned HA sync data, also update properties from that
      if (data && data.ha_sync && Object.keys(data.ha_sync).length > 0) {
        // update properties states based on HA sync. Support numeric or string keys and several value formats.
        try {
          const syncMap = data.ha_sync;
          setProperties((prev) => prev.map(p => {
            const key1 = String(p.property_id);
            const raw = syncMap.hasOwnProperty(key1) ? syncMap[key1] : (syncMap.hasOwnProperty(p.property_id) ? syncMap[p.property_id] : undefined);
            if (raw === undefined || raw === null) return p;
            const val = (typeof raw === 'string') ? raw.toLowerCase() : raw;
            const isOn = val === 'on' || val === '1' || val === 1 || val === true;
            return { ...p, current_state: isOn ? 'on' : 'off' };
          }));
        } catch (e) {
          // ignore mapping errors
        }
      }
    } catch (err) {
      console.error('Manual cutoff failed:', err);
      setError('Failed to trigger manual cutoff. Check logs.');
      setTimeout(() => setError(null), 5000);
    } finally {
      setCuttingOff(false);
    }
  };

  const handleRetry = async (property_id) => {
    try {
      setRetrying(prev => ({ ...prev, [property_id]: true }));
      const res = await turnPowerOff(property_id, 'Retry from UI', { retry_attempt: 1 });

      // If API returns success, move unit from failed -> units in cutoffResult
      setCutoffResult(prev => {
        if (!prev) return prev;
        const failed = (prev.failed || []).filter(f => f.property_id !== property_id);
        const succeededUnit = (prev.failed || []).find(f => f.property_id === property_id);
        const units = prev.units ? [...prev.units] : [];
        if (res && res.data && res.data.success) {
          if (succeededUnit) {
            units.push({
              property_id: succeededUnit.property_id,
              room_number: succeededUnit.room_number,
              tenant_name: succeededUnit.tenant_name,
              phone: succeededUnit.phone,
              pending_amount: succeededUnit.pending_amount,
              status: 'success'
            });
          }
        } else {
          // update the reason for failure if provided
          const failedIdx = failed.findIndex(f => f.property_id === property_id);
          if (failedIdx >= 0) {
            failed[failedIdx] = { ...failed[failedIdx], reason: res?.data?.details || 'Retry failed' };
          }
        }

        return { ...prev, failed, units };
      });

      // refresh properties and live sync
      await fetchData();
    } catch (err) {
      console.error('Retry failed:', err);
      setError('Retry failed. Check connection to Home Assistant.');
      setTimeout(() => setError(null), 5000);
      setCutoffResult(prev => {
        if (!prev) return prev;
        const failed = (prev.failed || []).map(f => f.property_id === property_id ? { ...f, reason: err.message || 'Retry error' } : f);
        return { ...prev, failed };
      });
    } finally {
      setRetrying(prev => ({ ...prev, [property_id]: false }));
    }
  };

  const handleFetchRetryLogs = async (property_id) => {
    try {
      setRetryLogsByProperty(prev => ({ ...prev, [property_id]: { loading: true, rows: prev[property_id]?.rows || [] } }));
      const res = await getRetryLogs(property_id);
      setRetryLogsByProperty(prev => ({ ...prev, [property_id]: { loading: false, rows: res.data || [] } }));
    } catch (err) {
      console.error('Failed to fetch retry logs:', err);
      setRetryLogsByProperty(prev => ({ ...prev, [property_id]: { loading: false, rows: [] } }));
    }
  };

  const _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const handleRetryAll = async () => {
    if (!cutoffResult || !cutoffResult.failed || cutoffResult.failed.length === 0) return;
    setBulkRetrying(true);
    const failedList = [...cutoffResult.failed];

    for (const f of failedList) {
      let succeeded = false;
      for (let attempt = 0; attempt < Math.max(1, retryAttempts) && !succeeded; attempt++) {
        try {
          setRetrying(prev => ({ ...prev, [f.property_id]: true }));
          const res = await turnPowerOff(f.property_id, 'Retry All from UI', { retry_attempt: attempt + 1 });
          if (res && res.data && res.data.success) {
            // mark succeeded
            setCutoffResult(prev => {
              if (!prev) return prev;
              const newFailed = (prev.failed || []).filter(x => x.property_id !== f.property_id);
              const units = prev.units ? [...prev.units] : [];
              units.push({
                property_id: f.property_id,
                room_number: f.room_number,
                tenant_name: f.tenant_name,
                phone: f.phone,
                pending_amount: f.pending_amount,
                status: 'success'
              });
              return { ...prev, failed: newFailed, units };
            });
            succeeded = true;
          } else {
            // not succeeded, will retry
            const wait = retryBaseDelayMs * Math.pow(2, attempt);
            await _sleep(wait);
          }
        } catch (err) {
          const wait = retryBaseDelayMs * Math.pow(2, attempt);
          await _sleep(wait);
        } finally {
          setRetrying(prev => ({ ...prev, [f.property_id]: false }));
        }
      }
    }

    // Refresh properties and final sync
    await fetchData();
    setBulkRetrying(false);
  };

  if ((loading && properties.length === 0) || !pendingSettings) return <div className="p-8 text-center font-bold text-gray-500 animate-pulse">Loading Power Systems...</div>;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
          <Zap className="text-blue-600" size={40} />
          Power Control & Automation
        </h1>
        <p className="text-gray-500 mt-2 font-medium">Configure automated power cutoffs and perform hardware diagnostics.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-800 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-4">
          <AlertTriangle size={20} />
          <span className="font-bold">{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-4">
          <ShieldCheck size={20} />
          <span className="font-bold">{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Automation Settings */}
        <div className="lg:col-span-1">
          <div className="card h-full bg-white border border-gray-100 shadow-xl shadow-blue-900/5 overflow-hidden">
            <div className="p-6 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-xl font-black flex items-center gap-2">
                <Settings2 className="text-blue-600" size={24} />
                Trigger Logic
              </h2>
            </div>
            <div className="p-6 space-y-8">
              
              <div className="flex flex-col gap-4">
                <button 
                  onClick={handleManualCutoff}
                  disabled={cuttingOff}
                  className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-lg ${
                    cuttingOff 
                      ? 'bg-gray-100 text-gray-400' 
                      : 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200 active:scale-[0.98]'
                  }`}
                >
                  {cuttingOff ? (
                    <RefreshCw className="animate-spin" size={20} />
                  ) : (
                    <AlertTriangle size={20} />
                  )}
                  {cuttingOff ? 'Processing Cutoffs...' : 'Cutoff Overdue Units Now'}
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div>
                  <p className="font-black text-gray-900 text-sm">Auto Power Cutoff</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Automatic triggering</p>
                </div>
                <button 
                  onClick={() => handlePendingUpdate('auto_cutoff_enabled', pendingSettings.auto_cutoff_enabled ? 0 : 1)}
                  className={`w-14 h-8 rounded-full relative transition-all duration-300 ${pendingSettings.auto_cutoff_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all duration-300 ${pendingSettings.auto_cutoff_enabled ? 'left-7' : 'left-1 shadow-sm'}`} />
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Auto-Cutoff Day of Month (1-31)</label>
                <div className="flex items-center gap-4">
                  <input 
                    type="range" 
                    min="1" 
                    max="31" 
                    value={pendingSettings.cutoff_grace_days}
                    onChange={(e) => handlePendingUpdate('cutoff_grace_days', parseInt(e.target.value))}
                    className="flex-1 accent-blue-600"
                  />
                  <span className="w-12 h-12 bg-blue-50 text-blue-700 rounded-xl flex items-center justify-center font-black text-lg border border-blue-100">
                    {pendingSettings.cutoff_grace_days}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 font-bold mt-2 italic">Select the calendar day (1-31) when unpaid units are automatically cut off.</p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Trigger Hour</label>
                <select 
                  value={pendingSettings.cutoff_hour}
                  onChange={(e) => handlePendingUpdate('cutoff_hour', parseInt(e.target.value))}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value={7}>07:00 AM</option>
                  <option value={8}>08:00 AM</option>
                  <option value={9}>09:00 AM</option>
                  <option value={10}>10:00 AM</option>
                  <option value={11}>11:00 AM</option>
                  <option value={12}>12:00 PM</option>
                  <option value={13}>01:00 PM</option>
                  <option value={14}>02:00 PM</option>
                  <option value={15}>03:00 PM</option>
                  <option value={16}>04:00 PM</option>
                  <option value={17}>05:00 PM</option>
                  <option value={18}>06:00 PM</option>
                  <option value={19}>07:00 PM</option>
                  <option value={20}>08:00 PM</option>
                  <option value={21}>09:00 PM</option>
                  <option value={22}>10:00 PM</option>
                  <option value={23}>11:00 PM</option>
                  <option value={0}>12:00 AM (Midnight)</option>
                </select>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-4">
                <Clock className="text-amber-600 shrink-0" size={24} />
                <div>
                  <p className="text-xs font-black text-amber-900 uppercase tracking-tight">System Notice</p>
                  <p className="text-[11px] text-amber-700 font-bold leading-relaxed mt-1">
                    Automated cutoffs occur only on the selected calendar day at the specified trigger hour for all units with outstanding dues.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex gap-3">
                <button 
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className={`flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-lg ${
                    saving 
                      ? 'bg-gray-100 text-gray-400' 
                      : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200 active:scale-[0.98]'
                  }`}
                >
                  {saving ? (
                    <RefreshCw className="animate-spin" size={20} />
                  ) : (
                    <ShieldCheck size={20} />
                  )}
                  {saving ? 'Saving...' : 'Save Automation Settings'}
                </button>
                
                {JSON.stringify(settings) !== JSON.stringify(pendingSettings) && (
                  <button 
                    onClick={() => setPendingSettings(settings)}
                    className="p-4 bg-gray-100 text-gray-400 rounded-2xl hover:bg-gray-200 transition-all"
                    title="Revert Changes"
                  >
                    <RefreshCw size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Manual Test Area */}
        <div className="lg:col-span-2">
          <div className="card bg-white border border-gray-100 shadow-xl shadow-blue-900/5">
            <div className="p-6 border-b border-gray-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <h2 className="text-xl font-black flex items-center gap-2">
                  <Zap className="text-emerald-600" size={24} />
                  Hardware Diagnostic
                </h2>
                <button
                  onClick={handleSyncStatus}
                  disabled={syncing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition-all"
                >
                  <RefreshCw className={syncing ? "animate-spin" : ""} size={14} />
                  {syncing ? 'Syncing...' : 'Sync Live Status'}
                </button>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <select 
                  className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All Properties</option>
                  <option value="room">Rooms Only</option>
                  <option value="shop">Shops Only</option>
                </select>
                <div className="relative flex-1 md:w-48">
                  <RefreshCw className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 cursor-pointer transition-colors ${syncing ? 'animate-spin text-blue-500' : ''}`} size={16} onClick={handleSyncStatus} />
                  <input 
                    type="text"
                    placeholder="Search unit..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-4 pr-10 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
              {properties
                .filter(p => {
                  const matchesFilter = filterType === 'all' || p.property_type === filterType;
                  const matchesSearch = p.room_number.toLowerCase().includes(searchTerm.toLowerCase());
                  return matchesFilter && matchesSearch;
                })
                .map((p) => (
                <div key={p.property_id} className="p-5 bg-white border border-gray-100 rounded-[2rem] hover:shadow-lg transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${p.current_state === 'on' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                        <Zap size={24} fill={p.current_state === 'on' ? 'currentColor' : 'none'} />
                      </div>
                      <div>
                        <p className="font-black text-gray-900">{p.room_number || `Property #${p.property_id}`}</p>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${p.current_state === 'on' ? 'text-emerald-500' : 'text-rose-500'}`}>
                           {p.current_state === 'on' ? '• Power On' : '• Power Off'}
                        </p>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => handleTest(p.property_id)}
                      disabled={testingId === p.property_id}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                        testingId === p.property_id 
                          ? 'bg-gray-100 text-gray-400' 
                          : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95'
                      }`}
                    >
                      {testingId === p.property_id ? (
                        <>Testing...</>
                      ) : (
                        <><Play size={14} fill="currentColor" /> Manual Test</>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pt-4 border-t border-gray-50">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-1000 ${p.current_state === 'on' ? 'w-full bg-blue-500' : 'w-0 bg-gray-300'}`} />
                    </div>
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">Connection Stable</span>
                  </div>
                </div>
              ))}

              {properties.length === 0 && (
                <div className="col-span-full py-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                    <AlertTriangle size={32} />
                  </div>
                  <p className="font-bold text-gray-500">No linked relays found. Link relays in Property Settings.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal for Overdue Cutoffs */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl p-6 overflow-auto max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black">Preview: Units to be cut off ({previewUnits.length})</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPreview(false)} className="px-3 py-1 rounded bg-gray-100">Cancel</button>
                <button onClick={confirmManualCutoff} className="px-4 py-2 bg-rose-600 text-white rounded font-bold" disabled={cuttingOff}>
                  {cuttingOff ? 'Processing...' : 'Confirm & Cut Off Now'}
                </button>
              </div>
            </div>

            {!cutoffResult ? (
              previewUnits.length === 0 ? (
                <div className="py-8 text-center text-gray-500 font-bold">No overdue units found.</div>
              ) : (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 text-xs font-black uppercase">Unit</th>
                          <th className="px-4 py-3 text-xs font-black uppercase">Tenant</th>
                          <th className="px-4 py-3 text-xs font-black uppercase">Phone</th>
                          <th className="px-4 py-3 text-xs font-black uppercase text-right">Overdue Amount</th>
                          <th className="px-4 py-3 text-xs font-black uppercase">Months</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewUnits.map((u) => (
                          <tr key={u.property_id}>
                            <td className="px-4 py-3 font-black text-gray-900">{u.room_number}</td>
                            <td className="px-4 py-3">{u.tenant_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{u.phone || '-'}</td>
                            <td className="px-4 py-3 text-right font-black">₹{(u.pending_amount || 0).toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{u.month_year || 'ledger'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm text-gray-600">Total units: <span className="font-black">{previewUnits.length}</span></div>
                    <div className="text-sm text-gray-600">Total overdue: <span className="font-black">₹{previewUnits.reduce((s, x) => s + (x.pending_amount || 0), 0).toLocaleString()}</span></div>
                  </div>
                </div>
              )
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-3 text-xs font-black uppercase">Unit</th>
                        <th className="px-4 py-3 text-xs font-black uppercase">Tenant</th>
                        <th className="px-4 py-3 text-xs font-black uppercase">Status</th>
                        <th className="px-4 py-3 text-xs font-black uppercase text-right">Overdue Amount</th>
                        <th className="px-4 py-3 text-xs font-black uppercase">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(cutoffResult.units || []).map((u) => (
                        <tr key={u.property_id}>
                          <td className="px-4 py-3 font-black text-gray-900">{u.room_number}</td>
                          <td className="px-4 py-3">{u.tenant_name}</td>
                          <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-black ${u.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{u.status}</span></td>
                          <td className="px-4 py-3 text-right font-black">₹{(u.pending_amount || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{u.status === 'success' ? 'Cutoff applied' : (u.reason || 'Failed')}</td>
                        </tr>
                      ))}
                      {(cutoffResult.failed || []).map((f, idx) => (
                        <tr key={`failed-${idx}`}> 
                          <td className="px-4 py-3 font-black text-gray-900">{f.room_number || f.property_id}</td>
                          <td className="px-4 py-3">{f.tenant_name || '-'}</td>
                          <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-700">failed</span></td>
                          <td className="px-4 py-3 text-right font-black">-</td>
                          <td className="px-4 py-3 text-sm text-gray-500 flex items-center gap-3">
                            <span>{f.reason}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleRetry(f.property_id)}
                                disabled={retrying[f.property_id]}
                                className={`ml-2 px-2 py-1 rounded text-xs font-black transition-all ${retrying[f.property_id] ? 'bg-gray-100 text-gray-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                              >
                                {retrying[f.property_id] ? 'Retrying...' : 'Retry'}
                              </button>
                              <button
                                onClick={() => handleFetchRetryLogs(f.property_id)}
                                className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200"
                              >
                                Audit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(cutoffResult.failed || []).map((f) => (
                        retryLogsByProperty[f.property_id] && retryLogsByProperty[f.property_id].rows && retryLogsByProperty[f.property_id].rows.length > 0 ? (
                          <tr key={`audit-${f.property_id}`}>
                            <td colSpan={5} className="px-4 py-3 bg-gray-50">
                              <div className="text-xs font-mono text-gray-700">Recent retry attempts for {f.room_number || f.property_id}:</div>
                              <ul className="text-xs text-gray-600 mt-2 space-y-1">
                                {retryLogsByProperty[f.property_id].rows.map(r => (
                                  <li key={r.id}>{new Date(r.created_at).toLocaleString()} — Attempt #{r.attempt_number} — {r.success ? 'success' : 'failed'}{r.error ? ` — ${r.error}` : ''}</li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600">Successful: <span className="font-black">{(cutoffResult.units || []).length}</span></div>
                  <div className="text-sm text-gray-600">Failed: <span className="font-black">{(cutoffResult.failed || []).length}</span></div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Attempts</label>
                      <input type="number" min={1} value={retryAttempts} onChange={(e) => setRetryAttempts(parseInt(e.target.value || '1'))} className="w-16 p-1 border rounded text-sm" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Base delay ms</label>
                      <input type="number" min={100} value={retryBaseDelayMs} onChange={(e) => setRetryBaseDelayMs(parseInt(e.target.value || '500'))} className="w-20 p-1 border rounded text-sm" />
                    </div>
                    <button
                      onClick={handleRetryAll}
                      disabled={bulkRetrying || (cutoffResult.failed || []).length === 0}
                      className={`px-3 py-2 rounded font-bold text-sm ${bulkRetrying ? 'bg-gray-100 text-gray-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                    >
                      {bulkRetrying ? 'Retrying All...' : 'Retry All Failed'}
                    </button>
                  </div>
                  <div className="text-right">
                    <button onClick={() => { setShowPreview(false); setCutoffResult(null); setPreviewUnits([]); }} className="px-4 py-2 bg-gray-100 rounded">Close</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
