# Ngrok Setup Instructions

## Mobile Responsive Features Added ✅

The game is now fully responsive for mobile devices:
- Touch-friendly buttons (44px minimum height)
- Responsive canvas that scales properly
- Mobile-optimized font sizes and spacing
- Prevents zoom on input focus (iOS)
- High DPI display support

## Setting up Ngrok

To expose your local server so others can access it from their phones:

### 1. Sign up for ngrok (free)
Visit: https://dashboard.ngrok.com/signup

### 2. Get your authtoken
After signing up, go to: https://dashboard.ngrok.com/get-started/your-authtoken
Copy your authtoken.

### 3. Configure ngrok
Run this command (replace YOUR_AUTHTOKEN with your actual token):
```bash
/opt/homebrew/bin/ngrok config add-authtoken YOUR_AUTHTOKEN
```

### 4. Start ngrok
Once configured, run:
```bash
/opt/homebrew/bin/ngrok http 3000
```

### 5. Get the public URL
Ngrok will display a public URL like: `https://xxxx-xx-xx-xx-xx.ngrok-free.app`
Share this URL with players - they can access the game from any device!

### Alternative: Quick Start Script

You can also create a script to start both the server and ngrok:

```bash
#!/bin/bash
# Start server in background
cd /Users/brunoflashbots/Desktop/flashbots/Spam_game
/opt/homebrew/bin/node server.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 2

# Start ngrok
/opt/homebrew/bin/ngrok http 3000

# When you stop (Ctrl+C), kill the server too
kill $SERVER_PID
```

## Notes

- The ngrok free tier provides a random URL each time you start it
- For a static URL, you'll need a paid ngrok plan
- Make sure your server is running on port 3000 before starting ngrok
- Players can access the game from any device with internet access using the ngrok URL



