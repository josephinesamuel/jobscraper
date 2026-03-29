# Job Application Suite — Local Proxy

## Setup (one time only)

1. Install dependencies:
   npm install

2. Copy the env file and fill in your keys:
   cp .env.example .env

   Open .env and add:
   - APIFY_TOKEN   → from apify.com/account/integrations
   - ANTHROPIC_KEY → from console.anthropic.com/settings/keys
   - GOOGLE_SHEET_ID → the long ID from your Google Sheet URL

3. Start the proxy:
   npm start

   You should see: ✅ Job Suite proxy running at http://localhost:3001

## Daily use

Just run: npm start
Then open the Claude artifact — everything routes through localhost:3001.

## Getting your API keys

### Apify
1. Sign up at apify.com (free tier works)
2. Go to Settings → Integrations → copy your API token

### Anthropic
1. Go to console.anthropic.com/settings/keys
2. Create a new key → copy it

### Google Sheet ID
1. Create a blank Google Sheet at sheets.google.com
2. Add header row: Date | Company | Role | Location | Status | CV Doc | Cover Letter | Job URL
3. Copy the ID from the URL:
   https://docs.google.com/spreadsheets/d/COPY_THIS_PART/edit

## Troubleshooting

- "EADDRINUSE" → another process is on port 3001, change PORT in .env
- "APIFY_TOKEN not set" → make sure you saved your .env file
- CORS errors in artifact → make sure npm start is running first
