name = "boosthubkenya"
main = "Workers.js"
compatibility_date = "2024-01-01"

# CRITICAL: Database for orders
[[d1_databases]]
binding = "DB"
database_name = "boosthub-db"
database_id = "xxxxxxxx" # Create via wrangler d1 create boosthub-db

# Environment variables
[vars]
SMM_PANEL_URL = "https://your-smm-provider.com"
SMM_API_KEY = "your-secret-key"
WEBHOOK_SECRET = "whsec_..."
