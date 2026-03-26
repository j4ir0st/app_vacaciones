import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, timer, from, EMPTY, Observable } from 'rxjs';
import { expand, map, reduce, catchError, switchMap, tap } from 'rxjs/operators';
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

    // Listas de solicitudes
    solicitudes: SolicitudVacaciones[] = [];
    solicitudesFiltradas: SolicitudVacaciones[] = [];

    // Estado de carga
    cargando = true;
    cargandoPaginaSiguiente = false;

    // Filtro de estado activo
    filtroEstado: string = 'Todos';

    // Contadores
    counts = {
        'Todos': 0,
        'Pendiente': 0,
        'Aprobado': 0,
        'Aprobado Supervisor': 0,
        'Rechazado': 0
    };

    // Control del modal
    mostrarFormulario = false;
    solicitudACancelar: SolicitudVacaciones | null = null;

    // Estado para la Vista Detalle
    solicitudDetalle: SolicitudVacaciones | null = null;


    // Suscripciones
    private refreshSub?: Subscription;

    constructor(
        public authService: AuthService,
        private solicitudService: SolicitudService,
        public vacacionesService: VacacionesService,
        private refreshService: RefreshService,
        private route: ActivatedRoute
    ) { }

    ngOnInit(): void {
        // Carga inicial y configuración de refresco cada 5 minutos (300,000 ms)
        this.refreshSub = timer(0, 300000).pipe(
            switchMap(() => {
                this.cargando = true;
                return this.cargarTodasLasPaginas();
            })
        ).subscribe();

        // Escuchar refrescos manuales
        this.refreshService.refresh$.subscribe(() => {
            console.log('Recibida señal de refresco en MisSolicitudes');
            this.cargando = true;
            this.cargarTodasLasPaginas().subscribe();
        });

        // Abrir formulario desde query params
        this.route.queryParams.subscribe(params => {
            if (params['nueva'] === 'true') {
                this.mostrarFormulario = true;
            }
        });
    }

    ngOnDestroy(): void {
        this.refreshSub?.unsubscribe();
    }

    /**
     * Realiza una carga recursiva de todas las páginas que devuelva la API DRF.
     * Utiliza el operador expand para encadenar las peticiones si existe una URL en el campo 'next'.
     * Los resultados se filtran y acumulan progresivamente para no bloquear la interfaz.
     */
    private cargarTodasLasPaginas(): Observable<any> {
        const urlUsuario = this.authService.usuarioActual?.url || '';
        const username = this.authService.usuarioActual?.username?.toLowerCase();
        let todas: SolicitudVacaciones[] = [];

        return this.solicitudService.obtenerSolicitudes().pipe(
            // El operador expand permite ejecutar una acción recursivamente mientras se cumpla una condición
            expand(resp => {
                const urlSiguiente = resp.next;
                if (urlSiguiente) {
                    this.cargandoPaginaSiguiente = true;
                    // Llamamos a la siguiente página de resultados usando proxy local
                    return this.solicitudService.obtenerSolicitudes(urlSiguiente.replace(/^https?:\/\/[^\/]+/, environment.apiUrl));
                }
                // Si no hay más páginas, devolvemos EMPTY para detener la recursión
                return EMPTY;
            }),
            // Convertimos la respuesta (que puede ser paginada o un array simple) a un array de items
            map(resp => Array.isArray(resp) ? resp : (resp.results || [])),
            // Filtramos localmente para mostrar solo las solicitudes que pertenecen al usuario autenticado
            map(items => items.filter((s: SolicitudVacaciones) => {
                if (!s.usuario_id || !urlUsuario) return false;

                // Normalizamos las URLs e IDs para una comparación robusta (sin slashes finales y en minúsculas)
                const idLimpio = s.usuario_id.replace(/\/$/, '').toLowerCase();
                const urlLimpia = urlUsuario.replace(/\/$/, '').toLowerCase();

                // Comprobamos coincidencia por URL completa o por nombre de usuario
                return idLimpio === urlLimpia || idLimpio.endsWith(urlLimpia) || urlLimpia.endsWith(idLimpio) || (username && idLimpio === username);
            })),
            // El operador tap nos permite ejecutar efectos secundarios sin alterar el flujo de datos
            tap((itemsFiltrados: SolicitudVacaciones[]) => {
                todas = [...todas, ...itemsFiltrados];
                // Ordenamos por fecha de inicio descendente (las más recientes arriba)
                this.solicitudes = [...todas].sort((a, b) =>
                    (b.fecha_inicio || '').localeCompare(a.fecha_inicio || '')
                );
                // Actualizamos los contadores de la cabecera y aplicamos los filtros visuales activos
                this.recalcularCounts();
                this.aplicarFiltro();
            }),
            // Manejo de errores durante la carga de cualquier página
            catchError(err => {
                console.error('Error cargando solicitudes:', err);
                this.cargando = false;
                this.cargandoPaginaSiguiente = false;
                return EMPTY;
            }),
            // Finalizamos los estados de carga al completar todo el flujo observable
            tap({
                complete: () => {
                    this.cargando = false;
                    this.cargandoPaginaSiguiente = false;
                }
            })
        );
    }

    /**
     * Recalcula los totales que se muestran en los botones de filtro de la parte superior.
     */
    recalcularCounts(): void {
        this.counts = {
            'Todos': this.solicitudes.length,
            'Pendiente': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'PD').length,
            'Aprobado': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP').length,
            'Aprobado Supervisor': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AS').length,
            'Rechazado': this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'RC').length
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
            this.solicitudesFiltradas = this.solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === codigoBuscado);
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
}
