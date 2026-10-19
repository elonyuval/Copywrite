#!/usr/bin/env bash
# Printed in the terminal when you open the codespace.
for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
URL="https://${CODESPACE_NAME:-localhost}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
TOKEN=$(grep '^SETUP_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
echo ""
echo "========================================================"
echo "  המערכת רצה:  $URL"
echo "  קוד הקמה (רק למשתמש הראשון):  $TOKEN"
if [ -n "${OPENAI_API_KEY:-}" ]; then echo "  AI: מחובר"; else echo "  AI: לא מחובר (אפשר להוסיף מפתח בהגדרות Codespaces של GitHub)"; fi
echo "  לשיתוף עם השותף/ה: לשונית PORTS > פורט 3000 > קליק ימני > Port Visibility > Public"
echo "  יומן השרת: data/server.log"
echo "========================================================"
