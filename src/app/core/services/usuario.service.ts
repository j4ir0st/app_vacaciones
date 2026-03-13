import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Usuario } from '../models/usuario.model';

@Injectable({
    providedIn: 'root'
})
export class UsuarioService {
    private readonly URL_USUARIOS = `${environment.apiUrl}/users/?format=json`;

    constructor(private http: HttpClient) { }

    // Obtiene la lista completa de usuarios activos
    obtenerUsuarios(): Observable<Usuario[]> {
        return this.http.get<Usuario[]>(this.URL_USUARIOS);
    }

    // Obtiene usuarios de un área específica (usa la URL del área para precisión en DRF)
    obtenerUsuariosPorArea(areaIdentificador: string): Observable<Usuario[]> {
        return this.http.get<Usuario[]>(`${this.URL_USUARIOS}&area_id=${encodeURIComponent(areaIdentificador)}`);
    }

    // Obtiene un usuario específico por su URL
    obtenerUsuario(url: string): Observable<Usuario> {
        const urlConFormato = url.includes('?') ? `${url}&format=json` : `${url}?format=json`;
        return this.http.get<Usuario>(urlConFormato);
    }

    // Actualiza parcialmente un usuario (PATCH a su URL directa)
    actualizarUsuario(url: string, datos: Partial<Usuario>): Observable<Usuario> {
        return this.http.patch<Usuario>(url, datos);
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
