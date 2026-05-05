import { Component, OnInit } from '@angular/core';
import { forkJoin, EMPTY, from, of } from 'rxjs';
import { expand, map, reduce, concatMap, toArray, catchError } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { Usuario } from '../core/models/usuario.model';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';

interface FilaReporte {
    nombre: string;
    username: string;
    area: string;
    puesto: string;
    empresa: string;
    fechaIngreso: string;
    totalAcumulado: number;
    diasUtilizados: number;
    diasTruncos: number;
    diasPendientes: number;
    diasProgramados: number;
    claseColor: string;
    cargandoRow: boolean; // Flag para carga individual
    solicitudes: SolicitudVacaciones[]; // Historial para el detalle
}

@Component({
    selector: 'app-reportes',
    templateUrl: './reportes.component.html',
    styleUrls: ['./reportes.component.css'],
    standalone: false
})
export class ReportesComponent implements OnInit {
    cargando = false;
    usuarioSeleccionado: string = ''; // Almacena el username para el filtro
    filtroArea = '';

    todasLasFilas: FilaReporte[] = [];
    areasDisponibles: string[] = [];
    filaSeleccionada: FilaReporte | null = null;

    // Combobox de usuario con buscador
    usuariosFiltrados: Usuario[] = [];
    textoBusquedaUsuario = '';
    mostrarResultadosUsuario = false;

    constructor(
        private authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();
        this.usuarioService.inicializarMapa().subscribe();
    }

    /**
     * Carga inicial de usuarios y disparo de carga asíncrona de solicitudes por fila.
     */
    cargarDatos(): void {
        this.cargando = true;
        this.todasLasFilas = [];

        // 1. Obtenemos todos los usuarios activos (filtro backend is_active=true)
        this.usuarioService.obtenerUsuariosTodo(false, true).subscribe({
            next: (listaUsuarios: Usuario[]) => {
                const usuarioActual = this.authService.usuarioActual;
                if (!usuarioActual) {
                    this.cargando = false;
                    return;
                }

                // 2. Filtrar usuarios según lógica de roles
                const usuariosPermitidos = this.filtrarUsuariosSegunRol(usuarioActual, listaUsuarios);

                // 3. Inicializar tabla con valores en cero y estado "cargando"
                this.todasLasFilas = usuariosPermitidos.map(usuario => ({
                    nombre: `${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username,
                    username: usuario.username,
                    area: usuario.area_id?.nombre || 'Sin Área',
                    puesto: usuario.puesto_id?.nombre || 'Sin Puesto',
                    empresa: usuario.empr_id || 'Sin Empresa',
                    fechaIngreso: usuario.fecha_ingreso,
                    totalAcumulado: 0,
                    diasUtilizados: 0,
                    diasTruncos: 0,
                    diasPendientes: 0,
                    diasProgramados: 0,
                    claseColor: 'color-blanco',
                    cargandoRow: true,
                    solicitudes: []
                })).sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Preparar filtros rápidos
                this.areasDisponibles = Array.from(new Set(this.todasLasFilas.map(f => f.area))).sort();
                this.usuariosFiltrados = usuariosPermitidos;

                // 4. Iniciar la carga asíncrona de solicitudes para cada usuario
                this.procesarCargaPorFila(usuariosPermitidos);
            },
            error: (err) => {
                console.error('Error cargando usuarios para reporte:', err);
                this.cargando = false;
            }
        });
    }

    /**
     * Procesa las solicitudes de cada usuario de forma independiente para no bloquear la UI.
     */
    private procesarCargaPorFila(usuarios: Usuario[]): void {
        // Usamos from() para convertir el array en un stream y procesar cada uno
        from(usuarios).pipe(
            concatMap(u => {
                // Filtramos por el ID numérico proporcionado por el backend
                const params = `&usuario_id=${u.id}`;

                // Construimos la URL inicial con el filtro de usuario
                const urlInicial = `${this.solicitudService.URL_SOLICITUDES}${params}`;

                return this.solicitudService.obtenerSolicitudes(urlInicial).pipe(
                    // Lógica para obtener todas las páginas de solicitudes del usuario específico
                    expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next + params) : EMPTY),
                    // Nota: El backend de DRF a veces pierde los filtros en el 'next' si no están bien configurados,
                    // por eso concatenamos el params si no existe en la URL de next.
                    map((resp: any) => {
                        const results = Array.isArray(resp) ? resp : (resp.results || []);
                        return results.filter((s: any) => {
                            // usuario_id puede ser un objeto o un string
                            const idParaComparar = typeof s.usuario_id === 'string' ? s.usuario_id : '';
                            if (!idParaComparar && typeof s.usuario_id === 'object') return true;

                            const solUrl = idParaComparar.toLowerCase().replace(/\/$/, '');
                            const userUrl = (u.url || '').toLowerCase().replace(/\/$/, '');
                            return solUrl === userUrl || solUrl.endsWith(userUrl) || userUrl.endsWith(solUrl);
                        });
                    }),
                    reduce((acc: any[], curr: any[]) => acc.concat(curr), []),
                    map(solicitudes => ({ usuario: u, solicitudes })),
                    catchError(err => {
                        console.error(`Error cargando solicitudes para ${u.username}:`, err);
                        return of({ usuario: u, solicitudes: [] });
                    })
                );
            })
        ).subscribe({
            next: (resultado) => {
                this.actualizarFilaConDatos(resultado.usuario, resultado.solicitudes);
                // Si ya no quedan filas cargando, detenemos el spinner general
                if (!this.todasLasFilas.some(f => f.cargandoRow)) {
                    this.cargando = false;
                }
            },
            complete: () => {
                this.cargando = false;
            }
        });
    }

    /**
     * Realiza los cálculos de vacaciones para un usuario específico y actualiza su fila.
     */
    private actualizarFilaConDatos(usuario: Usuario, solicitudes: SolicitudVacaciones[]): void {
        const index = this.todasLasFilas.findIndex(f => f.username === usuario.username);
        if (index === -1) return;

        const resumen = this.vacacionesService.calcularResumen(usuario.fecha_ingreso, solicitudes);

        // Días programados: Solicitudes Aprobadas (AP) o Aprobado Supervisor (AS) que aún no se han usado (futuras)
        const diasProgramados = solicitudes
            .filter(s => {
                const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                const esEstadoValido = cod === 'AP' || cod === 'AS';
                return esEstadoValido && this.vacacionesService.esFechaFutura(s.fecha_inicio);
            })
            .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

        // Lógica de color según días pendientes
        let claseColor = 'color-blanco';
        if (resumen.diasPendientes >= 60) {
            claseColor = 'color-rojo-rechazado';
        } else if (resumen.diasPendientes >= 30) {
            claseColor = 'color-amarillo-pendiente';
        }

        this.todasLasFilas[index] = {
            ...this.todasLasFilas[index],
            totalAcumulado: resumen.diasAcumulados,
            diasUtilizados: resumen.diasTomados,
            diasTruncos: resumen.diasTruncos,
            diasPendientes: resumen.diasPendientes,
            diasProgramados: diasProgramados,
            claseColor: claseColor,
            cargandoRow: false,
            solicitudes: solicitudes
        };
    }

    verDetalle(fila: FilaReporte): void {
        if (fila.cargandoRow) return;
        this.filaSeleccionada = fila;
    }

    cerrarDetalle(): void {
        this.filaSeleccionada = null;
    }

    claseEstado(estado: any): string {
        const cod = this.vacacionesService.obtenerCodigoEstado(estado);
        switch (cod) {
            case 'AP': return 'status-aprobado';
            case 'RC': return 'status-rechazado';
            case 'PD': return 'status-pendiente';
            case 'AS': return 'status-supervisor';
            case 'CN': return 'status-cancelado';
            default: return 'status-pendiente';
        }
    }

    /**
     * Implementa la lógica de PowerApps para filtrar usuarios visibles.
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
                    'desarrollo software', 'logística inversa', 'operaciones'
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

    get filasFiltradas(): FilaReporte[] {
        return this.todasLasFilas.filter(f => {
            const coincideUsuario = !this.usuarioSeleccionado || f.username === this.usuarioSeleccionado;
            const coincideArea = !this.filtroArea || f.area === this.filtroArea;
            return coincideUsuario && coincideArea;
        });
    }

    // Getter para el combobox buscador de usuarios (filtra por nombre/apellido y área activa)
    get usuariosBuscados(): Usuario[] {
        const busqueda = this.textoBusquedaUsuario.toLowerCase().trim();
        // Filtrar por área si está seleccionada
        let base = this.usuariosFiltrados;
        if (this.filtroArea) {
            base = base.filter(u => (u.area_id?.nombre || u.area) === this.filtroArea);
        }

        if (!busqueda) return base;
        return base.filter(u => {
            const nombreCompleto = `${u.first_name} ${u.last_name}`.toLowerCase();
            return nombreCompleto.includes(busqueda);
        });
    }

    // Obtiene el nombre del usuario seleccionado para mostrar en el Combobox
    getNombreUsuarioSeleccionado(): string {
        if (!this.usuarioSeleccionado) return 'Filtrar por Colaborador';
        const user = this.usuariosFiltrados.find(u => u.username === this.usuarioSeleccionado);
        return user ? `${user.first_name} ${user.last_name}` : 'Filtrar por Colaborador';
    }

    // Selecciona un usuario del combobox
    seleccionarUsuarioCombobox(u: Usuario): void {
        this.usuarioSeleccionado = u.username || '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
    }

    // Limpia la selección de usuario
    limpiarSeleccionUsuario(): void {
        this.usuarioSeleccionado = '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
    }

    // Genera iniciales para el avatar
    obtenerIniciales(nombre: string): string {
        if (!nombre) return 'U';
        return nombre.split(' ')
            .filter(n => n)
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    private obtenerNombreEmpresa(id: number): string {
        const empresas: { [key: number]: string } = {
            1: 'Surgicorp',
            2: 'Surgivision',
            3: 'Surgilab',
            4: 'Surgimed'
        };
        return empresas[id] || 'N/A';
    }

    descargarDetallesFila(fila: FilaReporte): void {
        if (!fila || fila.solicitudes.length === 0) return;

        const cabeceras = [
            'id_solicitud', 'fecha_solicitud', 'tipo_solicitud', 'estado_solicitud',
            'jefe', 'fecha_jefe', 'gerente', 'fecha_gerente',
            'fecha_inicio', 'fecha_final', 'total_periodo', 'motivo', 'observaciones'
        ];

        const registros = fila.solicitudes.map(sol => {
            const tipoMap: Record<string, string> = { 'AT': 'Autorizado', 'AD': 'Adelanto' };
            
            const idSolicitud = sol.url?.split('?')[0].split('/').filter(x => x).pop() || '';
            
            return [
                idSolicitud,
                this.vacacionesService.formatearFechaHora(sol.fecha_solicitud || ''),
                tipoMap[sol.tipo_solicitud || ''] || sol.tipo_solicitud || '',
                this.vacacionesService.obtenerLabelEstado(sol.estado_solicitud),
                this.usuarioService.resolverNombrePorUrl(sol.jefe_id),
                this.vacacionesService.formatearFechaHora(sol.fecha_jefe || ''),
                this.usuarioService.resolverNombrePorUrl(sol.gerente_id),
                this.vacacionesService.formatearFechaHora(sol.fecha_gerente || ''),
                this.vacacionesService.formatearFechaCompleta(sol.fecha_inicio || ''),
                this.vacacionesService.formatearFechaCompleta(sol.fecha_final || ''),
                sol.total_periodo.toString(),
                (sol.motivo || '').replace(/;/g, '-').replace(/\n/g, ' '),
                (sol.obs || '').replace(/;/g, '-').replace(/\n/g, ' ')
            ];
        });

        const contenido = [cabeceras, ...registros].map(e => e.join(';')).join('\n');
        const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Detalle_Vacaciones_${fila.nombre.replace(/ /g, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    private exportarCSV(cabeceras: string[], filas: any[][], nombreArchivo: string): void {
        const contenidoCsv = [
            cabeceras.join(';'),
            ...filas.map(r => r.join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    descargarReporte(): void {
        if (this.filasFiltradas.length === 0) return;

        const cabeceras = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Gozados', 'Días Truncos', 'Días Pendientes', 'Días Programados'];
        const registros = this.filasFiltradas.map(f => [
            f.nombre,
            f.area,
            f.puesto,
            f.empresa,
            f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasUtilizados.toString().replace('.', ','),
            f.diasTruncos.toString().replace('.', ','),
            f.diasPendientes.toString().replace('.', ','),
            f.diasProgramados.toString().replace('.', ',')
        ]);

        this.exportarCSV(cabeceras, registros, 'Reporte_Vacaciones_Completo');
    }

    descargarReportePendientes(): void {
        if (this.filasFiltradas.length === 0) return;

        const cabeceras = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Truncos', 'Días Pendientes'];
        const registros = this.filasFiltradas.map(f => [
            f.nombre,
            f.area,
            f.puesto,
            f.empresa,
            f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasTruncos.toString().replace('.', ','),
            f.diasPendientes.toString().replace('.', ',')
        ]);

        this.exportarCSV(cabeceras, registros, 'Reporte_Vacaciones_Pendientes');
    }

    descargarReporteGozados(): void {
        if (this.filasFiltradas.length === 0) return;

        const cabeceras = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Gozados'];
        const registros = this.filasFiltradas.map(f => [
            f.nombre,
            f.area,
            f.puesto,
            f.empresa,
            f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasUtilizados.toString().replace('.', ',')
        ]);

        this.exportarCSV(cabeceras, registros, 'Reporte_Vacaciones_Gozados');
    }

    resetearFiltros(): void {
        this.usuarioSeleccionado = '';
        this.filtroArea = '';
    }

    refrescar(): void {
        this.cargarDatos();
    }
}

