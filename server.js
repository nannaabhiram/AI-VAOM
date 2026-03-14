const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const aiService = require('./aiService');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client initialization with fallback
let supabase;
let useInMemoryFallback = false;
const inMemoryOrders = new Map();
let orderIdCounter = 1;

try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
  // Test connection
  supabase.from('orders').select('*').limit(1).then(({error}) => {
    if (error) {
      console.warn('⚠️ Supabase connection failed, using in-memory fallback:', error.message);
      useInMemoryFallback = true;
    } else {
      console.log('✅ Supabase connected successfully');
    }
  });
} catch (error) {
  console.warn('⚠️ Supabase init failed, using in-memory fallback:', error.message);
  useInMemoryFallback = true;
  supabase = null;
}

// In-memory CRUD helpers
async function getOrders() {
  if (useInMemoryFallback) {
    return Array.from(inMemoryOrders.values()).sort((a, b) => b.id - a.id);
  }
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createOrder(orderData) {
  if (useInMemoryFallback) {
    const order = {
      id: orderIdCounter++,
      item: orderData.item,
      quantity: orderData.quantity,
      status: orderData.status || 'pending',
      price: orderData.price || 0.0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryOrders.set(order.id, order);
    console.log('💾 Order saved to memory:', order);
    return order;
  }
  const { data, error } = await supabase.from('orders').insert([orderData]).select().single();
  if (error) throw error;
  return data;
}

// In-memory session storage for context memory and confirmation state
const sessionContext = new Map();
const pendingConfirmations = new Map();
const businessAnalytics = new Map(); // Track time saved per session

/**
 * Executive AI-VAOM Controller - Business Solution Logic
 * Optimizes for speed, business efficiency, and "Instant" UI feedback
 * @param {string} user_input - The user's speech transcript
 * @param {number} last_id - The last order ID in session context
 * @param {boolean} is_waiting_for_confirm - If waiting for confirmation
 * @param {string} environment - "High Noise" | "Quiet"
 * @param {string} last_action - Last action performed
 * @param {Object} current_order_state - Current order state JSON
 * @returns {Object} - Executive Controller response schema
 */
function processExecutiveController(user_input, last_id = null, is_waiting_for_confirm = false, environment = 'Quiet', last_action = '', current_order_state = null) {
  const input = user_input.toLowerCase().trim();
  
  // Executive Controller response schema
  const response = {
    action: 'IGNORE',
    optimistic_ui: {
      action_preview: null,
      target_id: null,
      highlight_color: null
    },
    analytics: {
      time_saved: 0,
      intent_confidence: 0.0
    },
    data: {
      items_list: [],
      order_id: null,
      require_confirmation: false,
      context_reset: false
    },
    voice_response: 'Sorry, I didn\'t understand that. Please try again.',
    dashboard_hint: 'Command not recognized'
  };
  
  // KIOSK MODE - Shorten responses in noisy environments
  const isKioskMode = environment === 'High Noise';
  
  // Handle confirmation responses
  if (is_waiting_for_confirm) {
    const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'do it', 'confirm', 'execute', 'proceed'];
    const cancelWords = ['no', 'cancel', 'stop', 'never mind', 'abort'];
    
    if (confirmWords.some(word => input.includes(word))) {
      response.action = 'CONFIRM_EXECUTE';
      response.voice_response = isKioskMode ? 'Confirmed.' : 'Executing your confirmed action.';
      response.dashboard_hint = 'Executing confirmed action...';
      response.optimistic_ui.action_preview = 'EXECUTING_ACTION';
      response.analytics.time_saved = 15;
      response.analytics.intent_confidence = 0.9;
      return response;
    } else if (cancelWords.some(word => input.includes(word))) {
      response.action = 'IGNORE';
      response.voice_response = isKioskMode ? 'Cancelled.' : 'Action cancelled.';
      response.dashboard_hint = 'Action cancelled';
      response.analytics.intent_confidence = 0.8;
      return response;
    }
  }
  
  // AMBIGUITY RESOLUTION - Detect context reset patterns
  const resetPatterns = ['wait', 'scratch', 'never mind', 'no actually', 'change my mind', 'instead'];
  const contextReset = resetPatterns.some(pattern => input.includes(pattern));
  
  if (contextReset) {
    response.data.context_reset = true;
    response.optimistic_ui.action_preview = 'RESETTING_CONTEXT';
    response.analytics.time_saved = 10; // Time saved by quick correction
    response.analytics.intent_confidence = 0.85;
  }
  
  // NOISE FILTER - Check for background noise or unrelated talk
  const gibberishPatterns = [/^[^a-zA-Z]+$/, /^(.)\1{3,}$/, /^[a-z]{1,2}$/i];
  const isGibberish = gibberishPatterns.some(pattern => pattern.test(input));
  const orderKeywords = ['order', 'buy', 'want', 'get', 'pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta', 'cancel', 'delete', 'track', 'status', 'where', 'check', 'change', 'update', 'modify', 'add', 'and', 'scratch', 'wait'];
  const hasOrderKeywords = orderKeywords.some(keyword => input.includes(keyword));
  
  if (isGibberish || !hasOrderKeywords) {
    response.action = 'IGNORE';
    response.voice_response = ''; // Silent ignore for background noise
    response.dashboard_hint = 'Background noise filtered';
    response.analytics.intent_confidence = 0.1;
    return response;
  }
  
  // MULTI-COMMANDS - Parse multiple items with "and"
  const items_list = [];
  const andPattern = /(.+?)\s+and\s+(.+)/i;
  const multiMatch = input.match(andPattern);
  
  if (multiMatch) {
    // Process multiple items
    const parts = [multiMatch[1], multiMatch[2]];
    for (const part of parts) {
      const itemData = parseItemFromText(part);
      if (itemData.item) {
        items_list.push(itemData);
      }
    }
  } else {
    // Single item
    const itemData = parseItemFromText(input);
    if (itemData.item) {
      items_list.push(itemData);
    }
  }
  
  // Extract order ID if mentioned
  const orderMatch = input.match(/\b(\d+)\b/);
  if (orderMatch) {
    response.data.order_id = parseInt(orderMatch[1]);
    response.optimistic_ui.target_id = response.data.order_id;
  }
  
  // Calculate intent confidence based on clarity
  response.analytics.intent_confidence = calculateIntentConfidence(input, items_list, response.data.order_id);
  
  // BUSINESS LOGIC - Calculate time saved
  const totalQuantity = items_list.reduce((sum, item) => sum + (item.qty || 1), 0);
  
  // ACTION MAPPING with Executive Controller logic
  if (input.includes('order') || input.includes('buy') || input.includes('want') || input.includes('get') || input.includes('add')) {
    if (items_list.length === 0) {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'What item?' : 'Sure! What would you like to order?';
      response.dashboard_hint = 'Awaiting item selection...';
      response.analytics.intent_confidence = 0.3;
    } else if (items_list.some(item => !item.qty)) {
      response.action = 'CLARIFY';
      response.data.items_list = items_list;
      const missingItem = items_list.find(item => !item.qty);
      response.voice_response = isKioskMode ? `How many ${missingItem.item}s?` : `Great! How many ${missingItem.item}${missingItem.qty !== 1 ? 's' : ''} would you like?`;
      response.dashboard_hint = 'Awaiting quantity...';
      response.analytics.intent_confidence = 0.6;
    } else {
      response.action = 'CREATE';
      response.data.items_list = items_list;
      response.analytics.time_saved = totalQuantity * 15; // CREATE = 15s per item
      
      if (totalQuantity > 5) {
        response.data.require_confirmation = true;
        response.action = 'CLARIFY';
        response.voice_response = isKioskMode ? `${totalQuantity} items, confirm?` : `That's ${totalQuantity} items. Are you sure you want to place this large order?`;
        response.dashboard_hint = 'Confirmation required for large order';
        response.optimistic_ui.action_preview = 'PREPARING_LARGE_ORDER';
        response.optimistic_ui.highlight_color = '#ef4444'; // Red for large orders
      } else {
        response.voice_response = isKioskMode ? `Adding ${items_list.map(i => i.item).join(', ')}.` : `Placing order for ${items_list.map(i => `${i.qty} ${i.item}${i.qty > 1 ? 's' : ''}`).join(' and ')}.`;
        response.dashboard_hint = `Analytics update: +${response.analytics.time_saved}s saved`;
        response.optimistic_ui.action_preview = 'ADDING_ITEMS';
        response.optimistic_ui.highlight_color = '#22c55e'; // Green for success
      }
    }
  }
  else if (input.includes('where') || input.includes('status') || input.includes('check') || input.includes('track')) {
    response.action = 'TRACK';
    response.analytics.time_saved = 5; // Quick status check
    
    if (response.data.order_id) {
      response.voice_response = isKioskMode ? `Tracking order ${response.data.order_id}.` : `Checking the status of order ${response.data.order_id}.`;
      response.dashboard_hint = `Tracking #${response.data.order_id}...`;
      response.optimistic_ui.action_preview = 'HIGHLIGHTING_ROW';
      response.optimistic_ui.highlight_color = '#3b82f6'; // Blue for tracking
    } else if (items_list.length > 0) {
      response.data.items_list = items_list;
      response.voice_response = isKioskMode ? `Tracking ${items_list.map(i => i.item).join(', ')}.` : `Checking the status of your ${items_list.map(i => i.item).join(' and ')} orders.`;
      response.dashboard_hint = `Tracking ${items_list.map(i => i.item).join(', ')} orders...`;
      response.optimistic_ui.action_preview = 'HIGHLIGHTING_ROWS';
      response.optimistic_ui.highlight_color = '#3b82f6';
    } else {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : 'Which order would you like to check? Please provide the order number or item name.';
      response.dashboard_hint = 'Awaiting order details...';
      response.analytics.intent_confidence = 0.4;
    }
  }
  else if (input.includes('change') || input.includes('update') || input.includes('modify') || contextReset) {
    if (!response.data.order_id && !contextReset) {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : 'Which order would you like to update? Please provide the order number.';
      response.dashboard_hint = 'Awaiting order ID...';
      response.analytics.intent_confidence = 0.4;
    } else {
      response.action = 'UPDATE';
      response.data.items_list = items_list;
      response.analytics.time_saved = 20; // UPDATE = 20s
      
      if (contextReset) {
        response.voice_response = isKioskMode ? 'Updated.' : `Switched to ${items_list.map(i => i.item).join(' and ')}.`;
        response.optimistic_ui.action_preview = 'REPLACING_ITEM';
        response.optimistic_ui.highlight_color = '#f59e0b'; // Amber for changes
      } else {
        response.voice_response = isKioskMode ? `Updating order ${response.data.order_id}.` : `Updating order ${response.data.order_id}.`;
        response.dashboard_hint = `Analytics update: +${response.analytics.time_saved}s saved`;
        response.optimistic_ui.action_preview = 'UPDATING_ITEM';
        response.optimistic_ui.highlight_color = '#22c55e';
      }
    }
  }
  else if (input.includes('cancel') || input.includes('delete') || input.includes('remove')) {
    if (!response.data.order_id) {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : 'Which order would you like to cancel? Please provide the order number.';
      response.dashboard_hint = 'Awaiting order ID...';
      response.analytics.intent_confidence = 0.4;
    } else {
      response.action = 'CLARIFY'; // Always clarify for safety
      response.data.order_id = response.data.order_id;
      response.data.require_confirmation = true;
      response.analytics.time_saved = 10; // DELETE = 10s
      response.voice_response = isKioskMode ? `Delete order ${response.data.order_id}?` : `Are you sure you want to cancel order ${response.data.order_id}?`;
      response.dashboard_hint = 'Confirmation required for deletion';
      response.optimistic_ui.action_preview = 'HIDING_ROW';
      response.optimistic_ui.highlight_color = '#ef4444'; // Red for deletion
    }
  }
  
  return response;
}

/**
 * Calculate intent confidence based on input clarity
 */
function calculateIntentConfidence(input, items_list, order_id) {
  let confidence = 0.5; // Base confidence
  
  // Boost confidence for clear item mentions
  if (items_list.length > 0 && items_list.every(item => item.item && item.qty)) {
    confidence += 0.3;
  }
  
  // Boost confidence for specific order ID
  if (order_id) {
    confidence += 0.2;
  }
  
  // Reduce confidence for ambiguous input
  if (input.includes('maybe') || input.includes('perhaps')) {
    confidence -= 0.2;
  }
  
  return Math.min(Math.max(confidence, 0.0), 1.0);
}

/**
 * Helper function to parse item and quantity from text
 */
function parseItemFromText(text) {
  const items = ['pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta', 'drink', 'water', 'soda', 'fries', 'chicken'];
  const item = items.find(i => text.includes(i)) || null;
  
  const quantityMatch = text.match(/\b(\d+)\b/);
  const quantity = quantityMatch ? parseInt(quantityMatch[1]) : (item ? 1 : null);
  
  return { item, qty: quantity };
}

/**
 * Legacy function for backward compatibility
 * @param {string} voiceCommand - The voice command string
 */
function handleVoiceIntent(voiceCommand) {
  const result = processExecutiveController(voiceCommand);
  console.log(`VOICE INTENT: ${result.action} - "${voiceCommand}"`);
  return result.action;
}

// CRUD Endpoints for Orders

// GET - Retrieve all orders
app.get('/api/orders', async (req, res) => {
  try {
    const data = await getOrders();
    res.json(data);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET - Retrieve single order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Order not found' });
      }
      console.error('Error fetching order:', error);
      return res.status(500).json({ error: 'Failed to fetch order' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST - Create new order
app.post('/api/orders', async (req, res) => {
  try {
    const { item, quantity, status = 'pending', price = 0.0 } = req.body;
    
    if (!item || !quantity) {
      return res.status(400).json({ error: 'Item and quantity are required' });
    }
    
    const order = await createOrder({ item, quantity, status, price });
    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PATCH - Update order status
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error updating order status:', error);
      return res.status(500).json({ error: 'Failed to update order status' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH - Update order (general)
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { item, quantity, status } = req.body;
    
    const updateData = { updated_at: new Date().toISOString() };
    if (item) updateData.item = item;
    if (quantity) updateData.quantity = quantity;
    if (status) updateData.status = status;
    
    const { data, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error updating order:', error);
      return res.status(500).json({ error: 'Failed to update order' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE - Cancel/delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error deleting order:', error);
      return res.status(500).json({ error: 'Failed to delete order' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ message: 'Order deleted successfully', deletedOrder: data[0] });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NEW: Gemini AI-powered voice intent processing with optimistic UI
app.post('/api/voice-process', async (req, res) => {
  try {
    const { 
      command, 
      sessionId = 'default',
      environment = 'Quiet',
      lastOrderId = null
    } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Context reset detection - check for cancellation phrases
    const contextResetPhrases = ['no', 'wait', 'actually', 'scratch that', 'never mind', 'cancel', 'changed my mind'];
    const hasContextReset = contextResetPhrases.some(phrase => 
      command.toLowerCase().includes(phrase)
    );
    
    // Process voice command with Gemini AI
    let extractedData;
    let contextReset = false;
    let action = 'CREATE';
    let requireConfirmation = false;
    
    if (hasContextReset) {
      // Handle context reset - extract new item after reset phrase
      const cleanCommand = command.replace(/^(no|wait|actually|scratch that|never mind|cancel)\s*,?\s*/i, '');
      extractedData = await aiService.processVoiceCommand(cleanCommand);
      contextReset = true;
      action = 'UPDATE';
    } else if (command.toLowerCase().includes('delete') || command.toLowerCase().includes('cancel')) {
      // Safety: Delete requires confirmation
      action = 'DELETE';
      requireConfirmation = true;
      const orderIdMatch = command.match(/\d+/);
      extractedData = { order_id: orderIdMatch ? parseInt(orderIdMatch[0]) : lastOrderId };
    } else {
      // Normal order creation
      extractedData = await aiService.processVoiceCommand(command);
      action = extractedData?.action || 'CREATE';
      console.log('Gemini extracted:', extractedData);
    }
    
    // Kiosk mode: 3 words max response
    let voiceResponse;
    if (environment === 'High Noise') {
      if (action === 'CREATE' && extractedData) {
        voiceResponse = `Adding ${extractedData.quantity} ${extractedData.item}.`;
      } else if (action === 'DELETE') {
        voiceResponse = 'Delete order?';
      } else if (contextReset) {
        voiceResponse = 'Updated.';
      } else {
        voiceResponse = 'Processing.';
      }
    } else {
      if (action === 'CREATE' && extractedData) {
        voiceResponse = `Adding ${extractedData.quantity} ${extractedData.item} to your order.`;
      } else if (action === 'DELETE') {
        voiceResponse = 'Are you sure you want to delete this order?';
      } else if (contextReset) {
        voiceResponse = `Correction detected. Switched to ${extractedData.item}.`;
      } else {
        voiceResponse = 'Processing your request.';
      }
    }
    
    // Calculate optimistic UI hints
    const optimisticUI = {
      action_preview: action === 'CREATE' ? 'ADDING_ITEMS' : 
                     action === 'DELETE' ? 'HIDING_ROW' : 
                     contextReset ? 'REPLACING_ITEM' : 'UPDATING_ITEM',
      target_id: extractedData?.order_id || lastOrderId,
      highlight_color: action === 'DELETE' ? '#ef4444' : 
                      contextReset ? '#f59e0b' : '#22c55e'
    };
    
    // Calculate analytics
    const analytics = {
      time_saved: action === 'CREATE' ? 15 : action === 'UPDATE' ? 20 : 10,
      intent_confidence: extractedData ? 0.95 : 0.5
    };
    
    // Build response
    const response = {
      command,
      sessionId,
      environment,
      action,
      context_reset: contextReset,
      data: {
        ...extractedData,
        require_confirmation: requireConfirmation
      },
      optimistic_ui: optimisticUI,
      analytics,
      voice_response: voiceResponse,
      dashboard_hint: contextReset ? 'Correction detected' : 
                     action === 'CREATE' ? `Analytics: +${analytics.time_saved}s saved` : 
                     'Processing...'
    };
    
    // If CREATE action and not requiring confirmation, save to database
    if (action === 'CREATE' && extractedData && !requireConfirmation) {
      const savedOrder = await aiService.saveOrder(extractedData);
      if (savedOrder) {
        response.data.order_id = savedOrder.id;
        response.data.saved_order = savedOrder;
        
        // Update session context
        sessionContext.set(sessionId, savedOrder.id);
        
        // Update business analytics
        const currentTotal = businessAnalytics.get(sessionId) || 0;
        businessAnalytics.set(sessionId, currentTotal + analytics.time_saved);
      }
    }
    
    console.log('Gemini AI Processing:', response);
    
    res.json(response);
    
  } catch (error) {
    console.error('Error processing voice with Gemini:', error);
    res.status(500).json({ error: 'Failed to process voice command with AI' });
  }
});

// Enhanced voice intent processing endpoint with Executive Controller logic
app.post('/api/voice-intent', (req, res) => {
  try {
    const { 
      command, 
      sessionId = 'default',
      environment = 'Quiet',
      lastAction = '',
      currentOrderState = null
    } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Get last order ID from session context
    const lastOrderId = sessionContext.get(sessionId) || null;
    
    // Check if waiting for confirmation
    const isWaitingForConfirm = pendingConfirmations.get(sessionId) || false;
    
    // Process with Executive Controller logic
    const executiveResponse = processExecutiveController(
      command, 
      lastOrderId, 
      isWaitingForConfirm, 
      environment, 
      lastAction, 
      currentOrderState
    );
    
    // Update business analytics
    if (executiveResponse.analytics.time_saved > 0) {
      const currentTotal = businessAnalytics.get(sessionId) || 0;
      businessAnalytics.set(sessionId, currentTotal + executiveResponse.analytics.time_saved);
    }
    
    // Handle confirmation state management
    if (executiveResponse.action === 'CLARIFY' && executiveResponse.data.require_confirmation) {
      pendingConfirmations.set(sessionId, true);
      // Store the pending action data for execution
      sessionContext.set(sessionId + '_pending', executiveResponse.data);
    } else if (executiveResponse.action === 'CONFIRM_EXECUTE') {
      // Execute the pending action
      const pendingData = sessionContext.get(sessionId + '_pending');
      if (pendingData) {
        executiveResponse.data = pendingData;
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action !== 'IGNORE') {
      // Clear confirmation state for other actions
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    }
    
    // Update session context if this action creates an order
    if (executiveResponse.action === 'CREATE' && executiveResponse.data.order_id) {
      sessionContext.set(sessionId, executiveResponse.data.order_id);
    } else if (executiveResponse.data.order_id) {
      // Update context with referenced order ID
      sessionContext.set(sessionId, executiveResponse.data.order_id);
    }
    
    console.log(`Executive Controller Processing:`, {
      command,
      sessionId,
      environment,
      lastOrderId,
      isWaitingForConfirm,
      response: executiveResponse
    });
    
    res.json({
      command,
      sessionId,
      environment,
      lastOrderId,
      isWaitingForConfirm: pendingConfirmations.get(sessionId) || false,
      total_time_saved: businessAnalytics.get(sessionId) || 0,
      ...executiveResponse
    });
  } catch (error) {
    console.error('Error processing voice intent:', error);
    res.status(500).json({ error: 'Failed to process voice intent' });
  }
});

// Session context management endpoint
app.get('/api/session/:sessionId/context', (req, res) => {
  const { sessionId } = req.params;
  const context = {
    lastOrderId: sessionContext.get(sessionId) || null,
    total_time_saved: businessAnalytics.get(sessionId) || 0,
    isWaitingForConfirm: pendingConfirmations.get(sessionId) || false
  };
  res.json(context);
});

// Business analytics endpoint
app.get('/api/analytics/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const analytics = {
    total_time_saved: businessAnalytics.get(sessionId) || 0,
    session_id: sessionId,
    timestamp: new Date().toISOString()
  };
  res.json(analytics);
});

// Clear session context
app.delete('/api/session/:sessionId/context', (req, res) => {
  const { sessionId } = req.params;
  sessionContext.delete(sessionId);
  sessionContext.delete(sessionId + '_pending');
  pendingConfirmations.delete(sessionId);
  businessAnalytics.delete(sessionId);
  res.json({ message: 'Session context cleared' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'VAOM Backend'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 VAOM Backend Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎤 Voice intent endpoint: http://localhost:${PORT}/api/voice-intent`);
  console.log(`📦 Orders endpoints: http://localhost:${PORT}/api/orders`);
});

module.exports = app;
