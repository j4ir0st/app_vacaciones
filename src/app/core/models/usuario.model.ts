// Interfaz para objetos serializados que contienen URL y Nombre
export interface ObjetoSerializado {
    url: string;
    nombre: string;
}

// Modelo de Usuario - corresponde a la tabla users de la API DRF
export interface Usuario {
    id: number;           // ID numérico para filtrado eficiente
    url: string;          // Funciona como ID único del usuario
    username: string;
    area_puesto?: { area_nombre: string; puesto_nombre: string };
    first_name: string;
    last_name: string;
    email: string;
    groups: string[];     // Grupos de permisos del usuario
    area: string;         // Nombre del área (deprecated o para fallback)
    area_id: ObjetoSerializado;   // Objeto con URL y Nombre del área
    puesto_id: ObjetoSerializado; // Objeto con URL y Nombre del puesto
    empr_id: string;      // ID de la empresa (Surgicorp maneja 4 empresas)
    fecha_ingreso: string; // Fecha de ingreso para cálculo de vacaciones
    avatar: string | null; // Foto de perfil opcional
    is_staff: boolean;    // Acceso al panel admin (NO modificar)
    is_active: boolean;   // Estado activo/inactivo (desactivar en lugar de eliminar)
}

// Respuesta de la API al autenticarse
export interface RespuestaToken {
    access: string;       // Token de acceso JWT
    refresh: string;      // Token de refresco JWT
}

// Datos del usuario almacenados en sesión
export interface SesionUsuario {
    token: string;
    refresh: string;
    usuario: Usuario;
}
