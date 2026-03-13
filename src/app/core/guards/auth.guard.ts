import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
    providedIn: 'root'
})
export class AuthGuard implements CanActivate {
    constructor(private authService: AuthService, private router: Router) { }

    canActivate(route: ActivatedRouteSnapshot): boolean {
        // Si no está autenticado, redirigir al login
        if (!this.authService.estaAutenticado) {
            this.router.navigate(['/login']);
            return false;
        }

        // Verificar si la ruta requiere rol de aprobador
        const requiereAprobador = route.data['requiereAprobador'];
        if (requiereAprobador && !this.authService.esAprobador) {
            this.router.navigate(['/dashboard']);
            return false;
        }

        return true;
    }
}
