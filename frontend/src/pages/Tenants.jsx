import React, { useState, useEffect } from 'react';
import { getTenants, getVacantProperties, createTenant, deleteTenant, updateTenant, getTenantLedger } from '../services/api';
import { Plus, User, Phone, Home, Trash2, Calendar, Edit, ArrowRight, TrendingDown, Clock, ShieldCheck } from 'lucide-react';

function getOrdinalSuffix(day) {
  const d = parseInt(day, 10);
  if (isNaN(d)) return '';
  if (d >= 11 && d <= 13) {
    return 'th';
  }
  switch (d % 10) {
    case 1:  return 'st';
    case 2:  return 'nd';
    case 3:  return 'rd';
    default: return 'th';
  }
}

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [vacantProperties, setVacantProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    property_id: '',
    name: '',
    phone: '',
    rent_amount: '',
    deposit_amount: '',
    deposit_date: new Date().toISOString().split('T')[0],
    rental_start_date: new Date().toISOString().split('T')[0],
    committed_payment_date: 18,
    skip_auto_cutoff: 0
  });
  const [editingTenant, setEditingTenant] = useState(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    phone: '',
    rent_amount: '',
    committed_payment_date: '',
    skip_auto_cutoff: 0
  });

  useEffect(() => {
    fetchTenants();
    fetchVacantProperties();
  }, []);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const res = await getTenants();
      setTenants(res.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching tenants:', err);
      setError('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  const fetchVacantProperties = async () => {
    try {
      const res = await getVacantProperties();
      setVacantProperties(res.data);
    } catch (err) {
      console.error('Error fetching vacant properties:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await createTenant(formData);
      setFormData({
        property_id: '',
        name: '',
        phone: '',
        rent_amount: '',
        deposit_amount: '',
        deposit_date: new Date().toISOString().split('T')[0],
        rental_start_date: new Date().toISOString().split('T')[0],
        committed_payment_date: 18
      });
      setShowForm(false);
      await fetchTenants();
      await fetchVacantProperties();
    } catch (err) {
      console.error('Error creating tenant:', err);
      setError('Failed to create tenant: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (tenant) => {
    setEditingTenant(tenant);
    setEditFormData({
      name: tenant.name,
      phone: tenant.phone,
      rent_amount: tenant.rent_amount,
      committed_payment_date: tenant.committed_payment_date,
      skip_auto_cutoff: tenant.skip_auto_cutoff || 0
    });
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await updateTenant(editingTenant.id, editFormData);
      setEditingTenant(null);
      await fetchTenants();
    } catch (err) {
      console.error('Error updating tenant:', err);
      setError('Failed to update tenant');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this tenant record?')) return;
    try {
      setLoading(true);
      
      // Frontend safeguard (in case backend is running old code)
      const ledgerRes = await getTenantLedger(id);
      if (ledgerRes && ledgerRes.data && ledgerRes.data.ledger) {
        const hasTransactions = ledgerRes.data.ledger.some(item => item.id != null);
        if (hasTransactions) {
          alert('Cannot delete tenant: Financial transactions are already linked to this tenant.');
          setLoading(false);
          return;
        }
      }

      await deleteTenant(id);
      await fetchTenants();
    } catch (err) {
      console.error('Error deleting tenant:', err);
      const errMsg = err.response?.data?.error || 'Failed to delete tenant';
      alert(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900">Tenants</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2"
        >
          {loading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
          ) : (
            <Plus size={20} />
          )}
          Add Tenant
        </button>
      </div>

      {error && <div className="p-4 bg-red-100 text-red-800 rounded mb-4">{error}</div>}

      {/* Onboarding Form */}
      {showForm && (
        <div className="card mb-8">
          <h2 className="text-xl font-bold mb-4">Onboard New Tenant</h2>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Property</label>
                <select
                  value={formData.property_id}
                  onChange={(e) => setFormData({ ...formData, property_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  required
                >
                  <option value="">Select Property</option>
                  {vacantProperties.map(p => (
                    <option key={p.id} value={p.id}>{p.room_number} ({p.property_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="John Doe"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Phone Number</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="9876543210"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Monthly Rent (₹)</label>
                <input
                  type="number"
                  value={formData.rent_amount}
                  onChange={(e) => setFormData({ ...formData, rent_amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="4000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Security Deposit (₹)</label>
                <input
                  type="number"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="8000"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Committed Date (Day of Month)</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={formData.committed_payment_date}
                  onChange={(e) => setFormData({ ...formData, committed_payment_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Rental Start Date</label>
                <input
                  type="date"
                  value={formData.rental_start_date}
                  onChange={(e) => setFormData({ ...formData, rental_start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  required
                />
              </div>
              <div className="flex items-center gap-3 h-full pt-6">
                <input 
                  type="checkbox"
                  id="skip_auto"
                  checked={formData.skip_auto_cutoff === 1}
                  onChange={(e) => setFormData({ ...formData, skip_auto_cutoff: e.target.checked ? 1 : 0 })}
                  className="w-5 h-5 accent-blue-600"
                />
                <label htmlFor="skip_auto" className="text-sm font-bold text-gray-700">Skip Auto Power Cutoff</label>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Processing...' : 'Complete Onboarding'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto border border-gray-200">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-4 font-semibold text-gray-700">Tenant</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Property</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Contact</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Rent</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Started</th>
              <th className="px-6 py-4 font-semibold text-gray-700 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {tenants.filter(t => t.status === 'active').map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                      <User size={20} />
                    </div>
                     <div>
                      <p className="font-bold text-gray-900">{tenant.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-gray-500">ID: #{tenant.id}</p>
                        {tenant.skip_auto_cutoff === 1 && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter flex items-center gap-1">
                            <ShieldCheck size={10} /> Exempt from Cutoff
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Home size={16} className="text-gray-400" />
                    <span className="font-semibold">{tenant.room_number}</span>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded capitalize">{tenant.property_type}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone size={16} className="text-gray-400" />
                    {tenant.phone}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="font-bold text-gray-900">₹{tenant.rent_amount}</p>
                  <p className="text-xs text-gray-500 font-bold">Due on {tenant.committed_payment_date}{getOrdinalSuffix(tenant.committed_payment_date)}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar size={16} className="text-gray-400" />
                    {new Date(tenant.rental_start_date).toLocaleDateString()}
                  </div>
                </td>
                 <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button 
                      onClick={() => handleEditClick(tenant)}
                      className="p-2 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                      title="Edit Tenant"
                    >
                      <Edit size={20} />
                    </button>
                    <button 
                      onClick={() => handleDelete(tenant.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Inactivate Tenant"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tenants.filter(t => t.status === 'active').length === 0 && (
          <div className="p-12 text-center text-gray-500">
            No active tenants found. Add your first tenant to get started!
          </div>
        )}
      </div>
      {/* Edit Modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-in zoom-in duration-200">
            <div className="p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
                  <Edit size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-gray-900">Edit Tenant Details</h2>
                  <p className="text-sm text-gray-500 font-medium">Updating information for {editingTenant.room_number}</p>
                </div>
              </div>

              <form onSubmit={handleUpdateSubmit} className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Full Name</label>
                  <input 
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Phone Number</label>
                  <input 
                    type="text"
                    value={editFormData.phone}
                    onChange={(e) => setEditFormData({...editFormData, phone: e.target.value})}
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Monthly Rent (₹)</label>
                    <input 
                      type="number"
                      value={editFormData.rent_amount}
                      onChange={(e) => setEditFormData({...editFormData, rent_amount: e.target.value})}
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase mb-2 tracking-widest">Due Day</label>
                    <input 
                      type="number"
                      min="1"
                      max="31"
                      value={editFormData.committed_payment_date}
                      onChange={(e) => setEditFormData({...editFormData, committed_payment_date: e.target.value})}
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <input 
                    type="checkbox"
                    id="edit_skip_auto"
                    checked={editFormData.skip_auto_cutoff === 1}
                    onChange={(e) => setEditFormData({...editFormData, skip_auto_cutoff: e.target.checked ? 1 : 0})}
                    className="w-5 h-5 accent-amber-600"
                  />
                  <label htmlFor="edit_skip_auto" className="text-sm font-black text-amber-900 uppercase tracking-tight">
                    Skip Automated Power Cutoff
                  </label>
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Update Records'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setEditingTenant(null)}
                    className="flex-1 bg-gray-100 text-gray-600 font-black py-4 rounded-2xl hover:bg-gray-200 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
