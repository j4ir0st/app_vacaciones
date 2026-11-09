#!/bin/sh
# Resuelve automáticamente BACKEND_URL si no está definido o si contiene localhost / 127.0.0.1
# para que funcione correctamente tanto en producción como en entornos locales.

# Asignar fallback oficial si BACKEND_URL no fue definido o está vacío (seguro con set -u)
BACKEND_URL="${BACKEND_URL:-https://appsurgicorperu.com}"

# Limpiar espacios en blanco al inicio y al final
BACKEND_URL=$(echo "$BACKEND_URL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
# Quitar barra final si la tiene
BACKEND_URL=$(echo "$BACKEND_URL" | sed 's/\/$//')
# Reemplazar localhost o 127.0.0.1 por host.docker.internal para Docker en desarrollo
BACKEND_URL=$(echo "$BACKEND_URL" | sed 's/localhost/host.docker.internal/g' | sed 's/127.0.0.1/host.docker.internal/g')

export BACKEND_URL
