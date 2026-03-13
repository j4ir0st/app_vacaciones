import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

// Definición de elementos del menú de navegación
interface ElementoMenu {
    ruta: string;
    etiqueta: string;
    icono: string;
    soloAprobador?: boolean; // Solo visible para jefes/gerentes
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

    // Elementos del menú lateral
    elementosMenu: ElementoMenu[] = [
        { ruta: '/dashboard', etiqueta: 'Panel de Control', icono: 'dashboard' },
        { ruta: '/mis-solicitudes', etiqueta: 'Mis Solicitudes', icono: 'solicitudes' },
        { ruta: '/calendario', etiqueta: 'Calendario', icono: 'calendario' },
        { ruta: '/admin', etiqueta: 'Administración', icono: 'admin', soloAprobador: true },
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
