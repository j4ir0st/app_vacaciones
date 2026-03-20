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
    cargandoUsuarios = true;
    usuarios: Usuario[] = [];
    textoBusqueda = '';
    usuarioADesactivar: Usuario | null = null;

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

    cargarDatos(): void {
        this.cargandoUsuarios = true;

        this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => {
                return resp.next ? this.usuarioService.obtenerUsuarios(resp.next) : EMPTY
            }),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        ).subscribe({
            next: (listaUsuarios: Usuario[]) => {
                this.usuarios = listaUsuarios;
                this.cargandoUsuarios = false;
            },
            error: (err) => {
                console.error('Error cargando usuarios:', err);
                this.cargandoUsuarios = false;
            }
        });
    }


    get usuariosFiltrados(): Usuario[] {
        if (!this.textoBusqueda.trim()) return this.usuarios;
        const busq = this.textoBusqueda.toLowerCase();
        return this.usuarios.filter(u =>
            `${u.first_name} ${u.last_name} ${u.username} ${u.area_id?.nombre || u.area}`.toLowerCase().includes(busq)
        );
    }

    iniciarDesactivacion(usuario: Usuario): void {
        this.usuarioADesactivar = usuario;
    }

    cambiarEstadoUsuario(): void {
        if (!this.usuarioADesactivar) return;
        const nuevoEstado = !this.usuarioADesactivar.is_active;

        this.usuarioService.actualizarUsuario(this.usuarioADesactivar.url, { is_active: nuevoEstado })
            .subscribe({
                next: () => {
                    this.usuarioADesactivar = null;
                    this.cargarDatos();
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
}
