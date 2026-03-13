import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';
import { Usuario } from '../core/models/usuario.model';
import { CalendarOptions, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';

// Colores para distinguir usuarios en el calendario
const COLORES_CALENDARIO = [
    '#1a73e8', '#c41e3a', '#2d7a3a', '#f59300', '#8e44ad',
    '#00bcd4', '#e91e63', '#607d8b', '#ff5722', '#4caf50'
];

@Component({
    selector: 'app-calendario',
    templateUrl: './calendario.component.html',
    styleUrls: ['./calendario.component.css'],
    standalone: false
})
export class CalendarioComponent implements OnInit {
    cargando = true;

    // Configuración del calendario FullCalendar
    opcionesCalendario: CalendarOptions = {
        plugins: [dayGridPlugin, interactionPlugin],
        initialView: 'dayGridMonth',
        locale: esLocale,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana'
        },
        events: [],
        eventDisplay: 'block',
        height: 'auto',
        eventClick: (info: any) => this.mostrarDetalleEvento(info.event),
    };

    // Detalle del evento seleccionado
    eventoSeleccionado: any = null;

    constructor(
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService
    ) { }

    ngOnInit(): void {
        this.cargarEventos();
    }

    // Carga las solicitudes aprobadas y las convierte en eventos del calendario
    cargarEventos(): void {
        this.cargando = true;

        forkJoin({
            solicitudes: this.solicitudService.obtenerSolicitudes(),
            usuarios: this.usuarioService.obtenerUsuarios()
        }).subscribe({
            next: ({ solicitudes, usuarios }) => {
                const mapaUsuarios = new Map<string, Usuario>(usuarios.map(u => [u.url, u]));
                const mapaColores = new Map<string, string>();

                // Asignar colores únicos por usuario
                let indiceColor = 0;
                usuarios.forEach(u => {
                    mapaColores.set(u.url, COLORES_CALENDARIO[indiceColor % COLORES_CALENDARIO.length]);
                    indiceColor++;
                });

                // Manejar tanto arrays directos como objetos de paginación de DRF
                const listaSolicitudes: SolicitudVacaciones[] = Array.isArray(solicitudes) ? solicitudes : (solicitudes.results || []);

                const eventos: EventInput[] = listaSolicitudes
                    .filter((s: SolicitudVacaciones) => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP')
                    .map((s: SolicitudVacaciones) => {
                        const usuarioCal = mapaUsuarios.get(s.usuario_id || '');
                        const nombreCompleto = usuarioCal
                            ? `${usuarioCal.first_name} ${usuarioCal.last_name}`.trim() || usuarioCal.username
                            : 'Usuario';

                        // IMPORTANTE: FullCalendar trata la fecha de fin como exclusiva.
                        // Para que el bloque de color cubra el último día, sumamos +1 a la fecha de fin real.
                        const fechaFinVisual = new Date(s.fecha_final);
                        fechaFinVisual.setDate(fechaFinVisual.getDate() + 1);

                        return {
                            id: String(s.url),
                            title: `${nombreCompleto} (${s.total_periodo}d)`,
                            start: s.fecha_inicio,
                            end: fechaFinVisual.toISOString().split('T')[0],
                            backgroundColor: mapaColores.get(s.usuario_id || '') || '#c41e3a',
                            borderColor: 'transparent',
                            extendedProps: { solicitud: s, nombreCompleto }
                        };
                    });

                this.opcionesCalendario = { ...this.opcionesCalendario, events: eventos };
                this.cargando = false;
            },
            error: () => { this.cargando = false; }
        });
    }

    // Muestra el detalle de un evento al hacer clic
    private mostrarDetalleEvento(evento: any): void {
        const solicitud = evento.extendedProps?.solicitud;
        if (solicitud) {
            this.eventoSeleccionado = {
                nombre: evento.extendedProps.nombreCompleto,
                inicio: solicitud.fecha_inicio,
                fin: solicitud.fecha_final,
                total_periodo: solicitud.total_periodo,
                motivo: solicitud.motivo,
                color: evento.backgroundColor
            };
        }
    }
}
