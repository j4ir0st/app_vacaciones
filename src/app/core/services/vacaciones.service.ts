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
        let diasTruncosCalc = 0;
        if (diasPendientesPotencial > 0) {
            diasTruncosCalc = remanenteAnual;
        } else {
            diasTruncosCalc = remanenteAnual + diasPendientesPotencial;
        }

        return {
            diasAcumulados: diasAcumuladosReferencia,
            diasTomados,
            diasPendientes: Math.max(0, diasPendientesPotencial),
            diasTruncos: Math.max(0, diasTruncosCalc),
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

    // Formatea una fecha en español (ej: "12 marzo 2026")
    formatearFecha(fecha: string): string {
        if (!fecha) return '';
        const opciones: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
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
        const d = new Date(fecha.includes('T') ? fecha : fecha + 'T00:00:00');
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const anio = d.getFullYear();
        return `${dia}/${mes}/${anio}`;
    }

    // Nuevo: dd/mm/yyyy hh:mm:ss (am/pm)
    // Se ignora el offset del backend para tratar la hora como local directa
    formatearFechaHora(fecha: string): string {
        if (!fecha) return '';
        
        // Extraemos solo la parte YYYY-MM-DDTHH:mm:ss ignorando milisegundos y offset
        const match = fecha.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        const fechaLimpia = match ? match[1] : fecha;
        
        const d = new Date(fechaLimpia);
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const anio = d.getFullYear();
        
        let horas = d.getHours();
        const ampm = horas >= 12 ? 'pm' : 'am';
        horas = horas % 12;
        horas = horas ? horas : 12; 
        const hStr = String(horas).padStart(2, '0');
        const mStr = String(d.getMinutes()).padStart(2, '0');
        const sStr = String(d.getSeconds()).padStart(2, '0');

        return `${dia}/${mes}/${anio} ${hStr}:${mStr}:${sStr} (${ampm})`;
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

    /**
     * Verifica si una fecha en formato YYYY-MM-DD es posterior a la fecha actual (hoy).
     * @param fecha Cadena de fecha en formato ISO (YYYY-MM-DD)
     * @returns true si la fecha es estrictamente mayor que hoy
     */
    esFechaFutura(fecha: string): boolean {
        if (!fecha) return false;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        // Usamos T00:00:00 para asegurar que se interprete en la zona horaria local o consistente
        const fInicio = new Date(fecha + 'T00:00:00');
        return fInicio > hoy;
    }

    /**
     * Calcula las sugerencias de programación de vacaciones (Prog. 1, 2, 3)
     * basándose en los días pendientes y la fecha de ingreso.
     */
    calcularSugerenciasProgramacion(diasPendientes: number, fechaIngreso: string): { prog1: string, prog2: string, prog3: string } {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Validamos la fecha de ingreso
        if (!fechaIngreso || diasPendientes <= 0) return { prog1: '-', prog2: '-', prog3: '-' };

        // 1. Calcular Fecha Límite (Aniversario del año actual o siguiente)
        const fIngreso = new Date(fechaIngreso + 'T00:00:00');
        let fDeadline = new Date(fIngreso);
        fDeadline.setFullYear(hoy.getFullYear());
        fDeadline.setHours(0, 0, 0, 0);

        if (fDeadline < hoy) {
            fDeadline.setFullYear(fDeadline.getFullYear() + 1);
        }

        // 2. Determinar número de segmentos (n)
        let n = 1;
        if (diasPendientes > 30) {
            n = 3;
        } else if (diasPendientes > 15) {
            n = 2;
        }

        // 3. Calcular puntos de corte temporales
        const diffMs = fDeadline.getTime() - hoy.getTime();
        const intervalo = diffMs / n;

        const f0 = hoy;
        const f1 = new Date(hoy.getTime() + intervalo);
        const f2 = new Date(hoy.getTime() + 2 * intervalo);
        const f3 = fDeadline;

        const formatear = (d: Date) => {
            const dia = String(d.getDate()).padStart(2, '0');
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            const anio = d.getFullYear();
            return `${dia}/${mes}/${anio}`;
        };

        let prog1 = "-";
        let prog2 = "-";
        let prog3 = "-";

        if (n === 1) {
            // Un solo bloque (Prog 3)
            prog3 = `Programar ${diasPendientes} dias entre el ${formatear(f0)} y el ${formatear(f3)}`;
        } else if (n === 2) {
            // Dos bloques (Prog 2 y 3)
            const diasP3 = 15;
            const diasP2 = diasPendientes - 15;
            prog2 = `Programar ${diasP2} dias entre el ${formatear(f0)} y el ${formatear(f1)}`;
            prog3 = `Programar ${diasP3} dias entre el ${formatear(f1)} y el ${formatear(f3)}`;
        } else if (n === 3) {
            // Tres bloques (Prog 1, 2 y 3)
            const diasP1 = Math.ceil(diasPendientes / 3);
            const diasP2 = Math.floor(diasPendientes / 3);
            const diasP3 = Math.floor(diasPendientes / 3);
            prog1 = `Programar ${diasP1} dias entre el ${formatear(f0)} y el ${formatear(f1)}`;
            prog2 = `Programar ${diasP2} dias entre el ${formatear(f1)} y el ${formatear(f2)}`;
            prog3 = `Programar ${diasP3} dias entre el ${formatear(f2)} y el ${formatear(f3)}`;
        }

        return { prog1, prog2, prog3 };
    }
}
