// Modelo de Solicitud de Vacaciones - corresponde a la tabla SolicitudVacaciones de la API DRF
// El estado ahora es un objeto: { "PD": "Pendiente" }
export type EstadoSolicitud = { [key: string]: string } | string;
export type TipoSolicitud = 'Autorizada' | 'Adelanto';

export interface SolicitudVacaciones {
    url: string;    // url de la solicitud de Vacaciones.
    usuario_id: {
        fullname: string;
        avatar: string;
    } | string;        // Ahora es un objeto con datos del usuario, pero mantenemos string por compatibilidad si es necesario.
    fecha_solicitud?: string; // Fecha en la que se envió la solicitud.
    fecha_inicio: string;   // Fecha de inicio de vacaciones (YYYY-MM-DD).
    fecha_final: string;      // Fecha de fin de vacaciones (YYYY-MM-DD).
    total_periodo: number;           // Cantidad de días hábiles solicitados.
    area_id: string; // Nombre del área (serializado del backend)
    motivo: string;         // Motivo o descripción de la solicitud.
    tipo_solicitud: TipoSolicitud;    // Tipo de Solicitud del pedido de Vacaciones. 
    // AT=Autorizada - AD=Adelanto
    estado_solicitud: EstadoSolicitud;    // Estado de la solicitud. 
    // AP=Aprobado - RC=Rechazado - PD=Pendiente - AS=Aprobado por Supervisor - CN=Cancelado.
    jefe_id: string;  //'url del Jefe que aprueba la solicitud de Vacaciones.
    fecha_jefe: string;  //'Fecha y Hora en la que el Jefe aprobó la solicitud de Vacaciones.
    gerente_id: string;  //'url del Gerente que aprueba la solicitud de Vacaciones.
    fecha_gerente: string;  //'Fecha y Hora en la que el Gerente aprobó la solicitud.
    obs: string;  //'Observaciones del Jefe o Gerente.
}

// Resumen estadístico de vacaciones de un usuario
export interface ResumenVacaciones {
    diasAcumulados: number;     // Total de días ganados (2.5 días/mes)
    diasTomados: number;        // Días en solicitudes aprobadas
    diasPendientes: number;     // Días disponibles para tomar
    diasTruncos: number;        // Fracción de mes en curso
    solicitudesAprobadas: number;
    solicitudesPendientes: number;
    solicitudesRechazadas: number;
}
