/**
 * Home Assistant Integration Service
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  NC (NORMALLY CLOSED) RELAY WIRING — DO NOT CHANGE THIS LOGIC  ║
 * ║                                                                    ║
 * ║  This property uses NC (Normally Closed) relay wiring.             ║
 * ║  Relay ON  = Power CUT   (tenant has NO electricity)               ║
 * ║  Relay OFF = Power FLOWING (tenant HAS electricity)                ║
 * ║                                                                    ║
 * ║  This is NOT a bug. This is how the hardware is physically wired   ║
 * ║  and it will stay this way.                                        ║
 * ║                                                                    ║
 * ║  — Devin Kakadia (Property Owner), 22 May 2026                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * HOW IT WORKS:
 * In Home Assistant, the switch entity controls the relay coil state.
 * Under NC wiring, energizing the relay coil (HA switch ON) OPENS the
 * circuit and CUTS tenant electricity. De-energizing the relay coil
 * (HA switch OFF) CLOSES the circuit and RESTORES tenant electricity.
 *
 * APPLICATION-LEVEL MAPPING (what the rest of the codebase sees):
 *   - homeAssistant.turnOn(propertyId)  → RESTORES tenant power
 *     (internally calls HA '/api/services/switch/turn_off' to de-energize relay)
 *   - homeAssistant.turnOff(propertyId) → CUTS tenant power
 *     (internally calls HA '/api/services/switch/turn_on' to energize relay)
 *
 * STATE MAPPING:
 *   - HA switch state 'off' → relay de-energized → circuit closed → tenant power ON
 *   - HA switch state 'on'  → relay energized   → circuit open   → tenant power OFF
 *
 * DO NOT REVERSE THIS LOGIC. If you see turnOn() calling switch/turn_off,
 * that is CORRECT for NC wiring. A previous AI tool already broke this
 * once by "fixing" what it thought was a bug. It was not a bug.
 */

const axios = require('axios');
const pool = require('./database');

class HomeAssistantService {
  constructor() {
    this.baseURL = process.env.HA_SERVER_URL;
    this.token = process.env.HA_API_TOKEN;
    this.timeout = parseInt(process.env.HA_REQUEST_TIMEOUT || '5000', 10);
    // Ensure timeout is a valid number, default to 5000 if NaN
    if (isNaN(this.timeout)) {
      this.timeout = 5000;
    }
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      defaultHeaders.Authorization = `Bearer ${this.token}`;
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: defaultHeaders,
    });
  }

  // Small helper to wait between retries
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _isConfigured() {
    return Boolean(this.baseURL && this.token);
  }

  _formatError(method, error) {
    const message = error?.response?.data?.error || error?.message || 'Unknown Home Assistant error';
    console.error(`[HomeAssistant][${method}]`, message);
    return message;
  }

  /**
   * Get relay entity ID for a property from DB
   */
  async getRelayEntity(propertyId) {
    try {
      const result = await pool.query(
        'SELECT ha_entity_id FROM properties WHERE id = $1',
        [propertyId]
      );
      return result.rows[0]?.ha_entity_id;
    } catch (error) {
      console.error(`Error fetching entity_id for property ${propertyId}:`, error);
      return null;
    }
  }

  async _ensureConfigured(method) {
    if (!this._isConfigured()) {
      const missing = [];
      if (!this.baseURL) missing.push('HA_SERVER_URL');
      if (!this.token) missing.push('HA_API_TOKEN');
      const message = `Home Assistant not configured: missing ${missing.join(', ')}`;
      console.warn(`[HomeAssistant][${method}] ${message}`);
      return { success: false, error: message };
    }
    return null;
  }

  /**
   * Turn ON a relay (Restore Power)
   */
  async turnOn(propertyId) {
    const configError = await this._ensureConfigured('turnOn');
    if (configError) return configError;

    try {
      const entityId = await this.getRelayEntity(propertyId);
      if (!entityId) {
        return { success: false, error: `No relay configured for property ${propertyId}` };
      }

      // Read previous state so we can verify a state change
      let prevState = null;
      try {
        const prev = await this.client.get(`/api/states/${entityId}`);
        prevState = prev.data && prev.data.state;
      } catch (e) {
        // ignore — we'll try to confirm after the action
      }

      // CORRECT: To restore tenant power under NC wiring, the relay must be OFF.
      // That means the Home Assistant switch MUST be turned OFF.
      // NC WIRING: switch 'off' = relay de-energized = circuit closed = power FLOWING
      const desiredState = 'off';

      // If already in desired state, return success immediately
      if (prevState === desiredState) {
        console.log(`[HomeAssistant][turnOn] ${entityId} already in desired state '${desiredState}' — power already restored`);
        return { success: true, data: { serviceResponse: null, prevState, state: prevState, alreadyInState: true } };
      }

      const response = await this.client.post('/api/services/switch/turn_off', { entity_id: entityId });

      // Poll the entity state a few times to ensure Home Assistant applied the change
      const maxAttempts = 5;
      const delayMs = 700;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const st = await this.client.get(`/api/states/${entityId}`);
          const newState = st.data && st.data.state;
          // Accept success if state changed OR if state is now the desired state
          if (newState === desiredState || (prevState === null) || (newState !== prevState)) {
            return { success: true, data: { serviceResponse: response.data, prevState, state: newState } };
          }
        } catch (e) {
          // ignore and retry
        }
        await this._sleep(delayMs);
      }

      return { success: false, error: `Home Assistant did not change state for ${entityId} after turn_on` };
    } catch (error) {
      return { success: false, error: this._formatError('turnOn', error) };
    }
  }

  /**
   * Turn OFF a relay (Cut Power)
   */
  async turnOff(propertyId) {
    const configError = await this._ensureConfigured('turnOff');
    if (configError) return configError;

    try {
      const entityId = await this.getRelayEntity(propertyId);
      if (!entityId) {
        return { success: false, error: `No relay configured for property ${propertyId}` };
      }

      // Read previous state so we can verify a state change
      let prevState = null;
      try {
        const prev = await this.client.get(`/api/states/${entityId}`);
        prevState = prev.data && prev.data.state;
      } catch (e) {
        // ignore — we'll try to confirm after the action
      }

      // CORRECT: To cut tenant power under NC wiring, the relay must be ON.
      // That means the Home Assistant switch MUST be turned ON.
      // NC WIRING: switch 'on' = relay energized = circuit open = power CUT
      const desiredState = 'on';

      // If already in desired state, return success immediately
      if (prevState === desiredState) {
        console.log(`[HomeAssistant][turnOff] ${entityId} already in desired state '${desiredState}' — power already cut`);
        return { success: true, data: { serviceResponse: null, prevState, state: prevState, alreadyInState: true } };
      }

      const response = await this.client.post('/api/services/switch/turn_on', { entity_id: entityId });

      // Poll the entity state a few times to ensure Home Assistant applied the change
      const maxAttempts = 5;
      const delayMs = 700;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const st = await this.client.get(`/api/states/${entityId}`);
          const newState = st.data && st.data.state;
          // Accept success if state changed OR if state is now the desired state
          if (newState === desiredState || (prevState === null) || (newState !== prevState)) {
            return { success: true, data: { serviceResponse: response.data, prevState, state: newState } };
          }
        } catch (e) {
          // ignore and retry
        }
        await this._sleep(delayMs);
      }

      return { success: false, error: `Home Assistant did not change state for ${entityId} after turn_off` };
    } catch (error) {
      return { success: false, error: this._formatError('turnOff', error) };
    }
  }

  /**
   * Get current state of a relay
   */
  async getState(propertyId) {
    const configError = await this._ensureConfigured('getState');
    if (configError) return configError;

    try {
      const entityId = await this.getRelayEntity(propertyId);
      if (!entityId) {
        return { success: false, error: `No relay configured for property ${propertyId}` };
      }

      const response = await this.client.get(`/api/states/${entityId}`);
      // Map Home Assistant relay state to tenant power state for NC wiring.
      // HA switch state 'off' means relay is de-energized and electricity is flowing.
      const powerState = response.data.state === 'off' ? 'on' : 'off';
      return { success: true, state: powerState };
    } catch (error) {
      return { success: false, error: this._formatError('getState', error) };
    }
  }

  /**
   * Sync all relay states
   */
  async syncAllStates() {
    const configError = await this._ensureConfigured('syncAllStates');
    if (configError) return configError;

    try {
      const propertiesResult = await pool.query(
        'SELECT id, ha_entity_id FROM properties WHERE ha_entity_id IS NOT NULL'
      );
      const states = {};

      if (propertiesResult.rows.length === 0) {
        return { success: true, data: {} };
      }

      const response = await this.client.get('/api/states');
      const stateMap = new Map(
        response.data
          .filter(entity => entity.entity_id && entity.state)
          .map(entity => [entity.entity_id, entity.state])
      );

      for (const row of propertiesResult.rows) {
        const propertyId = row.id;
        const entityId = row.ha_entity_id;
        const entityState = stateMap.get(entityId);

        if (!entityState) {
          console.warn(`Home Assistant state missing for ${entityId}`);
          continue;
        }

        // Map entity state to tenant power state and numeric power_status for NC wiring.
        // HA switch state 'off' means the relay is de-energized and tenant power is ON.
        const powerState = entityState === 'off' ? 'on' : 'off';
        states[propertyId] = powerState;

        const powerStatus = entityState === 'off' ? 1 : 0;
        await pool.query(
          'UPDATE properties SET power_status = $1 WHERE id = $2',
          [powerStatus, propertyId]
        );
      }

      return { success: true, data: states };
    } catch (error) {
      console.error('Error syncing Home Assistant states:', this._formatError('syncAllStates', error));
      return { success: false, error: this._formatError('syncAllStates', error) };
    }
  }

  /**
   * Fetch all switch entities from Home Assistant
   */
  async getAvailableSwitches() {
    const configError = await this._ensureConfigured('getAvailableSwitches');
    if (configError) return configError;

    try {
      const response = await this.client.get('/api/states');

      // Filter for switch domain
      const switches = response.data
        .filter(entity => entity.entity_id.startsWith('switch.'))
        .map(entity => ({
          entity_id: entity.entity_id,
          friendly_name: entity.attributes.friendly_name || entity.entity_id,
          state: entity.state
        }));

      return { success: true, data: switches };
    } catch (error) {
      const message = this._formatError('getAvailableSwitches', error);
      return { success: false, error: message };
    }
  }
}

module.exports = new HomeAssistantService();
