#!/usr/bin/env bash
# Smoke test: Lightpanda fetch as the restricted devnuby-exec user, the way the app runs it.
# Usage (root, on the server): bash scripts/exec-sandbox/lightpanda-smoke.sh [url]
set -u
URL="${1:-https://example.com}"
LP=/usr/local/bin/lightpanda
UIDN=$(id -u devnuby-exec); GIDN=$(id -g devnuby-exec)

run() {
  systemd-run --scope --quiet --collect -p MemoryMax=768M -p MemorySwapMax=0 -p TasksMax=64 -p CPUQuota=100% -- \
  bwrap --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup-try --die-with-parent --new-session \
    --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --ro-bind /etc /etc --tmpfs /etc/ssh --tmpfs /etc/ssl/private \
    --proc /proc --dev /dev --tmpfs /tmp --tmpfs /home --chdir /tmp --clearenv \
    --setenv HOME /tmp --setenv PATH /usr/bin:/bin --setenv LIGHTPANDA_DISABLE_TELEMETRY true \
    -- setpriv --reuid="$UIDN" --regid="$GIDN" --clear-groups --no-new-privs --inh-caps=-all --bounding-set=-all \
    -- "$LP" fetch --log-level fatal --block-private-networks --wait-until networkidle --wait-ms 8000 --terminate-ms 15000 \
       --dump markdown --strip-mode clutter --dump-max-bytes 200000 --json "$@"
}

echo "== whoami inside sandbox"
systemd-run --scope --quiet --collect -- setpriv --reuid="$UIDN" --regid="$GIDN" --clear-groups -- id -u
echo "== public page: $URL"
time run "$URL" | head -c 1500; echo
echo "== loopback (must fail)"
run "http://127.0.0.1:6752/" | head -c 400; echo
echo "== server public ip (must fail)"
run "http://194.233.78.169/" | head -c 400; echo
