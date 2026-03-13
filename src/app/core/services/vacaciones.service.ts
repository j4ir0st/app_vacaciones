import { Injectable } from '@angular/core';
import { SolicitudVacaciones, ResumenVacaciones, EstadoSolicitud } from '../models/solicitud-vacaciones.model';

// Días de vacaciones acumulados por mes trabajado
const DIAS_POR_MES = 2.5;

@Injectable({
    providedIn: 'root'
})
export class VacacionesService {

    // Calcula el total de días acumulados desde la fecha de ingreso
    calcularDiasAcumulados(fechaIngreso: string): number {
        if (!fechaIngreso) return 0;
        const hoy = new Date();
        const inicio = new Date(fechaIngreso);
        const meses = this.calcularMesesTranscurridos(inicio, hoy);
        return Math.floor(meses) * DIAS_POR_MES;
    }

    // Calcula los días truncos (correspondientes a la fracción de mes no completada)
    calcularDiasTruncos(fechaIngreso: string): number {
        if (!fechaIngreso) return 0;
        const hoy = new Date();
        const inicio = new Date(fechaIngreso);
        const mesesTotales = this.calcularMesesTranscurridos(inicio, hoy);
        const fraccionMes = mesesTotales - Math.floor(mesesTotales);
        return Math.round(fraccionMes * DIAS_POR_MES * 10) / 10; // Redondear a 1 decimal
    }

    // Calcula el resumen completo de vacaciones de un usuario
    calcularResumen(fechaIngreso: string, solicitudes: SolicitudVacaciones[]): ResumenVacaciones {
        const diasAcumulados = this.calcularDiasAcumulados(fechaIngreso);
        const diasTruncos = this.calcularDiasTruncos(fechaIngreso);

        const solicitudesAprobadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'AP');
        const solicitudesPendientes = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'PD');
        const solicitudesRechazadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'RC');

        const diasTomados = solicitudesAprobadas.reduce((total, s) => total + (s.total_periodo || 0), 0);
        const diasPendientes = Math.max(0, diasAcumulados - diasTomados);

        return {
            diasAcumulados,
            diasTomados,
            diasPendientes,
            diasTruncos,
            solicitudesAprobadas: solicitudesAprobadas.length,
            solicitudesPendientes: solicitudesPendientes.length,
            solicitudesRechazadas: solicitudesRechazadas.length,
        };
    }

    // Calcula la cantidad de días naturales entre dos fechas (incluyendo fines de semana y feriados)
    // El cálculo es inclusivo, por lo que suma 1 al final para contar el día de inicio
    calcularDiasNaturales(fechaInicio: Date, fechaFin: Date): number {
        const milisegundosPorDia = 1000 * 60 * 60 * 24;
        const diferenciaMilisegundos = Math.abs(fechaFin.getTime() - fechaInicio.getTime());
        return Math.floor(diferenciaMilisegundos / milisegundosPorDia) + 1;
    }

    // Método para mantener la compatibilidad con el código anterior que buscaba "días hábiles"
    // Actualmente la política de la empresa considera días naturales
    calcularDiasHabiles(fechaInicio: Date, fechaFin: Date): number {
        return this.calcularDiasNaturales(fechaInicio, fechaFin);
    }

    // Calcula la fecha de finalización dada una fecha de inicio y el número de días a tomar
    // IMPORTANTE: El primer día de vacaciones es el mismo día de inicio, por eso se resta 1 a los días totales
    calcularFechaFinal(fechaInicio: Date, cantidadDias: number): Date {
        if (cantidadDias <= 0) return new Date(fechaInicio);
        const fechaCalculada = new Date(fechaInicio);
        // Si el usuario toma 1 día el 01/02, la fecha fin es el mismo 01/02
        fechaCalculada.setDate(fechaCalculada.getDate() + (cantidadDias - 1));
        return fechaCalculada;
    }

    // Formatea una fecha en español (ej: "12 marzo")
    formatearFecha(fecha: string): string {
        if (!fecha) return '';
        const opciones: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' };
        return new Date(fecha + 'T00:00:00Z').toLocaleDateString('es-PE', opciones);
    }

    // Formatea el rango de fechas de una solicitud
    formatearRangoFechas(inicio: string, fin: string): string {
        return `${this.formatearFecha(inicio)} - ${this.formatearFecha(fin)}`;
    }

    // Calcula los meses transcurridos entre dos fechas (con fracción)
    private calcularMesesTranscurridos(inicio: Date, fin: Date): number {
        const años = fin.getFullYear() - inicio.getFullYear();
        const meses = fin.getMonth() - inicio.getMonth();
        const dias = fin.getDate() - inicio.getDate();
        const mesesCompletos = años * 12 + meses + (dias < 0 ? -1 : 0);
        const diasEnMes = 30; // Aproximación estándar
        const fraccion = dias < 0
            ? (diasEnMes + dias) / diasEnMes
            : dias / diasEnMes;
        return mesesCompletos + fraccion;
    }

    // Formatea una fecha como "Día Mes" (ej: 10 mar)
    formatearFechaCorta(fecha: string): string {
        if (!fecha) return '';
        const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const d = new Date(fecha);
        // Usamos UTC para evitar desfases de zona horaria si la fecha viene YYYY-MM-DD
        const dia = d.getUTCDate();
        const mes = meses[d.getUTCMonth()];
        return `${dia} ${mes}`;
    }

    /**
     * Extrae el código (sigla) del objeto de estado.
     * Ejemplo: de { "PD": "Pendiente" } extrae "PD".
     */
    obtenerCodigoEstado(estado: EstadoSolicitud | undefined): string {
        if (!estado) return '';
        if (typeof estado === 'string') return estado;
        return Object.keys(estado)[0] || '';
    }

    /**
     * Extrae la descripción (valor) del objeto de estado.
     * Ejemplo: de { "PD": "Pendiente" } extrae "Pendiente".
     */
    obtenerLabelEstado(estado: EstadoSolicitud | undefined): string {
        if (!estado) return '';
        if (typeof estado === 'string') return estado;
        return Object.values(estado)[0] || '';
    }
}
