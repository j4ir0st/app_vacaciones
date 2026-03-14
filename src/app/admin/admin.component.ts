import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, EMPTY } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { RefreshService } from '../core/services/refresh.service';
import { SolicitudVacaciones, EstadoSolicitud } from '../core/models/solicitud-vacaciones.model';
import { Usuario } from '../core/models/usuario.model';
import { environment } from '../../environments/environment';

type FiltroAdmin = 'Pendiente' | 'Aprobado Supervisor' | 'Aprobado' | 'Rechazado';

interface FilaSolicitud extends SolicitudVacaciones {
    nombreUsuario: string;
    avatarUsuario: string | null;
    areaNombre: string;
    puestoNombre: string;
}

@Component({
    selector: 'app-admin',
    templateUrl: './admin.component.html',
    styleUrls: ['./admin.component.css'],
    standalone: false
})
export class AdminComponent implements OnInit {
    // Estados de carga
    cargandoSolicitudes = true;
    cargandoUsuarios = true;

    // Pestaña activa
    pestanaActiva: 'solicitudes' | 'usuarios' = 'solicitudes';

    // Datos de solicitudes
    todasSolicitudes: FilaSolicitud[] = [];
    solicitudesFiltradas: FilaSolicitud[] = [];
    filtroEstado: FiltroAdmin = 'Pendiente';
    opcionesFiltroAdmin: FiltroAdmin[] = ['Pendiente', 'Aprobado Supervisor', 'Aprobado', 'Rechazado'];

    // Contadores para los botones de filtro
    counts = {
        'Pendiente': 0,
        'Aprobado Supervisor': 0,
        'Aprobado': 0,
        'Rechazado': 0
    };

    // Datos de usuarios
    usuarios: Usuario[] = [];
    textoBusqueda = '';

    // Confirmación de acción (antigua, en modal lista)
    solicitudEnAccion: FilaSolicitud | null = null;
    accionPendiente: 'aprobar' | 'rechazar' | null = null;
    usuarioADesactivar: Usuario | null = null;

    // Estado para la Vista Detalle
    solicitudDetalle: FilaSolicitud | null = null;
    observacionDetalle: string = '';
    procesandoDetalle = false;

    constructor(
        public authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService,
        private refreshService: RefreshService,
        private route: ActivatedRoute
    ) { }

    ngOnInit(): void {
        // Detectar pestaña inicial desde la ruta
        this.route.data.subscribe(data => {
            if (data['pestana']) {
                this.pestanaActiva = data['pestana'];
            }
        });

        this.cargarDatos();

        // Escuchar refrescos manuales
        this.refreshService.refresh$.subscribe(() => {
            console.log('Recibida señal de refresco en Admin');
            this.cargarDatos();
        });
    }

    cargarDatos(): void {
        const user = this.authService.usuarioActual;
        if (!user) return;

        const puesto = (user.area_puesto?.puesto_nombre || user.puesto_id?.nombre || '').trim().toLowerCase();
        const esJefatura = ['gerente', 'jefe', 'supervisor'].includes(puesto);

        // Bloqueo de consultas a la API si el usuario no tiene permisos de Jefatura/Gerencia
        if (!esJefatura) {
            this.todasSolicitudes = [];
            this.solicitudesFiltradas = [];
            this.usuarios = [];
            this.cargandoSolicitudes = false;
            this.cargandoUsuarios = false;
            return;
        }

        this.cargandoSolicitudes = true;
        this.cargandoUsuarios = true;

        const urlSolicitudes = `${environment.apiUrl}/SolicitudVacaciones/?format=json${this.obtenerFiltroAreaBackend()}`;

        const reqSolicitudes = this.solicitudService.obtenerSolicitudes(urlSolicitudes).pipe(
            expand((resp: any) => {
                return resp.next ? this.solicitudService.obtenerSolicitudes(this.fixPaginationUrl(resp.next)) : EMPTY
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        const reqUsuarios = this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => {
                return resp.next ? this.usuarioService.obtenerUsuarios(this.fixPaginationUrl(resp.next)) : EMPTY
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        forkJoin([reqSolicitudes, reqUsuarios]).subscribe({
            next: ([listaSolicitudes, listaUsuarios]: [any[], any[]]) => {

                this.usuarios = listaUsuarios;
                this.todasSolicitudes = listaSolicitudes.map((s: SolicitudVacaciones): FilaSolicitud => {
                    const solUrlLimpia = (s.usuario_id || '').replace(/\/$/, '').toLowerCase();
                    const usu = listaUsuarios.find((u: Usuario) => {
                        const uUrlLimpia = (u.url || '').replace(/\/$/, '').toLowerCase();
                        return solUrlLimpia === uUrlLimpia || solUrlLimpia.endsWith(uUrlLimpia) || uUrlLimpia.endsWith(solUrlLimpia);
                    });
                    
                    return {
                        ...s,
                        nombreUsuario: usu
                            ? `${usu.first_name} ${usu.last_name}`.trim() || usu.username
                            : 'Usuario Desconocido',
                        avatarUsuario: usu?.avatar || null,
                        areaNombre: usu?.area_id?.nombre || usu?.area || '',
                        puestoNombre: usu?.puesto_id?.nombre || 'Usuario'
                    };
                }).sort((a: FilaSolicitud, b: FilaSolicitud) => (b.fecha_solicitud || '').localeCompare(a.fecha_solicitud || '') * -1);

                this.aplicarFiltroSolicitudes();
                this.cargandoSolicitudes = false;
                this.cargandoUsuarios = false;
            },
            error: (err: any) => {
                console.error('Error cargando datos:', err);
                this.cargandoSolicitudes = false;
                this.cargandoUsuarios = false;
            }
        });
    }

    // Corrige error CORS reemplazando dominio absoluto de la API por el proxy local
    private fixPaginationUrl(nextUrl: string): string {
        if (!nextUrl) return '';
        return nextUrl.replace(/^https?:\/\/[^\/]+/, environment.apiUrl);
    }

    private obtenerFiltroAreaBackend(): string {
        const user = this.authService.usuarioActual;
        if (!user) return '';

        const puesto = (user.area_puesto?.puesto_nombre || user.puesto_id?.nombre || '').trim().toLowerCase();
        const areaUser = (user.area_puesto?.area_nombre || user.area_id?.nombre || user.area || '').trim().toLowerCase();
        const nombreUser = `${user.first_name} ${user.last_name}`.trim().toLowerCase();

        let areas: string[] = [];

        if (puesto === 'gerente' || puesto === 'jefe' || puesto === 'supervisor') {
            if (areaUser === 'operaciones') {
                areas = [
                    "Gerencia", "Desarrollo Software", "Logística Inversa", 
                    "Atenciones", "Distribución", "Almacenes", "Facturación"
                ];
            } else if (nombreUser === 'katherine lewis') {
                areas = [
                    "Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", 
                    "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", 
                    "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", 
                    "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"
                ];
            } else {
                areas = [user.area_puesto?.area_nombre || user.area_id?.nombre || user.area || ''];
            }
        } else {
            // Usuario normal, solo cargamos su area
            areas = [user.area_puesto?.area_nombre || user.area_id?.nombre || user.area || ''];
        }

        const areasFiltradas = areas.filter(a => a).map(a => a.trim());
        if (areasFiltradas.length > 0) {
            return `&area_nombre=${encodeURIComponent(areasFiltradas.join(','))}`;
        }
        return '';
    }

    // Aplica el filtro de estado y área en la sección de solicitudes
    aplicarFiltroSolicitudes(): void {
        const user = this.authService.usuarioActual;
        if (!user) return;

        // 1. Solicitudes ya vienen filtradas por área desde Backend
        // Como los roles regulares ya son bloqueados en cargarDatos(), todos los que llegan aquí
        // son jefaturas o gerencias que ya traen los datos correctos del backend, así que lo permitimos todo.
        let solicitudesPermitidas = this.todasSolicitudes;

        // 2. Actualizar contadores basados en las solicitudes permitidas
        this.recalcularCounts(solicitudesPermitidas);

        // 3. Filtrar por el estado seleccionado en los botones superiores
        const mapFiltroACodigo: Record<string, string> = {
            'Pendiente': 'PD',
            'Aprobado Supervisor': 'AS',
            'Aprobado': 'AP',
            'Rechazado': 'RC'
        };
        const codigoBuscado = mapFiltroACodigo[this.filtroEstado];
        this.solicitudesFiltradas = solicitudesPermitidas.filter(
            (s: FilaSolicitud) => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === codigoBuscado
        );
    }

    recalcularCounts(solicitudes: FilaSolicitud[]): void {
        this.counts = {
            'Pendiente': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'PD').length,
            'Aprobado Supervisor': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AS').length,
            'Aprobado': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP').length,
            'Rechazado': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'RC').length
        };
    }

    cambiarFiltroEstado(estado: FiltroAdmin): void {
        this.filtroEstado = estado;
        this.aplicarFiltroSolicitudes();
    }

    // Devuelve los usuarios filtrados por búsqueda
    get usuariosFiltrados(): Usuario[] {
        if (!this.textoBusqueda.trim()) return this.usuarios;
        const busq = this.textoBusqueda.toLowerCase();
        return this.usuarios.filter(u =>
            `${u.first_name} ${u.last_name} ${u.username} ${u.area_id?.nombre || u.area}`.toLowerCase().includes(busq)
        );
    }

    // =========== MODO DETALLE DE SOLICITUD ===========

    verDetalle(solicitud: FilaSolicitud): void {
        this.solicitudDetalle = solicitud;
        this.observacionDetalle = solicitud.obs || '';
    }

    cerrarDetalle(): void {
        this.solicitudDetalle = null;
        this.observacionDetalle = '';
    }

    procesarDetalle(accion: 'aprobar' | 'rechazar'): void {
        if (!this.solicitudDetalle?.url) return;
        
        const user = this.authService.usuarioActual;
        if (!user) return;
        
        this.procesandoDetalle = true;
        const puesto = (user.area_puesto?.puesto_nombre || user.puesto_id?.nombre || '').trim().toLowerCase();
        const esGerente = puesto === 'gerente';

        // Lógica de auditoría
        let nuevoEstado: string = 'RC'; // Default Rechazado
        let payloadAuditoria: any = {
            obs: this.observacionDetalle
        };

        const nowIso = new Date().toISOString();

        if (accion === 'aprobar') {
            if (esGerente) {
                nuevoEstado = 'AP';
                payloadAuditoria['gerente_id'] = user.url;
                payloadAuditoria['fecha_gerente'] = nowIso;
            } else {
                nuevoEstado = 'AS';
                payloadAuditoria['jefe_id'] = user.url;
                payloadAuditoria['fecha_jefe'] = nowIso;
            }
        } else {
            // Si es rechazo usamos la correlación de quien rechazó
             if (esGerente) {
                payloadAuditoria['gerente_id'] = user.url;
                payloadAuditoria['fecha_gerente'] = nowIso;
            } else {
                payloadAuditoria['jefe_id'] = user.url;
                payloadAuditoria['fecha_jefe'] = nowIso;
            }
        }

        payloadAuditoria['estado_solicitud'] = nuevoEstado;

        this.solicitudService.actualizarSolicitud(this.solicitudDetalle.url, payloadAuditoria)
            .subscribe({
                next: () => {
                    this.procesandoDetalle = false;
                    this.cerrarDetalle();
                    this.cargarDatos(); // Refrescamos todo tras el cambio
                },
                error: (err) => {
                    console.error('Error al procesar detalle', err);
                    this.procesandoDetalle = false;
                }
            });
    }

    // ========= ACCIONES RAPIDAS (Antiguo modal) ==========

    iniciarAccion(solicitud: FilaSolicitud, accion: 'aprobar' | 'rechazar'): void {
        this.solicitudEnAccion = solicitud;
        this.accionPendiente = accion;
    }

    // Confirma la acción de aprobación/rechazo
    confirmarAccionSolicitud(): void {
        if (!this.solicitudEnAccion?.url || !this.accionPendiente) return;

        const urlAprobador = this.authService.usuarioActual?.url || '';
        const nuevoEstado = this.accionPendiente === 'aprobar' ? 'AP' : 'RC'; // Usamos siglas para actualizar

        // El personal usa jefe_id y gerente_id, aquí lo simplificamos por ahora o enviamos lo que requiere la API
        this.solicitudService.actualizarSolicitud(this.solicitudEnAccion.url, {
            estado_solicitud: nuevoEstado as any,
            obs: 'Acción desde Panel de Control'
        }).subscribe({
            next: () => {
                this.solicitudEnAccion = null;
                this.accionPendiente = null;
                this.cargarDatos();
            },
            error: () => {
                this.solicitudEnAccion = null;
                this.accionPendiente = null;
            }
        });
    }

    // Inicia proceso de desactivación de usuario
    iniciarDesactivacion(usuario: Usuario): void {
        this.usuarioADesactivar = usuario;
    }

    // Cambia el estado activo/inactivo del usuario
    cambiarEstadoUsuario(): void {
        if (!this.usuarioADesactivar) return;
        const nuevoEstado = !this.usuarioADesactivar.is_active;

        this.usuarioService.actualizarUsuario(this.usuarioADesactivar.url, { is_active: nuevoEstado })
            .subscribe({
                next: () => {
                    this.usuarioADesactivar = null;
                    this.cargarDatos();
                },
                error: () => { this.usuarioADesactivar = null; }
            });
    }

    // Obtiene iniciales del usuario
    obtenerIniciales(usuario: Usuario): string {
        return (usuario.first_name?.[0] || '') + (usuario.last_name?.[0] || '');
    }

    // Clase CSS según estado de solicitud
    claseEstado(estado: EstadoSolicitud): string {
        const codigo = this.vacacionesService.obtenerCodigoEstado(estado);
        const clases: Record<string, string> = {
            'AP': 'estado-aprobado',
            'PD': 'estado-pendiente',
            'RC': 'estado-rechazado',
            'AS': 'estado-supervisor'
        };
        return clases[codigo] || '';
    }
}
