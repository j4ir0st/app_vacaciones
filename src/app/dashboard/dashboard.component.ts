import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { expand, map, tap } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { VacacionesService, ResumenVacaciones } from '../core/services/vacaciones.service';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent implements OnInit {
    cargando = true;
    resumen: ResumenVacaciones = {
        diasAcumulados: 0,
        diasTomados: 0,
        diasPendientes: 0,
        diasTruncos: 0,
        solicitudesPendientes: 0,
        solicitudesAprobadas: 0,
        solicitudesRechazadas: 0
    };

    proximasVacaciones: any[] = [];

    constructor(
        private authService: AuthService,
        private solicitudService: SolicitudService,
        private vacacionesService: VacacionesService,
        private router: Router
    ) { }

    ngOnInit(): void {
        this.cargarDatos();
    }

    // Porcentajes para las barras de progreso
    get porcentajeUtilizado(): number {
        if (this.resumen.diasAcumulados === 0) return 0;
        return Math.round((this.resumen.diasTomados / this.resumen.diasAcumulados) * 100);
    }

    get porcentajeRestante(): number {
        return 100 - this.porcentajeUtilizado;
    }

    get porcentajeTruncos(): number {
        // Asumiendo un máximo de 30 días para visualización
        return Math.min(Math.round((this.resumen.diasTruncos / 30) * 100), 100);
    }

    // Carga todos los datos necesarios para el dashboard
    cargarDatos(): void {
        const usuActual = this.authService.usuarioActual;
        const nombreCompleto = this.authService.nombreCompleto.toLowerCase();

        if (!usuActual?.id) {
            this.cargando = false;
            return;
        }

        this.cargando = true;

        // 1. Cargar historial completo filtrado por user_id (según especificación del backend)
        let todas: SolicitudVacaciones[] = [];

        this.solicitudService.obtenerSolicitudes(this.solicitudService.URL_SOLICITUDES, { usuario_id: usuActual.id }).pipe(
            expand(resp => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map(resp => Array.isArray(resp) ? resp : (resp.results || [])),
            tap(items => {
                // Filtro local de seguridad para garantizar que solo se procesen datos del usuario actual
                const itemsFiltrados = items.filter((s: SolicitudVacaciones) => {
                    const uInfo = typeof s.usuario_id === 'object' ? s.usuario_id : null;
                    if (uInfo) {
                        return uInfo.fullname.toLowerCase().includes(nombreCompleto);
                    }
                    return true;
                });
                todas = [...todas, ...itemsFiltrados];
            })
        ).subscribe({
            complete: () => {
                this.procesarSolicitudes(todas, usuActual.fecha_ingreso);
                this.cargando = false;
            },
            error: (err) => {
                console.error('Error cargando datos del dashboard:', err);
                this.cargando = false;
            }
        });

        // 2. Cargar próximas vacaciones filtradas por áreas permitidas
        const areasRaw = this.authService.getAreasVisibles();
        const areasPermitidas = areasRaw.map(a => a.toLowerCase());
        const filtrosAreas = this.solicitudService.obtenerFiltroArea(areasRaw);

        this.solicitudService.obtenerSolicitudes(this.solicitudService.URL_SOLICITUDES, filtrosAreas).subscribe(resp => {
            const items = Array.isArray(resp) ? resp : (resp.results || []);
            const hoy = new Date().toISOString().split('T')[0];

            this.proximasVacaciones = items
                .filter((s: any) => {
                    const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                    const esVigente = (cod === 'AP' || cod === 'AS') && (s.fecha_inicio || '') >= hoy;
                    
                    if (!esVigente) return false;

                    // Filtro por área: el usuario solo ve vacaciones de sus áreas permitidas
                    // Manejamos area_id tanto si viene como string (nombre) u objeto ({nombre})
                    const areaObj = s.area_id;
                    const areaNombre = (typeof areaObj === 'object' ? areaObj?.nombre : areaObj) || '';
                    const areaSolicitud = areaNombre.toLowerCase().trim();
                    
                    return areasPermitidas.includes(areaSolicitud);
                })
                .sort((a: any, b: any) => (a.fecha_inicio || '').localeCompare(b.fecha_inicio || ''))
                .slice(0, 15)
                .map((s: any) => {
                    const uInfo = typeof s.usuario_id === 'object' ? s.usuario_id : null;
                    return {
                        ...s,
                        nombreUsuario: uInfo?.fullname || 'Usuario',
                        avatarUsuario: this.solicitudService.obtenerUrlAvatar(uInfo?.avatar)
                    };
                });
        });
    }

    private procesarSolicitudes(solicitudes: SolicitudVacaciones[], fechaIngreso: string): void {
        this.resumen = this.vacacionesService.calcularResumen(fechaIngreso, solicitudes);
    }

    nuevaSolicitud(): void {
        this.router.navigate(['/mis-solicitudes'], { queryParams: { nueva: 'true' } });
    }

    formatearRango(vac: any): string {
        if (!vac.fecha_inicio || !vac.fecha_final) return '';
        const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
        const inicio = new Date(vac.fecha_inicio + 'T00:00:00').toLocaleDateString('es-ES', options);
        const fin = new Date(vac.fecha_final + 'T00:00:00').toLocaleDateString('es-ES', options);
        return `${inicio} - ${fin}`;
    }

    obtenerIniciales(nombre: string): string {
        if (!nombre) return 'U';
        return nombre.split(' ').filter(n => n).map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}
