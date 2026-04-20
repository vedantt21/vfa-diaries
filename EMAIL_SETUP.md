# Email Verification Setup Guide

The VFA Diaries app has built-in email verification. By default, verification codes print to the terminal. To enable real Gmail verification before deployment, follow these steps:

## Step 1: Enable 2-Step Verification on Your Google Account

1. Go to https://myaccount.google.com/security
2. Click "2-Step Verification" and follow the setup
3. Complete phone verification

## Step 2: Create a Gmail App Password

1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer" (or your device)
3. Google will generate a 16-character password
4. **Copy this password** - you'll only see it once

## Step 3: Create .env File

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and replace:
   - `SMTP_USERNAME`: Your Gmail address (e.g., your-email@gmail.com)
   - `SMTP_PASSWORD`: The 16-character app password from Step 2, not your regular Gmail password
   - `SMTP_FROM`: Your Gmail address

Example `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_SSL=false
SMTP_USERNAME=myapp@gmail.com
SMTP_PASSWORD=abcd efgh ijkl mnop
SMTP_FROM=myapp@gmail.com
```

A Gmail App Password is usually 16 characters without spaces, or 19 characters if you keep Google's spaces between groups. If `SMTP_PASSWORD` is much longer than that, it is probably your normal Gmail password or the wrong value.

## Step 4: Load Environment Variables When Running

`server.py` automatically loads `.env` from this folder:

```bash
python3 server.py
```

For deployment, do not upload `.env`. Add the same values in your hosting provider's environment variable settings instead.

If you prefer a small local startup command, you can also use:

```bash
python3 run.py
```

## Step 5: Test

1. Go to http://localhost:8000
2. Create a new account with your Gmail address
3. Check your inbox for the verification email
4. Enter the 6-digit code to verify

## Troubleshooting

**"Could not send verification email" error:**
- Check that SMTP_USERNAME and SMTP_PASSWORD are correct
- Verify 2-Step Verification is enabled on your Google Account
- Confirm the app password was created (not your regular password)
- The app password has spaces - include them exactly as generated

**Email not arriving:**
- Check spam/junk folder
- Wait 30 seconds and refresh inbox
- Try sending again with "Resend code"

**Verification code expires in 15 minutes** - defined in `VERIFICATION_TTL_MINUTES` in server.py

## Security Notes

- ⚠️ **Never commit .env to git** - add it to .gitignore
- The app password is safe to use - it only works for your Gmail account
- You can revoke it anytime from https://myaccount.google.com/apppasswords
- Verification codes are hashed with salt in the database (not stored plaintext)
