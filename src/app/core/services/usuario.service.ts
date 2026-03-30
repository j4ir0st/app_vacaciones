import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, of, tap, expand, reduce, EMPTY } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Usuario } from '../models/usuario.model';

@Injectable({
    providedIn: 'root'
})
export class UsuarioService {
    private readonly URL_USUARIOS = `${environment.apiUrl}/users/?format=json`;

    // Caché de usuarios en memoria
    private usuariosCache: Usuario[] | null = null;
    private ultimaActualizacion: number = 0;
    private readonly TTL_CACHE = 24 * 60 * 60 * 1000; // 24 horas en ms

    constructor(private http: HttpClient) { }

    /**
     * Obtiene todos los usuarios usando recursividad para manejar la paginación de DRF.
     * Implementa una caché de 24 horas.
     */
    obtenerUsuariosTodo(forzarRefresco: boolean = false): Observable<Usuario[]> {
        const ahora = Date.now();
        const cacheExpirada = ahora - this.ultimaActualizacion > this.TTL_CACHE;

        if (!forzarRefresco && this.usuariosCache && !cacheExpirada) {
            return of(this.usuariosCache);
        }

        return this.http.get<any>(this.URL_USUARIOS).pipe(
            expand((resp: any) => resp.next ? this.http.get<any>(this.fixUrl(resp.next)) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: Usuario[], curr: Usuario[]) => acc.concat(curr), []),
            tap(usuarios => {
                this.usuariosCache = usuarios;
                this.ultimaActualizacion = Date.now();
            })
        );
    }

    /**
     * Limpia la caché local para forzar una nueva petición al servidor.
     */
    limpiarCache(): void {
        this.usuariosCache = null;
        this.ultimaActualizacion = 0;
    }

    // Obtiene una página individual de usuarios (soporta paginación DRF)
    obtenerUsuarios(url: string = this.URL_USUARIOS): Observable<any> {
        return this.http.get<any>(this.fixUrl(url));
    }

    // Obtiene usuarios de un área específica (usa la URL del área para precisión en DRF)
    obtenerUsuariosPorArea(areaIdentificador: string): Observable<Usuario[]> {
        return this.http.get<any>(`${this.URL_USUARIOS}&area_id=${encodeURIComponent(areaIdentificador)}`).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }

    // Obtiene usuarios filtrando por nombre de área (puede recibir varios nombres separados por comas)
    obtenerUsuariosPorNombreArea(nombresArea: string): Observable<Usuario[]> {
        return this.http.get<any>(`${this.URL_USUARIOS}&area_nombre=${encodeURIComponent(nombresArea)}`).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }

    // Obtiene un usuario específico por su URL
    obtenerUsuario(url: string): Observable<Usuario> {
        let urlConFormato = this.fixUrl(url);
        if (!urlConFormato.includes('format=json')) {
            urlConFormato = urlConFormato.includes('?') ? `${urlConFormato}&format=json` : `${urlConFormato}?format=json`;
        }
        return this.http.get<Usuario>(urlConFormato);
    }

    // Actualiza parcialmente un usuario (PATCH a su URL directa)
    actualizarUsuario(url: string, datos: Partial<Usuario>): Observable<Usuario> {
        return this.http.patch<Usuario>(this.fixUrl(url), datos);
    }

    // Ajusta la URL para usar el proxy en lugar del dominio absoluto (evita CORS)
    private fixUrl(url: string): string {
        if (!url) return '';
        if (url.startsWith('http')) {
            return url.replace(/^https?:\/\/[^\/]+/, environment.apiUrl);
        }
        return url.startsWith('/') ? url : `${environment.apiUrl}/${url.includes('?') ? url : url + '/'}`;
    }

    // Desactiva un usuario en lugar de eliminarlo (is_active = false)
    desactivarUsuario(url: string): Observable<Usuario> {
        return this.actualizarUsuario(url, { is_active: false });
    }

    // Activa un usuario previamente desactivado
    activarUsuario(url: string): Observable<Usuario> {
        return this.actualizarUsuario(url, { is_active: true });
    }

    // Actualiza el avatar del usuario
    actualizarAvatar(url: string, avatar: string): Observable<Usuario> {
        return this.actualizarUsuario(url, { avatar });
    }

    // Obtiene el nombre completo de un usuario
    nombreCompleto(usuario: Usuario): string {
        return `${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username;
    }
}
