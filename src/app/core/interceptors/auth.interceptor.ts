import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { NotificacionService } from '../services/notificacion.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    private refrescando = false;
    private refreshSubject = new BehaviorSubject<string | null>(null);

    constructor(
        private authService: AuthService,
        private notificacionService: NotificacionService
    ) { }

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // No interceptamos la propia petición de refresco para evitar recursión infinita
        if (req.url.includes('/api/token/refresh/')) {
            return next.handle(req);
        }

        // Agrega el token de autorización a todas las demás peticiones a la API
        const token = this.authService.tokenAcceso;
        const reqConToken = token ? this.agregarToken(req, token) : req;

        return next.handle(reqConToken).pipe(
            catchError((error: HttpErrorResponse) => {
                // Si el error es 401 (Unauthorized)
                if (error.status === 401) {
                    // Si existe un token previo, intentamos refrescarlo
                    if (token) {
                        return this.manejarTokenExpirado(req, next);
                    } else {
                        // Si no hay token y dio 401, redirigimos al login (sesión no iniciada o perdida)
                        this.notificarYRedirigir();
                    }
                }
                return throwError(() => error);
            })
        );
    }

    // Agrega el header Authorization con el token JWT
    private agregarToken(req: HttpRequest<any>, token: string): HttpRequest<any> {
        return req.clone({
            setHeaders: { Authorization: `Bearer ${token}` }
        });
    }

    // Maneja el caso en que el token expiró - intenta refrescarlo
    private manejarTokenExpirado(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        if (this.refrescando) {
            // Esperar a que termine el refresco en curso
            return this.refreshSubject.pipe(
                filter(token => token !== null),
                take(1),
                switchMap(token => next.handle(this.agregarToken(req, token!)))
            );
        }

        this.refrescando = true;
        this.refreshSubject.next(null);

        return this.authService.refrescarToken().pipe(
            switchMap((resp) => {
                this.refrescando = false;
                this.refreshSubject.next(resp.access);
                return next.handle(this.agregarToken(req, resp.access));
            }),
            catchError(err => {
                this.refrescando = false;
                // Notificamos fallo en el refresco y redirigimos
                this.notificarYRedirigir();
                return throwError(() => err);
            })
        );
    }

    /**
     * Muestra mensaje de error y redirige al login tras una breve pausa
     */
    private notificarYRedirigir(): void {
        this.notificacionService.mostrar(
            'Sesión expirada o no válida. Redirigiendo al inicio de sesión...', 
            'error', 
            3000
        );

        // Retardo para que el usuario pueda leer el mensaje antes de la redirección
        setTimeout(() => {
            this.authService.cerrarSesion();
        }, 800);
    }
}
