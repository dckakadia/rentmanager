import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,  // Send auth cookie on every request
});

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginUser = (username, password) =>
  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  }).then(r => r.json());

export const logoutUser = () =>
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).then(r => r.json());

export const getMe = () =>
  fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());



// Simple sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Health check: returns true if backend /api/health responds 200
async function healthCheck(timeout = 3000) {
  try {
    const source = axios.CancelToken.source();
    const timer = setTimeout(() => source.cancel('healthcheck-timeout'), timeout);
    const res = await api.get('/health', { cancelToken: source.token });
    clearTimeout(timer);
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

// Robust request wrapper: retries transient errors with exponential backoff
const request = async (method, url, options = {}) => {
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      // Normalize options: support either passing data directly or { data, params }
      const params = options && options.params ? options.params : undefined;
      const data = options && options.data !== undefined ? options.data : (method === 'get' || method === 'delete' ? undefined : options);

      let response;
      if (method === 'get' || method === 'delete') {
        response = await api[method](url, { params });
      } else {
        response = await api[method](url, data, { params });
      }
      return response;
    } catch (error) {
      const status = error?.response?.status;
      // For server errors, network errors, or rate limits/temporary issues, retry a few times
      if (!status || status >= 500 || status === 503) {
        const wait = 500 * attempt;
        console.warn(`API Error (${method.toUpperCase()} ${url}) - attempt ${attempt}:`, error.message || status);
        if (attempt < maxAttempts) {
          await sleep(wait);
          continue;
        }
      }

      // Non-retryable or exhausted attempts
      console.error(`API Error (${method.toUpperCase()} ${url}):`, error);
      throw error;
    }
  }

  throw new Error('API unreachable after multiple attempts');
};

// Dashboard
export const getDashboard = () => request('get', '/dashboard');
export const getPendingRent = () => request('get', '/dashboard/pending-rent');
export const getVacantProperties = () => request('get', '/dashboard/vacant');
export const getCollectionStats = () => request('get', '/dashboard/stats/collections');
export const getMonthlyReport = (month_year) => request('get', '/dashboard/monthly-report', { params: { month_year } });
export const getElectricityReport = (month_year) => request('get', '/dashboard/electricity-report', { params: { month_year } });

// Properties
export const getProperties = () => request('get', '/properties');
export const getProperty = (id) => request('get', `/properties/${id}`);
export const getPropertyDetail = (id) => request('get', `/properties/${id}`);
export const createProperty = (data) => request('post', '/properties', data);
export const updateProperty = (id, data) => request('patch', `/properties/${id}`, data);
export const deleteProperty = (id) => request('delete', `/properties/${id}`);
export const linkRelay = (id, ha_entity_id) => request('patch', `/properties/${id}/link-relay`, { data: { ha_entity_id } });
export const unlinkRelay = (id) => request('patch', `/properties/${id}/unlink-relay`);
export const getAvailableRelays = () => request('get', '/properties/relays/available');

// Tenants
export const getTenants = () => request('get', '/tenants');
export const createTenant = (data) => request('post', '/tenants', data);
export const updateTenant = (id, data) => request('patch', `/tenants/${id}`, data);
export const deleteTenant = (id) => request('delete', `/tenants/${id}`);
export const inactivateTenant = (id) => request('patch', `/tenants/${id}/inactivate`);
export const getTenantLedger = (id) => request('get', `/tenants/${id}/ledger`);

// Transactions
export const getTransactions = (params) => request('get', '/transactions', { params });
export const createTransaction = (data) => request('post', '/transactions', data);
export const updateTransaction = (id, data) => request('patch', `/transactions/${id}`, data);
export const deleteTransaction = (id) => request('delete', `/transactions/${id}`);

// Payments
export const getPayments = (params) => request('get', '/payments', { params });
export const recordPayment = (data) => request('post', '/payments', data);
export const correctPayment = (id, data) => request('patch', `/payments/${id}`, data);
export const getPaymentHistory = (property_id) => request('get', `/payments/history/${property_id}`);

// Utilities & Power Control
export const getLatestMeterReading = (property_id) => request('get', `/meter-readings/latest/${property_id}`);
export const getMeterReadings = (property_id) => request('get', `/meter-readings/${property_id}`);
export const recordMeterReading = (data) => request('post', '/meter-readings', data);
export const updateMeterReading = (id, data) => request('put', `/meter-readings/${id}`, data);
export const deleteMeterReading = (id) => request('delete', `/meter-readings/${id}`);
export const getAllLatestReadings = () => request('get', '/meter-readings/all/latest');

export const getPowerStatus = () => request('get', '/power-control');
export const getPowerLogs = (property_id) => request('get', `/power-control/logs/${property_id}`);
export const togglePower = (id, action) => request('post', `/power-control/${id}/${action.toLowerCase()}`);
export const turnPowerOn = (id, reason, meta = {}) => request('post', `/power-control/${id}/on`, { reason, ...meta });
export const turnPowerOff = (id, reason, meta = {}) => request('post', `/power-control/${id}/off`, { reason, ...meta });
export const testRelay = (id) => request('post', `/power-control/${id}/test`);
export const triggerOverdueCutoff = () => request('post', '/power-control/trigger-cutoff');
export const getOverdueCutoffCandidates = () => request('get', '/power-control/overdue-candidates');
export const getRetryLogs = (property_id) => request('get', `/power-control/retries/${property_id}`);

// Data Portability
export const exportData = () => request('get', '/data/export');
export const importData = (data) => request('post', '/data/import', data);

// Settings
export const getSettings = () => request('get', '/settings');
export const updateSettings = (data) => request('patch', '/settings', data);

// Bill Generation
export const getBillingSummary = (period_from, period_to, month_year) => 
  request('get', '/bills/billing-summary', { params: { period_from, period_to, month_year } }).then(res => res.data);
export const checkDuplicateBills = (data) => 
  request('post', '/bills/check-duplicate', data).then(res => res.data);
export const generateBills = (data) => 
  request('post', '/bills/generate', data).then(res => res.data);

export default api;
