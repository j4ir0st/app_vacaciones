import { Injectable } from '@angular/core';
import { SolicitudVacaciones, EstadoSolicitud, ResumenVacaciones } from '../models/solicitud-vacaciones.model';

export type { ResumenVacaciones }; 

@Injectable({
    providedIn: 'root'
})
export class VacacionesService {

    // Calcula el resumen completo de vacaciones de un usuario basado en fórmulas de PowerApps
    calcularResumen(fechaIngreso: string, solicitudes: SolicitudVacaciones[]): ResumenVacaciones {
        if (!fechaIngreso) {
            return {
                diasAcumulados: 0, diasTomados: 0, diasPendientes: 0, diasTruncos: 0,
                solicitudesAprobadas: 0, solicitudesPendientes: 0, solicitudesRechazadas: 0
            };
        }

        const hoy = new Date();
        const ingreso = new Date(fechaIngreso);
        
        // 1. MesesCumplidos
        let mesesCompletos = (hoy.getFullYear() - ingreso.getFullYear()) * 12 + (hoy.getMonth() - ingreso.getMonth());
        if (hoy.getDate() < ingreso.getDate()) {
            mesesCompletos--;
        }
        const mesesCumplidos = Math.max(0, mesesCompletos);

        // 2. DiasAcumulados (Total acumulado histórico por meses cumplidos)
        const diasAcumuladosReferencia = mesesCumplidos * 2.5;

        // 3. DiasGozados (Suma de TOTAL_PERIODO de solicitudes Aprobadas)
        const solicitudesAprobadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'AP');
        const solicitudesPendientes = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'PD');
        const solicitudesRechazadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'RC');
        
        const diasTomados = solicitudesAprobadas.reduce((total, s) => total + (s.total_periodo || 0), 0);

        // 4. DiasPendientes (Días de años completos menos lo gozado)
        const diasDeAniosCompletos = Math.floor(diasAcumuladosReferencia / 30) * 30;
        const diasPendientesPotencial = diasDeAniosCompletos - diasTomados;
        const diasPendientesDisplay = Math.max(0, diasPendientesPotencial);

        // 5. DiasTruncos (Resto de días acumulados en el año actual, ajustado si se tomó de más)
        const remanenteAnual = diasAcumuladosReferencia % 30;
        let diasTruncos = 0;
        if (diasPendientesPotencial > 0) {
            diasTruncos = remanenteAnual;
        } else {
            diasTruncos = remanenteAnual + diasPendientesPotencial;
        }

        return {
            diasAcumulados: diasAcumuladosReferencia,
            diasTomados,
            diasPendientes: diasPendientesPotencial,
            diasTruncos: Math.max(0, diasTruncos),
            solicitudesAprobadas: solicitudesAprobadas.length,
            solicitudesPendientes: solicitudesPendientes.length,
            solicitudesRechazadas: solicitudesRechazadas.length,
        };
    }

    // Calcula la cantidad de días naturales entre dos fechas
    calcularDiasNaturales(fechaInicio: Date, fechaFin: Date): number {
        const milisegundosPorDia = 1000 * 60 * 60 * 24;
        const diferenciaMilisegundos = Math.abs(fechaFin.getTime() - fechaInicio.getTime());
        return Math.floor(diferenciaMilisegundos / milisegundosPorDia) + 1;
    }

    calcularDiasHabiles(fechaInicio: Date, fechaFin: Date): number {
        return this.calcularDiasNaturales(fechaInicio, fechaFin);
    }

    calcularFechaFinal(fechaInicio: Date, cantidadDias: number): Date {
        if (cantidadDias <= 0) return new Date(fechaInicio);
        const fechaCalculada = new Date(fechaInicio);
        fechaCalculada.setDate(fechaCalculada.getDate() + (cantidadDias - 1));
        return fechaCalculada;
    }

    // Formatea una fecha en español (ej: "12 marzo")
    formatearFecha(fecha: string): string {
        if (!fecha) return '';
        const opciones: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' };
        // Si ya es una fecha ISO completa (contiene T), no le agregamos el sufijo de medianoche UTC
        const dateObj = fecha.includes('T') ? new Date(fecha) : new Date(fecha + 'T00:00:00Z');
        return dateObj.toLocaleDateString('es-PE', opciones);
    }

    formatearRangoFechas(inicio: string, fin: string): string {
        return `${this.formatearFecha(inicio)} - ${this.formatearFecha(fin)}`;
    }

    formatearFechaCorta(fecha: string): string {
        if (!fecha) return '';
        const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const d = new Date(fecha);
        const dia = d.getUTCDate();
        const mes = meses[d.getUTCMonth()];
        return `${dia} ${mes}`;
    }

    formatearFechaCompleta(fecha: string): string {
        if (!fecha) return '';
        const d = new Date(fecha.includes('T') ? fecha : fecha + 'T00:00:00Z');
        const dia = String(d.getUTCDate()).padStart(2, '0');
        const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
        const anio = d.getUTCFullYear();
        return `${dia}/${mes}/${anio}`;
    }

    obtenerCodigoEstado(estado: EstadoSolicitud | undefined): string {
        if (!estado) return '';
        if (typeof estado === 'string') return estado;
        return Object.keys(estado)[0] || '';
    }

    obtenerLabelEstado(estado: EstadoSolicitud | undefined): string {
        if (!estado) return '';
        if (typeof estado === 'string') return estado;
        return Object.values(estado)[0] || '';
    }
}
