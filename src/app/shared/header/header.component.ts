import { Component, Output, EventEmitter } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { RefreshService } from '../../core/services/refresh.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { Usuario } from '../../core/models/usuario.model';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css'],
    standalone: false
})
export class HeaderComponent {
    @Output() toggleMenu = new EventEmitter<void>();

    // Controla visibilidad del dropdown de perfil
    menuPerfilAbierto = false;

    constructor(
        public authService: AuthService,
        private refreshService: RefreshService,
        private usuarioService: UsuarioService
    ) { }

    // Obtiene el nombre completo del usuario actual
    get nombreUsuario(): string {
        const usuario = this.authService.usuarioActual;
        if (!usuario) return '';
        return `${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username;
    }

    // Obtiene el cargo/área del usuario (Badge combinado)
    get cargoUsuario(): string {
        const usuario = this.authService.usuarioActual;
        if (!usuario) return 'Usuario';
        const area = usuario.area_id?.nombre || usuario.area || 'Área';
        const puesto = usuario.puesto_id?.nombre || 'Puesto';
        return `${area} - ${puesto}`;
    }

    // Obtiene la URL del avatar o usa iniciales
    get avatarUrl(): string | null {
        return this.authService.usuarioActual?.avatar || null;
    }

    // Iniciales del usuario para el avatar por defecto
    get inicialesUsuario(): string {
        const usuario = this.authService.usuarioActual;
        if (!usuario) return 'U';
        const nombre = usuario.first_name?.[0] || '';
        const apellido = usuario.last_name?.[0] || '';
        return (nombre + apellido).toUpperCase() || usuario.username[0].toUpperCase();
    }

    // Obtiene el email del usuario
    get emailUsuario(): string {
        return this.authService.usuarioActual?.email || '';
    }

    // Obtiene la empresa del usuario
    get empresaUsuario(): string {
        return this.authService.usuarioActual?.empr_id || '';
    }

    // Verifica si el usuario es staff (Administrador)
    get esAdmin(): boolean {
        return this.authService.usuarioActual?.is_staff || false;
    }

    alternarMenuPerfil(): void {
        this.menuPerfilAbierto = !this.menuPerfilAbierto;
    }

    refrescarManual(): void {
        console.log('Limpiando caché y disparando refresco manual desde el logo...');
        this.usuarioService.limpiarCache();
        this.refreshService.triggerRefresh();
    }

    cerrarSesion(): void {
        this.authService.cerrarSesion();
    }
}
