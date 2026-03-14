import { Injectable } from '@angular/core';
import { SolicitudVacaciones, ResumenVacaciones, EstadoSolicitud } from '../models/solicitud-vacaciones.model';

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
        // Set(MesesCumplidos; DateDiff(varUserRecord.FECHA_INGRESO; Today(); TimeUnit.Months) - If(Day(Today()) < Day(varUserRecord.FECHA_INGRESO); 1; 0))
        let mesesCompletos = (hoy.getFullYear() - ingreso.getFullYear()) * 12 + (hoy.getMonth() - ingreso.getMonth());
        if (hoy.getDate() < ingreso.getDate()) {
            mesesCompletos--;
        }
        const mesesCumplidos = Math.max(0, mesesCompletos);

        // 2. DiasAcumulados (Total acumulado histórico por meses cumplidos)
        // Set(DiasAcumulados; Max(MesesCumplidos;0) * 2,5)
        const diasAcumuladosReferencia = mesesCumplidos * 2.5;

        // 3. DiasGozados (Suma de TOTAL_PERIODO de solicitudes Aprobadas)
        const solicitudesAprobadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'AP');
        const solicitudesPendientes = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'PD');
        const solicitudesRechazadas = solicitudes.filter(s => this.obtenerCodigoEstado(s.estado_solicitud) === 'RC');
        
        const diasTomados = solicitudesAprobadas.reduce((total, s) => total + (s.total_periodo || 0), 0);

        // 4. DiasPendientes (Días de años completos menos lo gozado)
        // Set(DiasPendientes; With({acum: DiasAcumulados; goz: DiasGozados}; Int(acum / 30) * 30 - goz))
        const diasDeAniosCompletos = Math.floor(diasAcumuladosReferencia / 30) * 30;
        const diasPendientesPotencial = diasDeAniosCompletos - diasTomados;
        const diasPendientesDisplay = Math.max(0, diasPendientesPotencial);

        // 5. DiasTruncos (Resto de días acumulados en el año actual, ajustado si se tomó de más)
        // Set(DiasTruncos; If(DiasPendientes > 0; Mod(DiasAcumulados; 30); Mod(DiasAcumulados;30) + DiasPendientes))
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
            diasTruncos: Math.max(0, diasTruncos), // Aseguramos que truncos tampoco sea negativo
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
