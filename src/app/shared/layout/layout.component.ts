import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';

@Component({
    selector: 'app-layout',
    templateUrl: './layout.component.html',
    styleUrls: ['./layout.component.css'],
    standalone: false
})
export class LayoutComponent implements OnInit {
    // Controla si el menú lateral está expandido o colapsado
    menuExpandido = true;

    constructor(public authService: AuthService, private router: Router) { }

    ngOnInit(): void {
        // En dispositivos móviles iniciamos con el menú colapsado
        if (typeof window !== 'undefined' && window.innerWidth <= 768) {
            this.menuExpandido = false;
        }
    }

    // Alterna el estado del menú lateral
    alternarMenu(): void {
        this.menuExpandido = !this.menuExpandido;
    }
}
