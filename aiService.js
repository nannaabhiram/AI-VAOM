const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./db');
require('dotenv').config();

// Initialize Gemini 1.5 Flash
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Process voice command using Gemini AI to extract item, quantity, and action
 * @param {string} text - Voice command text
 * @returns {Promise<Object>} - Extracted {item, quantity, action} or null if failed
 */
async function processVoiceCommand(text) {
  try {
    const prompt = `
You are a voice command parser for an order management system.
Analyze the user's input and extract the action, item name, and quantity.

Supported Actions:
- CREATE: When user wants to order, add, buy, get, or place an order for something
- UPDATE: When user wants to change, modify, or update an existing order
- DELETE: When user wants to cancel, remove, or delete an order
- TRACK: When user wants to check status, track, or see where their order is

Return ONLY a valid JSON object in this exact format:
{"action": "CREATE|UPDATE|DELETE|TRACK", "item": "item_name", "quantity": number}

Rules:
- Action must be one of: CREATE, UPDATE, DELETE, or TRACK (default to CREATE for new orders)
- Recognize ANY food item, drink, or product (pizza, burger, coffee, salad, pasta, sushi, tacos, etc.)
- Item name should be lowercase and singular
- If quantity is not specified, default to 1
- If no item can be identified, return {"action": "IGNORE", "item": null, "quantity": null}
- For ordering phrases like "I want", "I need", "Order me", "Get me", "Add", "Give me" → use CREATE
- Return ONLY the JSON object, no other text or explanation

Text to parse: "${text}"
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const textResponse = response.text();

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = textResponse.trim();
    
    // Remove markdown code block if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/```$/, '');
    }
    
    jsonStr = jsonStr.trim();

    // Parse the JSON response
    const parsed = JSON.parse(jsonStr);
    
    // Validate the response structure
    if (!parsed.action) {
      console.log('AI returned no action:', parsed);
      return null;
    }

    // If it's a CREATE/UPDATE action but no item, that's invalid
    if ((parsed.action === 'CREATE' || parsed.action === 'UPDATE') && !parsed.item) {
      console.log('AI returned action without item:', parsed);
      return null;
    }

    return {
      action: parsed.action,
      item: parsed.item ? parsed.item.toLowerCase() : null,
      quantity: typeof parsed.quantity === 'number' ? parsed.quantity : 1
    };

  } catch (error) {
    console.error('Error processing voice command with Gemini:', error);
    // FALLBACK: Simple regex parser for demo
    return fallbackParse(text);
  }
}

/**
 * Fallback parser when Gemini fails (e.g., invalid API key)
 * @param {string} text - Voice command text
 * @returns {Object} - Extracted {action, item, quantity}
 */
function fallbackParse(text) {
  const lower = text.toLowerCase();
  
  // Check for ordering keywords
  const orderKeywords = ['order', 'want', 'need', 'get', 'add', 'give', 'buy', 'place'];
  const isOrder = orderKeywords.some(kw => lower.includes(kw));
  
  if (!isOrder) {
    return { action: 'IGNORE', item: null, quantity: null };
  }
  
  // Extract quantity
  const qtyMatch = text.match(/(\d+)/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
  
  // Extract item - list of common foods
  const foods = ['pizza', 'burger', 'coffee', 'salad', 'pasta', 'sushi', 'taco', 'sandwich', 
                 'fries', 'donut', 'cake', 'chicken', 'steak', 'fish', 'soup', 'burrito',
                 'noodles', 'rice', 'bread', 'croissant', 'muffin', 'pancake', 'waffle'];
  
  let item = 'item'; // default
  for (const food of foods) {
    if (lower.includes(food)) {
      item = food;
      break;
    }
  }
  
  // If no food found, try to extract noun after quantity
  if (item === 'item' && qtyMatch) {
    const afterQty = text.slice(text.indexOf(qtyMatch[0]) + qtyMatch[0].length).trim();
    const words = afterQty.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      item = words[0].toLowerCase().replace(/[^a-z]/g, '');
    }
  }
  
  console.log('Fallback parser result:', { action: 'CREATE', item, quantity });
  return { action: 'CREATE', item, quantity };
}

/**
 * Save order to database via API
 * @param {Object} orderData - {item, quantity}
 * @returns {Promise<Object>} - Saved order or null if failed
 */
async function saveOrder(orderData) {
  try {
    if (!orderData || !orderData.item || !orderData.quantity) {
      console.log('Invalid order data:', orderData);
      return null;
    }

    // Use API endpoint instead of direct Supabase
    const response = await fetch('http://localhost:3001/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: orderData.item,
        quantity: orderData.quantity,
        status: 'pending',
        price: 0.0
      })
    });

    if (!response.ok) {
      console.error('Error saving order:', response.statusText);
      return null;
    }

    const data = await response.json();
    console.log('Order saved successfully:', data);
    return data;

  } catch (error) {
    console.error('Error in saveOrder:', error);
    return null;
  }
}

/**
 * Process voice command and save to database
 * @param {string} text - Voice command text
 * @returns {Promise<Object>} - Complete result with extracted data and saved order
 */
async function processAndSaveVoiceCommand(text) {
  try {
    // Step 1: Extract action, item and quantity using Gemini AI
    const extracted = await processVoiceCommand(text);
    
    if (!extracted || extracted.action === 'IGNORE') {
      return {
        success: false,
        error: 'Could not understand the voice command',
        extracted: extracted,
        savedOrder: null
      };
    }

    // Only save to database for CREATE action
    if (extracted.action !== 'CREATE') {
      return {
        success: true,
        extracted: extracted,
        savedOrder: null,
        message: `Action ${extracted.action} recognized but not saved to database`
      };
    }

    // Step 2: Save to database
    const savedOrder = await saveOrder(extracted);
    
    if (!savedOrder) {
      return {
        success: false,
        error: 'Failed to save order to database',
        extracted: extracted,
        savedOrder: null
      };
    }

    return {
      success: true,
      extracted: extracted,
      savedOrder: savedOrder
    };

  } catch (error) {
    console.error('Error in processAndSaveVoiceCommand:', error);
    return {
      success: false,
      error: error.message,
      extracted: null,
      savedOrder: null
    };
  }
}

module.exports = {
  processVoiceCommand,
  saveOrder,
  processAndSaveVoiceCommand
};
