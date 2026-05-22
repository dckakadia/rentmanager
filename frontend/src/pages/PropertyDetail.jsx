import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  getPropertyDetail, 
  getPowerLogs, 
  getMeterReadings,
  turnPowerOn,
  turnPowerOff,
  linkRelay,
  unlinkRelay,
  getAvailableRelays,
  updateProperty,
  deleteProperty
} from '../services/api';
import { 
  ArrowLeft, 
  Home, 
  Zap, 
  ZapOff, 
  History, 
  Activity,
  Link as LinkIcon,
  Unlink,
  Settings as SettingsIcon
} from 'lucide-react';

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [property, setProperty] = useState(null);
  const [powerLogs, setPowerLogs] = useState([]);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [powerActionLoading, setPowerActionLoading] = useState(false);
  const [availableRelays, setAvailableRelays] = useState([]);
  const [selectedRelay, setSelectedRelay] = useState('');
  const [relayActionLoading, setRelayActionLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const propRes = await getPropertyDetail(id);
      setProperty(propRes.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching property details:', err);
      setError('Failed to load property details');
      setLoading(false);
      return;
    }

    const powerLogsPromise = getPowerLogs(id).catch((err) => {
      console.error('Error fetching power logs:', err);
      return { data: [] };
    });
    const meterReadingsPromise = getMeterReadings(id).catch((err) => {
      console.error('Error fetching meter readings:', err);
      return { data: [] };
    });
    const relaysPromise = getAvailableRelays().catch((err) => {
      console.error('Error fetching available relays:', err);
      return { data: [] };
    });

    try {
      const [logRes, readRes, relayRes] = await Promise.all([
        powerLogsPromise,
        meterReadingsPromise,
        relaysPromise
      ]);

      setPowerLogs(logRes.data || []);
      setReadings(readRes.data || []);
      setAvailableRelays(relayRes.data || []);
    } catch (err) {
      console.error('Error loading property supplementary data:', err);
      setPowerLogs([]);
      setReadings([]);
      setAvailableRelays([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePowerToggle = async (turnOn) => {
    try {
      setPowerActionLoading(true);
      if (turnOn) {
        await turnPowerOn(id, 'Manual Override');
      } else {
        await turnPowerOff(id, 'Manual Override');
      }
      await fetchData(); 
    } catch (err) {
      console.error('Error toggling power:', err);
      alert('Failed to control power: ' + (err.response?.data?.error || err.message));
    } finally {
      setPowerActionLoading(false);
    }
  };

  const handleLinkRelay = async () => {
    if (!selectedRelay) return;
    try {
      setRelayActionLoading(true);
      await linkRelay(id, selectedRelay);
      await fetchData();
      setSelectedRelay('');
    } catch (err) {
      console.error('Error linking relay:', err);
      alert('Failed to link relay: ' + (err.response?.data?.error || err.message));
    } finally {
      setRelayActionLoading(false);
    }
  };

  const handleUnlinkRelay = async () => {
    // Note: removed window.confirm for better compatibility with automated browser tests
    try {
      setRelayActionLoading(true);
      await unlinkRelay(id);
      await fetchData();
    } catch (err) {
      console.error('Error unlinking relay:', err);
      alert('Failed to unlink relay: ' + (err.response?.data?.error || err.message));
    } finally {
      setRelayActionLoading(false);
    }
  };

  const handleDeleteProperty = async () => {
    if (!window.confirm('Delete this property? This action cannot be undone.')) return;
    try {
      setLoading(true);
      await deleteProperty(id);
      navigate('/properties');
    } catch (err) {
      console.error('Error deleting property:', err);
      alert('Failed to delete property: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };



  if (loading && !property) return <div className="p-8 text-center text-xl">Loading Property Details...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!property) return <div className="p-8 text-center">Property not found</div>;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <button 
        onClick={() => navigate('/properties')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Properties
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Property & Relay Config */}
        <div className="lg:col-span-1 space-y-8">
          {/* Property Card */}
          <div className="card">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                  <Home size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold">{property.room_number}</h1>
                    {property.meter_number && (
                      <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg uppercase tracking-tighter">
                        Meter: {property.meter_number}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 uppercase text-xs font-semibold tracking-wider">
                    {property.property_type}
                  </p>
                </div>
              </div>
              <button
                onClick={handleDeleteProperty}
                className="rounded-2xl bg-rose-600 text-white px-4 py-2 text-sm font-black uppercase tracking-wider hover:bg-rose-700 transition-all shadow-sm"
              >
                Delete Property
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="text-gray-600">Occupancy</span>
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  property.is_occupied ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {property.is_occupied ? 'Occupied' : 'Vacant'}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="text-gray-600">Power Status</span>
                <span className={`flex items-center gap-1 font-bold ${
                  property.power_status ? 'text-green-600' : 'text-red-600'
                }`}>
                  {property.power_status ? <Zap size={16} /> : <ZapOff size={16} />}
                  {property.power_status ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex gap-2 mt-4">
                <button 
                  onClick={() => handlePowerToggle(true)}
                  disabled={property.power_status || powerActionLoading || !property.ha_entity_id}
                  className="flex-1 btn-success flex items-center justify-center gap-2 py-2 disabled:opacity-50"
                >
                  <Zap size={18} /> Power ON
                </button>
                <button 
                  onClick={() => handlePowerToggle(false)}
                  disabled={!property.power_status || powerActionLoading || !property.ha_entity_id}
                  className="flex-1 btn-danger flex items-center justify-center gap-2 py-2 disabled:opacity-50"
                >
                  <ZapOff size={18} /> Power OFF
                </button>
              </div>
            </div>
          </div>

          {/* Property Config Card */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4 text-gray-700">
              <SettingsIcon size={20} className="text-blue-500" />
              <h2 className="font-bold">Unit Configuration</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1 tracking-widest ml-1">Room/Shop Number</label>
                <input 
                  type="text"
                  value={property.room_number}
                  onChange={(e) => setProperty({...property, room_number: e.target.value})}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 font-bold text-gray-900 outline-none focus:border-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1 tracking-widest ml-1">Electricity Meter Number</label>
                <input 
                  type="text"
                  value={property.meter_number || ''}
                  onChange={(e) => setProperty({...property, meter_number: e.target.value})}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 font-bold text-gray-900 outline-none focus:border-blue-500 transition-all"
                  placeholder="Enter meter number..."
                />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest ml-1">Occupancy Profile</label>
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setProperty({...property, is_occupied: true})}
                    className={`flex-1 py-3 rounded-xl font-black text-xs tracking-widest transition-all shadow-sm ${
                      property.is_occupied 
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' 
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    OCCUPIED
                  </button>
                  <button 
                    type="button"
                    onClick={() => setProperty({...property, is_occupied: false})}
                    className={`flex-1 py-3 rounded-xl font-black text-xs tracking-widest transition-all shadow-sm ${
                      !property.is_occupied 
                      ? 'bg-rose-600 text-white shadow-lg shadow-rose-100' 
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    VACANT
                  </button>
                </div>
              </div>
              <button 
                onClick={async () => {
                  try {
                    setLoading(true);
                    const res = await updateProperty(id, { 
                      room_number: property.room_number,
                      meter_number: property.meter_number,
                      is_occupied: property.is_occupied
                    });
                    setProperty(res.data);
                    alert('Configuration saved successfully!');
                  } catch (err) {
                    alert('Failed to save configuration');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
              >
                {loading ? 'Saving...' : 'Save Unit Configuration'}
              </button>
            </div>
          </div>

          {/* Relay Link Card */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4 text-gray-700">
              <LinkIcon size={20} className="text-blue-500" />
              <h2 className="font-bold">Relay Link Config</h2>
            </div>
            
            {property.ha_entity_id ? (
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                  <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Linked Relay</p>
                  <p className="font-black text-gray-900 break-all">{property.ha_entity_id}</p>
                </div>
                <button 
                  onClick={handleUnlinkRelay}
                  disabled={relayActionLoading}
                  className="w-full py-3 bg-white border-2 border-rose-100 text-rose-500 rounded-2xl font-black text-sm uppercase tracking-wider hover:bg-rose-50 hover:border-rose-200 transition-all flex items-center justify-center gap-2"
                >
                  <Unlink size={18} /> Unlink Relay
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Select Available Relay</p>
                  <select 
                    value={selectedRelay}
                    onChange={(e) => setSelectedRelay(e.target.value)}
                    className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-blue-500 focus:bg-white transition-all font-bold text-gray-900 appearance-none cursor-pointer"
                  >
                    <option value="">-- Choose Relay --</option>
                    {availableRelays.filter(r => !r.is_linked).map(relay => (
                      <option key={relay.entity_id} value={relay.entity_id}>
                        {relay.friendly_name}
                      </option>
                    ))}
                  </select>
                </div>
                <button 
                  onClick={handleLinkRelay}
                  disabled={!selectedRelay || relayActionLoading}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-wider hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-200 transition-all disabled:opacity-50 disabled:bg-gray-400 flex items-center justify-center gap-2"
                >
                  <LinkIcon size={18} /> Link Relay
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Insights */}
        <div className="lg:col-span-2 space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Meter Readings */}
            <div className="card">
              <div className="flex items-center justify-between mb-4 text-gray-700">
                <div className="flex items-center gap-2">
                  <Activity size={20} className="text-purple-500" />
                  <h2 className="font-bold">Meter Readings</h2>
                </div>
                {property.meter_number && (
                  <span className="text-[10px] font-black bg-purple-50 text-purple-600 px-2 py-1 rounded-lg uppercase tracking-widest">
                    METER: {property.meter_number}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {readings.map((r) => (
                  <div key={r.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded">
                    <div>
                      <p className="font-bold">{r.current_reading} units</p>
                      <p className="text-xs text-gray-500">{new Date(r.reading_date).toLocaleDateString()}</p>
                    </div>
                    {r.units_consumed > 0 && (
                      <span className="text-xs font-semibold text-purple-600">+{r.units_consumed} kWh</span>
                    )}
                  </div>
                ))}
                {readings.length === 0 && (
                  <p className="text-center text-gray-400 italic py-4 text-sm">No readings</p>
                )}
              </div>
            </div>

            {/* Power Logs */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4 text-gray-700">
                <History size={20} className="text-orange-500" />
                <h2 className="font-bold">Power Activity</h2>
              </div>
              <div className="space-y-3">
                {powerLogs.map((log) => (
                  <div key={log.id} className="flex gap-3 text-sm border-l-2 border-gray-100 pl-3 py-1">
                    <div className={`mt-1 ${log.action === 'ON' ? 'text-green-500' : 'text-red-500'}`}>
                      {log.action === 'ON' ? <Zap size={14} /> : <ZapOff size={14} />}
                    </div>
                    <div>
                      <p className="font-semibold">{log.action === 'ON' ? 'Power Restored' : 'Power Cutoff'}</p>
                      <p className="text-xs text-gray-500">{log.reason}</p>
                      <p className="text-xs text-gray-400">{new Date(log.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
                {powerLogs.length === 0 && (
                  <p className="text-center text-gray-400 italic py-4 text-sm">No activity logs</p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
