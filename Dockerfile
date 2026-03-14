# Dockerfile multi-stage para el Sistema de Vacaciones Surgicorp
# Stage 1: Construcción del proyecto Angular
FROM node:20-alpine AS build

WORKDIR /app

# Instalar dependencias del sistema necesarias para Alpine
RUN apk add --no-cache libc6-compat gcompat

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN rm -f package-lock.json && npm install --legacy-peer-deps

# Copiar el resto del código
COPY . .

# Compilar Angular con base-href /app_vacaciones/
RUN npm run build -- --configuration production --base-href=/app_vacaciones/

# Stage 2: Servidor nginx para servir la aplicación
FROM nginx:alpine

# Copiar los archivos compilados al directorio de nginx
COPY --from=build /app/dist/app-vacaciones /usr/share/nginx/html/app_vacaciones

# Copiar la plantilla de configuración de nginx (Nginx oficial las procesa automáticamente)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Exponer el puerto 80
EXPOSE 80

# Iniciar nginx en primer plano
CMD ["nginx", "-g", "daemon off;"]
