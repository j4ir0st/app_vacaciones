import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, timer, EMPTY, Observable } from 'rxjs';
import { expand, map, catchError, switchMap, tap } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { RefreshService } from '../core/services/refresh.service';
import { SolicitudVacaciones, EstadoSolicitud } from '../core/models/solicitud-vacaciones.model';
import { NuevaSolicitudComponent } from '../nueva-solicitud/nueva-solicitud.component';
import { environment } from '../../environments/environment';

@Component({
    selector: 'app-mis-solicitudes',
    templateUrl: './mis-solicitudes.component.html',
    styleUrls: ['./mis-solicitudes.component.css'],
    standalone: false
})
export class MisSolicitudesComponent implements OnInit, OnDestroy {
    @ViewChild(NuevaSolicitudComponent) compNuevaSolicitud?: NuevaSolicitudComponent;

    solicitudes: SolicitudVacaciones[] = [];
    solicitudesFiltradas: SolicitudVacaciones[] = [];

    cargando = true;
    cargandoPaginaSiguiente = false;
    filtroEstado: string = 'Todos';

    counts = {
        'Todos': 0,
        'Pendiente': 0,
        'Aprobado': 0,
        'Aprobado Supervisor': 0,
        'Rechazado': 0
    };

    mostrarFormulario = false;
    solicitudACancelar: SolicitudVacaciones | null = null;
    solicitudDetalle: SolicitudVacaciones | null = null;

    private refreshSub?: Subscription;

    constructor(
        public authService: AuthService,
        private solicitudService: SolicitudService,
        public vacacionesService: VacacionesService,
        private refreshService: RefreshService,
        private route: ActivatedRoute
    ) { }

    ngOnInit(): void {
        this.refreshSub = timer(0, 300000).pipe(
            switchMap(() => {
                this.cargando = true;
                return this.cargarTodasLasPaginas();
            })
        ).subscribe();

        this.refreshService.refresh$.subscribe(() => {
            this.cargando = true;
            this.cargarTodasLasPaginas().subscribe();
        });

        this.route.queryParams.subscribe(params => {
            if (params['nueva'] === 'true') {
                this.mostrarFormulario = true;
            }
        });
    }

    ngOnDestroy(): void {
        this.refreshSub?.unsubscribe();
    }

    private cargarTodasLasPaginas(): Observable<any> {
        const usuActual = this.authService.usuarioActual;
        const nombreCompleto = this.authService.nombreCompleto.toLowerCase();
        let todas: SolicitudVacaciones[] = [];

        // Cambiamos 'username' por 'user_id' según requerimiento del backend
        return this.solicitudService.obtenerSolicitudes(this.solicitudService.URL_SOLICITUDES, { usuario_id: usuActual?.id }).pipe(
            expand(resp => {
                if (resp.next) {
                    this.cargandoPaginaSiguiente = true;
                    const nextUrl = resp.next.replace(/^https?:\/\/[^\/]+/, environment.apiUrl);
                    return this.solicitudService.obtenerSolicitudes(nextUrl);
                }
                return EMPTY;
            }),
            map(resp => Array.isArray(resp) ? resp : (resp.results || [])),
            tap((items: SolicitudVacaciones[]) => {
                const itemsLimpio = items.filter((s: any) => {
                    const uInfo = typeof s.usuario_id === 'object' ? s.usuario_id : null;
                    if (uInfo) {
                        return uInfo.fullname.toLowerCase().includes(nombreCompleto);
                    }
                    return true;
                });

                todas = [...todas, ...itemsLimpio];
                this.solicitudes = [...todas].sort((a, b) =>
                    (b.fecha_inicio || '').localeCompare(a.fecha_inicio || '')
                );
                this.recalcularCounts();
                this.aplicarFiltro();
            }),
            catchError(err => {
                console.error('Error cargando solicitudes:', err);
                this.cargando = false;
                this.cargandoPaginaSiguiente = false;
                return EMPTY;
            }),
            tap({
                complete: () => {
                    this.cargando = false;
                    this.cargandoPaginaSiguiente = false;
                }
            })
        );
    }

    recalcularCounts(): void {
        this.counts = {
            'Todos': this.solicitudes.length,
            'Pendiente': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'PD').length,
            'Aprobado': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP').length,
            'Aprobado Supervisor': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AS').length,
            'Rechazado': this.solicitudes.filter(s => ['RC', 'CN'].includes(this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud))).length
        };
    }

    aplicarFiltro(): void {
        if (this.filtroEstado === 'Todos') {
            this.solicitudesFiltradas = this.solicitudes;
        } else {
            const mapFiltroACodigo: Record<string, string> = {
                'Pendiente': 'PD',
                'Aprobado': 'AP',
                'Aprobado Supervisor': 'AS',
                'Rechazado': 'RC'
            };
            const codigoBuscado = mapFiltroACodigo[this.filtroEstado];
            this.solicitudesFiltradas = this.solicitudes.filter(s => {
                const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                return codigoBuscado === 'RC' ? (cod === 'RC' || cod === 'CN') : (cod === codigoBuscado);
            });
        }
    }

    cambiarFiltro(estado: string): void {
        this.filtroEstado = estado;
        this.aplicarFiltro();
    }

    verDetalle(solicitud: SolicitudVacaciones): void {
        this.solicitudDetalle = solicitud;
    }

    cerrarDetalle(): void {
        this.solicitudDetalle = null;
    }

    intentarCerrarModal(): void {
        if (this.compNuevaSolicitud?.esSucio) {
            if (window.confirm('¿Está seguro que desea salir? Se perderán los datos.')) {
                this.mostrarFormulario = false;
            }
        } else {
            this.mostrarFormulario = false;
        }
    }

    onSolicitudCreada(): void {
        this.mostrarFormulario = false;
        this.cargando = true;
        this.cargarTodasLasPaginas().subscribe();
    }

    confirmarCancelacion(solicitud: SolicitudVacaciones): void {
        this.solicitudACancelar = solicitud;
    }

    cancelarSolicitud(): void {
        if (!this.solicitudACancelar?.url) return;
        this.solicitudService.eliminarSolicitud(this.solicitudACancelar.url).subscribe({
            next: () => {
                this.solicitudACancelar = null;
                this.cargando = true;
                this.cargarTodasLasPaginas().subscribe();
            },
            error: () => this.solicitudACancelar = null
        });
    }

    claseEstado(estado: EstadoSolicitud): string {
        const codigo = this.vacacionesService.obtenerCodigoEstado(estado);
        const clases: Record<string, string> = {
            'AP': 'estado-aprobado',
            'PD': 'estado-pendiente',
            'RC': 'estado-rechazado',
            'AS': 'estado-supervisor',
            'CN': 'estado-rechazado'
        };
        return clases[codigo] || 'estado-default';
    }

    obtenerAvatar(sol: SolicitudVacaciones): string | null {
        const uInfo = typeof sol.usuario_id === 'object' ? sol.usuario_id : null;
        return this.solicitudService.obtenerUrlAvatar(uInfo?.avatar);
    }
}
