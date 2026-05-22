/**
 * Improved Electricity Bill Calculation with Validation & Flexibility
 * 
 * NEW FEATURES:
 * - Better fallback strategy (closest-to-10th instead of latest)
 * - Consumption validation (negative, zero, anomaly checks)
 * - Reading source tracking (audit trail for audits)
 * - Configurable rates instead of hardcoded ₹9/unit
 * 
 * USAGE:
 * - Replace existing calculateElectricityBill() with improvedCalculateElectricityBill()
 * - Use validateConsumption() before accepting meter readings
 */

const pool = require('../config/database');

/**
 * IMPROVED: Calculate electricity bill for a given month
 * Uses lenient fallback strategy (closest-to-10th instead of latest)
 * 
 * Returns: { consumption, rate, bill, source, warning }
 * 
 * LOGIC:
 * 1. Try exact 10th of month (PREFERRED)
 * 2. Try closest date to 10th (±3 days, i.e., 7th-13th)
 * 3. Try anywhere in month (FALLBACK)
 * 4. No reading found: ₹0 bill + warning
 */
async function improvedCalculateElectricityBill(propertyId, monthYear) {
  try {
    const [year, month] = monthYear.split('-').map(Number);
    const dayStr = '10';
    const targetReadingDate = `${year}-${String(month).padStart(2, '0')}-${dayStr}`;
    
    // Get electricity rate from settings (instead of hardcoded ₹9)
    const settingsResult = await pool.query(
      'SELECT electricity_rate FROM settings LIMIT 1'
    );
    const rate = settingsResult.rows[0]?.electricity_rate || 9;

    // STRATEGY 1: Try exact 10th (PREFERRED)
    let result = await pool.query(
      `SELECT id, reading_date, units_consumed 
       FROM meter_readings 
       WHERE property_id = $1 AND reading_date = $2`,
      [propertyId, targetReadingDate]
    );

    if (result.rows.length > 0 && result.rows[0].units_consumed !== null) {
      const consumption = result.rows[0].units_consumed;
      
      // Validate consumption before accepting
      const validation = validateConsumption(consumption, propertyId, 'exact_10th');
      
      return {
        consumption,
        rate,
        bill: consumption * rate,
        source: 'exact_10th',
        reading_date: result.rows[0].reading_date,
        reading_id: result.rows[0].id,
        errors: validation.errors,
        warnings: validation.warnings
      };
    }

    // STRATEGY 2: Try closest to 10th (±3 days = 7th to 13th)
    const startDay = Math.max(1, 10 - 3);
    const endDay = Math.min(31, 10 + 3);
    
    result = await pool.query(
      `SELECT id, reading_date, units_consumed,
              ABS(strftime('%d', reading_date) - 10) as day_diff
       FROM meter_readings 
       WHERE property_id = $1 
       AND strftime('%Y-%m', reading_date) = $2
       AND strftime('%d', reading_date) BETWEEN $3 AND $4
       ORDER BY day_diff ASC, reading_date DESC
       LIMIT 1`,
      [propertyId, monthYear, String(startDay).padStart(2, '0'), String(endDay).padStart(2, '0')]
    );

    if (result.rows.length > 0 && result.rows[0].units_consumed !== null) {
      const consumption = result.rows[0].units_consumed;
      const dayDiff = result.rows[0].day_diff;
      
      // Validate consumption
      const validation = validateConsumption(consumption, propertyId, 'closest_to_10th');
      
      return {
        consumption,
        rate,
        bill: consumption * rate,
        source: `closest_to_10th_offset_${dayDiff}_days`,
        reading_date: result.rows[0].reading_date,
        reading_id: result.rows[0].id,
        errors: validation.errors,
        warnings: [
          ...validation.warnings,
          `Reading taken on ${dayDiff} day(s) offset from preferred 10th`
        ]
      };
    }

    // STRATEGY 3: Try anywhere in month (FALLBACK)
    result = await pool.query(
      `SELECT id, reading_date, units_consumed
       FROM meter_readings 
       WHERE property_id = $1 
       AND strftime('%Y-%m', reading_date) = $2
       ORDER BY reading_date DESC
       LIMIT 1`,
      [propertyId, monthYear]
    );

    if (result.rows.length > 0 && result.rows[0].units_consumed !== null) {
      const consumption = result.rows[0].units_consumed;
      
      // Validate consumption
      const validation = validateConsumption(consumption, propertyId, 'fallback_any');
      
      return {
        consumption,
        rate,
        bill: consumption * rate,
        source: 'fallback_latest_in_month',
        reading_date: result.rows[0].reading_date,
        reading_id: result.rows[0].id,
        errors: validation.errors,
        warnings: [
          ...validation.warnings,
          `FALLBACK: No reading near 10th. Using latest available (${result.rows[0].reading_date})`
        ]
      };
    }

    // NO READING FOUND
    return {
      consumption: 0,
      rate,
      bill: 0,
      source: 'no_reading',
      reading_date: null,
      reading_id: null,
      errors: [`No meter reading found for ${monthYear}`],
      warnings: ['Manual entry required or ₹0 bill will be applied']
    };

  } catch (error) {
    console.error(`[Billing] Error calculating electricity for property ${propertyId}:`, error);
    return {
      consumption: null,
      rate: 0,
      bill: 0,
      source: 'error',
      reading_date: null,
      reading_id: null,
      errors: [error.message],
      warnings: ['Bill calculation failed']
    };
  }
}

/**
 * VALIDATE: Check if consumption value is reasonable
 * 
 * Returns: { isValid, errors, warnings, consumption }
 * 
 * CHECKS:
 * 1. Negative consumption (meter went backwards)
 * 2. Zero consumption (meter malfunction?)
 * 3. Anomalously high consumption
 * 4. Anomalously low consumption
 */
function validateConsumption(consumption, propertyId, source = 'unknown') {
  const errors = [];
  const warnings = [];

  if (consumption === null || consumption === undefined) {
    errors.push('Consumption is null/undefined');
    return { isValid: false, errors, warnings, consumption: 0 };
  }

  // Ensure numeric
  const value = parseFloat(consumption);
  if (isNaN(value)) {
    errors.push(`Consumption is not a valid number: ${consumption}`);
    return { isValid: false, errors, warnings, consumption: 0 };
  }

  // Rule 1: Negative consumption is impossible
  if (value < 0) {
    errors.push(
      `CRITICAL: Negative consumption (${value} units). ` +
      `Current meter reading must be >= previous reading. ` +
      `Possible causes: meter reset, entry error, or meter replacement.`
    );
    return { isValid: false, errors, warnings, consumption: value };
  }

  // Rule 2: Zero consumption is suspicious
  if (value === 0) {
    warnings.push(
      `Zero consumption recorded. ` +
      `Possible causes: meter malfunction, no occupancy, or meter off.`
    );
  }

  // Rule 3: Very low consumption (< 1 unit)
  if (value > 0 && value < 1) {
    warnings.push(
      `Very low consumption (${value} units). ` +
      `Verify meter reading accuracy.`
    );
  }

  // Rule 4: Very high consumption - check against property type
  // (This is a heuristic; adjust based on actual usage patterns)
  const dailyAvg = value / 30;
  
  // Property type check (from schema context if available)
  // For now, use conservative estimates:
  // - Shop: max 150 units/day (typical: 30-80)
  // - Room: max 50 units/day (typical: 5-20)
  
  if (dailyAvg > 150) {
    warnings.push(
      `VERY HIGH consumption (${dailyAvg.toFixed(1)} units/day, ${value} total). ` +
      `This is unusually high. Verify meter reading for accuracy or meter malfunction.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    consumption: value
  };
}

/**
 * Get meter reading history for debugging/audits
 * Shows all readings for a property with source tracking
 */
async function getMeterReadingHistory(propertyId, monthYear) {
  try {
    const [year, month] = monthYear.split('-').map(Number);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    
    // Get last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const result = await pool.query(
      `SELECT 
        id, reading_date, previous_reading, current_reading, units_consumed,
        ABS(strftime('%d', reading_date) - 10) as day_offset_from_10th,
        CASE 
          WHEN strftime('%d', reading_date) = '10' THEN 'exact_10th'
          WHEN ABS(strftime('%d', reading_date) - 10) <= 3 THEN 'near_10th'
          ELSE 'other'
        END as reading_type
       FROM meter_readings 
       WHERE property_id = $1 
       AND reading_date BETWEEN $2 AND $3
       ORDER BY reading_date DESC`,
      [propertyId, monthStart, monthEnd]
    );

    return {
      property_id: propertyId,
      month: monthYear,
      readings_found: result.rows.length,
      history: result.rows,
      summary: {
        exact_10th: result.rows.filter(r => r.reading_type === 'exact_10th').length,
        near_10th: result.rows.filter(r => r.reading_type === 'near_10th').length,
        other: result.rows.filter(r => r.reading_type === 'other').length
      }
    };
  } catch (error) {
    console.error(`Error fetching meter reading history:`, error);
    return { error: error.message };
  }
}

module.exports = {
  improvedCalculateElectricityBill,
  validateConsumption,
  getMeterReadingHistory
};
