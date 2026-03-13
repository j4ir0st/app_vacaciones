import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { RefreshService } from '../core/services/refresh.service';
import { SolicitudVacaciones, ResumenVacaciones } from '../core/models/solicitud-vacaciones.model';
import { Usuario } from '../core/models/usuario.model';
import { Router } from '@angular/router';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent implements OnInit {
    // Estado de carga
    cargando = true;

    // Resumen de vacaciones del usuario actual
    resumen: ResumenVacaciones = {
        diasAcumulados: 0,
        diasTomados: 0,
        diasPendientes: 0,
        diasTruncos: 0,
        solicitudesAprobadas: 0,
        solicitudesPendientes: 0,
        solicitudesRechazadas: 0,
    };

    // Próximas vacaciones del equipo (solicitudes aprobadas futuras)
    proximasVacaciones: Array<SolicitudVacaciones & { nombreUsuario: string; avatarUsuario: string | null }> = [];

    // Porcentaje de vacaciones anuales utilizadas
    get porcentajeUtilizado(): number {
        if (this.resumen.diasAcumulados === 0) return 0;
        return Math.round((this.resumen.diasTomados / this.resumen.diasAcumulados) * 100);
    }

    // Porcentaje de días truncos restantes
    get porcentajeTruncos(): number {
        return Math.round((this.resumen.diasTruncos / 2.5) * 100);
    }

    constructor(
        public authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        private vacacionesService: VacacionesService,
        private refreshService: RefreshService,
        private router: Router
    ) { }

    ngOnInit(): void {
        this.cargarDatos();

        // Escuchar refrescos manuales
        this.refreshService.refresh$.subscribe(() => {
            console.log('Recibida señal de refresco en Dashboard');
            this.cargarDatos();
        });
    }

    // Carga todos los datos necesarios para el dashboard
    cargarDatos(): void {
        this.cargando = true;
        const urlUsuario = this.authService.usuarioActual?.url || '';

        forkJoin({
            solicitudes: this.solicitudService.obtenerSolicitudes(),
            usuarios: this.usuarioService.obtenerUsuarios()
        }).subscribe({
            next: ({ solicitudes, usuarios }) => {
                // Manejar tanto arrays directos como objetos de paginación de DRF
                const listaSolicitudes: SolicitudVacaciones[] = Array.isArray(solicitudes) ? solicitudes : (solicitudes.results || []);
                
                // Filtrar solicitudes propias
                const misSolicitudes = listaSolicitudes.filter((s: SolicitudVacaciones) => s.usuario_id === urlUsuario);
                
                // Calcular resumen de vacaciones
                this.resumen = this.vacacionesService.calcularResumen(
                    this.authService.usuarioActual?.fecha_ingreso || '',
                    misSolicitudes
                );

                // Calculamos las próximas vacaciones del equipo (solicitudes aprobadas con fechas futuras o actuales)
                const hoy = new Date().toISOString().split('T')[0];
                const mapaUsuarios = new Map<string, Usuario>(usuarios.map(u => [u.url, u]));

                this.proximasVacaciones = listaSolicitudes
                    .filter((s: SolicitudVacaciones) => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === 'AP' && (s.fecha_final || '') >= hoy)
                    .sort((a, b) => (a.fecha_inicio || '').localeCompare(b.fecha_inicio || ''))
                    // Mostramos solo los primeros 6 registros para no sobrecargar el panel
                    .slice(0, 6)
                    .map((s: SolicitudVacaciones) => {
                        const usuarioSol = mapaUsuarios.get(s.usuario_id || '');
                        return {
                            ...s,
                            nombreUsuario: usuarioSol
                                ? `${usuarioSol.first_name} ${usuarioSol.last_name}`.trim() || usuarioSol.username
                                : 'Usuario desconocido',
                            avatarUsuario: usuarioSol?.avatar || null
                        } as any;
                    });

                this.cargando = false;
            },
            error: () => { this.cargando = false; }
        });
    }

    // Navega a la vista de nueva solicitud
    nuevaSolicitud(): void {
        this.router.navigate(['/mis-solicitudes'], { queryParams: { nueva: 'true' } });
    }

    // Formatea el rango de fechas de una solicitud
    formatearRango(solicitud: SolicitudVacaciones): string {
        return this.vacacionesService.formatearRangoFechas(solicitud.fecha_inicio, solicitud.fecha_final);
    }

    // Obtiene las iniciales del nombre para el avatar
    obtenerIniciales(nombre: string): string {
        const partes = nombre.trim().split(' ');
        return (partes[0]?.[0] || '') + (partes[1]?.[0] || '');
    }
}
