import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { RefreshService } from '../core/services/refresh.service';
import { SolicitudVacaciones, EstadoSolicitud } from '../core/models/solicitud-vacaciones.model';
import { Usuario } from '../core/models/usuario.model';

type FiltroAdmin = 'Pendiente' | 'Aprobado' | 'Rechazado' | 'Todos';

interface FilaSolicitud extends SolicitudVacaciones {
    nombreUsuario: string;
    avatarUsuario: string | null;
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
    opcionesFiltroAdmin: FiltroAdmin[] = ['Pendiente', 'Aprobado', 'Rechazado', 'Todos'];

    // Datos de usuarios
    usuarios: Usuario[] = [];
    textoBusqueda = '';

    // Confirmación de acción
    solicitudEnAccion: FilaSolicitud | null = null;
    accionPendiente: 'aprobar' | 'rechazar' | null = null;
    usuarioADesactivar: Usuario | null = null;

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
            console.log('Recibida señal de refresco en Admin');
            this.cargarDatos();
        });
    }

    cargarDatos(): void {
        forkJoin([
            this.solicitudService.obtenerSolicitudes(),
            this.usuarioService.obtenerUsuarios()
        ]).subscribe({
            next: ([todas, usuarios]: [SolicitudVacaciones[], Usuario[]]) => {
                this.usuarios = usuarios;
                this.todasSolicitudes = todas.map((s: SolicitudVacaciones): FilaSolicitud => {
                    const usu = usuarios.find((u: Usuario) => u.url === s.usuario_id);
                    return {
                        ...s,
                        nombreUsuario: usu
                            ? `${usu.first_name} ${usu.last_name}`.trim() || usu.username
                            : s.usuario_id,
                        avatarUsuario: usu?.avatar || null
                    };
                }).sort((a: FilaSolicitud, b: FilaSolicitud) => (b.fecha_inicio || '').localeCompare(a.fecha_inicio || ''));

                this.aplicarFiltroSolicitudes();
                this.cargandoSolicitudes = false;
                this.cargandoUsuarios = false;
            },
            error: (err: any) => {
                this.cargandoSolicitudes = false;
                this.cargandoUsuarios = false;
            }
        });
    }

    // Aplica el filtro de estado en la sección de solicitudes
    aplicarFiltroSolicitudes(): void {
        if (this.filtroEstado === 'Todos') {
            this.solicitudesFiltradas = [...this.todasSolicitudes];
        } else {
            const mapFiltroACodigo: Record<string, string> = {
                'Pendiente': 'PD',
                'Aprobado': 'AP',
                'Rechazado': 'RC'
            };
            const codigoBuscado = mapFiltroACodigo[this.filtroEstado];
            this.solicitudesFiltradas = this.todasSolicitudes.filter(
                (s: FilaSolicitud) => this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud) === codigoBuscado
            );
        }
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

    // Inicia acción de aprobación/rechazo de solicitud
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
