/**
 * Input Validation Middleware & Utilities
 * Provides validation and error handling for API requests
 */

const Joi = require('joi');

/**
 * Validate request body against schema
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const messages = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      
      return res.status(400).json({
        error: 'Validation Error',
        details: messages
      });
    }

    req.validatedBody = value;
    next();
  };
}

/**
 * Validate request params
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const messages = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      
      return res.status(400).json({
        error: 'Validation Error',
        details: messages
      });
    }

    req.validatedParams = value;
    next();
  };
}

/**
 * Validate request query
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const messages = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      
      return res.status(400).json({
        error: 'Validation Error',
        details: messages
      });
    }

    req.validatedQuery = value;
    next();
  };
}

// ============ VALIDATION SCHEMAS ============

const Schemas = {
  // Property Schemas
  createProperty: Joi.object({
    room_number: Joi.string().required().max(50).messages({
      'string.empty': 'Room number is required',
      'string.max': 'Room number must be at most 50 characters'
    }),
    property_type: Joi.string().valid('shop', 'room').required(),
    meter_number: Joi.string().optional().max(50),
    ha_entity_id: Joi.string().optional().max(100)
  }),

  patchProperty: Joi.object({
    room_number: Joi.string().optional().max(50),
    property_type: Joi.string().valid('shop', 'room').optional(),
    meter_number: Joi.string().optional().max(50),
    ha_entity_id: Joi.string().optional().max(100),
    is_occupied: Joi.number().valid(0, 1).optional()
  }),

  // Tenant Schemas
  createTenant: Joi.object({
    property_id: Joi.number().required().positive(),
    name: Joi.string().required().max(100),
    phone: Joi.string().required().regex(/^[0-9]{10}$/).messages({
      'string.pattern.base': 'Phone must be a valid 10-digit number'
    }),
    rent_amount: Joi.number().required().positive().messages({
      'number.positive': 'Rent amount must be greater than 0'
    }),
    committed_payment_date: Joi.number().required().min(1).max(31),
    skip_auto_cutoff: Joi.number().valid(0, 1).optional(),
    status: Joi.string().valid('active', 'inactive').optional()
  }),

  patchTenant: Joi.object({
    name: Joi.string().optional().max(100),
    phone: Joi.string().optional().regex(/^[0-9]{10}$/),
    rent_amount: Joi.number().optional().positive(),
    committed_payment_date: Joi.number().optional().min(1).max(31),
    skip_auto_cutoff: Joi.number().valid(0, 1).optional(),
    status: Joi.string().valid('active', 'inactive').optional()
  }),

  // Payment Schemas
  recordPayment: Joi.object({
    property_id: Joi.number().required().positive(),
    month_year: Joi.string().required().regex(/^\d{4}-\d{2}$/),
    amount_paid: Joi.number().required().positive().messages({
      'number.positive': 'Amount paid must be greater than 0'
    }),
    base_rent: Joi.number().required().positive(),
    electricity_bill: Joi.number().optional().min(0),
    payment_date: Joi.string().optional().isoDate(),
    notes: Joi.string().optional().max(500)
  }),

  correctPayment: Joi.object({
    payment_id: Joi.number().required().positive(),
    new_amount_paid: Joi.number().required().min(0),
    reason: Joi.string().optional().max(500)
  }),

  // Meter Reading Schemas
  recordMeterReading: Joi.object({
    property_id: Joi.number().required().positive(),
    reading_date: Joi.string().required().isoDate(),
    previous_reading: Joi.number().required().min(0),
    current_reading: Joi.number().required().min(0).messages({
      'number.min': 'Current reading cannot be negative'
    })
  }),

  // Settings Schemas
  updateSettings: Joi.object({
    admin_name: Joi.string().optional().max(100),
    auto_cutoff_enabled: Joi.number().valid(0, 1).optional(),
    cutoff_grace_days: Joi.number().optional().min(0).max(31),
    cutoff_hour: Joi.number().required().min(0).max(23),
    cutoff_notify_whatsapp: Joi.number().valid(0, 1).optional(),
    cutoff_due_threshold: Joi.number().optional().min(0)
  }),

  // WhatsApp Schemas
  sendMessage: Joi.object({
    phone: Joi.string().required().regex(/^[0-9]{10}$/),
    message: Joi.string().required().max(1000)
  }),

  // Power Control Schemas
  idParam: Joi.object({
    id: Joi.number().required().positive()
  }),

  queryMonth: Joi.object({
    month_year: Joi.string().required().regex(/^\d{4}-\d{2}$/)
  })
};

/**
 * Safe error wrapper for async route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Centralized error handler (use at the end of app.use)
 */
function errorHandler(err, req, res, next) {
  console.error('[Error Handler]', err);

  // Validation errors
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Token expired'
    });
  }

  // Database errors
  if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Duplicate entry or constraint violation'
    });
  }

  // Database connectivity / busy errors -> Service Unavailable
  if (err.code && err.code.toString().toUpperCase().startsWith('SQLITE')) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database error or unavailable. Please try again later.'
    });
  }

  if (err.message && /database|SQLITE|busy|locked/i.test(err.message)) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database error or unavailable. Please try again later.'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.error || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = {
  validateRequest,
  validateParams,
  validateQuery,
  Schemas,
  asyncHandler,
  errorHandler
};
