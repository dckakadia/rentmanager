const cron = require('node-cron');
const pool = require('../config/database');
const homeAssistant = require('../config/homeAssistant');
const whatsappService = require('../services/whatsappService');
const billingService = require('../services/billingService');

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  NC (NORMALLY CLOSED) RELAY WIRING — DO NOT CHANGE THIS LOGIC  ║
 * ║                                                                    ║
 * ║  Relay ON  = Power CUT   (tenant has NO electricity)               ║
 * ║  Relay OFF = Power FLOWING (tenant HAS electricity)                ║
 * ║                                                                    ║
 * ║  homeAssistant.turnOff() = CUT power   (correct for cutoff)        ║
 * ║  homeAssistant.turnOn()  = RESTORE power (correct for restoration) ║
 * ║                                                                    ║
 * ║  This is NOT a bug. Do not reverse the logic.                      ║
 * ║  — Devin Kakadia (Property Owner), 22 May 2026                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

let scheduledJobs = [];

/**
 * Scheduler 1: Rent Due Reminders (Runs on 13th, 14th, 15th of the month)
 */
function rentReminderScheduler() {
  // Cron: 0 10 12,13,14 * * (10:00 AM on 12, 13, 14)
  const job = cron.schedule('0 10 12,13,14 * *', async () => {
    console.log('[Scheduler] Running payment reminders...');
    try {
      // We are reminding about the PREVIOUS month's bill (which was finalized on the 10th of this month)
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const prevMonthYear = `${year}-${month}`;

      const result = await pool.query(`
        SELECT 
          p.id, p.room_number, t.name, t.phone, rp.total_due, rp.amount_paid
        FROM properties p
        JOIN tenants t ON p.id = t.property_id
        JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
        WHERE p.is_occupied = 1 
          AND rp.payment_status IN ('pending', 'partial')
      `, [prevMonthYear]);

      for (const row of result.rows) {
        const pending = row.total_due - (row.amount_paid || 0);
        const messageContent = `Reminder: Hi ${row.name}, your bill for ${prevMonthYear} (Rent + Electricity) is ₹${pending}. Please clear it by the 14th to avoid automatic power disconnection on the 15th.`;
        
        await whatsappService.sendMessage(row.phone, messageContent);
        await pool.query(
          `INSERT INTO whatsapp_reminders (property_id, reminder_type, status, message_content)
           VALUES ($1, $2, $3, $4)`,
          [row.id, 'rent_due', 'sent', messageContent]
        );
      }
    } catch (error) {
      console.error('[Scheduler Error] Reminder check failed:', error);
    }
  }, { timezone: 'Asia/Kolkata' });

  return job;
}

/**
 * Scheduler 2: Dynamic Power Cutoff (Runs every hour to check conditions)
 */
function powerCutoffScheduler() {
  // Cron: 0 * * * * (Every hour at minute 0)
  const job = cron.schedule('0 * * * *', async () => {
    try {
      // 1. Get settings
      const settingsRes = await pool.query('SELECT * FROM settings WHERE id = 1');
      const settings = settingsRes.rows[0];

      if (!settings || !settings.auto_cutoff_enabled) {
        return; // Auto-cutoff is disabled
      }

      // Use IST-aware time (server may be UTC — cron fires correctly via timezone option,
      // but new Date() needs explicit locale parsing to match IST hour)
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentHour = nowIST.getHours();
      if (currentHour !== settings.cutoff_hour) {
        return; // Not the right hour to trigger cutoff
      }

      console.log(`[Scheduler] Running fixed-date power cutoff check (Target Day: ${settings.cutoff_grace_days}, Target Hour: ${settings.cutoff_hour})...`);

      // 2. Identify tenants who are past the fixed cutoff date (use IST date)
      const d = nowIST;
      const currentDay = d.getDate();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const monthYear = `${year}-${month}`;

      const result = await pool.query(`
        SELECT
          p.id,
          p.room_number,
          t.name,
          t.phone,
          MIN(rp.month_year) AS oldest_month_year,
          GROUP_CONCAT(rp.month_year, ', ') AS month_years,
          SUM(rp.total_due - COALESCE(rp.amount_paid, 0)) AS pending_amount
        FROM properties p
        JOIN tenants t ON p.id = t.property_id
        JOIN rent_payments rp ON p.id = rp.property_id
        WHERE p.is_occupied = 1
          AND t.skip_auto_cutoff = 0
          AND rp.payment_status IN ('pending', 'partial')
          AND (
            rp.month_year < $1
            OR 
            (rp.month_year = $1 AND $2 > (t.committed_payment_date + $3))
          )
        GROUP BY p.id, p.room_number, t.name, t.phone
        HAVING SUM(rp.total_due - COALESCE(rp.amount_paid, 0)) > 0
      `, [monthYear, currentDay, settings.cutoff_grace_days]);

      for (const row of result.rows) {
        try {
          const haResult = await homeAssistant.turnOff(row.id);
          if (haResult.success) {
            await pool.query(
              `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
               VALUES ($1, 'OFF', 'AUTO', $2, 'success')`,
              [row.id, `Unpaid bill past grace period (${settings.cutoff_grace_days} days)`]
            );

            if (settings.cutoff_notify_whatsapp) {
              const messageContent = `Your electricity for Room ${row.room_number} has been cut off as payment was not received within the ${settings.cutoff_grace_days}-day grace period. Please pay to restore power.`;
              await whatsappService.sendMessage(row.phone, messageContent);
            }
          }
        } catch (rowError) {
          console.error(`[Scheduler Error] Failed to process cutoff for property ${row.id}:`, rowError);
        }
      }
    } catch (error) {
      console.error('[Scheduler Error] Power cutoff failed:', error);
    }
  }, { timezone: 'Asia/Kolkata' });

  return job;
}

/**
 * Scheduler 3: Pending Bills Report (Runs on the 16th at 10:00 AM IST)
 */
function pendingReportScheduler() {
  // Cron: 0 10 16 * * (10:00 AM on the 16th)
  const job = cron.schedule('0 10 16 * *', async () => {
    console.log('[Scheduler] Generating pending bills report...');
    try {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const prevMonthYear = `${year}-${month}`;

      const result = await pool.query(`
        SELECT p.room_number, t.name, (rp.total_due - rp.amount_paid) as pending
        FROM properties p
        JOIN tenants t ON p.id = t.property_id
        JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
        WHERE rp.payment_status IN ('pending', 'partial')
      `, [prevMonthYear]);

      if (result.rows.length > 0) {
        let report = `Pending Bills Report (${prevMonthYear}):\n`;
        result.rows.forEach(r => {
          report += `- ${r.room_number} (${r.name}): ₹${r.pending}\n`;
        });
        console.log('--- PENDING REPORT ---');
        console.log(report);
        // In a real setup, we could WhatsApp this to the admin phone
      }
    } catch (error) {
      console.error('[Scheduler Error] Report generation failed:', error);
    }
  }, { timezone: 'Asia/Kolkata' });

  return job;
}

/**
 * Scheduler 4: Home Assistant Sync (Every 6 hours)
 */
function homeAssistantSyncScheduler() {
  const job = cron.schedule('0 */6 * * *', async () => {
    try {
      await homeAssistant.syncAllStates();
    } catch (error) {
      console.error('[Scheduler Error] HA sync failed:', error);
    }
  });

  return job;
}

/**
 * Scheduler 5: Automated Billing (Runs on the 11th at 8:00 AM IST)
 * Finalizes the previous month's bill after the 10th-to-10th electricity reading
 */
function monthlyBillingScheduler() {
  // Cron: 0 8 11 * * (8:00 AM on the 11th)
  const job = cron.schedule('0 8 11 * *', async () => {
    console.log('[Scheduler] Running automated monthly billing...');
    try {
      const prevMonthYear = billingService.getPreviousMonthYear();
      await billingService.generateAllBills(prevMonthYear);
      console.log(`[Scheduler] Bills generated for ${prevMonthYear}`);
    } catch (error) {
      console.error('[Scheduler Error] Automated billing failed:', error);
    }
  }, { timezone: 'Asia/Kolkata' });

  return job;
}

/**
 * Start all schedulers
 */
function startSchedulers() {
  console.log('\n========================================');
  console.log('Starting Automated Schedulers');
  console.log('========================================\n');

  scheduledJobs.push(rentReminderScheduler());
  console.log('✓ Reminders: 12th-14th @ 10 AM');

  // DISABLED: monthlyBillingScheduler
  // Billing is now manual via Bill Generation page
  // scheduledJobs.push(monthlyBillingScheduler());
  // console.log('✓ Billing: 11th @ 8 AM (Finalizes previous month)');

  scheduledJobs.push(powerCutoffScheduler());
  console.log('✓ Power Cutoff: Active (Dynamic based on settings)');

  scheduledJobs.push(pendingReportScheduler());
  console.log('✓ Pending Report: 16th @ 10 AM');

  scheduledJobs.push(homeAssistantSyncScheduler());
  console.log('✓ Home Assistant sync: Every 6 hours');

  console.log('\n========================================\n');
}

/**
 * Stop all schedulers
 */
function stopSchedulers() {
  scheduledJobs.forEach(job => job.stop());
}

module.exports = {
  startSchedulers,
  stopSchedulers,
  autoPowerRestoration: async (propertyId) => {
    // Restoration logic remains same: turn ON when payment received
    await homeAssistant.turnOn(propertyId);
  }
};
