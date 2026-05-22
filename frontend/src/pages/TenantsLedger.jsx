import React, { useState, useEffect } from 'react';
import { 
  getPayments, 
  recordPayment, 
  getLatestMeterReading,
  getTenantLedger,
  correctPayment,
  getTenants,
  getProperties,
  createTransaction,
  updateTransaction,
  deleteTransaction
} from '../services/api';
import { 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  DollarSign,
  Plus,
  ArrowRight,
  FileText,
  Check,
  X,
  Edit3,
  MessageCircle,
  Save,
  PlusCircle
} from 'lucide-react';

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

export default function TenantsLedger() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [paymentData, setPaymentData] = useState({
    amount_paid: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  
  const [ledgerData, setLedgerData] = useState(null); // { tenant, ledger, total_outstanding }
  const [editingPayment, setEditingPayment] = useState(null);
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionFormData, setTransactionFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'debit',
    charge_type: 'rent',
    payment_mode: 'cash',
    debit: '',
    credit: '',
    month_year: selectedMonth,
    notes: ''
  });
  const [editingTransaction, setEditingTransaction] = useState(null);

  const sendWhatsApp = (phone, name, amount, property) => {
    if (!phone) {
      alert('Phone number not available to send WhatsApp');
      return;
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const recipient = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
    const message = `Hi ${name}, this is a reminder for your pending balance of ₹${amount?.toLocaleString() || amount} for unit ${property}. Please settle it at the earliest. Thank you!`;
    window.open(`https://wa.me/${recipient}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const [showBulkWhatsAppModal, setShowBulkWhatsAppModal] = useState(false);
  const [bulkQueue, setBulkQueue] = useState([]);

  const sendBulkWhatsApp = () => {
    const pendingRecipients = payments.filter(p => p.total_due > 0 && p.tenant_phone);
    if (pendingRecipients.length === 0) {
      alert('No pending payments with phone numbers found.');
      return;
    }
    
    // Map them into a queue structure with a "sent" status
    const queue = pendingRecipients.map((recipient, index) => ({
      id: recipient.id || index,
      room_number: recipient.room_number,
      tenant_name: recipient.tenant_name,
      tenant_phone: recipient.tenant_phone,
      total_due: recipient.total_due,
      sent: false
    }));
    
    setBulkQueue(queue);
    setShowBulkWhatsAppModal(true);
  };

  const handleSendIndividual = (id, phone, name, amount, property) => {
    sendWhatsApp(phone, name, amount, property);
    setBulkQueue(prev => prev.map(item => item.id === id ? { ...item, sent: true } : item));
  };

  const openTransactionForm = (mode = 'debit', existing = null) => {
    if (existing) {
      setEditingTransaction(existing);
      setTransactionFormData({
        date: existing.date || new Date().toISOString().split('T')[0],
        type: existing.status === 'paid' ? 'credit' : existing.status === 'opening' ? 'opening' : 'debit',
        charge_type: existing.status === 'opening' ? 'other' : existing.rent_due > 0 ? 'rent' : existing.elec_due > 0 ? 'electricity' : 'other',
        payment_mode: existing.payment_mode || 'cash',
        debit: existing.total_due?.toString() || '',
        credit: existing.paid?.toString() || '',
        month_year: existing.month_year || selectedMonth,
        notes: existing.notes || ''
      });
      setShowTransactionForm(true);
      return;
    }

    setEditingTransaction(null);
    setTransactionFormData({
      date: new Date().toISOString().split('T')[0],
      type: mode,
      charge_type: mode === 'credit' ? 'other' : 'rent',
      payment_mode: 'cash',
      debit: '',
      credit: '',
      month_year: selectedMonth,
      notes: ''
    });
    setShowTransactionForm(true);
  };

  const closeTransactionForm = () => {
    setShowTransactionForm(false);
    setEditingTransaction(null);
    setTransactionFormData({
      date: new Date().toISOString().split('T')[0],
      type: 'debit',
      charge_type: 'rent',
      payment_mode: 'cash',
      debit: '',
      credit: '',
      month_year: selectedMonth,
      notes: ''
    });
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    const tenantId = ledgerData?.tenant?.id;
    if (!tenantId) return;

    try {
      setLoading(true);
      const payload = {
        tenant_id: tenantId,
        date: transactionFormData.date,
        type: transactionFormData.type,
        charge_type: transactionFormData.charge_type,
        payment_mode: transactionFormData.payment_mode,
        debit: parseFloat(transactionFormData.debit) || 0,
        credit: parseFloat(transactionFormData.credit) || 0,
        month_year: transactionFormData.month_year,
        notes: transactionFormData.notes
      };

      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, payload);
      } else {
        await createTransaction(payload);
      }
      await fetchLedger({ tenant_id: tenantId, tenant_name: ledgerData.tenant.name, property_id: ledgerData.tenant.property_id, room_number: ledgerData.tenant.room_number });
      closeTransactionForm();
    } catch (err) {
      console.error('Error saving transaction:', err);
      alert('Unable to save transaction');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTransaction = async (transactionId) => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      setLoading(true);
      await deleteTransaction(transactionId);
      await fetchLedger({ tenant_id: ledgerData.tenant.id });
    } catch (err) {
      console.error('Error deleting transaction:', err);
      alert('Unable to delete transaction');
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async (payment) => {
    let tenantId = payment.tenant_id || payment.tenant_id;
    try {
      setLoading(true);
      
      // Fallback if property has an active tenant but no payment row for this month
      if (!tenantId) {
        const tenantsRes = await getTenants();
        const activeTenant = tenantsRes.data.find(
          t => t.property_id === payment.property_id && t.status === 'active'
        );
        if (activeTenant) {
          tenantId = activeTenant.id;
        }
      }

      if (!tenantId) {
        alert("No active tenant for this property.");
        return;
      }

      const res = await getTenantLedger(tenantId);
      setLedgerData(res.data);
    } catch (err) {
      console.error('Error fetching ledger:', err);
      setError('Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  const handleCorrectPayment = async (paymentId) => {
    if (!correctionAmount || isNaN(correctionAmount)) return;
    try {
      setLoading(true);
      await correctPayment(paymentId, { amount_paid: parseFloat(correctionAmount) });
      const res = await getTenantLedger(ledgerData.tenant.id);
      setLedgerData(res.data);
      setEditingPayment(null);
      setCorrectionAmount('');
      fetchInitialData();
    } catch (err) {
      console.error('Error correcting payment:', err);
      alert('Failed to correct payment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, [selectedMonth]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [payRes, propRes] = await Promise.all([
        getPayments({ month_year: selectedMonth }),
        getProperties() // Fetch properties as well
      ]);
      
      const allProperties = propRes.data.filter(p => p.room_number !== 'Common Meter');
      const paymentsMap = new Map(payRes.data.map(p => [p.property_id, p]));

      const combinedData = allProperties.map(property => {
        const payment = paymentsMap.get(property.id);
        const totalDue = payment ? payment.total_due : 0;
        const amountPaid = payment ? payment.amount_paid : 0;
        return {
          ...property,
          ...payment,
          tenant_id: payment?.tenant_id || property.tenant_id,
          tenant_name: payment?.tenant_name || property.tenant_name,
          tenant_phone: payment?.tenant_phone || property.tenant_phone,
          total_due: totalDue,
          amount_paid: amountPaid,
          paymentDetails: payment,
        };
      });

      setPayments(combinedData);
      setError(null);
    } catch (err) {
      console.error('Error fetching payments data:', err);
      setError('Failed to load payments data');
    } finally {
      setLoading(false);
    }
  };

  // Modified getStatus to use the payments map
  const getStatus = (propertyId, paymentsMap) => {
    const payment = paymentsMap.get(propertyId);
    if (!payment) return { label: 'PENDING', class: 'bg-red-100 text-red-700', icon: <Clock size={14} /> };
    if (payment.payment_status === 'paid') return { label: 'PAID', class: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={14} /> };
    if (payment.payment_status === 'partial') return { label: 'PARTIAL', class: 'bg-yellow-100 text-yellow-700', icon: <AlertCircle size={14} /> };
    return { label: 'PENDING', class: 'bg-red-100 text-red-700', icon: <Clock size={14} /> };
  };

  // getAmountPaid is no longer needed in this structure, it's part of the combinedData

  const paymentsMap = new Map(payments.map(p => [p.property_id, p]));
  const paidCount = payments.filter(p => p.payment_status === 'paid').length;
  const partialCount = payments.filter(p => p.payment_status === 'partial').length;
  const pendingCount = payments.filter(p => !p.payment_status || p.payment_status === 'pending').length;
  const totalCount = payments.length;

  const filteredPayments = payments.filter(p => {
    const searchText = `${p.room_number || ''} ${p.tenant_name || ''}`.toLowerCase();
    const matchesSearch = searchText.includes(searchTerm.toLowerCase());
    const matchesStatus = selectedStatus === 'all' || p.payment_status === selectedStatus || (selectedStatus === 'pending' && (!p.payment_status || p.payment_status === 'pending'));
    return matchesSearch && matchesStatus;
  });

  const ledgerTotals = ledgerData ? ledgerData.ledger.reduce((totals, item) => {
    return {
      charged: totals.charged + (item.total_due || 0),
      paid: totals.paid + (item.paid || 0),
      balance: totals.balance + (item.balance || 0),
    };
  }, { charged: 0, paid: 0, balance: 0 }) : { charged: 0, paid: 0, balance: 0 };

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const getMonthNameFromMonthYear = (my) => {
    if (!my) return null;
    const m = my.match(/(\d{4})-(\d{2})/);
    if (m) return monthNames[parseInt(m[2], 10) - 1];
    const nameMatch = my.match(/([A-Za-z]+)/);
    if (nameMatch) return nameMatch[1];
    return null;
  };

  const summarizeNotes = (item) => {
    if (!item) return '';
    if (item.month_year && item.charge_type) {
      const month = getMonthNameFromMonthYear(item.month_year);
      const type = item.charge_type === 'electricity' ? 'Electricity Bill' : item.charge_type.charAt(0).toUpperCase() + item.charge_type.slice(1);
      if (month && type) return `${month}-${type}`;
    }

    if (item.notes) {
      const parts = item.notes.split('|').map(p => p.trim()).filter(Boolean);
      const found = parts.find(p => /rent/i.test(p) || /electricity/i.test(p));
      const token = found || parts[0];
      if (token) {
        const short = token.length > 40 ? token.slice(0, 40).trim() + '...' : token;
        return short.replace(/\s+/g, ' ');
      }
    }

    return item.status === 'opening' ? 'Opening balance' : 'Recorded entry';
  };

  const getEntryTitle = (item) => {
    if (item.particulars && item.particulars.trim() !== '' && item.particulars !== 'Ledger Entry') {
      return item.particulars;
    }
    
    // Fallback for older auto-generated bills that used markdown tables in notes
    if (item.notes && item.notes.includes('| Period Start |')) {
      const lines = item.notes.split('\n');
      if (lines.length >= 3) {
        const headers = lines[0].split('|').map(p => p.trim()).filter(Boolean);
        const values = lines[2].split('|').map(p => p.trim()).filter(Boolean);
        
        if (headers.length >= 4 && values.length >= 4) {
          // If it's a rent charge (or just a generic debit that's not electricity)
          if (item.charge_type === 'rent' || (item.debit > 0 && item.credit === 0 && !item.notes.toLowerCase().includes('units'))) {
            return values[2]; // Rent Ledger Label value
          }
          // If it's electricity
          if (item.charge_type === 'electricity' || (item.debit > 0 && item.credit === 0 && item.notes.toLowerCase().includes('units'))) {
            return values[3]; // Electricity Ledger Label value
          }
        }
      }
    }

    if (item.charge_type && item.charge_type.trim() !== '') {
      return item.charge_type.replace(/\b\w/g, c => c.toUpperCase());
    }

    return 'Ledger Entry';
  };

  const openPaymentModal = async (property) => {
    setSelectedProperty(property);
    setShowModal(true);
    
    try {
      const meterRes = await getLatestMeterReading(property.id);
      const latestReading = meterRes.data;
      
      setPaymentData({
        ...paymentData,
        base_rent: property.rent_amount || property.base_rent || 0,
        electricity_bill: latestReading?.electricity_bill || property.electricity_bill || 0,
        historical_outstanding: property.historical_outstanding > 0 ? property.historical_outstanding : 0,
        amount_paid: property.total_due > 0 ? property.total_due.toString() : (property.current_month_due || 0).toString(),
      });
    } catch (err) {
      console.error('Error fetching meter reading for modal:', err);
      setPaymentData({
        ...paymentData,
        base_rent: property.rent_amount || property.base_rent || 0,
        electricity_bill: property.electricity_bill || 0,
        historical_outstanding: property.historical_outstanding > 0 ? property.historical_outstanding : 0,
        amount_paid: property.total_due > 0 ? property.total_due.toString() : (property.current_month_due || 0).toString(),
      });
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await recordPayment({
        property_id: selectedProperty.id,
        month_year: selectedMonth,
        base_rent: parseFloat(paymentData.base_rent),
        electricity_bill: parseFloat(paymentData.electricity_bill),
        amount_paid: parseFloat(paymentData.amount_paid),
        payment_date: paymentData.payment_date,
        notes: paymentData.notes,
        tenant_id: selectedProperty.tenant_id, // Include tenant_id
      });
      setShowModal(false);
      fetchInitialData(); // Refresh list
    } catch (err) {
      console.error('Error recording payment:', err);
      alert('Failed to record payment: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Tenants Ledger</h1>
          <p className="text-gray-500 mt-1">Manage tenant ledgers, collections and dues</p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-[1fr_auto_auto] md:w-auto">
          <div className="flex items-center gap-3 bg-white p-2 rounded-xl shadow-sm border">
            <Filter size={18} className="text-gray-400" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border-none focus:ring-0 text-gray-700 font-semibold"
            />
          </div>
          <button
            type="button"
            onClick={fetchInitialData}
            className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={sendBulkWhatsApp}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-blue-700 transition-colors"
          >
            Send Bulk WhatsApp
          </button>
        </div>
      </div>



      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by room, tenant, or status..."
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {['all', 'paid', 'partial', 'pending'].map((status) => {
            const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
            const selected = selectedStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setSelectedStatus(status)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-all ${selected ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[920px] max-h-[calc(100vh-16rem)] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Property</th>
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Tenant</th>
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Status</th>
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Due Date</th>
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Total Due Balance</th>
                  <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-20 text-center text-gray-400 font-bold italic">
                      {payments.length === 0 ? 'No collections found for this period.' : 'No matching properties found for your search.'}
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment) => {
                    const status = getStatus(payment.property_id, paymentsMap);
                    return (
                      <tr key={payment.property_id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 text-sm">{payment.room_number}</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-0.5 rounded border">{payment.property_type}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <p className="font-semibold text-gray-800 text-sm whitespace-nowrap">{payment.tenant_name || <span className="text-gray-400 italic">Vacant</span>}</p>
                        </td>
                        <td className="px-6 py-3">
                          <span className={`${status.class} inline-flex items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider`}>
                            {status.icon}
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-600 font-semibold text-xs">
                          {payment.committed_payment_date 
                            ? `${payment.committed_payment_date}${getOrdinalSuffix(payment.committed_payment_date)}` 
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-3">
                          <span className="font-bold text-gray-950 text-sm">₹{(payment.total_due || 0).toLocaleString()}</span>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fetchLedger(payment)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <FileText size={13} />
                              View Ledger
                            </button>
                            <button
                              type="button"
                              onClick={() => sendWhatsApp(payment.tenant_phone, payment.tenant_name || payment.room_number, payment.total_due, payment.room_number)}
                              disabled={!payment.tenant_phone}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold rounded-lg transition-colors whitespace-nowrap ${payment.tenant_phone ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-800' : 'bg-gray-50 text-gray-400 cursor-not-allowed'}`}
                            >
                              <MessageCircle size={13} />
                              Send WA
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        {payments.length === 0 && (
          <div className="p-20 text-center flex flex-col items-center gap-4">
            <AlertCircle size={48} className="text-gray-200" />
            <p className="text-gray-400 font-bold italic text-lg">No collections found for this period.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="max-h-[calc(100vh-4rem)] overflow-y-auto">
              <div className="bg-blue-600 p-6 text-white">
                <h2 className="text-2xl font-bold">Record Payment</h2>
                <p className="opacity-90">{selectedProperty?.room_number} - {selectedProperty?.tenant_name}</p>
              </div>
              <form onSubmit={handlePaymentSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Base Rent</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
                      <input
                        type="number"
                        value={paymentData.base_rent}
                        onChange={(e) => setPaymentData({ ...paymentData, base_rent: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border rounded bg-gray-50"
                        readOnly
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Electricity Bill</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
                      <input
                        type="number"
                        value={paymentData.electricity_bill}
                        onChange={(e) => setPaymentData({ ...paymentData, electricity_bill: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border rounded"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-blue-700 font-semibold">Total Due</span>
                    <span className="text-xl font-black text-blue-900">
                      ₹{(
                        parseFloat(paymentData.base_rent || 0) +
                        parseFloat(paymentData.electricity_bill || 0) +
                        parseFloat(paymentData.historical_outstanding || 0)
                      ).toLocaleString()}
                    </span>
                  </div>
                  {parseFloat(paymentData.historical_outstanding || 0) > 0 && (
                    <div className="text-xs text-blue-600 mt-1 flex justify-between">
                      <span>(Current Month: ₹{(parseFloat(paymentData.base_rent || 0) + parseFloat(paymentData.electricity_bill || 0)).toLocaleString()})</span>
                      <span>Past Dues: ₹{parseFloat(paymentData.historical_outstanding || 0).toLocaleString()}</span>
                    </div>
                  )}
                  {parseFloat(paymentData.historical_outstanding || 0) < 0 && (
                    <div className="text-xs text-blue-600 mt-1 flex justify-between">
                      <span>(Current Month: ₹{(parseFloat(paymentData.base_rent || 0) + parseFloat(paymentData.electricity_bill || 0)).toLocaleString()})</span>
                      <span>Advance/Overpaid: ₹{Math.abs(parseFloat(paymentData.historical_outstanding || 0)).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount Being Paid Now</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
                    <input
                      type="number"
                      value={paymentData.amount_paid}
                      onChange={(e) => setPaymentData({ ...paymentData, amount_paid: e.target.value })}
                      className="w-full pl-7 pr-3 py-3 border-2 border-blue-500 rounded-xl text-lg font-bold outline-none"
                      placeholder="Enter amount"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Date</label>
                    <input
                      type="date"
                      value={paymentData.payment_date}
                      onChange={(e) => setPaymentData({ ...paymentData, payment_date: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Month</label>
                    <input
                      type="text"
                      value={selectedMonth}
                      readOnly
                      className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes</label>
                  <textarea
                    value={paymentData.notes}
                    onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded resize-none"
                    rows="2"
                    placeholder="e.g. Paid via UPI, Partial payment"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 py-3 px-4 rounded-xl font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-3 px-4 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                  >
                    {submitting ? 'Recording...' : <><ArrowRight size={18} /> Confirm Payment</>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {ledgerData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-6xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="max-h-[calc(100vh-4rem)] overflow-y-auto">
              
              {/* Transaction Form block inside modal container */}
              {showTransactionForm && (
                <div className="p-8 border-b border-gray-100 bg-white">
                  <div className="flex justify-between gap-4 items-start mb-6">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 leading-tight">{editingTransaction ? 'Edit Transaction' : 'New Transaction'}</h3>
                      <p className="text-xs text-gray-400 font-bold tracking-wider mt-1">Adjust the ledger with a clean, accurate entry.</p>
                    </div>
                    <button
                      onClick={closeTransactionForm}
                      className="text-sm font-semibold text-gray-400 hover:text-gray-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <form onSubmit={handleTransactionSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Date</label>
                        <input
                          type="date"
                          value={transactionFormData.date}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, date: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Type</label>
                        <select
                          value={transactionFormData.type}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, type: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="debit">Charge</option>
                          <option value="credit">Payment</option>
                          <option value="opening">Opening Balance</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Charge / Payment</label>
                        <select
                          value={transactionFormData.charge_type}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, charge_type: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="rent">Rent</option>
                          <option value="electricity">Electricity</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Month / Year</label>
                        <input
                          type="month"
                          value={transactionFormData.month_year}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, month_year: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Debit</label>
                        <input
                          type="number"
                          value={transactionFormData.debit}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, debit: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Credit</label>
                        <input
                          type="number"
                          value={transactionFormData.credit}
                          onChange={(e) => setTransactionFormData({ ...transactionFormData, credit: e.target.value })}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Notes</label>
                      <input
                        type="text"
                        value={transactionFormData.notes}
                        onChange={(e) => setTransactionFormData({ ...transactionFormData, notes: e.target.value })}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
                        placeholder="Payment details or reason"
                      />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={closeTransactionForm}
                        className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-indigo-700 transition-all shadow-md"
                      >
                        <Plus size={16} /> {editingTransaction ? 'UPDATE' : 'ADD'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Full Statement Section */}
              <div className="p-8 bg-white">
                <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-gray-900 uppercase tracking-wider">Full Statement</h3>
                    <p className="text-sm text-gray-500 mt-1">A clean ledger view of all transactions for **{ledgerData.tenant.name}** (Room {ledgerData.tenant.room_number || 'N/A'}).</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {!showTransactionForm && (
                      <button
                        onClick={() => openTransactionForm('debit')}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-indigo-700 transition-colors shadow-md"
                      >
                        <PlusCircle size={16} /> Add Transaction
                      </button>
                    )}
                    <button
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      Print Statement
                    </button>
                    <button
                      onClick={() => setLedgerData(null)}
                      className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white hover:bg-black transition-colors shadow-md"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-3xl border border-gray-100">
                  <table className="w-full min-w-[800px] divide-y divide-gray-100">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-gray-500">Date</th>
                        <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-gray-500">Description</th>
                        <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-widest text-gray-500">Debit</th>
                        <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-widest text-gray-500">Credit</th>
                        <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-widest text-gray-500">Balance</th>
                        <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-widest text-gray-500">Status</th>
                        <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-widest text-gray-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {ledgerData.ledger.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="px-6 py-12 text-center text-sm text-gray-400">
                            No ledger entries available for this tenant.
                          </td>
                        </tr>
                      ) : (
                        ledgerData.ledger.map((item, idx) => (
                          <tr key={item.id || idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 text-sm text-gray-600 font-bold">{item.date ? new Date(item.date).toLocaleDateString() : item.month_year || '-'}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">
                              <div className="font-bold text-gray-900">{getEntryTitle(item)}</div>
                              {!item.particulars && !item.notes?.includes('| Period Start |') && (
                                <div className="text-xs text-gray-500">{summarizeNotes(item)}</div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right text-sm font-black text-rose-600">₹{item.total_due || 0}</td>
                            <td className="px-6 py-4 text-right text-sm font-black text-emerald-600">₹{item.paid || 0}</td>
                            <td className="px-6 py-4 text-right text-sm font-black text-gray-900">₹{item.balance || 0}</td>
                            <td className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider ${
                                item.status === 'paid' 
                                  ? 'bg-emerald-100 text-emerald-700' 
                                  : item.status === 'partial' 
                                    ? 'bg-amber-100 text-amber-700' 
                                    : 'bg-rose-100 text-rose-700'
                              }`}>
                                {item.status || 'pending'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openTransactionForm(null, item)}
                                  className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTransaction(item.id)}
                                  className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors shadow-sm"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-gray-100 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-emerald-600 p-6 text-white flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <MessageCircle size={24} />
                  Bulk WhatsApp Reminders
                </h3>
                <p className="text-sm opacity-90 font-medium mt-1">
                  Send pending outstanding alerts to active tenants in click sequence.
                </p>
              </div>
              <button 
                onClick={() => setShowBulkWhatsAppModal(false)}
                className="w-10 h-10 bg-emerald-700/50 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center font-bold transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Progress bar */}
            <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center justify-between gap-4 flex-shrink-0">
              <div className="flex-1">
                <div className="flex justify-between items-center text-xs font-black text-emerald-800 uppercase tracking-widest mb-1.5">
                  <span>Dispatch Queue</span>
                  <span>
                    {bulkQueue.filter(q => q.sent).length} of {bulkQueue.length} Alerted
                  </span>
                </div>
                <div className="w-full h-2.5 bg-emerald-200/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${(bulkQueue.filter(q => q.sent).length / bulkQueue.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {bulkQueue.map((item) => (
                <div 
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-2xl gap-4 transition-all ${
                    item.sent 
                      ? 'bg-gray-50/70 border-gray-100 opacity-60' 
                      : 'bg-white border-gray-200 shadow-sm hover:border-emerald-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xs ${
                      item.sent ? 'bg-gray-100 text-gray-400' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {item.sent ? <Check size={18} /> : item.room_number}
                    </div>
                    <div>
                      <div className="font-black text-gray-900 text-sm">{item.tenant_name || item.room_number}</div>
                      <div className="text-xs text-gray-400 font-bold">{item.tenant_phone}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Balance Due</span>
                      <span className="font-black text-gray-900 text-sm">₹{item.total_due?.toLocaleString()}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSendIndividual(item.id, item.tenant_phone, item.tenant_name || item.room_number, item.total_due, item.room_number)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                        item.sent 
                          ? 'bg-gray-100 text-gray-400 cursor-default' 
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-100'
                      }`}
                      disabled={item.sent}
                    >
                      <MessageCircle size={14} />
                      {item.sent ? 'Sent' : 'Send'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowBulkWhatsAppModal(false)}
                className="btn bg-gray-200 hover:bg-gray-300 text-gray-700 font-black text-xs uppercase tracking-widest py-3 px-6 rounded-xl"
              >
                Close Dispatcher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
