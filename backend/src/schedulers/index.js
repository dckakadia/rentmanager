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
 * Scheduler 2: Dynamic Power Cutoff (Runs every minute to check exact time match)
 */
function powerCutoffScheduler() {
  // Cron: * * * * * (Every minute)
  const job = cron.schedule('* * * * *', async () => {
    try {
      // 1. Get settings
      const settingsRes = await pool.query('SELECT * FROM settings WHERE id = 1');
      const settings = settingsRes.rows[0];

      if (!settings || !settings.cutoff_date || !settings.cutoff_time) {
        return; // Cutoff point not set
      }

      // Use IST-aware time
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      
      const currentDay = String(nowIST.getDate()).padStart(2, '0');
      const currentMonth = String(nowIST.getMonth() + 1).padStart(2, '0');
      const currentYear = nowIST.getFullYear();
      const currentDateStr = `${currentYear}-${currentMonth}-${currentDay}`;
      
      const currentHour = String(nowIST.getHours()).padStart(2, '0');
      const currentMinute = String(nowIST.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHour}:${currentMinute}`;

      if (settings.cutoff_date !== currentDateStr || settings.cutoff_time !== currentTimeStr) {
        return; // Only trigger on the exact minute
      }

      console.log(`[Scheduler] Global cutoff time reached (${currentDateStr} ${currentTimeStr}). Running cutoff sweep...`);

      const { getOverdueCutoffCandidates } = require('../controllers/powerControl');
      const candidates = await getOverdueCutoffCandidates(settings, false);

      if (candidates.length === 0) {
        console.log('[Scheduler] No overdue candidates found at cutoff time.');
        return;
      }

      for (const row of candidates) {
        try {
          const haResult = await homeAssistant.turnOff(row.property_id);
          if (haResult.success) {
            await pool.query(
              `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
               VALUES ($1, 'OFF', 'AUTO', $2, 'success')`,
              [row.property_id, `Global Cutoff Time Hit (${currentTimeStr}): Unpaid balance ₹${row.pending_amount}`]
            );

            if (settings.cutoff_notify_whatsapp) {
              const messageContent = `Your electricity for Room ${row.room_number} has been cut off as payment was not received before the scheduled cutoff time. Please pay to restore power.`;
              await whatsappService.sendMessage(row.phone, messageContent);
            }
          }
        } catch (rowError) {
           console.error(`[Scheduler Error] Failed to process cutoff for property ${row.property_id}:`, rowError);
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
