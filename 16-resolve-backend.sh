#!/bin/sh
# Resuelve automáticamente BACKEND_URL si contiene localhost o 127.0.0.1
# para que redirija a host.docker.internal sin discrepancias en pruebas locales.

if [ -n "$BACKEND_URL" ]; then
    # Limpiar espacios en blanco al inicio o al final
    BACKEND_URL=$(echo "$BACKEND_URL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    # Quitar barra final si la tiene
    BACKEND_URL=$(echo "$BACKEND_URL" | sed 's/\/$//')
    # Reemplazar localhost o 127.0.0.1 por host.docker.internal
    BACKEND_URL=$(echo "$BACKEND_URL" | sed 's/localhost/host.docker.internal/g' | sed 's/127.0.0.1/host.docker.internal/g')
    export BACKEND_URL
fi
