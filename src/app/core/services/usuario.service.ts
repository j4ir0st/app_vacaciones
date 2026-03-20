import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Usuario } from '../models/usuario.model';

@Injectable({
    providedIn: 'root'
})
export class UsuarioService {
    private readonly URL_USUARIOS = `${environment.apiUrl}/users/?format=json`;

    constructor(private http: HttpClient) { }

    // Obtiene la lista completa de usuarios activos (soporta paginación DRF)
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
