const { chromium } = require('playwright');
require('dotenv').config();

class WhatsAppService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
  }

  /**
   * Initialize WhatsApp Web browser
   */
  async initialize() {
    try {
      console.log('[WhatsApp] Initializing browser...');
      
      this.browser = await chromium.launch({
        headless: false, // Set to false so user can scan QR code
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],
      });

      this.page = await this.browser.newPage();
      await this.page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

      // Wait for QR code scan (give user 2 minutes)
      const timeout = process.env.WHATSAPP_READY_TIMEOUT || 120000;
      console.log(`[WhatsApp] Waiting for QR code scan (${timeout / 1000} seconds)...`);

      try {
        await this.page.waitForSelector('[data-icon="pane-info-chevron"]', { timeout });
        this.isReady = true;
        console.log('[WhatsApp] ✓ Successfully authenticated!');
      } catch (error) {
        console.error('[WhatsApp] QR code scan timeout or failed');
        throw error;
      }

      return true;
    } catch (error) {
      console.error('[WhatsApp] Initialization failed:', error);
      if (this.browser) {
        await this.browser.close();
      }
      return false;
    }
  }

  /**
   * Send message to a contact
   */
  async sendMessage(phoneNumber, message, imagePath = null) {
    if (!this.isReady) {
      console.warn('[WhatsApp] Service not initialized. Message not sent.');
      return { success: false, error: 'WhatsApp service is not initialized' };
    }

    try {
      // Format phone number (remove special characters, ensure +91 prefix)
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Open chat with contact
      const chatUrl = `https://web.whatsapp.com/send?phone=${formattedPhone}`;
      await this.page.goto(chatUrl, { waitUntil: 'networkidle' });

      // Wait for message input to be ready
      await this.page.waitForSelector('footer [contenteditable="true"]', { timeout: 10000 });

      // Type message
      const messageBox = await this.page.$('footer [contenteditable="true"]');
      await messageBox.click();
      await this.page.keyboard.type(message, { delay: 10 });

      // Send message
      const sendButton = await this.page.$('[data-testid="send"]');
      if (sendButton) {
        await sendButton.click();
      } else {
        // Fallback: send with Enter key
        await this.page.keyboard.press('Enter');
      }

      // Wait for message to be sent
      await this.page.waitForTimeout(1000);

      console.log(`[WhatsApp] Message sent to ${formattedPhone}`);
      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      console.error(`[WhatsApp] Error sending message to ${phoneNumber}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Format phone number to WhatsApp format
   */
  formatPhoneNumber(phone) {
    // Ensure phone is a string, then remove all non-digits
    const asString = phone === null || phone === undefined ? '' : String(phone);
    let cleaned = asString.replace(/\D/g, '');

    // If it starts with 0, remove it (Indian format)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }

    // Add country code if not present
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }

    return cleaned;
  }

  /**
   * Close the browser session
   */
  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.isReady = false;
        console.log('[WhatsApp] Browser closed');
      }
    } catch (error) {
      console.error('[WhatsApp] Error closing browser:', error);
    }
  }

  /**
   * Check if connection is still active
   */
  async isConnected() {
    if (!this.isReady || !this.page) {
      return false;
    }

    try {
      // Try to access a page element to verify connection
      const result = await this.page.$('[data-testid="chat-screen"]');
      return result !== null;
    } catch (error) {
      return false;
    }
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();

// Auto-initialize on startup (optional - can be called manually if needed)
// whatsappService.initialize().catch(console.error);

module.exports = whatsappService;
