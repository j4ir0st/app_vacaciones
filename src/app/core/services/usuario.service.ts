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
    obtenerUsuariosTodo(forzarRefresco: boolean = false, soloActivos: boolean = false): Observable<Usuario[]> {
        const ahora = Date.now();
        const cacheExpirada = ahora - this.ultimaActualizacion > this.TTL_CACHE;

        // Si pedimos solo activos, ignoramos la caché general por ahora para asegurar precisión del backend
        if (!forzarRefresco && !soloActivos && this.usuariosCache && !cacheExpirada) {
            return of(this.usuariosCache);
        }

        let url = this.URL_USUARIOS;
        if (soloActivos) {
            url += '&is_active=true';
        }

        return this.http.get<any>(url).pipe(
            expand((resp: any) => resp.next ? this.http.get<any>(this.fixUrl(resp.next)) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: Usuario[], curr: Usuario[]) => acc.concat(curr), []),
            tap(usuarios => {
                // Solo cacheamos si es la lista completa (no solo activos)
                if (!soloActivos) {
                    this.usuariosCache = usuarios;
                    this.ultimaActualizacion = Date.now();
                }
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
    // Implementa recursividad para manejar la paginación y filtra solo usuarios activos.
    obtenerUsuariosPorNombreArea(nombresArea: string): Observable<Usuario[]> {
        const url = `${this.URL_USUARIOS}&area_nombre=${encodeURIComponent(nombresArea)}&is_active=true`;

        return this.http.get<any>(url).pipe(
            expand((resp: any) => resp.next ? this.http.get<any>(this.fixUrl(resp.next)) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: Usuario[], curr: Usuario[]) => acc.concat(curr), [])
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
    public fixUrl(url: string): string {
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

    /**
     * Verifica asíncronamente si un username existe.
     */
    verificarUsername(username: string): Observable<boolean> {
        return this.http.get<any>(`${this.URL_USUARIOS}&username=${encodeURIComponent(username)}`).pipe(
            map(resp => {
                const results = Array.isArray(resp) ? resp : (resp.results || []);
                return results.some((u: any) => u.username.toLowerCase() === username.toLowerCase());
            })
        );
    }

    /**
     * Obtiene la lista de Puestos desde el endpoint EU_Puesto.
     */
    obtenerPuestosRaw(): Observable<any[]> {
        return this.http.get<any>(`${environment.apiUrl}/EU_Puesto/?format=json`).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }

    /**
     * Obtiene la lista de Áreas desde el endpoint EU_Area.
     */
    obtenerAreasRaw(): Observable<any[]> {
        return this.http.get<any>(`${environment.apiUrl}/EU_Area/?format=json`).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }

    /**
     * Obtiene la lista de Empresas desde el endpoint Empresa.
     */
    obtenerEmpresas(): Observable<any[]> {
        return this.http.get<any>(`${environment.apiUrl}/Empresa/?format=json`).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }

    /**
     * Crea un usuario completo enviando datos multipart/form-data.
     */
    crearUsuarioCompleto(datos: FormData): Observable<any> {
        return this.http.post<any>(this.URL_USUARIOS, datos);
    }

    // ========================================
    // Resolución de Nombres de Firmantes
    // ========================================

    // Mapa interno para resolver URLs de usuarios a nombres completos
    private mapaUsuarios: Map<string, Usuario> = new Map();
    private mapaInicializado = false;

    /**
     * Construye el mapa de resolución de usuarios desde una lista.
     * Debe llamarse una vez desde cada componente que necesite resolver nombres.
     */
    construirMapaUsuarios(usuarios: Usuario[]): void {
        this.mapaUsuarios.clear();
        usuarios.forEach(u => {
            if (u.url) {
                this.mapaUsuarios.set(u.url.replace(/\/$/, ''), u);
            }
        });
        this.mapaInicializado = true;
    }

    /**
     * Inicializa el mapa cargando todos los usuarios del backend.
     * Solo lo hace si el mapa está vacío (lazy initialization).
     */
    inicializarMapa(): Observable<Usuario[]> {
        if (this.mapaInicializado && this.mapaUsuarios.size > 0) {
            return of(Array.from(this.mapaUsuarios.values()));
        }

        return this.obtenerUsuariosTodo().pipe(
            tap(usuarios => this.construirMapaUsuarios(usuarios))
        );
    }

    /**
     * Resuelve el nombre completo de un usuario a partir de su URL (jefe_id, gerente_id, etc.).
     */
    resolverNombrePorUrl(url: string | null | undefined): string {
        if (!url) return '';
        const urlNormalizada = url.replace(/\/$/, '');
        const usuario = this.mapaUsuarios.get(urlNormalizada);
        return usuario ? `${usuario.first_name} ${usuario.last_name}`.trim() : '';
    }

    /**
     * Resuelve el nombre del solicitante (usuario_id puede ser string URL o objeto).
     */
    resolverNombreSolicitante(solicitud: any): string {
        if (!solicitud) return '';
        if (typeof solicitud.usuario_id === 'object' && solicitud.usuario_id?.fullname) {
            return solicitud.usuario_id.fullname;
        }
        if (typeof solicitud.usuario_id === 'string') {
            return this.resolverNombrePorUrl(solicitud.usuario_id);
        }
        return solicitud.nombreUsuario || '';
    }
}
