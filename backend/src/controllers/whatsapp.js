const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');

/**
 * GET - Status of WhatsApp connection
 */
router.get('/status', async (req, res) => {
  try {
    const isConnected = await whatsappService.isConnected();
    res.json({ 
      isReady: whatsappService.isReady,
      isConnected: isConnected
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Initialize WhatsApp (opens browser for QR scan)
 */
router.post('/connect', async (req, res) => {
  try {
    // We run initialize which handles browser launch
    // Note: In a production server, this might need headless: true 
    // but for user local setup, they need to see the QR.
    const success = await whatsappService.initialize();
    if (success) {
      res.json({ message: 'WhatsApp initialized successfully' });
    } else {
      res.status(500).json({ error: 'Failed to initialize WhatsApp' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Test message
 */
router.post('/test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });
    
    const result = await whatsappService.sendMessage(phone, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
