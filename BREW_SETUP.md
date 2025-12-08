# Homebrew Setup Instructions

## Status
✅ Homebrew is already installed at `/opt/homebrew/bin/brew`
✅ ngrok is already installed via Homebrew

## Adding Homebrew to PATH (Optional)

If you want to use `brew` directly without the full path, add it to your PATH:

### For bash (default shell):
Add this line to your `~/.bash_profile` or `~/.bashrc`:
```bash
export PATH="/opt/homebrew/bin:$PATH"
```

Then reload your shell:
```bash
source ~/.bash_profile
```

### For zsh (if you're using zsh):
Add this line to your `~/.zshrc`:
```bash
export PATH="/opt/homebrew/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

## Using Homebrew (Current Method)

You can use Homebrew with the full path:
```bash
/opt/homebrew/bin/brew install <package>
/opt/homebrew/bin/brew list
/opt/homebrew/bin/brew update
```

## Using ngrok

ngrok is already installed! You can use it with:
```bash
/opt/homebrew/bin/ngrok http 3000
```

Or if you add Homebrew to PATH:
```bash
ngrok http 3000
```

## Next Steps for ngrok

1. Sign up for a free ngrok account: https://dashboard.ngrok.com/signup
2. Get your authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
3. Configure ngrok:
   ```bash
   /opt/homebrew/bin/ngrok config add-authtoken YOUR_AUTHTOKEN
   ```
4. Start ngrok:
   ```bash
   /opt/homebrew/bin/ngrok http 3000
   ```
5. Share the public URL with players!

## If Homebrew Wasn't Installed

If you need to install Homebrew from scratch, run:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

This will install Homebrew and add it to your PATH automatically.



