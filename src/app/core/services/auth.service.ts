import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, catchError, throwError, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RespuestaToken, SesionUsuario, Usuario } from '../models/usuario.model';

// Grupos con permisos de aprobación de vacaciones
const GRUPOS_APROBADORES = ['Jefes', 'Gerentes', 'Administradores', 'jefes', 'gerentes', 'administradores'];

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private readonly CLAVE_SESION = 'vacaciones_sesion';
    private readonly URL_TOKEN = `${environment.apiUrl}/api/token/?format=json`;
    private readonly URL_REFRESH = `${environment.apiUrl}/api/token/refresh/?format=json`;
    private readonly URL_USUARIOS = `${environment.apiUrl}/users/?format=json`;

    // Observable para que los componentes reaccionen a cambios de sesión
    private sesionSubject = new BehaviorSubject<SesionUsuario | null>(this.cargarSesion());
    public sesion$ = this.sesionSubject.asObservable();

    constructor(private http: HttpClient, private router: Router) { }

    // Inicia sesión con usuario y contraseña
    iniciarSesion(username: string, password: string): Observable<any> {
        console.log('Iniciando sesión para:', username);
        return this.http.post<RespuestaToken>(this.URL_TOKEN, { username, password }).pipe(
            switchMap((resp: RespuestaToken) => {
                console.log('Token obtenido con éxito. Buscando datos del usuario con filtro de servidor...');
                // Buscamos directamente al usuario por su username para eficiencia
                const urlFiltrada = `${this.URL_USUARIOS}&username=${encodeURIComponent(username)}`;

                return this.http.get<any>(urlFiltrada, {
                    headers: { Authorization: `Bearer ${resp.access}` }
                }).pipe(
                    tap((respUsuarios: any) => {
                        // DRF puede devolver un array o un objeto paginado { results: [] }
                        const usuarios: Usuario[] = Array.isArray(respUsuarios) ? respUsuarios : (respUsuarios.results || []);

                        // Buscamos en los resultados (debería haber solo uno o pocos)
                        const usuarioActual = usuarios.find(u =>
                            u.username.toLowerCase() === username.toLowerCase() ||
                            u.email.toLowerCase() === username.toLowerCase()
                        );

                        if (!usuarioActual) {
                            console.error('Usuario no encontrado tras filtrar por username:', username);
                            throw new Error(`El usuario '${username}' no está registrado en el sistema de personal.`);
                        }

                        console.log('Usuario encontrado y verificado:', usuarioActual.username);
                        const sesion: SesionUsuario = {
                            token: resp.access,
                            refresh: resp.refresh,
                            usuario: usuarioActual
                        };
                        this.guardarSesion(sesion);
                    })
                );
            }),
            catchError(err => {
                console.error('Error en autenticación:', err);
                let mensaje = 'Error de conexión con el servidor.';

                if (err.status === 401) {
                    mensaje = 'Credenciales incorrectas.';
                } else if (err.status === 403) {
                    mensaje = 'No tienes permiso para acceder a esta aplicación.';
                } else if (err.error?.detail) {
                    mensaje = err.error.detail;
                } else if (err.message) {
                    mensaje = err.message;
                } else if (typeof err === 'string') {
                    mensaje = err;
                }

                return throwError(() => new Error(mensaje));
            })
        );
    }

    // Cierra la sesión y redirige al login
    cerrarSesion(): void {
        localStorage.removeItem(this.CLAVE_SESION);
        this.sesionSubject.next(null);
        this.router.navigate(['/login']);
    }

    // Verifica si el usuario está autenticado
    get estaAutenticado(): boolean {
        return this.sesionSubject.value !== null;
    }

    // Obtiene el usuario actual de la sesión
    get usuarioActual(): Usuario | null {
        return this.sesionSubject.value?.usuario ?? null;
    }

    // Obtiene el token de acceso actual
    get tokenAcceso(): string | null {
        return this.sesionSubject.value?.token ?? null;
    }

    // Obtiene el nombre completo del usuario actual
    get nombreCompleto(): string {
        const u = this.usuarioActual;
        if (!u) return '';
        return `${u.first_name} ${u.last_name}`.trim() || u.username;
    }

    // Verifica si el usuario tiene rol de aprobador (jefe/gerente)
    get esAprobador(): boolean {
        const grupos = this.usuarioActual?.groups ?? [];
        return grupos.some(g => GRUPOS_APROBADORES.includes(g));
    }

    // Refresca el token de acceso usando el refresh token
    refrescarToken(): Observable<any> {
        const refresh = this.sesionSubject.value?.refresh;
        if (!refresh) return throwError(() => new Error('Sin token de refresco'));

        return this.http.post<{ access: string }>(this.URL_REFRESH, { refresh }).pipe(
            tap(resp => {
                const sesionActual = this.sesionSubject.value;
                if (sesionActual) {
                    const sesionActualizada = { ...sesionActual, token: resp.access };
                    this.guardarSesion(sesionActualizada);
                }
            })
        );
    }

    // Carga la sesión desde localStorage
    private cargarSesion(): SesionUsuario | null {
        try {
            const datos = localStorage.getItem(this.CLAVE_SESION);
            return datos ? JSON.parse(datos) : null;
        } catch {
            return null;
        }
    }

    // Guarda la sesión en localStorage y actualiza el Subject
    private guardarSesion(sesion: SesionUsuario): void {
        localStorage.setItem(this.CLAVE_SESION, JSON.stringify(sesion));
        this.sesionSubject.next(sesion);
    }
}
