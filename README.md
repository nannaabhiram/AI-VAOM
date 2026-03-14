# Voice-Activated Order Management (VAOM) Backend

A Node.js Express server with Supabase integration for managing orders through voice commands.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Update with your Supabase credentials:
     ```env
     SUPABASE_URL=https://your-project-id.supabase.co
     SUPABASE_KEY=your_supabase_key_here
     ```

3. **Set up Supabase database:**
   Create an `orders` table with the following structure:
   ```sql
   CREATE TABLE orders (
     id SERIAL PRIMARY KEY,
     item VARCHAR(255) NOT NULL,
     quantity INTEGER NOT NULL,
     status VARCHAR(50) DEFAULT 'pending',
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   ```

4. **Start the server:**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Orders CRUD Operations

- `GET /api/orders` - Get all orders
- `GET /api/orders/:id` - Get single order by ID
- `POST /api/orders` - Create new order
  ```json
  {
    "item": "pizza",
    "quantity": 2,
    "status": "pending"
  }
  ```
- `PATCH /api/orders/:id` - Update order
  ```json
  {
    "item": "burger",
    "quantity": 3,
    "status": "preparing"
  }
  ```
- `PATCH /api/orders/:id/status` - Update order status
  ```json
  {
    "status": "completed"
  }
  ```
- `DELETE /api/orders/:id` - Delete/cancel order

### Voice Processing

- `POST /api/voice-intent` - Process voice commands
  ```json
  {
    "command": "Order a pizza"
  }
  ```

### Health Check

- `GET /api/health` - Server health status

## Voice Intent Mapping

The `handleVoiceIntent` function maps voice commands to CRUD operations:

- **CREATE**: "order", "buy", "want", "get"
- **TRACK**: "where", "status", "check", "track"
- **UPDATE**: "change", "update", "modify"
- **DELETE**: "cancel", "delete", "remove"

## Example Voice Commands

- "Order a pizza" → CREATE
- "Where is my burger?" → TRACK
- "Change order 45 to two pizzas" → UPDATE
- "Cancel my pizza order 45" → DELETE

## Error Handling

The server includes comprehensive error handling for:
- Database connection issues
- Invalid request data
- Resource not found (404)
- Internal server errors (500)

## Development

The server uses:
- **Express.js** for web framework
- **Supabase** for database
- **CORS** for cross-origin requests
- **dotenv** for environment variables
- **nodemon** for development auto-reload
