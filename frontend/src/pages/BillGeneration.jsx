import React, { useState, useEffect } from 'react';
import { 
  getBillingSummary, 
  checkDuplicateBills, 
  generateBills,
  getTenants 
} from '../services/api';
import { 
  Receipt,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Home,
  Calendar,
  DollarSign,
  FileText,
  Loader,
  Sparkles,
  Coins,
  Search,
  ArrowRight,
  UserCheck
} from 'lucide-react';

export default function BillGeneration() {
  // State for selected month
  const [selectedMonth, setSelectedMonth] = useState('');
  // Computed dates for display and API
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  
  // State for data
  const [tenants, setTenants] = useState([]);
  const [billingData, setBillingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Rent bills state
  const [rentBills, setRentBills] = useState([]);
  const [allRentSelected, setAllRentSelected] = useState(true);

  // Electricity bills state
  const [elecBills, setElecBills] = useState([]);
  const [allElecSelected, setAllElecSelected] = useState(true);

  // Bill labels
  const [billLabels, setBillLabels] = useState({ rent: '', electricity: '' });

  // Filter State
  const [searchTerm, setSearchTerm] = useState('');

  // Generate month options
  const monthOptions = React.useMemo(() => {
    const options = [];
    const today = new Date();
    // Generate from 6 months ago to 6 months ahead
    for (let i = -6; i <= 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  }, []);

  // Initialize dates on component mount
  useEffect(() => {
    const today = new Date();
    let targetMonth = today.getMonth();
    let targetYear = today.getFullYear();
    
    // If before 10th, default to previous month's billing cycle
    if (today.getDate() < 10) {
      targetMonth -= 1;
      if (targetMonth < 0) {
        targetMonth = 11;
        targetYear -= 1;
      }
    }
    
    const initialMonth = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
    handleMonthChange(initialMonth);
  }, []);

  const handleMonthChange = (monthVal) => {
    setSelectedMonth(monthVal);
    
    const [yearStr, monthStr] = monthVal.split('-');
    const year = parseInt(yearStr);
    const monthIndex = parseInt(monthStr) - 1;

    // Start Date -> 10th of the selected month
    const fromDate = new Date(year, monthIndex, 10);
    // End Date -> 9th of the next month
    const toDate = new Date(year, monthIndex + 1, 9);

    // Format manually to avoid timezone shift issues
    const fromStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-10`;
    const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-09`;

    setPeriodFrom(fromStr);
    setPeriodTo(toStr);
    
    updateBillLabels(monthVal);
    fetchBillingData(fromStr, toStr, monthVal);
  };

  /**
   * Calculate bill labels based on selected month
   */
  const updateBillLabels = (monthYearVal) => {
    if (!monthYearVal) return;

    const [year, month] = monthYearVal.split('-');
    const d = new Date(year, parseInt(month) - 1, 1);
    const monthName = d.toLocaleString('en-IN', { month: 'long' });
    
    setBillLabels({
      rent: `${monthName} ${year}-Rent`,
      electricity: `${monthName} ${year}-Electricity Bills`
    });
  };

  /**
   * Fetch billing data from backend
   */
  const fetchBillingData = async (from, to, month_year) => {
    if (!from || !to) return;

    try {
      setLoading(true);
      setMessage(null);

      const response = await getBillingSummary(from, to, month_year);
      
      // Initialize rent bills
      const rentBillsData = response.tenants.map(tenant => ({
        tenant_id: tenant.tenant_id,
        tenant_name: tenant.tenant_name,
        room_number: tenant.room_number,
        property_id: tenant.property_id,
        property_type: tenant.property_type,
        rent_amount: parseFloat(tenant.rent_amount) || 0,
        amount: parseFloat(tenant.rent_amount) || 0, // User can override
        include: !tenant.has_rent_bill, // Do not include if already billed
        has_rent_bill: tenant.has_rent_bill
      }));

      // Initialize electricity bills
      const elecBillsData = response.tenants.map(tenant => {
        const reading = tenant.latest_meter_reading;
        const previousReading = reading?.previous_reading || 0;
        const currentReading = reading?.current_reading || 0;
        const unitsConsumed = Math.max(0, currentReading - previousReading);
        const amount = unitsConsumed * (response.electricity_rate || 9);

        return {
          tenant_id: tenant.tenant_id,
          tenant_name: tenant.tenant_name,
          room_number: tenant.room_number,
          property_id: tenant.property_id,
          previous_reading: previousReading,
          current_reading: currentReading,
          units_consumed: unitsConsumed,
          rate_per_unit: response.electricity_rate || 9,
          amount: amount, // User can override
          calculated_amount: amount,
          include: reading && !tenant.has_electricity_bill ? true : false, // Do not include if already billed or no reading
          has_reading: !!reading,
          reading_date: reading?.reading_date || null,
          has_electricity_bill: tenant.has_electricity_bill
        };
      });

      setRentBills(rentBillsData);
      setElecBills(elecBillsData);
      setBillingData(response);
      setAllRentSelected(true);
      setAllElecSelected(true);

    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to fetch billing data'
      });
      console.error('Error fetching billing data:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Toggle rent bill selection for individual tenant
   */
  const toggleRentBill = (tenantId) => {
    setRentBills(prev => 
      prev.map(bill => 
        bill.tenant_id === tenantId ? { ...bill, include: !bill.include } : bill
      )
    );
    setAllRentSelected(false);
  };

  /**
   * Toggle all rent bills
   */
  const toggleAllRent = () => {
    const newSelected = !allRentSelected;
    setRentBills(prev => prev.map(bill => ({ 
      ...bill, 
      include: bill.has_rent_bill ? false : newSelected 
    })));
    setAllRentSelected(newSelected);
  };

  /**
   * Toggle electricity bill selection for individual tenant
   */
  const toggleElecBill = (tenantId) => {
    setElecBills(prev =>
      prev.map(bill =>
        bill.tenant_id === tenantId ? { ...bill, include: !bill.include } : bill
      )
    );
    setAllElecSelected(false);
  };

  /**
   * Toggle all electricity bills
   */
  const toggleAllElec = () => {
    const newSelected = !allElecSelected;
    setElecBills(prev => prev.map(bill => ({ 
      ...bill, 
      include: (bill.has_electricity_bill || !bill.has_reading) ? false : newSelected 
    })));
    setAllElecSelected(newSelected);
  };

  /**
   * Update rent amount for a tenant
   */
  const updateRentAmount = (tenantId, newAmount) => {
    setRentBills(prev =>
      prev.map(bill =>
        bill.tenant_id === tenantId ? { ...bill, amount: parseFloat(newAmount) || 0 } : bill
      )
    );
  };

  /**
   * Update electricity amount for a tenant
   */
  const updateElecAmount = (tenantId, newAmount) => {
    setElecBills(prev =>
      prev.map(bill =>
        bill.tenant_id === tenantId ? { ...bill, amount: parseFloat(newAmount) || 0 } : bill
      )
    );
  };

  /**
   * Show confirmation before generating
   */
  const handleGenerateClick = async () => {
    // Validate that at least one bill is selected
    const rentSelected = rentBills.some(b => b.include);
    const elecSelected = elecBills.some(b => b.include);

    if (!rentSelected && !elecSelected) {
      setMessage({
        type: 'error',
        text: 'Please select at least one bill to generate'
      });
      return;
    }

    try {
      setSubmitting(true);
      
      const selectedTenantIds = new Set([
        ...rentBills.filter(b => b.include).map(b => b.tenant_id),
        ...elecBills.filter(b => b.include).map(b => b.tenant_id)
      ]);

      const duplicateCheck = await checkDuplicateBills({
        period_from: periodFrom,
        period_to: periodTo,
        tenant_ids: Array.from(selectedTenantIds)
      });

      if (duplicateCheck.has_duplicates) {
        setMessage({
          type: 'error',
          text: `Bills for this period (${periodFrom} to ${periodTo}) have already been generated for some selected tenants. Please check the Tenant Ledger to avoid duplicate entries.`
        });
        setSubmitting(false);
        return; // Prevent further execution
      }

    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Failed to check for duplicate bills. Please try again.'
      });
      setSubmitting(false);
      return;
    }

    setSubmitting(false);

    // Check for zero amounts
    const zeroAmountWarnings = [];
    
    rentBills.forEach(bill => {
      if (bill.include && bill.amount === 0) {
        zeroAmountWarnings.push(`${bill.room_number}: Rs. 0 rent amount`);
      }
    });

    elecBills.forEach(bill => {
      if (bill.include && bill.amount === 0) {
        zeroAmountWarnings.push(`${bill.room_number}: Rs. 0 electricity amount`);
      }
    });

    if (zeroAmountWarnings.length > 0) {
      setMessage({
        type: 'warning',
        text: `Warning: Zero-value amounts detected:\n${zeroAmountWarnings.join('\n')}\n\nPlease confirm to proceed with these zero-value entries.`
      });
    }

    setShowConfirmation(true);
  };

  /**
   * Generate bills
   */
  const handleConfirmGenerate = async () => {
    try {
      setSubmitting(true);
      setMessage(null);

      const payload = {
        period_from: periodFrom,
        period_to: periodTo,
        month_year: selectedMonth,
        rent_label: billLabels.rent,
        electricity_label: billLabels.electricity,
        rent_bills: rentBills.map(b => ({
          tenant_id: b.tenant_id,
          amount: b.amount,
          include: b.include
        })),
        electricity_bills: elecBills.map(b => ({
          tenant_id: b.tenant_id,
          amount: b.amount,
          include: b.include
        }))
      };

      const response = await generateBills(payload);

      setMessage({
        type: 'success',
        text: 'Bills generated successfully! Entries have been recorded in the Tenant Ledger.',
        isToast: true
      });

      setShowConfirmation(false);
      
      // Reset form after successful generation
      setTimeout(() => {
        handleMonthChange(selectedMonth); // Re-fetch to update duplicate status
      }, 2000);

    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to generate bills'
      });
      console.error('Error generating bills:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedRentCount = rentBills.filter(b => b.include).length;
  const selectedElecCount = elecBills.filter(b => b.include).length;
  const totalRentAmount = rentBills.filter(b => b.include).reduce((sum, b) => sum + b.amount, 0);
  const totalElecAmount = elecBills.filter(b => b.include).reduce((sum, b) => sum + b.amount, 0);

  // Filters bills based on search string
  const filteredRentBills = rentBills.filter(b => 
    b.tenant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.room_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredElecBills = elecBills.filter(b => 
    b.tenant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.room_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formattedPeriodFrom = periodFrom ? periodFrom.split('-').reverse().join('-') : '—';
  const formattedPeriodTo = periodTo ? periodTo.split('-').reverse().join('-') : '—';

  return (
    <div className="p-3 bg-gray-50 min-h-screen flex flex-col overflow-hidden max-h-screen select-none">
      
      {/* 🚀 Highly Prominent Header Section with Action Button */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-650 text-white rounded-xl shadow-sm">
            <Receipt className="w-5.5 h-5.5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-955 tracking-tight leading-none">Bill Generation</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[9px] font-black text-indigo-650 uppercase bg-indigo-50/70 px-2.5 py-0.5 rounded-full border border-indigo-100/40 tracking-wider">Active Cycle</span>
              <span className="text-xs font-black text-gray-700 flex items-center gap-1.5">
                <span className="font-medium text-gray-400">{formattedPeriodFrom}</span>
                <span className="text-gray-300">→</span>
                <span className="font-medium text-gray-400">{formattedPeriodTo}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Huge, Bold Action Button Standalone in Page Header */}
        <button
          onClick={handleGenerateClick}
          disabled={loading || (rentBills.length === 0 && elecBills.length === 0)}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-850 text-white font-black text-[11px] uppercase tracking-widest rounded-xl disabled:from-gray-250 disabled:to-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed shadow-lg shadow-indigo-200/60 hover:shadow-indigo-300/80 active:scale-98 transition-all duration-250 flex items-center gap-2 border border-indigo-500/20"
        >
          <FileText className="w-4.5 h-4.5" />
          Generate Selected Bills ({selectedRentCount + selectedElecCount})
        </button>
      </div>

      {/* Super Compact Consolidated Control Card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-2.5 shadow-sm mb-3 flex-shrink-0 flex items-center justify-between gap-4 flex-wrap">
        {/* Inputs & Search inline */}
        <div className="flex items-center gap-3">
          {/* Month selector */}
          <div className="relative">
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="pl-3 pr-8 py-1.5 bg-gray-50 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-extrabold text-gray-800 appearance-none text-xs w-[140px] transition-all"
            >
              {monthOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none w-3.5 h-3.5" />
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8.5 pr-3.5 py-1.5 text-xs font-extrabold text-gray-800 bg-gray-50 border border-gray-250 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 w-[140px] transition-all placeholder-gray-455"
            />
          </div>
        </div>

        {/* KPI Compact inline metrics */}
        <div className="flex items-center gap-3">
          {/* Rent selected */}
          <div className="bg-emerald-50 border-2 border-emerald-100 rounded-xl px-3.5 py-1.5 flex items-center gap-3 shadow-sm hover:shadow transition-all duration-200">
            <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
              <Home className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[14px] font-black text-emerald-950 leading-none tracking-tight">₹{totalRentAmount.toLocaleString()}</div>
              <div className="text-[9px] font-black text-emerald-800 uppercase mt-1 tracking-wider">{selectedRentCount}/{rentBills.length} Rent</div>
            </div>
          </div>

          {/* Elec selected */}
          <div className="bg-amber-50 border-2 border-amber-100 rounded-xl px-3.5 py-1.5 flex items-center gap-3 shadow-sm hover:shadow transition-all duration-200">
            <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[14px] font-black text-amber-950 leading-none tracking-tight">₹{totalElecAmount.toLocaleString()}</div>
              <div className="text-[9px] font-black text-amber-800 uppercase mt-1 tracking-wider">{selectedElecCount}/{elecBills.length} Elec</div>
            </div>
          </div>

          {/* Grand total */}
          <div className="bg-slate-900 text-white rounded-xl px-3.5 py-1.5 flex items-center gap-3 shadow-md hover:bg-slate-950 transition-all duration-200">
            <div className="p-1.5 bg-indigo-600 text-white rounded-lg">
              <Coins className="w-4 h-4 text-indigo-200" />
            </div>
            <div>
              <div className="text-[14px] font-black text-white leading-none tracking-tight">₹{(totalRentAmount + totalElecAmount).toLocaleString()}</div>
              <div className="text-[9px] font-black text-indigo-300 uppercase mt-1 tracking-wider">Grand Total</div>
            </div>
          </div>
        </div>

        {/* Labels inline edit */}
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-150 px-3 py-1 rounded-xl h-9.5 text-xs font-extrabold">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Rent:</span>
            <input
              type="text"
              value={billLabels.rent}
              onChange={(e) => setBillLabels({ ...billLabels, rent: e.target.value })}
              className="py-0.5 text-xs font-extrabold text-gray-800 bg-transparent border-b border-gray-250 focus:outline-none focus:border-indigo-500 w-[115px]"
            />
          </div>
          <div className="w-px h-4 bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Elec:</span>
            <input
              type="text"
              value={billLabels.electricity}
              onChange={(e) => setBillLabels({ ...billLabels, electricity: e.target.value })}
              className="py-0.5 text-xs font-extrabold text-gray-800 bg-transparent border-b border-gray-250 focus:outline-none focus:border-indigo-500 w-[125px]"
            />
          </div>
        </div>
      </div>

      {/* Messages */}
      {message && !message.isToast && (
        <div className={`p-2.5 rounded-xl mb-3 shadow-sm flex gap-2 flex-shrink-0 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-150' :
          message.type === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-150' :
          'bg-amber-50 text-amber-800 border border-amber-150'
        }`}>
          {message.type === 'success' ? <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" /> :
           message.type === 'error' ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" /> :
           <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />}
          <div className="whitespace-pre-line text-xs font-bold leading-relaxed">{message.text}</div>
        </div>
      )}

      {/* Toast Notification */}
      {message && message.isToast && (
        <div className="fixed bottom-6 right-6 bg-gray-955 text-white px-6 py-4.5 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-emerald-500 rounded-full p-1 flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
          <div className="whitespace-pre-line font-black text-xs tracking-wide">{message.text}</div>
          <button onClick={() => setMessage(null)} className="ml-4 text-gray-400 hover:text-white transition-colors">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 bg-white rounded-[2rem] border border-gray-200 shadow-sm flex-1 flex flex-col justify-center items-center">
          <Loader className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-gray-400 font-bold mt-3 text-sm italic">Synchronizing billing summary...</p>
        </div>
      ) : (
        /* Highly Legible Spreadsheet Side-By-Side Layout */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden mb-1">
          {/* LEFT PANEL: Rent Invoices Column */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between pb-2 border-b border-gray-150 mb-2 flex-shrink-0">
              <h2 className="text-[13px] font-black uppercase text-gray-900 tracking-wider flex items-center gap-2">
                <Home className="w-4.5 h-4.5 text-emerald-500" />
                Rent Invoices
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md">
                  {selectedRentCount} Selected
                </span>
                <span className="text-xs font-black text-emerald-600">₹{totalRentAmount.toLocaleString()}</span>
              </div>
            </div>

            <div className="overflow-x-auto min-h-0 flex-1">
              <div className="min-w-[480px] h-full max-h-full overflow-y-auto pr-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest text-center w-10">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={allRentSelected && filteredRentBills.length > 0}
                            onChange={toggleAllRent}
                            className="w-3.5 h-3.5 rounded accent-indigo-650 cursor-pointer border-gray-300 focus:ring-indigo-500"
                          />
                        </div>
                      </th>
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest">Tenant</th>
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest text-right">Rent (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150">
                    {filteredRentBills.length === 0 ? (
                      <tr>
                        <td colSpan="3" className="px-6 py-12 text-center text-gray-400 font-bold italic text-xs">
                          {rentBills.length === 0 ? 'No tenants found for this cycle.' : 'No matching tenants found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRentBills.map(bill => (
                        <tr key={bill.tenant_id} className={`hover:bg-gray-50/80 transition-all duration-150 ${bill.has_rent_bill ? 'bg-gray-50/50' : ''}`}>
                          <td className="px-2.5 py-2 text-center align-middle w-10">
                            <div className="flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={bill.include}
                                onChange={() => toggleRentBill(bill.tenant_id)}
                                disabled={bill.has_rent_bill}
                                className="w-3.5 h-3.5 rounded accent-indigo-650 cursor-pointer border-gray-300 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </div>
                          </td>
                          <td className="px-2.5 py-2 align-middle">
                            <div className="flex items-center gap-2.5 whitespace-nowrap">
                              <span className={`text-[13px] font-extrabold ${bill.has_rent_bill ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                {bill.tenant_name}
                              </span>
                              <span className="bg-indigo-50 text-indigo-650 px-2 py-0.5 rounded-lg border border-indigo-100/50 text-[10px] font-black uppercase tracking-wider">{bill.room_number}</span>
                              <span className="text-[9px] font-black text-gray-400 uppercase">{bill.property_type}</span>
                              {bill.has_rent_bill && (
                                <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.2 rounded border border-emerald-100 text-[9px] font-black flex items-center gap-0.5">
                                  <Check size={8} /> Billed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-gray-405">₹</span>
                              <input
                                type="number"
                                value={bill.amount}
                                onChange={(e) => updateRentAmount(bill.tenant_id, e.target.value)}
                                disabled={!bill.include || bill.has_rent_bill}
                                className="w-18 px-2 py-0.5 text-right font-extrabold text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 transition-all"
                              />
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

          {/* RIGHT PANEL: Electricity Invoices Column */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between pb-2 border-b border-gray-150 mb-2 flex-shrink-0">
              <h2 className="text-[13px] font-black uppercase text-gray-900 tracking-wider flex items-center gap-2">
                <Zap className="w-4.5 h-4.5 text-amber-500" />
                Electricity Bills
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-400 tracking-wider bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md">
                  {selectedElecCount} Selected
                </span>
                <span className="text-xs font-black text-amber-600">₹{totalElecAmount.toLocaleString()}</span>
              </div>
            </div>

            <div className="overflow-x-auto min-h-0 flex-1">
              <div className="min-w-[620px] h-full max-h-full overflow-y-auto pr-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest text-center w-10">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={allElecSelected && filteredElecBills.length > 0}
                            onChange={toggleAllElec}
                            className="w-3.5 h-3.5 rounded accent-indigo-650 cursor-pointer border-gray-355 focus:ring-indigo-500"
                          />
                        </div>
                      </th>
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest">Tenant</th>
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest text-right">Reading (Units)</th>
                      <th className="px-2.5 py-2 font-bold text-gray-500 uppercase text-[9px] tracking-widest text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150">
                    {filteredElecBills.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="px-6 py-12 text-center text-gray-400 font-bold italic text-xs">
                          {elecBills.length === 0 ? 'No tenants found for this cycle.' : 'No matching tenants found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredElecBills.map(bill => (
                        <tr key={bill.tenant_id} className={`hover:bg-gray-50/80 transition-all duration-150 ${bill.has_electricity_bill ? 'bg-gray-50/50' : !bill.has_reading ? 'bg-amber-50/10' : ''}`}>
                          <td className="px-2.5 py-2 text-center align-middle w-10">
                            <div className="flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={bill.include && bill.has_reading && !bill.has_electricity_bill}
                                onChange={() => toggleElecBill(bill.tenant_id)}
                                disabled={!bill.has_reading || bill.has_electricity_bill}
                                className="w-3.5 h-3.5 rounded accent-indigo-650 cursor-pointer border-gray-355 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </div>
                          </td>
                          <td className="px-2.5 py-2 align-middle">
                            <div className="flex items-center gap-2.5 whitespace-nowrap">
                              <span className={`text-[13px] font-extrabold ${bill.has_electricity_bill ? 'text-gray-400 line-through' : 'text-gray-955'}`}>
                                {bill.tenant_name}
                              </span>
                              <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-lg border border-amber-100/50 text-[10px] font-black uppercase tracking-wider">{bill.room_number}</span>
                              {bill.has_electricity_bill ? (
                                <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.2 rounded border border-emerald-100 text-[9px] font-black flex items-center gap-0.5">
                                  <Check size={8} /> Billed
                                </span>
                              ) : !bill.has_reading ? (
                                <span className="bg-amber-50 text-amber-600 px-1.5 py-0.2 rounded border border-amber-100 text-[9px] font-black">No Reading</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2.5 py-2 text-right text-xs font-bold text-gray-550 align-middle">
                            <span className="text-gray-900 font-extrabold">{bill.units_consumed} <span className="text-[9px] font-medium text-gray-400">kWh</span></span>
                            <span className="text-[9px] font-bold text-gray-400 ml-1">({bill.previous_reading}→{bill.current_reading})</span>
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-gray-455">₹</span>
                              <input
                                type="number"
                                value={bill.amount}
                                onChange={(e) => updateElecAmount(bill.tenant_id, e.target.value)}
                                disabled={!bill.include || !bill.has_reading || bill.has_electricity_bill}
                                className="w-18 px-2 py-0.5 text-right font-extrabold text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 transition-all"
                              />
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
      )}

      {/* Modern High-End Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden border border-gray-100 flex flex-col">
            <div className="bg-slate-900 text-white p-6 pb-8 text-center relative overflow-hidden flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/40 via-purple-900/20 to-slate-900/40" />
              <button 
                onClick={() => setShowConfirmation(false)} 
                className="absolute right-5 top-5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-full p-2.5 transition-all z-10"
              >
                <X className="w-4 h-4" />
              </button>
              <h2 className="text-2xl font-black tracking-tight relative z-10">Confirm Bill Generation</h2>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1 relative z-10">
                Please review your selected invoice projection
              </p>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1 bg-gray-50/50">
              {/* Billing Period Details */}
              <div className="bg-indigo-50 border border-indigo-100/80 p-4.5 rounded-[1.5rem] flex items-center gap-3">
                <Calendar className="w-5 h-5 text-indigo-650 flex-shrink-0" />
                <div>
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Billing Cycle Period</div>
                  <div className="text-sm font-extrabold text-indigo-950 mt-0.5">
                    {formattedPeriodFrom} <span className="font-semibold text-indigo-400 px-1">to</span> {formattedPeriodTo}
                  </div>
                </div>
              </div>

              {/* Rent Bills summary block */}
              {selectedRentCount > 0 && (
                <div className="bg-white border border-gray-200 p-5 rounded-[1.75rem] shadow-sm">
                  <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Home className="w-4 h-4 text-emerald-500" />
                    Rent Invoices ({selectedRentCount} entries)
                  </h3>
                  <div className="space-y-2 text-xs font-bold text-gray-600 max-h-40 overflow-y-auto pr-1">
                    {rentBills.filter(b => b.include).map(bill => (
                      <div key={bill.tenant_id} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                        <span className="font-medium text-gray-500">{bill.room_number} — <span className="text-gray-800 font-bold">{bill.tenant_name}</span></span>
                        <span className="font-extrabold text-emerald-600">₹{bill.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-150 mt-3 pt-3 flex justify-between items-center text-xs font-extrabold">
                    <span className="uppercase text-gray-400 tracking-wider">Subtotal Rent:</span>
                    <span className="text-emerald-600 text-sm">₹{totalRentAmount.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Electricity bills summary block */}
              {selectedElecCount > 0 && (
                <div className="bg-white border border-gray-200 p-5 rounded-[1.75rem] shadow-sm">
                  <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" />
                    Electricity Invoices ({selectedElecCount} entries)
                  </h3>
                  <div className="space-y-2 text-xs font-bold text-gray-605 max-h-40 overflow-y-auto pr-1">
                    {elecBills.filter(b => b.include).map(bill => (
                      <div key={bill.tenant_id} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                        <span className="font-medium text-gray-555">
                          {bill.room_number} — <span className="text-gray-855 font-bold">{bill.tenant_name}</span> 
                          <span className="text-[10px] font-bold text-gray-450 bg-gray-100 px-1.5 py-0.5 rounded ml-1">({bill.units_consumed} units)</span>
                        </span>
                        <span className="font-extrabold text-amber-600">₹{bill.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-150 mt-3 pt-3 flex justify-between items-center text-xs font-extrabold">
                    <span className="uppercase text-gray-400 tracking-wider">Subtotal Electricity:</span>
                    <span className="text-amber-600 text-sm">₹{totalElecAmount.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Grand summary banner */}
              <div className="bg-slate-900 text-white p-5 rounded-[1.75rem] shadow-lg flex justify-between items-center flex-shrink-0">
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Grand Total Billing</div>
                  <div className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mt-0.5">Projected revenue balance</div>
                </div>
                <div className="text-2xl font-black text-white">₹{(totalRentAmount + totalElecAmount).toLocaleString()}</div>
              </div>
            </div>

            {/* Confirmation actions row */}
            <div className="bg-gray-100 border-t border-gray-200 p-6 flex gap-4 justify-end flex-shrink-0">
              <button
                onClick={() => setShowConfirmation(false)}
                disabled={submitting}
                className="px-6 py-3 border border-gray-200 text-gray-500 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-gray-200 disabled:opacity-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGenerate}
                disabled={submitting}
                className="px-6 py-3 bg-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-indigo-150 transition-all"
              >
                {submitting && <Loader className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? 'Generating...' : <><ArrowRight className="w-3.5 h-3.5" /> Confirm & Generate</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
