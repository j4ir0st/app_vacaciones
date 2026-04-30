# AppVacaciones - Sistema de Gestión de Vacaciones

Este proyecto es una aplicación web SPA (Single Page Application) desarrollada con **Angular** para la gestión y administración de solicitudes de vacaciones. Permite a los empleados realizar solicitudes, ver su estado de días (acumulados, tomados, truncos) y a los administradores/jefes gestionar las aprobaciones.

## 🚀 Características Principales

- **Dashboard Informativo**: Resumen de días de vacaciones y visualización de próximas salidas del equipo.
- **Gestión de Solicitudes**: Formulario intuitivo de 3 pasos para crear nuevas solicitudes.
- **Panel Administrativo**: Herramientas para jefes y gerentes para aprobar/rechazar solicitudes y gestionar usuarios.
- **Calendario Integrado**: Visualización gráfica de los periodos de vacaciones.
- **Diseño Premium**: Interfaz moderna, funcional y responsiva, siguiendo los lineamientos estéticos de Surgicorp.

## 🛠️ Arquitectura y Tecnologías

- **Frontend**: Angular 19+ (Componentes, Servicios, RxJS para reactividad).
- **Estilos**: Vanilla CSS con variables para personalización de temas.
- **Seguridad**: Autenticación basada en JWT con interceptores para manejo de tokens.
- **Despliegue**: Dockerizado con Nginx como servidor y proxy inverso.

## 📁 Estructura del Proyecto

```text
src/app/
├── core/           # Servicios globales, interceptores, guards y modelos
├── shared/         # Componentes comunes (Header, Navbar, Diálogos)
├── auth/           # Módulo de autenticación (Login)
├── dashboard/      # Panel principal y widgets
├── mis-solicitudes/# Gestión de solicitudes propias
└── admin/          # Panel de administración de jefes/gerentes
```

## 🐳 Despliegue con Docker

El proyecto está configurado para ejecutarse en contenedores Docker mediante una construcción multi-etapa para optimizar el tamaño de la imagen.

### Requisitos previos
- Docker y Docker Compose instalados.

### Instrucciones para levantar el proyecto

1.  **Clonar el repositorio**:
    ```bash
    git clone https://github.com/j4ir0st/app_vacaciones.git
    cd app_vacaciones
    ```

2.  **Configurar variables de entorno**:
    Crea un archivo `.env` basado en `.env.example` para configurar la URL del backend.

3.  **Levantar con Docker Compose**:
    ```bash
    docker-compose up -d --build
    ```
    La aplicación estará disponible en `http://localhost:8005/app_vacaciones/`.

## ⚙️ Configuración del Proxy

Para evitar problemas de CORS y centralizar las llamadas a la API, se utiliza un proxy inverso tanto en desarrollo (Angular Proxy) como en producción (Nginx). Asegúrate de configurar la URL correcta de tu API en el archivo de configuración correspondiente o mediante variables de entorno en el contenedor.

---
© 2026 - Desarrollado por j4ir0st

## 📝 Notas de Implementación

### Lógica de Días Programados (Reportes)
A partir del 30 de abril de 2026, la columna **Días Programados** en el módulo de reportes sigue la siguiente lógica:
- Suma los días de solicitudes en estado **Aprobado (AP)** o **Aprobado Supervisor (AS)**.
- Solo se consideran solicitudes cuya **fecha de inicio sea posterior a la fecha actual** (hoy).
- Se excluyen las solicitudes en estado Pendiente (PD) de esta columna específica para reflejar solo días confirmados o en proceso avanzado de aprobación.
