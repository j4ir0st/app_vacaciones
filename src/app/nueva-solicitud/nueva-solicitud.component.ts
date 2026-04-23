import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EMPTY } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { UsuarioService } from '../core/services/usuario.service';
import { Usuario } from '../core/models/usuario.model';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';

@Component({
    selector: 'app-nueva-solicitud',
    templateUrl: './nueva-solicitud.component.html',
    styleUrls: ['./nueva-solicitud.component.css'],
    standalone: false
})
export class NuevaSolicitudComponent implements OnInit {
    @Output() solicitudCreada = new EventEmitter<void>();
    @Output() cancelar = new EventEmitter<void>();

    // Stepper
    pasoActual = 1;
    totalPasos = 3;

    // Formulario de nueva solicitud
    formulario!: FormGroup;
    cargando = false;
    error = '';
    exito = false;
    diasCalculados = 0;
    procesandoDetalle = false;

    // Usuarios para selección (Jefes/Gerentes)
    usuarios: Usuario[] = [];
    cargandoUsuarios = false;
    textoBusquedaUsuario = '';
    mostrarResultados = false;

    // Conflictos de fechas
    conflictosFechas: { nombre: string; area: string; puesto: string; estado: string; fechaInicio: string; fechaFinal: string }[] = [];
    verificandoConflictos = false;
    conflictosAceptados = false;

    get usuarioActual() {
        return this.authService.usuarioActual;
    }

    // Determina si el formulario ha sido modificado
    get esSucio(): boolean {
        return this.formulario?.dirty || false;
    }

    // Filtra la lista de usuarios activos según el texto ingresado en el buscador
    get usuariosFiltrados(): Usuario[] {
        const busqueda = this.textoBusquedaUsuario.toLowerCase().trim();
        // Solo mostramos usuarios activos
        const usuariosActivos = this.usuarios.filter(u => u.is_active);

        if (!busqueda) return usuariosActivos;

        return usuariosActivos.filter(u => {
            const nombreCompleto = `${u.first_name} ${u.last_name}`.toLowerCase();
            return nombreCompleto.includes(busqueda);
        });
    }

    // Fecha mínima para la solicitud (vacía para permitir regularización de fechas pasadas)
    get fechaMinima(): string {
        return '';
    }

    // Determina si el paso actual es válido para habilitar el botón "Siguiente"
    get pasoValido(): boolean {
        if (this.pasoActual === 1) {
            const f = this.formulario.value;
            // Validamos que tenga fechas y días mayores a 0
            const camposOk = !!f.fecha_inicio && !!f.fecha_final && this.diasCalculados > 0 && !!f.usuario_id;
            // Bloquear si hay conflictos sin aceptar (excepto gerentes que no ven conflictos)
            if (camposOk && this.conflictosFechas.length > 0 && !this.conflictosAceptados) return false;
            return camposOk;
        }
        if (this.pasoActual === 2) {
            return (this.formulario.get('motivo')?.value || '').length >= 5;
        }
        return true;
    }

    constructor(
        private fb: FormBuilder,
        public authService: AuthService,
        private solicitudService: SolicitudService,
        private vacacionesService: VacacionesService,
        private usuarioService: UsuarioService
    ) { }

    ngOnInit(): void {
        this.inicializarFormulario();
        if (this.authService.esJefeOGerente) {
            this.cargarUsuarios();
        }
    }

    // Inicializa el formulario reactivo con valores por defecto
    private inicializarFormulario(): void {
        const urlPropia = this.usuarioActual?.url || '';

        this.formulario = this.fb.group({
            usuario_id: [urlPropia, Validators.required],
            tipo_solicitud: ['AT', Validators.required],
            fecha_inicio: ['', Validators.required],
            fecha_final: ['', Validators.required],
            dias: [0, [Validators.required, Validators.min(1)]],
            motivo: ['', [Validators.required, Validators.minLength(5)]]
        });

        // Suscripciones para cálculos automáticos unidireccionales
        this.formulario.get('fecha_inicio')?.valueChanges.subscribe(() => {
            this.recalcularAlCambiarDias(this.formulario.get('dias')?.value);
            this.conflictosAceptados = false;
            this.verificarConflictosFechas();
        });

        this.formulario.get('dias')?.valueChanges.subscribe((val: number) => {
            this.recalcularAlCambiarDias(val);
            this.conflictosAceptados = false;
            this.verificarConflictosFechas();
        });
    }

    // Recalcula automáticamente la fecha final cuando cambian los días solicitados
    // Se asegura de que el primer día de vacaciones esté incluido en el cálculo
    private recalcularAlCambiarDias(cantDias: number): void {
        const inicio = this.formulario.get('fecha_inicio')?.value;
        if (inicio && cantDias > 0) {
            // Utilizamos el servicio de vacaciones para centralizar la lógica de negocio del calendario
            const nuevaFechaFin = this.vacacionesService.calcularFechaFinal(new Date(inicio), cantDias);

            // Ajuste manual de zona horaria para evitar desfases al convertir a formato ISO (YYYY-MM-DD)
            const fechaString = nuevaFechaFin.toISOString().split('T')[0];

            // Actualizamos el campo fecha_final sin disparar eventos circulares
            this.formulario.get('fecha_final')?.setValue(fechaString, { emitEvent: false });
            this.diasCalculados = cantDias;
        }
    }

    // Carga la lista de colaboradores bajo la supervisión del usuario actual
    // Implementa la lógica de filtrado por área heredada (fórmula PowerApps)
    private cargarUsuarios(): void {
        this.cargandoUsuarios = true;

        const user = this.usuarioActual;
        const nombreUser = `${user?.first_name} ${user?.last_name}`.trim();
        const username = user?.username?.toLowerCase() || '';
        const areaOriginal = (user?.area_id?.nombre || user?.area || '').trim();

        let areasAFiltar: string[] = [];

        // Lógica de filtrado compleja para Jefes y Gerentes
        if (this.authService.esAprobador) {
            if (areaOriginal === 'Operaciones') {
                // Usuarios de Operaciones ven áreas operativas específicas
                areasAFiltar = ["Distribución", "Atenciones", "Almacenes", "Facturación", "Desarrollo Software", "Logística Inversa", "Operaciones"];
            } else if (username === 'klewis' || username === 'klewism' || nombreUser.toLowerCase().includes('katherine lewis')) {
                // Caso específico para Katherine Lewis (acceso multi-área)
                areasAFiltar = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else {
                // Por defecto, ven solo su propia área
                areasAFiltar = [areaOriginal];
            }
        } else {
            // Si no es aprobador (aunque esta función no debería llamarse), ve solo su área
            areasAFiltar = [areaOriginal];
        }

        const nombresArea = areasAFiltar.join(',');
        this.usuarioService.obtenerUsuariosPorNombreArea(nombresArea).subscribe({
            next: (res: any) => {
                this.usuarios = res || [];
                // Si el usuario actual es gerente de un área específica (ej. Software), 
                // ya el filtro 'Else' se encargó de traer solo su área.
                this.cargandoUsuarios = false;
            },
            error: (err: any) => {
                console.error('Error cargando usuarios filtrados:', err);
                this.cargandoUsuarios = false;
            }
        });
    }

    // Avanza al siguiente paso del formulario validando los campos del paso actual
    siguientePaso(): void {
        if (this.pasoActual === 1) {
            // Validar campos obligatorios del paso 1 (Colaborador, Tipo y Fechas)
            const camposAValidar = ['usuario_id', 'tipo_solicitud', 'fecha_inicio', 'fecha_final'];
            let esValido = true;

            camposAValidar.forEach(campo => {
                const control = this.formulario.get(campo);
                if (control?.invalid) {
                    control.markAsTouched(); // Marcamos como tocado para mostrar errores visuales
                    esValido = false;
                }
            });

            if (!esValido || this.diasCalculados <= 0) return;
        }

        if (this.pasoActual === 2) {
            // Validar que el motivo cumpla con la longitud mínima requerida
            const motivo = this.formulario.get('motivo');
            if (motivo?.invalid) {
                motivo.markAsTouched();
                return;
            }
        }

        // Si todas las validaciones pasan, avanzamos al siguiente paso del stepper
        if (this.pasoActual < this.totalPasos) {
            this.pasoActual++;
        }
    }

    // Retrocede al paso anterior del formulario
    anteriorPaso(): void {
        if (this.pasoActual > 1) {
            this.pasoActual--;
        }
    }

    // Actualiza el colaborador en el formulario y cierra los resultados de búsqueda
    seleccionarUsuario(u: any): void {
        this.formulario.get('usuario_id')?.setValue(u.url);
        this.textoBusquedaUsuario = ''; // Limpiar búsqueda al seleccionar
        this.mostrarResultados = false;
    }

    // Obtiene el nombre completo del colaborador seleccionado para mostrarlo en el resumen
    getNombreUsuarioSeleccionado(): string {
        const urlVal = this.formulario.get('usuario_id')?.value;
        if (!urlVal) return 'Sin seleccionar';
        if (urlVal === this.usuarioActual?.url) return this.authService.nombreCompleto;

        const user = this.usuarios.find(u => u.url === urlVal);
        return user ? `${user.first_name} ${user.last_name}` : 'Usuario';
    }

    // Envía la solicitud de vacaciones a la API del servidor
    enviarSolicitud(): void {
        if (this.formulario.invalid || this.diasCalculados === 0) return;

        this.cargando = true;
        this.error = '';

        const datos = this.formulario.value;
        const esGerente = this.authService.esGerente;
        const esAprobador = this.authService.esAprobador;
        const fechaActual = new Date().toISOString();
        const urlUsuario = this.usuarioActual?.url || '';

        // Lógica de auto-aprobación por niveles
        let estado = 'PD';
        let jefe_id = null;
        let fecha_jefe = null;
        let gerente_id = null;
        let fecha_gerente = null;

        if (esGerente) {
            estado = 'AP';
            jefe_id = urlUsuario;
            fecha_jefe = fechaActual;
            gerente_id = urlUsuario;
            fecha_gerente = fechaActual;
        } else if (esAprobador) {
            estado = 'AS';
            jefe_id = urlUsuario;
            fecha_jefe = fechaActual;
        }

        // Determinación del Área de la Solicitud (Debe ser la del seleccionado, no la del logueado)
        let urlAreaReal = '';
        const selectedUrl = datos.usuario_id;

        if (selectedUrl === this.usuarioActual?.url) {
            urlAreaReal = this.usuarioActual?.area_id?.url || '';
        } else {
            // Buscamos al usuario en la lista cargada para obtener su área real
            const selectedUser = this.usuarios.find(u => u.url === selectedUrl);
            urlAreaReal = selectedUser?.area_id?.url || this.usuarioActual?.area_id?.url || '';
        }

        const payload = {
            ...datos,
            total_periodo: this.diasCalculados,
            fecha_solicitud: fechaActual,
            estado_solicitud: estado as any,
            area_id: urlAreaReal,
            jefe_id: jefe_id,
            fecha_jefe: fecha_jefe,
            gerente_id: gerente_id,
            fecha_gerente: fecha_gerente,
            obs: this.generarMensajeConflictos()
        };

        this.solicitudService.crearSolicitud(payload).subscribe({
            next: () => {
                this.cargando = false;
                this.exito = true;
            },
            error: (err: any) => {
                this.cargando = false;
                console.error('Error al crear solicitud:', err);
                this.error = 'Error al crear la solicitud. Por favor, inténtelo de nuevo.';
                if (err.error) {
                    console.table(err.error);
                }
            }
        });
    }

    // Emite el evento de finalización para cerrar el modal o refrescar la vista
    finalizar(): void {
        this.solicitudCreada.emit();
    }

    // Genera las iniciales de un nombre para el avatar genérico
    obtenerIniciales(nombre: string): string {
        if (!nombre) return 'U';
        return nombre.split(' ')
            .filter(n => n)
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    // Verifica si hay solicitudes de la misma área que se solapen con las fechas seleccionadas
    private verificarConflictosFechas(): void {
        const fechaInicio = this.formulario.get('fecha_inicio')?.value;
        const fechaFinal = this.formulario.get('fecha_final')?.value;

        // No verificar si no hay fechas completas o si es gerente
        if (!fechaInicio || !fechaFinal || this.authService.esGerente) {
            this.conflictosFechas = [];
            return;
        }

        // Obtener el área del usuario seleccionado
        const selectedUrl = this.formulario.get('usuario_id')?.value;
        let areaNombre = '';
        if (selectedUrl === this.usuarioActual?.url) {
            areaNombre = this.usuarioActual?.area_id?.nombre || '';
        } else {
            const selectedUser = this.usuarios.find(u => u.url === selectedUrl);
            areaNombre = selectedUser?.area_id?.nombre || this.usuarioActual?.area_id?.nombre || '';
        }

        if (!areaNombre) return;

        this.verificandoConflictos = true;

        // Consultar solicitudes del área en el backend
        const urlSolicitudes = `${this.solicitudService.URL_SOLICITUDES}&area_nombre=${encodeURIComponent(areaNombre)}`;
        this.solicitudService.obtenerSolicitudes(urlSolicitudes).pipe(
            expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        ).subscribe({
            next: (solicitudes: SolicitudVacaciones[]) => {
                this.verificandoConflictos = false;
                this.detectarConflictos(solicitudes, fechaInicio, fechaFinal, selectedUrl);
            },
            error: () => {
                this.verificandoConflictos = false;
            }
        });
    }

    // Detecta conflictos de solapamiento de fechas con solicitudes existentes
    private detectarConflictos(solicitudes: SolicitudVacaciones[], inicio: string, fin: string, urlSolicitante: string): void {
        const fechaIni = new Date(inicio + 'T00:00:00');
        const fechaFin = new Date(fin + 'T23:59:59');

        const estadosAVerificar = ['AP', 'AS', 'PD'];

        this.conflictosFechas = solicitudes
            .filter(s => {
                // Solo verificar estados relevantes
                const codigoEstado = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                if (!estadosAVerificar.includes(codigoEstado)) return false;

                // No comparar con las solicitudes del propio usuario que está solicitando
                const urlUsuarioSoli = typeof s.usuario_id === 'string' ? s.usuario_id : '';
                if (urlUsuarioSoli === urlSolicitante) return false;

                // Verificar solapamiento de fechas
                const solInicio = new Date(s.fecha_inicio + 'T00:00:00');
                const solFin = new Date(s.fecha_final + 'T23:59:59');
                return fechaIni <= solFin && fechaFin >= solInicio;
            })
            .map(s => {
                let nombre = 'Usuario';
                let area = '';
                let puesto = '';
                const codigoEstado = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);

                if (typeof s.usuario_id === 'object' && s.usuario_id) {
                    nombre = (s.usuario_id as any).fullname || 'Usuario';
                    area = (s.usuario_id as any).area || '';
                    puesto = (s.usuario_id as any).puesto || '';
                } else if (typeof s.usuario_id === 'string') {
                    // Buscar en la lista de usuarios cargados
                    const usr = this.usuarios.find(u => u.url === s.usuario_id);
                    if (usr) {
                        nombre = `${usr.first_name} ${usr.last_name}`.trim();
                        area = usr.area_id?.nombre || usr.area || '';
                        puesto = usr.puesto_id?.nombre || '';
                    }
                }

                const etiquetaEstado = codigoEstado === 'AP' ? 'aprobada' :
                    codigoEstado === 'AS' ? 'aprobada por supervisor' : 'pendiente';

                return {
                    nombre,
                    area,
                    puesto,
                    estado: etiquetaEstado,
                    fechaInicio: s.fecha_inicio,
                    fechaFinal: s.fecha_final
                };
            });
    }

    // Genera el mensaje de sistema para el campo obs cuando hay conflictos
    private generarMensajeConflictos(): string {
        if (this.conflictosFechas.length === 0) return '';

        return this.conflictosFechas.map(c =>
            `System Message: Ya existe ${c.nombre} (${c.area} - ${c.puesto}) que tiene una solicitud ${c.estado} para las fechas ${c.fechaInicio} al ${c.fechaFinal}.`
        ).join(' | ');
    }

    // Acepta los conflictos detectados y permite continuar
    aceptarConflictos(): void {
        this.conflictosAceptados = true;
    }
}