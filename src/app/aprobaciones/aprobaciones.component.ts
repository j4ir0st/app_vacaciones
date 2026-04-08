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

type FiltroAdministrador = 'Pendiente' | 'Aprobado Supervisor' | 'Aprobado' | 'Rechazado';

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
    filtroEstado: FiltroAdministrador = 'Pendiente';
    opcionesFiltroAdmin: FiltroAdministrador[] = ['Pendiente', 'Aprobado Supervisor', 'Aprobado', 'Rechazado'];

    // Conteos para los botones de filtro
    conteos = {
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
    modoPreviewPDF = false;
    aprobacionExitosaGerente = false;
    fechaFirma: Date = new Date();

    // Mensajes de error
    errorRechazo = '';

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

    /**
     * Carga las solicitudes y usuarios desde el servidor aplicando los filtros de área.
     */
    cargarDatos(): void {
        const usuarioActual = this.authService.usuarioActual;
        if (!usuarioActual) return;

        this.cargandoSolicitudes = true;

        const filtroAdicional = this.obtenerFiltroAreaBackend();
        const urlSolicitudes = `${environment.apiUrl}/SolicitudVacaciones/?format=json${filtroAdicional}`;

        // Obtención recursiva de solicitudes (DRF paginación 60 registros)
        const peticionSolicitudes = this.solicitudService.obtenerSolicitudes(urlSolicitudes).pipe(
            expand((resp: any) => {
                if (!resp.next) return EMPTY;
                // Nos aseguramos de que el link de 'next' mantenga los filtros si el backend no los incluye
                let proximaUrl = resp.next;
                if (!proximaUrl.includes('area_nombre') && filtroAdicional) {
                    proximaUrl += filtroAdicional;
                }
                return this.solicitudService.obtenerSolicitudes(proximaUrl);
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acumulado: any[], actual: any[]) => acumulado.concat(actual), [])
        );

        // Obtención de usuarios para cruce de información
        const peticionUsuarios = this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => resp.next ? this.usuarioService.obtenerUsuarios(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acumulado: any[], actual: any[]) => acumulado.concat(actual), [])
        );

        forkJoin([peticionSolicitudes, peticionUsuarios]).subscribe({
            next: ([listaSolicitudes, listaUsuarios]: [any[], any[]]) => {
                this.todasSolicitudes = listaSolicitudes.map((sol: SolicitudVacaciones): FilaSolicitud => {
                    return this.mapearSolicitud(sol, listaUsuarios);
                }).sort((a: FilaSolicitud, b: FilaSolicitud) => {
                    // Orden descendente por fecha de solicitud (las más recientes primero)
                    return (b.fecha_solicitud || '').localeCompare(a.fecha_solicitud || '');
                });

                this.aplicarFiltroSolicitudes();
                this.cargandoSolicitudes = false;
            },
            error: (error: any) => {
                console.error('Error cargando solicitudes:', error);
                this.cargandoSolicitudes = false;
            }
        });
    }

    /**
     * Mapea una solicitud cruda del backend al formato de fila con información de usuario extendida.
     */
    private mapearSolicitud(sol: SolicitudVacaciones, usuarios: Usuario[]): FilaSolicitud {
        // Identificación del usuario y su área
        let nombreUsuario = 'Usuario';
        let areaUsuario = 'Sin Área';
        let puestoUsuario = 'Usuario';
        const urlUsuarioEnSolicitud = typeof sol.usuario_id === 'string' ? sol.usuario_id : '';

        // Prioridad 1: Información serializada directamente en el objeto usuario_id (Frontend/Backend optimizado)
        const infoUsuarioObj = (typeof sol.usuario_id === 'object' && sol.usuario_id !== null) ? (sol.usuario_id as any) : null;

        if (infoUsuarioObj) {
            nombreUsuario = infoUsuarioObj.fullname || nombreUsuario;
            areaUsuario = infoUsuarioObj.area || areaUsuario;
            puestoUsuario = infoUsuarioObj.puesto || puestoUsuario;
        }

        // Prioridad 2: Buscar en la lista de usuarios completa si falta información o es solo una URL
        if (areaUsuario === 'Sin Área' || nombreUsuario === 'Usuario') {
            const usuarioEncontrado = usuarios.find(u => {
                if (!urlUsuarioEnSolicitud) return false;
                const uUrl = u.url?.toLowerCase().replace(/\/$/, '') || '';
                const solUrl = urlUsuarioEnSolicitud.toLowerCase().replace(/\/$/, '') || '';
                return uUrl === solUrl || uUrl.endsWith(solUrl) || solUrl.endsWith(uUrl);
            });

            if (usuarioEncontrado) {
                if (nombreUsuario === 'Usuario') {
                    nombreUsuario = `${usuarioEncontrado.first_name} ${usuarioEncontrado.last_name}`.trim() || usuarioEncontrado.username;
                }
                if (areaUsuario === 'Sin Área') {
                    areaUsuario = usuarioEncontrado.area_id?.nombre || usuarioEncontrado.area || 'Sin Área';
                }
                if (puestoUsuario === 'Usuario') {
                    puestoUsuario = usuarioEncontrado.puesto_id?.nombre || 'Usuario';
                }
            }
        }

        // Si el backend envía el nombre del área directamente en el campo raíz por compatibilidad
        const areaOriginal = typeof sol.area_id === 'string' && !sol.area_id.includes('/') ? sol.area_id : (sol as any).area_nombre;
        const areaFinal = areaOriginal || areaUsuario;

        return {
            ...sol,
            nombreUsuario: nombreUsuario,
            avatarUsuario: this.solicitudService.obtenerUrlAvatar(infoUsuarioObj?.avatar || ''),
            areaNombre: areaFinal,
            puestoNombre: puestoUsuario
        };
    }


    /**
     * Define los parámetros de filtro por área para la consulta al backend.
     */
    private obtenerFiltroAreaBackend(): string {
        const usuarioActual = this.authService.usuarioActual;
        if (!usuarioActual) return '';

        const puestoUsuario = (usuarioActual.puesto_id?.nombre || '').trim().toLowerCase();
        const areaUsuario = (usuarioActual.area_id?.nombre || '').toLowerCase();
        const nombreUsuario = `${usuarioActual.first_name} ${usuarioActual.last_name}`.trim().toLowerCase();
        const username = usuarioActual.username?.toLowerCase() || '';
        const esGerenteOJefe = puestoUsuario.includes('gerente') || puestoUsuario.includes('jefe');

        let areas: string[] = [];

        if (esGerenteOJefe) {
            if (areaUsuario === 'operaciones') {
                areas = ["Distribución", "Atenciones", "Almacenes", "Facturación", "Desarrollo Software", "Logística Inversa"];
            } else if (username === 'klewis' || nombreUsuario.includes('katherine lewis')) {
                areas = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else {
                areas = [usuarioActual.area_id?.nombre || ''];
            }
        } else {
            areas = [usuarioActual.area_id?.nombre || ''];
        }

        const areasFiltradas = areas.filter(a => a).map(a => a.trim());
        const filtroArea = areasFiltradas.length > 0 ? `&area_nombre=${encodeURIComponent(areasFiltradas.join(','))}` : '';

        return filtroArea;
    }

    /**
     * Aplica el filtro en memoria basado en el estado seleccionado en los botones.
     */
    aplicarFiltroSolicitudes(): void {
        this.recalcularConteos(this.todasSolicitudes);

        const mapaFiltroACodigo: Record<string, string> = {
            'Pendiente': 'PD',
            'Aprobado Supervisor': 'AS',
            'Aprobado': 'AP',
            'Rechazado': 'RC'
        };
        const codigoBuscado = mapaFiltroACodigo[this.filtroEstado];
        this.solicitudesFiltradas = this.todasSolicitudes.filter(
            (sol: FilaSolicitud) => this.vacacionesService.obtenerCodigoEstado(sol.estado_solicitud) === codigoBuscado
        );
    }

    /**
     * Calcula los conteos de cada estado para mostrar en los botones de filtro.
     */
    recalcularConteos(solicitudes: FilaSolicitud[]): void {
        this.conteos = {
            'Pendiente': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'PD').length,
            'Aprobado Supervisor': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AS').length,
            'Aprobado': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP').length,
            'Rechazado': solicitudes.filter(s => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'RC').length
        };
    }

    /**
     * Gestión de Vista Detalle
     */
    verDetalle(solicitud: FilaSolicitud): void {
        this.solicitudDetalle = solicitud;
        this.observacionDetalle = solicitud.obs || '';
    }

    cerrarDetalle(): void {
        this.solicitudDetalle = null;
        this.observacionDetalle = '';
    }

    /**
     * Procesa la aprobación o rechazo de una solicitud.
     */
    procesarDetalle(accion: 'aprobar' | 'rechazar', vieneDeFirma: boolean = false): void {
        if (!this.solicitudDetalle?.url) return;

        const usuarioActual = this.authService.usuarioActual;
        if (!usuarioActual) return;

        this.procesandoDetalle = true;
        const esGerente = this.authService.esGerente;

        let nuevoEstado: string = 'RC';
        let payloadAuditoria: any = { obs: this.observacionDetalle };
        const fechaActualIso = new Date().toISOString();

        if (accion === 'aprobar') {
            if (esGerente) {
                nuevoEstado = 'AP';
                payloadAuditoria['gerente_id'] = usuarioActual.url;
                payloadAuditoria['fecha_gerente'] = fechaActualIso;

                // Si la solicitud aún no tiene firma de jefe (ej. salto de paso), el gerente firma por ambos para completar la auditoría
                if (!this.solicitudDetalle.jefe_id) {
                    payloadAuditoria['jefe_id'] = usuarioActual.url;
                    payloadAuditoria['fecha_jefe'] = fechaActualIso;
                }
            } else {
                nuevoEstado = 'AS';
                payloadAuditoria['jefe_id'] = usuarioActual.url;
                payloadAuditoria['fecha_jefe'] = fechaActualIso;
            }
        } else {
            // Caso de rechazo (Se registra quién rechazó)
            if (esGerente) {
                payloadAuditoria['gerente_id'] = usuarioActual.url;
                payloadAuditoria['fecha_gerente'] = fechaActualIso;
            } else {
                payloadAuditoria['jefe_id'] = usuarioActual.url;
                payloadAuditoria['fecha_jefe'] = fechaActualIso;
            }
        }

        payloadAuditoria['estado_solicitud'] = nuevoEstado;

        this.solicitudService.actualizarSolicitud(this.solicitudDetalle.url, payloadAuditoria)
            .subscribe({
                next: () => {
                    if (accion === 'rechazar') {
                        this.procesandoDetalle = false;
                        this.rechazoExitoso = true;
                    } else if (accion === 'aprobar') {
                        if (esGerente && vieneDeFirma) {
                            this.ejecutarNotificacionFinal();
                        } else if (esGerente) {
                            this.procesandoDetalle = false;
                            this.modoPreviewPDF = true;
                            this.fechaFirma = new Date();
                        } else {
                            this.procesandoDetalle = false;
                            this.aprobacionExitosa = true;
                        }
                    } else {
                        this.procesandoDetalle = false;
                        this.cerrarDetalle();
                        this.cargarDatos();
                    }
                },
                error: (error) => {
                    console.error('Error al procesar detalle:', error);
                    this.procesandoDetalle = false;
                }
            });
    }

    /**
     * Flujo de Rechazo
     */
    confirmarRechazo(): void {
        this.mostrandoConfirmacionRechazo = true;
    }

    cancelarRechazo(): void {
        this.mostrandoConfirmacionRechazo = false;
        this.errorRechazo = '';
    }

    ejecutarRechazo(): void {
        if (!this.observacionDetalle || this.observacionDetalle.trim() === '') {
            this.errorRechazo = 'El campo observaciones es Obligatorio y se debe indicar el motivo del rechazo.';
            return;
        }
        this.errorRechazo = '';
        this.mostrandoConfirmacionRechazo = false;
        this.procesarDetalle('rechazar');
    }

    /**
     * Flujo de Aprobación
     */
    cambiarFiltroEstado(estado: FiltroAdministrador): void {
        this.filtroEstado = estado;
        this.aplicarFiltroSolicitudes();
    }

    retornarDeExito(): void {
        this.rechazoExitoso = false;
        this.aprobacionExitosa = false;
        this.aprobacionExitosaGerente = false;
        this.modoPreviewPDF = false;
        this.errorRechazo = '';
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

        const usuarioActual = this.authService.usuarioActual;
        const nombrePuesto = (usuarioActual?.puesto_id?.nombre || '').trim().toLowerCase();

        if (nombrePuesto === 'gerente') {
            this.modoPreviewPDF = true;
            this.fechaFirma = new Date();
        } else {
            this.procesarDetalle('aprobar');
        }
    }

    /**
     * Gestión de Firma y Notificaciones (Rol Gerente)
     */
    cancelarPreview(): void {
        this.modoPreviewPDF = false;
        this.cerrarDetalle();
        this.cargarDatos();
    }

    firmarYEnviar(): void {
        this.procesarDetalle('aprobar', true);
    }

    private ejecutarNotificacionFinal(): void {
        if (!this.solicitudDetalle?.url) return;

        this.solicitudService.enviarNotificacion(this.solicitudDetalle.url).subscribe({
            next: () => {
                this.procesandoDetalle = false;
                this.modoPreviewPDF = false;
                this.aprobacionExitosaGerente = true;
            },
            error: (error) => {
                this.procesandoDetalle = false;
                console.error('Error al enviar notificación:', error);
                alert('La solicitud fue aprobada pero hubo un error al enviar el correo de notificación.');
                this.modoPreviewPDF = false;
                this.aprobacionExitosaGerente = true;
            }
        });
    }

    /**
     * Descarga de Documentos y Utilidades
     */
    descargarDocumento(): void {
        if (!this.solicitudDetalle?.url) return;

        this.solicitudService.descargarPDF(this.solicitudDetalle.url).subscribe({
            next: (datosBlob) => {
                const urlDescarga = window.URL.createObjectURL(datosBlob);
                const elementoLink = document.createElement('a');
                elementoLink.href = urlDescarga;
                const partesUrl = this.solicitudDetalle?.url.split('/') || [];
                const idSolicitud = partesUrl.filter(p => p).pop() || 'documento';
                elementoLink.download = `Solicitud_Vacaciones_${idSolicitud}.pdf`;
                elementoLink.click();
                window.URL.revokeObjectURL(urlDescarga);
            },
            error: (error) => {
                console.error('Error al descargar PDF:', error);
                alert('No se pudo descargar el documento en este momento.');
            }
        });
    }

    claseEstado(estado: EstadoSolicitud): string {
        const codigoEstado = this.vacacionesService.obtenerCodigoEstado(estado);
        const clasesCSS: Record<string, string> = {
            'AP': 'estado-aprobado',
            'PD': 'estado-pendiente',
            'RC': 'estado-rechazado',
            'AS': 'estado-supervisor'
        };
        return clasesCSS[codigoEstado] || '';
    }
}
