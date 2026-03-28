import { Component, OnInit } from '@angular/core';
import { expand, map, reduce } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { RefreshService } from '../core/services/refresh.service';
import { Usuario } from '../core/models/usuario.model';
import { environment } from '../../environments/environment';

@Component({
    selector: 'app-usuarios',
    templateUrl: './usuarios.component.html',
    styleUrls: ['./usuarios.component.css'],
    standalone: false
})
export class UsuariosComponent implements OnInit {
    cargandoUsuarios = false;
    usuarios: Usuario[] = [];
    textoBusqueda = '';
    usuarioADesactivar: Usuario | null = null;
    proximaPagina: string | null = null;

    constructor(
        public authService: AuthService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService,
        private refreshService: RefreshService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();

        this.refreshService.refresh$.subscribe(() => {
            this.cargarDatos();
        });
    }

    /**
     * Carga de usuarios con soporte para paginación (scroll infinito).
     */
    cargarDatos(nuevaPagina: boolean = false): void {
        if (this.cargandoUsuarios) return;

        const url = nuevaPagina && this.proximaPagina ? this.proximaPagina : undefined;

        if (!nuevaPagina) {
            this.usuarios = [];
            this.proximaPagina = null;
        }

        this.cargandoUsuarios = true;

        this.usuarioService.obtenerUsuarios(url).subscribe({
            next: (resp: any) => {
                const results = Array.isArray(resp) ? resp : (resp.results || []);
                const usuarioActual = this.authService.usuarioActual;

                if (usuarioActual) {
                    const filtrados = this.filtrarUsuariosSegunRol(usuarioActual, results);
                    this.usuarios = [...this.usuarios, ...filtrados];
                } else {
                    this.usuarios = [...this.usuarios, ...results];
                }

                this.proximaPagina = resp.next || null;
                this.cargandoUsuarios = false;

                // Si se filtraron todos los de esta página pero hay más, intentamos cargar automáticamente
                if (nuevaPagina && this.usuarios.length < 5 && this.proximaPagina) {
                    this.cargarDatos(true);
                }
            },
            error: (err) => {
                console.error('Error cargando usuarios:', err);
                this.cargandoUsuarios = false;
            }
        });
    }

    /**
     * Detecta el scroll para cargar más datos al llegar al final.
     */
    onScroll(event: any): void {
        const element = event.target;
        if (element.scrollHeight - element.scrollTop <= element.clientHeight + 100) {
            if (this.proximaPagina && !this.cargandoUsuarios) {
                this.cargarDatos(true);
            }
        }
    }

    /**
     * Lógica de visibilidad heredada de Reportes.
     */
    private filtrarUsuariosSegunRol(autor: Usuario, lista: Usuario[]): Usuario[] {
        const puesto = (autor.puesto_id?.nombre || '').toLowerCase();
        const area = (autor.area_id?.nombre || '').toLowerCase();
        const esGerenteOJefe = puesto.includes('gerente') || puesto.includes('jefe');

        if (esGerenteOJefe) {
            // Caso especial: Katherine Lewis (basado en username 'klewis')
            if (autor.username.toLowerCase() === 'klewis') {
                const areasKatherine = [
                    'contabilidad', 'mantenimiento', 'provincia', 'vigilancia', 'finanzas',
                    'neurocirugía', 'traumatología', 'heridas y quemados', 'regulatorios',
                    'terapia de sueño y apnea', 'ingeniería', 'marketing', 'licitaciones',
                    'equipos médicos', 'casa', 'cdc'
                ];
                return lista.filter(u => {
                    const areaU = (u.area_id?.nombre || '').toLowerCase();
                    return areasKatherine.includes(areaU);
                });
            }

            // Caso especial: Operaciones
            if (area === 'operaciones') {
                const areasOperaciones = [
                    'distribución', 'atenciones', 'almacenes', 'facturación',
                    'desarrollo software', 'logística inversa'
                ];
                return lista.filter(u => {
                    const areaU = (u.area_id?.nombre || '').toLowerCase();
                    return areasOperaciones.includes(areaU);
                });
            }

            // Gerente/Jefe estándar ve solo su área
            return lista.filter(u => {
                const areaU = (u.area_id?.nombre || '').toLowerCase();
                return areaU === area;
            });
        }

        // Otros roles ven solo su propia área
        return lista.filter(u => {
            const areaU = (u.area_id?.nombre || '').toLowerCase();
            return areaU === area;
        });
    }

    get usuariosFiltrados(): Usuario[] {
        if (!this.textoBusqueda.trim()) return this.usuarios;
        const busq = this.textoBusqueda.toLowerCase();
        return this.usuarios.filter(u =>
            `${u.first_name} ${u.last_name} ${u.username} ${u.area_id?.nombre || u.area}`.toLowerCase().includes(busq)
        );
    }

    get esGerente(): boolean {
        const puesto = (this.authService.usuarioActual?.area_puesto?.puesto_nombre ||
            this.authService.usuarioActual?.puesto_id?.nombre || '').toLowerCase();
        return puesto.includes('gerente');
    }

    iniciarDesactivacion(usuario: Usuario): void {
        if (!this.esGerente) return;
        this.usuarioADesactivar = usuario;
    }

    cambiarEstadoUsuario(): void {
        if (!this.usuarioADesactivar || !this.esGerente) return;
        const nuevoEstado = !this.usuarioADesactivar.is_active;

        this.usuarioService.actualizarUsuario(this.usuarioADesactivar.url, { is_active: nuevoEstado })
            .subscribe({
                next: () => {
                    // Actualizamos el estado en la lista local para evitar recarga completa si es posible
                    const index = this.usuarios.findIndex(u => u.url === this.usuarioADesactivar!.url);
                    if (index !== -1) {
                        this.usuarios[index].is_active = nuevoEstado;
                    }
                    this.usuarioADesactivar = null;
                },
                error: (err) => {
                    console.error('Error al cambiar estado de usuario', err);
                    this.usuarioADesactivar = null;
                }
            });
    }

    obtenerIniciales(usuario: Usuario): string {
        return (usuario.first_name?.[0] || '') + (usuario.last_name?.[0] || '');
    }

    irACrearUsuario(): void {
        console.log('Navegando a creación de usuario...');
        // TODO: Implementar navegación o abrir modal según requerimiento futuro
    }
}
