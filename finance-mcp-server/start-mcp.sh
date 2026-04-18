#!/bin/bash
cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server
export $(grep -v '^#' .env | xargs)
exec /Users/jaystudio/.nvm/versions/node/v24.14.0/bin/npx tsx /Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/src/mcp-stdio.ts
