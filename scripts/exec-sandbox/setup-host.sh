#!/usr/bin/env bash
# Provisions a Linux host (Ubuntu 24.04) for the devnuby-ai OS command sandbox
# (`src/executors/sandbox.ts`, `user-workspace.ts`). Idempotent; run as root:
#
#   sudo APP_DIR=/www/wwwroot/chat.devnuby.id bash scripts/exec-sandbox/setup-host.sh
#
# What it sets up:
#   - system user `devnuby-exec`: no login, no password, no sudo/docker, no cron/at, no SSH
#   - ACLs so that user cannot read app folders, secrets, backups or logs on the host
#   - an egress firewall for that uid: private/internal networks and this host blocked,
#     public internet allowed (systemd unit `devnuby-exec-firewall`)
#   - bubblewrap + document tooling (LibreOffice, pandoc, poppler, qpdf, OCR, fonts)
#   - the Lightpanda headless browser used by fetch_url (/usr/local/bin/lightpanda)
#   - root-only image dir and the mount root for the per-user 250 MB workspaces
set -euo pipefail

EXEC_USER=devnuby-exec
APP_DIR="${APP_DIR:-/www/wwwroot/chat.devnuby.id}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  acl bubblewrap util-linux e2fsprogs \
  libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
  pandoc poppler-utils qpdf ghostscript imagemagick tesseract-ocr tesseract-ocr-ind \
  fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
  fonts-noto-core fonts-noto-color-emoji zip unzip curl

echo "== user"
if ! id "$EXEC_USER" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "/home/$EXEC_USER" \
    --shell /usr/sbin/nologin --comment "devnuby-ai code executor (restricted)" "$EXEC_USER"
fi
passwd -l "$EXEC_USER" >/dev/null
chmod 700 "/home/$EXEC_USER"
grep -qx "$EXEC_USER" /etc/cron.deny 2>/dev/null || echo "$EXEC_USER" >> /etc/cron.deny
grep -qx "$EXEC_USER" /etc/at.deny 2>/dev/null || echo "$EXEC_USER" >> /etc/at.deny
printf 'DenyUsers %s\n' "$EXEC_USER" > /etc/ssh/sshd_config.d/90-devnuby-exec.conf
sshd -t && systemctl reload ssh
cat > /etc/security/limits.d/90-devnuby-exec.conf <<EOF
$EXEC_USER  hard  nproc   256
$EXEC_USER  hard  nofile  1024
$EXEC_USER  hard  fsize   1048576
$EXEC_USER  hard  core    0
EOF

echo "== workspace dirs"
install -d -m 700 -o root -g root /var/lib/devnuby-exec /var/lib/devnuby-exec/images
install -d -m 755 -o root -g root "/home/$EXEC_USER/mnt"

echo "== deny host paths to $EXEC_USER (ACL)"
deny() { [ -e "$1" ] && setfacl -m "u:$EXEC_USER:---" "$1" && echo "  blocked $1"; return 0; }
for p in /home/www /home/postgres /etc/letsencrypt /etc/ssh/ssh_host_* /var/log /var/spool/cron /opt; do
  deny "$p"
done
# aaPanel layout: block /www except /www/server/nodejs (the Node.js runtime)
if [ -d /www ]; then
  for p in /www/* /www/.Recycle_bin; do [ "$p" = /www/server ] || deny "$p"; done
  for p in /www/server/*; do [ "$p" = /www/server/nodejs ] || deny "$p"; done
fi

echo "== egress firewall"
install -m 750 "$(dirname "$0")/devnuby-exec-firewall" /usr/local/sbin/devnuby-exec-firewall
install -m 644 "$(dirname "$0")/devnuby-exec-firewall.service" /etc/systemd/system/devnuby-exec-firewall.service
systemctl daemon-reload
systemctl enable devnuby-exec-firewall.service >/dev/null
systemctl restart devnuby-exec-firewall.service

echo "== lightpanda headless browser (fetch_url, runs as $EXEC_USER; src/executors/lightpanda.ts)"
# Nightly builds only; re-run this script to update. Telemetry is turned off by the app.
curl -fsSL -o /tmp/lightpanda.new \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux
install -o root -g root -m 0755 /tmp/lightpanda.new /usr/local/bin/lightpanda
rm -f /tmp/lightpanda.new
LIGHTPANDA_DISABLE_TELEMETRY=true /usr/local/bin/lightpanda version

echo "== python libraries in the app venv (shared read-only with the sandbox)"
if [ -x "$APP_DIR/.devnuby/.venv/bin/python" ]; then
  "$APP_DIR/.devnuby/.venv/bin/python" -m pip install -q --disable-pip-version-check \
    reportlab pypdf pdfplumber pypdfium2 PyMuPDF python-docx python-pptx openpyxl XlsxWriter \
    pandas numpy matplotlib pillow lxml defusedxml beautifulsoup4 markdown pdf2image
else
  echo "  skipped: $APP_DIR/.devnuby/.venv not found (the app creates it on first skill run)"
fi

echo "done"
