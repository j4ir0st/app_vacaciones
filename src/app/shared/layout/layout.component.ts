import { Component } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';

@Component({
    selector: 'app-layout',
    templateUrl: './layout.component.html',
    styleUrls: ['./layout.component.css'],
    standalone: false
})
export class LayoutComponent {
    // Controla si el menú lateral está expandido o colapsado
    menuExpandido = true;

    constructor(public authService: AuthService, private router: Router) { }

    // Alterna el estado del menú lateral
    alternarMenu(): void {
        this.menuExpandido = !this.menuExpandido;
    }
}
