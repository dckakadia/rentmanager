import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProperties, createProperty, updateProperty } from '../services/api';
import { Plus, Home } from 'lucide-react';

export default function Properties() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    property_type: 'room',
    room_number: '',
    meter_number: '',
  });


  useEffect(() => {
    fetchProperties();
  }, []);

    const fetchProperties = async () => {
    try {
      setLoading(true);
      const res = await getProperties();
      const allProps = Array.isArray(res.data) ? res.data : [];
      setProperties(allProps.filter(p => p.room_number !== 'Common Meter'));
      setError(null);
    } catch (err) {
      console.error('Error fetching properties:', err);
      setError('Failed to load properties: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await createProperty(formData);
      setFormData({ property_type: 'room', room_number: '', meter_number: '' });
      setShowForm(false);
      await fetchProperties();
    } catch (err) {
      console.error('Error creating property:', err);
      setError('Failed to create property: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };


  const formatRent = (property) => {
    if (property.property_type === 'shop') return '₹4,000';
    return '₹2,500';
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Properties</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2"
        >
          {loading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
          ) : (
            <Plus size={20} />
          )}
          New Property
        </button>
      </div>

      {error && <div className="p-4 bg-red-100 text-red-800 rounded mb-4">{error}</div>}

      {/* Create Form */}
      {showForm && (
        <div className="card mb-8 animate-in slide-in-from-top-4 duration-300">
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700 uppercase tracking-wider text-[10px]">Property Type</label>
                <select
                  value={formData.property_type}
                  onChange={(e) => setFormData({ ...formData, property_type: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold"
                >
                  <option value="room">Room</option>
                  <option value="shop">Shop</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700 uppercase tracking-wider text-[10px]">Room/Shop Number</label>
                <input
                  type="text"
                  value={formData.room_number}
                  onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                  placeholder="e.g., R-101"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700 uppercase tracking-wider text-[10px]">Meter Number</label>
                <input
                  type="text"
                  value={formData.meter_number}
                  onChange={(e) => setFormData({ ...formData, meter_number: e.target.value })}
                  placeholder="e.g., M-98765"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button type="submit" className="btn-primary px-8">Create Property</button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn bg-gray-200 text-gray-600 hover:bg-gray-300 px-6 rounded-2xl font-bold"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Properties Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {properties.map((property) => (
          <div key={property.id} className="card hover:shadow-xl transition-all duration-300 group">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg uppercase tracking-widest">{property.property_type}</span>
                  {property.meter_number && (
                    <span className="text-[10px] font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg uppercase tracking-widest">Meter: {property.meter_number}</span>
                  )}
                </div>
                <h3 className="text-3xl font-black mt-2 text-gray-900 tracking-tight group-hover:text-blue-600 transition-colors">{property.room_number}</h3>
              </div>
              <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                <Home size={28} />
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-gray-400 uppercase tracking-widest text-[10px]">Estimated Rent</span>
                <span className="text-gray-900">{formatRent(property)}</span>
              </div>
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-gray-400 uppercase tracking-widest text-[10px]">Status</span>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                  property.is_occupied ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}>
                  {property.is_occupied ? 'Occupied' : 'Vacant'}
                </span>
              </div>
            </div>

            {property.tenant_name && (
              <div className={`mb-6 p-4 rounded-2xl border transition-all ${
                property.is_occupied 
                  ? 'bg-gray-50 border-gray-100 shadow-inner' 
                  : 'bg-gray-50/50 border-gray-100/30 opacity-60'
              }`}>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                  {property.is_occupied ? 'Current Tenant' : 'Previous Tenant'}
                </p>
                <p className={`font-black ${property.is_occupied ? 'text-gray-900' : 'text-gray-500'}`}>{property.tenant_name}</p>
                <p className={`text-xs font-bold ${property.is_occupied ? 'text-blue-500' : 'text-gray-400'} mt-1`}>{property.tenant_phone}</p>
              </div>
            )}

            <button 
              onClick={() => navigate(`/properties/${property.id}`)}
              className="btn-primary w-full py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-100 hover:shadow-blue-200 transition-all"
            >
              Manage
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
