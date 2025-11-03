# PocketOption Postback Server for Render

## Deploy (Render Web Service)
- Start command: `node server.js`
- Env vars:
  - PORT=10000
  - MONGODB_URI=...
  - PO_POSTBACK_SECRET=YourStrongSecret
  - PO_ACCEPT_AFFILIATES=  # optional
  - PO_ACCEPT_CAMPAIGNS=   # optional

PocketOption URL:
`https://<your-app>.onrender.com/api/pocket/postback?secret=YourStrongSecret`

Add uptime monitor to ping `/health` every 5 minutes (UptimeRobot / GitHub Actions) to keep free instance warm.
