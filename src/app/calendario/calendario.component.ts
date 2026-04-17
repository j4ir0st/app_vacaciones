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

    // Combobox de usuario
    textoBusquedaUsuario = '';
    mostrarResultadosUsuario = false;

    constructor(
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService,
        private areaService: AreaService,
        public authService: AuthService
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

    // Getter para el combobox buscador de usuarios (filtra por nombre/apellido y área activa)
    get usuariosBuscados(): Usuario[] {
        const base = this.usuariosParaDropdown.filter(u => u.is_active);
        const busqueda = this.textoBusquedaUsuario.toLowerCase().trim();
        if (!busqueda) return base;
        return base.filter(u => {
            const nombreCompleto = `${u.first_name} ${u.last_name}`.toLowerCase();
            return nombreCompleto.includes(busqueda);
        });
    }

    // Obtiene el nombre del usuario seleccionado para mostrar en el Combobox
    getNombreUsuarioSeleccionado(): string {
        if (!this.usuarioSeleccionado) return 'Filtrar por Usuario';
        const user = this.usuariosFiltrados.find(u => u.url === this.usuarioSeleccionado);
        return user ? `${user.first_name} ${user.last_name}` : 'Filtrar por Usuario';
    }

    // Selecciona un usuario del combobox
    seleccionarUsuarioCombobox(u: any): void {
        this.usuarioSeleccionado = u.url || '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
        this.actualizarCalendario();
    }

    // Limpia la selección de usuario
    limpiarSeleccionUsuario(): void {
        this.usuarioSeleccionado = '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
        this.actualizarCalendario();
    }

    // Genera iniciales para el avatar
    obtenerIniciales(nombre: string): string {
        if (!nombre) return 'U';
        return nombre.split(' ')
            .filter(n => n)
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    // Resuelve el nombre del área a partir del usuario asociado a la solicitud
    private resolverAreaDeSolicitud(s: SolicitudVacaciones): string {
        // Intentar resolver por el usuario de la solicitud
        if (typeof s.usuario_id === 'string') {
            const usuario = this.todosUsuarios.find(u => u.url === s.usuario_id);
            if (usuario) {
                return (usuario.area_id?.nombre || usuario.area || '').trim().toLowerCase();
            }
        } else if (s.usuario_id && typeof s.usuario_id === 'object') {
            const nombreCompleto = (s.usuario_id.fullname || '').trim().toLowerCase();
            const usuario = this.todosUsuarios.find(u =>
                `${u.first_name} ${u.last_name}`.trim().toLowerCase() === nombreCompleto
            );
            if (usuario) {
                return (usuario.area_id?.nombre || usuario.area || '').trim().toLowerCase();
            }
        }

        // Fallback: intentar resolver el area_id como URL de área
        if (typeof s.area_id === 'string') {
            const areaObj = this.todasAreas.find(a => a.url === s.area_id);
            if (areaObj) {
                return areaObj.nombre.trim().toLowerCase();
            }
            // Si no es URL, podría ser el nombre directo
            return s.area_id.trim().toLowerCase();
        }

        return '';
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

                // 2. Filtro por Área: resolver el nombre del área desde el usuario de la solicitud
                if (areaFiltro) {
                    const areaSolicitud = this.resolverAreaDeSolicitud(s);
                    if (areaSolicitud !== areaFiltro) return false;
                }

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
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
        this.actualizarCalendario();
    }

    onUsuarioChange(): void {
        this.actualizarCalendario();
    }

    limpiarFiltros(): void {
        this.areaSeleccionada = this.areasFiltradas.length === 1 ? this.areasFiltradas[0] : '';
        this.usuarioSeleccionado = '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
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
