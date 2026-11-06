#!/bin/bash
# Despliega la rama actual del repo en /opt/grimorio y reinicia el servicio.
# Uso (en la Pi, desde el repo):  ./despliegue/desplegar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=/opt/grimorio
NPM="node $HOME/.local/lib/npm/bin/npm-cli.js"
sudo install -d -o raspberry -g raspberry -m 755 "$DEST"
rsync -a --delete --exclude .git --exclude node_modules --exclude datos ./ "$DEST/"
(cd "$DEST" && $NPM ci --omit=dev --no-audit --no-fund --loglevel=error)
sudo systemctl restart grimorio
# En la Pi 3 el arranque tarda unos segundos
for i in $(seq 30); do curl -fs http://127.0.0.1:${PORT:-8002}/api/salud >/dev/null && break; sleep 0.5; done
systemctl is-active grimorio
curl -fsS http://127.0.0.1:${PORT:-8002}/api/salud && echo
