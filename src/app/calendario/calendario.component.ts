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
        // Usar la lógica centralizada de permisos para el calendario
        this.areasFiltradas = this.authService.getAreasVisibles();

        // Si solo hay un área, seleccionarla por defecto
        if (this.areasFiltradas.length === 1) {
            this.areaSeleccionada = this.areasFiltradas[0];
        } else {
            // Si tiene varias áreas pero ninguna seleccionada, mostramos todas (o la primera)
            this.areaSeleccionada = ''; 
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
        const areasVisibles = this.authService.getAreasVisibles();
        const paramsArea = this.solicitudService.obtenerFiltroArea(areasVisibles);

        this.solicitudService.obtenerSolicitudes(this.solicitudService.URL_SOLICITUDES, paramsArea).pipe(
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
        const areaFiltro = this.areaSeleccionada.trim().toLowerCase();
        return this.usuariosFiltrados.filter(u => {
            const areaU = (u.area_id?.nombre || u.area || '').trim().toLowerCase();
            return areaU === areaFiltro;
        });
    }

    // Filtra y actualiza los eventos en el calendario
    actualizarCalendario(): void {
        const mapaUsuarios = new Map<string, Usuario>(this.todosUsuarios.map(u => [u.url, u]));
        const mapaUsuariosPorNombre = new Map<string, Usuario>(
            this.todosUsuarios.map(u => [`${u.first_name} ${u.last_name}`.trim().toLowerCase(), u])
        );
        const mapaColores = new Map<string, string>();

        // Asignar colores únicos por usuario
        let indiceColor = 0;
        this.todosUsuarios.forEach(u => {
            mapaColores.set(u.url, COLORES_CALENDARIO[indiceColor % COLORES_CALENDARIO.length]);
            indiceColor++;
        });

        const eventos: EventInput[] = this.todasSolicitudes
            .filter((s: SolicitudVacaciones) => {
                // 1. Filtrar por estado (Solo Aprobadas)
                if (this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) !== 'AP') return false;
                
                const areaFiltro = (this.areaSeleccionada || '').trim().toLowerCase();
                const usuarioFiltro = this.usuarioSeleccionado || '';

                // Identificar área de la solicitud
                const areaSoliRaw = typeof s.area_id === 'string' ? s.area_id : (s as any).area_nombre || '';
                const areaFinal = areaSoliRaw.trim().toLowerCase();

                // 2. Filtro por Área (si hay una seleccionada)
                if (areaFiltro && areaFinal !== areaFiltro) return false;

                // 3. Filtro por Usuario (si hay uno seleccionado)
                if (usuarioFiltro) {
                    const usuSeleccionadoObj = mapaUsuarios.get(usuarioFiltro);
                    // Obtenemos el nombre del objeto de la base de datos (dropdown)
                    const nombreFiltroNormalized = usuSeleccionadoObj 
                        ? `${usuSeleccionadoObj.first_name} ${usuSeleccionadoObj.last_name}`.trim().toLowerCase() 
                        : '';
                    
                    let urlEnSoli = '';
                    let nombreEnSoli = '';

                    // Obtenemos el nombre/url que viene en la solicitud (backend)
                    if (typeof s.usuario_id === 'string') {
                        urlEnSoli = s.usuario_id;
                        const usuEnSoli = mapaUsuarios.get(s.usuario_id);
                        nombreEnSoli = usuEnSoli ? `${usuEnSoli.first_name} ${usuEnSoli.last_name}`.trim().toLowerCase() : '';
                    } else if (s.usuario_id && typeof s.usuario_id === 'object') {
                        nombreEnSoli = (s.usuario_id.fullname || '').trim().toLowerCase();
                    }

                    // Intentamos coincidencia por URL
                    const matchUrl = urlEnSoli && urlEnSoli === usuarioFiltro;
                    
                    // Intentamos coincidencia por Nombre con soporte para nombres parciales
                    // Esto resuelve casos como "Jairo Castillo" vs "Jairo Castillo Alcas"
                    const matchNombre = (nombreEnSoli && nombreFiltroNormalized) && (
                        nombreEnSoli.includes(nombreFiltroNormalized) || 
                        nombreFiltroNormalized.includes(nombreEnSoli)
                    );

                    if (!matchUrl && !matchNombre) return false;
                }

                return true;
            })
            .map((s: SolicitudVacaciones) => {
                let nombreCompleto = 'Usuario';
                let urlUsuario = '';

                if (typeof s.usuario_id === 'string') {
                    const usu = mapaUsuarios.get(s.usuario_id);
                    urlUsuario = s.usuario_id;
                    nombreCompleto = usu ? `${usu.first_name} ${usu.last_name}`.trim() || usu.username : 'Usuario';
                } else if (s.usuario_id && typeof s.usuario_id === 'object') {
                    nombreCompleto = s.usuario_id.fullname || 'Usuario';
                    const usuMatch = mapaUsuariosPorNombre.get(nombreCompleto.toLowerCase());
                    urlUsuario = usuMatch?.url || '';
                }

                const fechaFinVisual = new Date(s.fecha_final);
                fechaFinVisual.setDate(fechaFinVisual.getDate() + 1);

                return {
                    id: String(s.url),
                    title: `${nombreCompleto} (${s.total_periodo}d)`,
                    start: s.fecha_inicio,
                    end: fechaFinVisual.toISOString().split('T')[0],
                    backgroundColor: mapaColores.get(urlUsuario) || '#c41e3a',
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
        this.cargarEventos(); // Recargar todo del servidor
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
