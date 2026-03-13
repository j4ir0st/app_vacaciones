import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    private refrescando = false;
    private refreshSubject = new BehaviorSubject<string | null>(null);

    constructor(private authService: AuthService) { }

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // Agrega el token de autorización a todas las peticiones a la API
        const token = this.authService.tokenAcceso;
        const reqConToken = token ? this.agregarToken(req, token) : req;

        return next.handle(reqConToken).pipe(
            catchError((error: HttpErrorResponse) => {
                // Si el token expiró (401), intentar refrescarlo
                if (error.status === 401 && token) {
                    return this.manejarTokenExpirado(req, next);
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
                this.authService.cerrarSesion();
                return throwError(() => err);
            })
        );
    }
}
