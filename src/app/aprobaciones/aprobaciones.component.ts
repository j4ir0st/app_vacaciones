import { Component, OnInit } from '@angular/core';
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
    selector: 'app-aprobaciones',
    templateUrl: './aprobaciones.component.html',
    styleUrls: ['./aprobaciones.component.css'],
    standalone: false
})
export class AprobacionesComponent implements OnInit {
    // Estados de carga
    cargandoSolicitudes = true;

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

    // Estado para la Vista Detalle
    solicitudDetalle: FilaSolicitud | null = null;
    observacionDetalle: string = '';
    procesandoDetalle = false;

    // Estados para el flujo de rechazo
    mostrandoConfirmacionRechazo = false;
    rechazoExitoso = false;

    // Estados para el flujo de aprobación
    mostrandoConfirmacionAprobacion = false;
    aprobacionExitosa = false;

    constructor(
        public authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService,
        private refreshService: RefreshService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();

        // Escuchar refrescos manuales
        this.refreshService.refresh$.subscribe(() => {
            this.cargarDatos();
        });
    }

    cargarDatos(): void {
        const user = this.authService.usuarioActual;
        if (!user) return;

        this.cargandoSolicitudes = true;

        const urlSolicitudes = `${environment.apiUrl}/SolicitudVacaciones/?format=json${this.obtenerFiltroAreaBackend()}`;

        const reqSolicitudes = this.solicitudService.obtenerSolicitudes(urlSolicitudes).pipe(
            expand((resp: any) => {
                return resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        const reqUsuarios = this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => {
                return resp.next ? this.usuarioService.obtenerUsuarios(resp.next) : EMPTY
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        forkJoin([reqSolicitudes, reqUsuarios]).subscribe({
            next: ([listaSolicitudes, listaUsuarios]: [any[], any[]]) => {
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
            },
            error: (err: any) => {
                console.error('Error cargando solicitudes:', err);
                this.cargandoSolicitudes = false;
            }
        });
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
                areas = ["Gerencia", "Desarrollo Software", "Logística Inversa", "Atenciones", "Distribución", "Almacenes", "Facturación"];
            } else if (nombreUser === 'katherine lewis') {
                areas = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else {
                areas = [user.area_puesto?.area_nombre || user.area_id?.nombre || user.area || ''];
            }
        } else {
            areas = [user.area_puesto?.area_nombre || user.area_id?.nombre || user.area || ''];
        }

        const areasFiltradas = areas.filter(a => a).map(a => a.trim());
        return areasFiltradas.length > 0 ? `&area_nombre=${encodeURIComponent(areasFiltradas.join(','))}` : '';
    }

    aplicarFiltroSolicitudes(): void {
        this.recalcularCounts(this.todasSolicitudes);

        const mapFiltroACodigo: Record<string, string> = {
            'Pendiente': 'PD',
            'Aprobado Supervisor': 'AS',
            'Aprobado': 'AP',
            'Rechazado': 'RC'
        };
        const codigoBuscado = mapFiltroACodigo[this.filtroEstado];
        this.solicitudesFiltradas = this.todasSolicitudes.filter(
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

        let nuevoEstado: string = 'RC';
        let payloadAuditoria: any = { obs: this.observacionDetalle };
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
                    if (accion === 'rechazar') {
                        this.rechazoExitoso = true;
                    } else if (accion === 'aprobar' && !esGerente) {
                        this.aprobacionExitosa = true;
                    } else {
                        this.cerrarDetalle();
                        this.cargarDatos(); 
                    }
                },
                error: (err) => {
                    console.error('Error al procesar detalle', err);
                    this.procesandoDetalle = false;
                }
            });
    }

    confirmarRechazo(): void {
        this.mostrandoConfirmacionRechazo = true;
    }

    cancelarRechazo(): void {
        this.mostrandoConfirmacionRechazo = false;
    }

    ejecutarRechazo(): void {
        this.mostrandoConfirmacionRechazo = false;
        this.procesarDetalle('rechazar');
    }

    retornarDeExito(): void {
        this.rechazoExitoso = false;
        this.aprobacionExitosa = false;
        this.cerrarDetalle();
        this.cargarDatos();
    }

    confirmarAprobacion(): void {
        this.mostrandoConfirmacionAprobacion = true;
    }

    cancelarAprobacion(): void {
        this.mostrandoConfirmacionAprobacion = false;
    }

    ejecutarAprobacion(): void {
        this.mostrandoConfirmacionAprobacion = false;
        this.procesarDetalle('aprobar');
    }

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
