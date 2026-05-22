import React, { useState, useEffect } from 'react';
import { exportData, importData, getSettings, updateSettings, unlinkRelay } from '../services/api';
import { 
  Download, 
  Upload, 
  Database, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle,
  FileJson,
  Cpu,
  Unplug,
  Save,
  RefreshCw,
  User,
  Phone
} from 'lucide-react';

export default function Settings() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [haConfig, setHaConfig] = useState({
    url: 'Loading...',
    token: '••••••••••••••••',
    relays: []
  });
  const [systemInfo, setSystemInfo] = useState({
    db_engine: 'Loading...',
    version: 'v1.0.0',
    admin_name: 'Admin Owner',
    admin_phone: ''
  });
  const [profileData, setProfileData] = useState({
    admin_name: '',
    admin_phone: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await getSettings();
      if (res.data.ha) {
        setHaConfig(res.data.ha);
      }
      if (res.data.system) {
        setSystemInfo(res.data.system);
        setProfileData({
          admin_name: res.data.system.admin_name || '',
          admin_phone: res.data.system.admin_phone || ''
        });
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await updateSettings(profileData);
      await fetchSettings();
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Update failed:', err);
      setMessage({ type: 'error', text: 'Failed to update profile.' });
    } finally {
      setLoading(false);
    }
  };

  const handleHaSave = async () => {
    setMessage({ type: 'success', text: 'Home Assistant server settings updated!' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRemoveRelay = async (propertyId) => {
    try {
      setLoading(true);
      await unlinkRelay(propertyId);
      await fetchSettings();
      setMessage({ type: 'success', text: 'Relay unlinked successfully!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Failed to unlink:', err);
      setMessage({ type: 'error', text: 'Failed to unlink relay.' });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setLoading(true);
      const res = await exportData();
      const dataStr = JSON.stringify(res.data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const linkElement = document.createElement('a');
      linkElement.href = url;
      linkElement.download = `RentManager_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(linkElement);
      linkElement.click();
      document.body.removeChild(linkElement);
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Data exported successfully!' });
    } catch (err) {
      console.error('Export failed:', err);
      setMessage({ type: 'error', text: 'Failed to export data.' });
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setLoading(true);
        const jsonData = JSON.parse(event.target.result);
        await importData(jsonData.data || jsonData);
        setMessage({ type: 'success', text: 'Data imported successfully! Reloading...' });
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        console.error('Import failed:', err);
        setMessage({ type: 'error', text: 'Failed to import data.' });
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight">System Settings</h1>
        <p className="text-gray-500 mt-1 font-medium">Manage your application data and system preferences.</p>
      </div>

      {message && (
        <div className={`mb-8 p-4 rounded-2xl flex items-center gap-3 border ${
          message.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <p className="font-bold">{message.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        
        {/* Profile Settings Section */}
        <div className="card overflow-hidden">
          <div className="bg-blue-600 p-6 -m-6 mb-6 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <User size={24} className="text-blue-100" />
              <h2 className="text-xl font-bold">Admin Profile</h2>
            </div>
            <button 
              form="profile-form"
              disabled={loading}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2"
            >
              <Save size={16} /> {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <form id="profile-form" onSubmit={handleProfileSave} className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase mb-2 tracking-widest">Admin Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="text" 
                  value={profileData.admin_name}
                  onChange={(e) => setProfileData({...profileData, admin_name: e.target.value})}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-12 pr-4 py-3 font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="e.g. Admin Owner"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase mb-2 tracking-widest">WhatsApp / Mobile Number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="text" 
                  value={profileData.admin_phone}
                  onChange={(e) => setProfileData({...profileData, admin_phone: e.target.value})}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-12 pr-4 py-3 font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="e.g. 9876543210"
                />
              </div>
              <p className="mt-2 text-[10px] text-gray-400 font-bold uppercase tracking-tight">This number will be used for system notifications and contact info.</p>
            </div>
          </form>
        </div>

        {/* Data Portability Section */}
        <div className="card overflow-hidden">
          <div className="bg-gray-900 p-6 -m-6 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3 text-white">
              <Database size={24} className="text-blue-400" />
              <h2 className="text-xl font-bold">Data Portability</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-4 shadow-inner">
                <Download size={32} />
              </div>
              <h3 className="text-lg font-black text-gray-900">Export System Data</h3>
              <p className="text-sm text-gray-500 mt-2 mb-6 leading-relaxed">Download a complete backup of your entire database.</p>
              <button onClick={handleExport} disabled={loading} className="w-full btn-primary flex items-center justify-center gap-2 py-3">
                {loading ? 'Processing...' : 'Download JSON Backup'}
              </button>
            </div>

            <div className="p-6 bg-rose-50/50 rounded-2xl border border-rose-100 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mb-4 shadow-inner">
                <Upload size={32} />
              </div>
              <h3 className="text-lg font-black text-gray-900">Restore from Backup</h3>
              <p className="text-sm text-gray-500 mt-2 mb-6 leading-relaxed text-rose-800/60 italic">Warning: Overwrites all existing data.</p>
              <label className="w-full">
                <input type="file" accept=".json" className="hidden" onChange={handleImport} disabled={loading} />
                <div className="w-full btn-danger cursor-pointer flex items-center justify-center gap-2 py-3">
                  <FileJson size={20} /> {loading ? 'Importing...' : 'Upload & Restore'}
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Home Assistant Integration Section */}
        <div className="card overflow-hidden">
          <div className="bg-blue-900 p-6 -m-6 mb-6 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <Cpu size={24} className="text-blue-300" />
              <h2 className="text-xl font-bold">Relay Node Management</h2>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-black uppercase">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div> Connected
            </div>
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-black text-gray-500 uppercase mb-2 tracking-widest">Server URL</label>
                <input type="text" value={haConfig.url} readOnly className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 font-medium outline-none" />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-500 uppercase mb-2 tracking-widest">Token Status</label>
                <input type="text" value="Active Secure Token" readOnly className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 font-medium outline-none" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Unplug size={16} className="text-blue-600" /> Linked Relays
                </h3>
                <button onClick={() => window.location.href = '/properties'} className="text-xs font-bold text-blue-600 hover:underline">+ Link New Property</button>
              </div>
              
              <div className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase">Unit</th>
                      <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase">HA Entity ID</th>
                      <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {haConfig.relays.map((relay, idx) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-0">
                        <td className="px-6 py-4 font-bold text-gray-900">{relay.roomNumber}</td>
                        <td className="px-6 py-4 font-mono text-xs text-blue-600">{relay.entityId}</td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => handleRemoveRelay(relay.propertyId)} className="text-rose-500 hover:text-rose-700 font-bold text-xs">Unlink</button>
                        </td>
                      </tr>
                    ))}
                    {haConfig.relays.length === 0 && (
                      <tr>
                        <td colSpan="3" className="px-6 py-8 text-center text-gray-400 italic">No relays linked yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* System Info */}
        <div className="card">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">System Status</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Database</p>
              <p className="text-gray-900 font-black">{systemInfo.db_engine}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Version</p>
              <p className="text-blue-600 font-black">{systemInfo.version}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
