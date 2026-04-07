import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

// Definición de elementos del menú de navegación
interface ElementoMenu {
    ruta: string;
    etiqueta: string;
    icono: string;
    soloAprobador?: boolean; // Visible para jefes/gerentes
}

@Component({
    selector: 'app-navbar',
    templateUrl: './navbar.component.html',
    styleUrls: ['./navbar.component.css'],
    standalone: false
})
export class NavbarComponent {
    @Input() expandido = true;
    @Output() toggleMenu = new EventEmitter<void>();

    // Elementos del menú lateral (Sincronizado con PowerApps)
    elementosMenu: ElementoMenu[] = [
        { ruta: '/dashboard', etiqueta: 'Panel de Control', icono: 'home' },
        { ruta: '/mis-solicitudes', etiqueta: 'Mis Solicitudes', icono: 'airplane' },
        { ruta: '/calendario', etiqueta: 'Calendario', icono: 'calendar' },
        { ruta: '/aprobaciones', etiqueta: 'Aprobaciones', icono: 'check', soloAprobador: true },
        { ruta: '/usuarios', etiqueta: 'Adm. Usuarios', icono: 'person', soloAprobador: true },
        { ruta: '/reportes', etiqueta: 'Reportes', icono: 'message', soloAprobador: true },
    ];

    constructor(public authService: AuthService, private router: Router) { }

    // Alterna el estado del menú
    alternar(): void {
        this.toggleMenu.emit();
    }

    // Verifica si un elemento del menu debe mostrarse
    debeVerse(elemento: ElementoMenu): boolean {
        if (elemento.soloAprobador) return this.authService.esAprobador;
        return true;
    }

    // Verifica si la ruta está activa
    estaActivo(ruta: string): boolean {
        return this.router.url.startsWith(ruta);
    }
}
