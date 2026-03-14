import { Component, OnInit } from '@angular/core';
import { forkJoin, EMPTY } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { AreaService } from '../core/services/area.service';
import { AuthService } from '../core/services/auth.service';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';
import { Usuario } from '../core/models/usuario.model';
import { Area } from '../core/models/area.model';
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

    // Filtros
    areasFiltradas: string[] = [];
    usuariosFiltrados: Usuario[] = [];
    areaSeleccionada: string = '';
    usuarioSeleccionado: string = '';

    // Datos maestros
    private todasSolicitudes: SolicitudVacaciones[] = [];
    private todosUsuarios: Usuario[] = [];
    private todasAreas: Area[] = [];

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
        public vacacionesService: VacacionesService,
        private areaService: AreaService,
        private authService: AuthService
    ) { }

    ngOnInit(): void {
        this.cargarEventos();
    }

    // Carga inicial de datos: áreas, y luego usuarios y solicitudes (con recursión de páginas)
    cargarEventos(): void {
        this.cargando = true;

        this.areaService.obtenerAreas().subscribe({
            next: (areasRes: Area[]) => {
                this.todasAreas = areasRes;
                this.configurarFiltrosIniciales();
                this.cargarUsuariosYSolicitudes();
            },
            error: () => this.cargando = false
        });
    }

    private configurarFiltrosIniciales(): void {
        const usuActual = this.authService.usuarioActual;
        if (!usuActual) return;

        const puesto = usuActual.puesto_id?.nombre;
        const areaUsu = usuActual.area_id?.nombre;
        const nombreUsu = this.authService.nombreCompleto;

        // Determinar Áreas Visibles (según fórmulas PowerApps)
        if (puesto === 'Gerente' || puesto === 'Jefe') {
            if (areaUsu === 'Operaciones') {
                this.areasFiltradas = ["Gerencia", "Desarrollo Software", "Logística Inversa", "Atenciones", "Distribución", "Almacenes", "Facturación"];
            } else if (nombreUsu === 'Katherine Lewis') {
                this.areasFiltradas = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else {
                this.areasFiltradas = [areaUsu || ''];
            }
        } else {
            this.areasFiltradas = [areaUsu || ''];
        }

        // Si solo hay un área, seleccionarla por defecto
        if (this.areasFiltradas.length === 1) {
            this.areaSeleccionada = this.areasFiltradas[0];
        }
    }

    private cargarUsuariosYSolicitudes(): void {
        const areasQuery = this.areasFiltradas.join(',');

        // 1. Cargar Usuarios Filtrados por Área
        this.usuarioService.obtenerUsuariosPorNombreArea(areasQuery).subscribe({
            next: (usuariosRes: Usuario[]) => {
                this.todosUsuarios = Array.isArray(usuariosRes) ? usuariosRes : ((usuariosRes as any).results || []);
                
                const usuActual = this.authService.usuarioActual;
                if (usuActual && this.authService.nombreCompleto === 'Katherine Lewis') {
                     this.usuariosFiltrados = this.todosUsuarios.filter(u => 
                        this.areasFiltradas.includes(u.area_id?.nombre || u.area)
                    );
                } else {
                    this.usuariosFiltrados = this.todosUsuarios;
                }

                // 2. Cargar TODAS las páginas de solicitudes de forma recursiva
                this.cargarTodasLasSolicitudes();
            },
            error: () => { this.cargando = false; }
        });
    }

    private cargarTodasLasSolicitudes(): void {
        this.solicitudService.obtenerSolicitudes().pipe(
            expand(resp => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map(resp => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc, curr) => [...acc, ...curr], [] as SolicitudVacaciones[])
        ).subscribe({
            next: (todas: SolicitudVacaciones[]) => {
                this.todasSolicitudes = todas;
                this.actualizarCalendario();
                this.cargando = false;
            },
            error: (err) => {
                console.error('Error cargando solicitudes:', err);
                this.cargando = false;
            }
        });
    }

    // Getter para el dropdown de usuarios (se filtra por el área seleccionada si existe)
    get usuariosParaDropdown(): Usuario[] {
        if (!this.areaSeleccionada) return this.usuariosFiltrados;
        return this.usuariosFiltrados.filter(u => (u.area_id?.nombre || u.area) === this.areaSeleccionada);
    }

    // Filtra y actualiza los eventos en el calendario
    actualizarCalendario(): void {
        const mapaUsuarios = new Map<string, Usuario>(this.todosUsuarios.map(u => [u.url, u]));
        const mapaColores = new Map<string, string>();

        // Asignar colores únicos por usuario
        let indiceColor = 0;
        this.todosUsuarios.forEach(u => {
            mapaColores.set(u.url, COLORES_CALENDARIO[indiceColor % COLORES_CALENDARIO.length]);
            indiceColor++;
        });

        const eventos: EventInput[] = this.todasSolicitudes
            .filter((s: SolicitudVacaciones) => {
                // Solo aprobadas
                if (this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) !== 'AP') return false;
                
                const usu = mapaUsuarios.get(s.usuario_id || '');
                if (!usu) return false;

                // Filtro por usuario seleccionado
                if (this.usuarioSeleccionado && usu.url !== this.usuarioSeleccionado) return false;

                // Filtro por área seleccionada
                if (this.areaSeleccionada && (usu.area_id?.nombre || usu.area) !== this.areaSeleccionada) return false;

                // Si no hay filtros directos, solo mostramos usuarios permitidos por la carga inicial
                return this.usuariosFiltrados.some(uf => uf.url === usu.url);
            })
            .map((s: SolicitudVacaciones) => {
                const usuarioCal = mapaUsuarios.get(s.usuario_id || '');
                const nombreCompleto = usuarioCal
                    ? `${usuarioCal.first_name} ${usuarioCal.last_name}`.trim() || usuarioCal.username
                    : 'Usuario';

                const fechaFinVisual = new Date(s.fecha_final);
                fechaFinVisual.setDate(fechaFinVisual.getDate() + 1);

                return {
                    id: String(s.url),
                    title: `${this.usuarioService.nombreCompleto(usuarioCal!)} (${s.total_periodo}d)`,
                    start: s.fecha_inicio,
                    end: fechaFinVisual.toISOString().split('T')[0],
                    backgroundColor: mapaColores.get(s.usuario_id || '') || '#c41e3a',
                    borderColor: 'transparent',
                    extendedProps: { solicitud: s, nombreCompleto }
                };
            });

        this.opcionesCalendario = { 
            ...this.opcionesCalendario, 
            events: eventos,
            height: '100%'
        };
    }

    // Eventos de cambio en filtros
    onAreaChange(): void {
        this.usuarioSeleccionado = ''; // Resetear usuario al cambiar área
        this.actualizarCalendario();
    }

    onUsuarioChange(): void {
        this.actualizarCalendario();
    }

    limpiarFiltros(): void {
        this.areaSeleccionada = this.areasFiltradas.length === 1 ? this.areasFiltradas[0] : '';
        this.usuarioSeleccionado = '';
        this.actualizarCalendario();
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
