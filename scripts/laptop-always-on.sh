#!/usr/bin/env bash
# Keeps a laptop running as an always-on server (run as your normal user; it asks sudo where needed):
#   - never suspends/hibernates (lid close, idle, suspend key); the screen may still blank and lock
#   - battery almost empty -> clean power-off instead of dying (protects MongoDB)
#   - Docker (and every container) starts at boot without logging in
#   - Wi-Fi keeps reconnecting forever after router/power cuts; Wi-Fi power saving off
#   - daily database backup at 03:00
# Undo: see the "Undo" section in README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
WIFI="${1:-$(nmcli -t -f NAME,TYPE con show --active | awk -F: '$2=="802-11-wireless"{print $1; exit}')}"

echo "== Never sleep"
sudo mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\nHandleSuspendKey=ignore\nHandleHibernateKey=ignore\nIdleAction=ignore\n' \
  | sudo tee /etc/systemd/logind.conf.d/10-always-on-server.conf >/dev/null
sudo systemctl kill -s HUP systemd-logind   # reload config without ending the desktop session
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

if command -v xfconf-query >/dev/null; then
  echo "== XFCE power manager: no idle suspend, lid = lock screen, critical battery = shut down"
  set_xfce() { xfconf-query -c xfce4-power-manager -p "/xfce4-power-manager/$1" -n -t "$2" -s "$3" 2>/dev/null \
    || xfconf-query -c xfce4-power-manager -p "/xfce4-power-manager/$1" -s "$3"; }
  set_xfce inactivity-on-ac uint 0
  set_xfce inactivity-on-battery uint 0
  set_xfce lid-action-on-ac uint 3
  set_xfce lid-action-on-battery uint 3
  set_xfce logind-handle-lid-switch bool false
  set_xfce critical-power-level uint 5
  set_xfce critical-power-action uint 4
fi

echo "== Battery at 5% -> clean power-off"
sudo sed -i -e 's/^CriticalPowerAction=.*/CriticalPowerAction=PowerOff/' -e 's/^PercentageAction=.*/PercentageAction=5.0/' /etc/UPower/UPower.conf
sudo systemctl restart upower

echo "== Docker starts at boot"
sudo systemctl enable docker containerd

if [ -n "$WIFI" ]; then
  echo "== Wi-Fi '$WIFI': reconnect forever, power saving off"
  nmcli con mod "$WIFI" connection.autoconnect yes connection.autoconnect-retries 0 connection.autoconnect-priority 100
  printf '[connection]\nwifi.powersave = 2\n' | sudo tee /etc/NetworkManager/conf.d/wifi-powersave-off.conf >/dev/null
fi

echo "== Daily backup at 03:00"
line="0 3 * * * cd $PWD && scripts/backup.sh >> backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'scripts/backup.sh' || true; echo "$line" ) | crontab -

echo
echo "Done. Check: systemctl status sleep.target (masked), crontab -l"
