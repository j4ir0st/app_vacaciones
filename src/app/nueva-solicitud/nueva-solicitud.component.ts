import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EMPTY, forkJoin, of } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { UsuarioService } from '../core/services/usuario.service';
import { Usuario } from '../core/models/usuario.model';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';

type ConflictoFecha = { nombre: string; area: string; puesto: string; estado: string; fechaInicio: string; fechaFinal: string };

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
    conflictosFechas: ConflictoFecha[] = [];
    // Cruces informativos con el Gerente de Operaciones (no bloquean la solicitud)
    avisosGerente: ConflictoFecha[] = [];
    verificandoConflictos = false;
    conflictosAceptados = false;
    private idVerificacion = 0;

    // Restricción para el área de Distribución: salvo los jefes, no pueden aceptar conflictos y deben cambiar de fechas
    esAreaDistribucion = false;
    esJefeColaborador = false;
    rangosDisponibles: { inicio: string; fin: string; dias: number; etiqueta: string }[] = [];
    alcanceDisponibilidad: 'semana' | 'mes' | '' = '';

    // Áreas pertenecientes a la Gerencia de Operaciones
    private readonly AREAS_OPERACIONES = [
        'distribución', 'distribucion',
        'atenciones',
        'almacenes',
        'facturación', 'facturacion',
        'desarrollo software',
        'logística inversa', 'logistica inversa',
        'operaciones'
    ];

    // Los colaboradores de Distribución (excepto jefes) no pueden continuar con fechas en conflicto,
    // salvo que la solicitud la registre el Gerente de Operaciones
    get puedeAceptarConflictos(): boolean {
        return !this.esAreaDistribucion || this.esJefeColaborador || this.authService.esGerenteOperaciones;
    }

    // Se sugieren fechas libres a Distribución mientras la regla aplique o lo registre el Gerente de Operaciones
    get mostrarFechasDisponibles(): boolean {
        return this.esAreaDistribucion && !this.esJefeColaborador;
    }

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

        this.formulario.get('usuario_id')?.valueChanges.subscribe(() => {
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

        // Áreas exclusivas del jefe de Operaciones (no visibles para magreda)
        const areasOperaciones = ['Distribución', 'Atenciones', 'Almacenes', 'Facturación',
            'Desarrollo Software', 'Logística Inversa', 'Operaciones'];

        // Caso especial: Jefe de Recursos Humanos consulta usuarios de la oficina Batallón (oficina_id=2)
        if (this.authService.esJefeRecursosHumanos) {
            this.usuarioService.obtenerUsuariosPorOficina(2).subscribe({
                next: (lista: Usuario[]) => {
                    this.usuarios = lista.filter(u => u.is_active && u.area_id != null);
                    this.cargandoUsuarios = false;
                },
                error: (err: any) => {
                    console.error('Error cargando usuarios por oficina_id para RR.HH.:', err);
                    this.cargandoUsuarios = false;
                }
            });
            return;
        }

        let areasAFiltar: string[] = [];

        // Lógica de filtrado compleja para Jefes y Gerentes
        if (this.authService.esAprobador) {
            if (areaOriginal === 'Operaciones') {
                // Usuarios de Operaciones ven áreas operativas específicas
                areasAFiltar = areasOperaciones;
            } else if (username === 'klewis' || username === 'klewism' || nombreUser.toLowerCase().includes('katherine lewis')) {
                // Caso específico para Katherine Lewis (acceso multi-área)
                areasAFiltar = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else if (username === 'frodriguez' || nombreUser.toLowerCase().includes('fernando rodriguez')) {
                // Caso específico para Fernando Rodríguez (doble área: Atenciones y Distribución)
                areasAFiltar = ['Atenciones', 'Distribución'];
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
        this.conflictosAceptados = false;
        this.verificarConflictosFechas();
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

    // Verifica si hay solicitudes de la misma área que se solapen con las fechas seleccionadas,
    // e incluye al Gerente de Operaciones si el solicitante es Supervisor, Coordinador o Jefe de un área de operaciones.
    private verificarConflictosFechas(): void {
        const fechaInicio = this.formulario.get('fecha_inicio')?.value;
        const fechaFinal = this.formulario.get('fecha_final')?.value;

        // Invalida respuestas de verificaciones anteriores que lleguen tarde
        const idVerificacion = ++this.idVerificacion;
        this.verificandoConflictos = false;
        this.rangosDisponibles = [];
        this.alcanceDisponibilidad = '';
        this.avisosGerente = [];
        this.esAreaDistribucion = false;
        this.esJefeColaborador = false;

        if (!fechaInicio || !fechaFinal) {
            this.conflictosFechas = [];
            return;
        }

        // Obtener el colaborador seleccionado
        const selectedUrl = this.formulario.get('usuario_id')?.value;
        let selectedUser: Usuario | null = null;
        if (selectedUrl === this.usuarioActual?.url) {
            selectedUser = this.usuarioActual;
        } else {
            selectedUser = this.usuarios.find(u => u.url === selectedUrl) || null;
        }

        const areaNombre = (selectedUser?.area_id?.nombre || selectedUser?.area || this.usuarioActual?.area_id?.nombre || '').trim();
        const puestoNombre = (selectedUser?.area_puesto?.puesto_nombre || selectedUser?.puesto_id?.nombre || '').toLowerCase().trim();

        // Si el solicitante seleccionado es Gerente, no aplican alertas de conflicto
        const esGerente = puestoNombre.includes('gerente') || (selectedUrl === this.usuarioActual?.url && this.authService.esGerente);
        if (esGerente) {
            this.conflictosFechas = [];
            return;
        }

        if (!areaNombre) return;

        this.verificandoConflictos = true;

        // Validar si el colaborador es Supervisor, Coordinador o Jefe de un área de Operaciones
        const esMando = puestoNombre.includes('supervisor') || puestoNombre.includes('coordinador') || puestoNombre.includes('jefe');
        const areaNorm = areaNombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const perteneceAOperaciones = this.AREAS_OPERACIONES.some(a => a.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === areaNorm);
        this.esAreaDistribucion = areaNorm === 'distribucion';
        this.esJefeColaborador = this.esAreaDistribucion && puestoNombre.includes('jefe');
        const debeVerificarGerenteOperaciones = esMando && perteneceAOperaciones;

        // Distribución necesita el puesto de cada compañero para separar usuarios y mandos
        const obsUsuariosArea = this.esAreaDistribucion
            ? this.usuarioService.obtenerUsuariosPorNombreArea(areaNombre)
            : of([] as Usuario[]);

        // 1. Petición para solicitudes de su propia área
        const urlSolicitudesArea = `${this.solicitudService.URL_SOLICITUDES}&area_nombre=${encodeURIComponent(areaNombre)}`;
        const obsSolicitudesArea = this.solicitudService.obtenerSolicitudes(urlSolicitudesArea).pipe(
            expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        // 2. Si es mando de Operaciones y su área no es 'Operaciones', consultamos también las solicitudes de Operaciones
        const consultarOperaciones = debeVerificarGerenteOperaciones && areaNorm !== 'operaciones';
        const obsSolicitudesOperaciones = consultarOperaciones
            ? this.solicitudService.obtenerSolicitudes(`${this.solicitudService.URL_SOLICITUDES}&area_nombre=Operaciones`).pipe(
                expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
                map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
                reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
            )
            : of([] as SolicitudVacaciones[]);

        // 3. Usuarios de Operaciones para identificar con precisión al Gerente de Operaciones
        const obsUsuariosOperaciones = debeVerificarGerenteOperaciones
            ? this.usuarioService.obtenerUsuariosPorNombreArea('Operaciones')
            : of([] as Usuario[]);

        forkJoin({
            solicitudesArea: obsSolicitudesArea,
            solicitudesOperaciones: obsSolicitudesOperaciones,
            usuariosOperaciones: obsUsuariosOperaciones,
            usuariosArea: obsUsuariosArea
        }).subscribe({
            next: ({ solicitudesArea, solicitudesOperaciones, usuariosOperaciones, usuariosArea }) => {
                if (idVerificacion !== this.idVerificacion) return;
                this.verificandoConflictos = false;
                if (this.esAreaDistribucion) {
                    this.detectarConflictosDistribucion(
                        solicitudesArea,
                        usuariosArea || [],
                        solicitudesOperaciones,
                        usuariosOperaciones || [],
                        fechaInicio,
                        fechaFinal,
                        selectedUser,
                        selectedUrl,
                        esMando
                    );
                    return;
                }
                this.detectarConflictos(
                    solicitudesArea,
                    solicitudesOperaciones,
                    usuariosOperaciones,
                    fechaInicio,
                    fechaFinal,
                    selectedUrl,
                    debeVerificarGerenteOperaciones
                );
            },
            error: (err) => {
                if (idVerificacion !== this.idVerificacion) return;
                console.error('Error al verificar conflictos de fechas:', err);
                this.verificandoConflictos = false;
            }
        });
    }

    // Detecta conflictos de solapamiento de fechas con solicitudes existentes
    private detectarConflictos(
        solicitudesArea: SolicitudVacaciones[],
        solicitudesOperaciones: SolicitudVacaciones[],
        usuariosOperaciones: Usuario[],
        inicio: string,
        fin: string,
        urlSolicitante: string,
        debeVerificarGerenteOperaciones: boolean
    ): void {
        const fechaIni = new Date(inicio + 'T00:00:00');
        const fechaFin = new Date(fin + 'T23:59:59');

        const estadosAVerificar = ['AP', 'AS', 'PD'];
        const conflictos: { nombre: string; area: string; puesto: string; estado: string; fechaInicio: string; fechaFinal: string }[] = [];
        const idsProcesados = new Set<string>();

        // 1. Conflictos en su propia área (compañeros de su misma área)
        for (const s of solicitudesArea) {
            const codigoEstado = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
            if (!estadosAVerificar.includes(codigoEstado)) continue;

            const urlUsuarioSoli = typeof s.usuario_id === 'string' ? s.usuario_id : '';
            if (urlUsuarioSoli === urlSolicitante) continue;

            const solInicio = new Date(s.fecha_inicio + 'T00:00:00');
            const solFin = new Date(s.fecha_final + 'T23:59:59');
            if (fechaIni <= solFin && fechaFin >= solInicio) {
                const sKey = s.url || `${s.fecha_inicio}-${s.fecha_final}-${urlUsuarioSoli}`;
                if (idsProcesados.has(sKey)) continue;
                idsProcesados.add(sKey);

                let nombre = 'Usuario';
                let area = '';
                let puesto = '';

                if (typeof s.usuario_id === 'object' && s.usuario_id) {
                    nombre = (s.usuario_id as any).fullname || 'Usuario';
                    area = (s.usuario_id as any).area || '';
                    puesto = (s.usuario_id as any).puesto || '';
                } else if (typeof s.usuario_id === 'string') {
                    const usr = this.usuarios.find(u => u.url === s.usuario_id) ||
                        usuariosOperaciones.find(u => u.url === s.usuario_id);
                    if (usr) {
                        nombre = `${usr.first_name} ${usr.last_name}`.trim();
                        area = usr.area_id?.nombre || usr.area || '';
                        puesto = usr.puesto_id?.nombre || '';
                    }
                }

                const etiquetaEstado = codigoEstado === 'AP' ? 'aprobada' :
                    codigoEstado === 'AS' ? 'aprobada por supervisor' : 'pendiente';

                conflictos.push({
                    nombre,
                    area,
                    puesto,
                    estado: etiquetaEstado,
                    fechaInicio: s.fecha_inicio,
                    fechaFinal: s.fecha_final
                });
            }
        }

        // 2. Conflictos con el Gerente de Operaciones (para coordinadores/supervisores/jefes de áreas de operaciones)
        if (debeVerificarGerenteOperaciones) {
            conflictos.push(...this.detectarConflictosGerente(
                solicitudesOperaciones, usuariosOperaciones, inicio, fin, urlSolicitante, estadosAVerificar
            ));
        }

        this.conflictosFechas = conflictos;
    }

    // Conflictos con las solicitudes del Gerente de Operaciones que se solapan con el rango indicado
    private detectarConflictosGerente(
        solicitudesOperaciones: SolicitudVacaciones[],
        usuariosOperaciones: Usuario[],
        inicio: string,
        fin: string,
        urlSolicitante: string,
        estadosAVerificar: string[]
    ): ConflictoFecha[] {
        const fechaIni = new Date(inicio + 'T00:00:00');
        const fechaFin = new Date(fin + 'T23:59:59');
        const conflictos: ConflictoFecha[] = [];
        const idsProcesados = new Set<string>();

        // Identificar al Gerente de Operaciones entre los usuarios de Operaciones
        const gerenteOperaciones = usuariosOperaciones.find(u => {
            const p = (u.area_puesto?.puesto_nombre || u.puesto_id?.nombre || '').toLowerCase();
            return p.includes('gerente');
        });

        for (const s of solicitudesOperaciones) {
            const codigoEstado = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
            if (!estadosAVerificar.includes(codigoEstado)) continue;

            const urlUsuarioSoli = typeof s.usuario_id === 'string' ? s.usuario_id : '';
            if (urlUsuarioSoli === urlSolicitante) continue;

            // Verificar si esta solicitud corresponde al Gerente de Operaciones
            let esDelGerente = false;
            let puestoDetectado = '';
            let nombreDetectado = '';

            if (gerenteOperaciones && (urlUsuarioSoli === gerenteOperaciones.url || (s.usuario_id as any)?.fullname === `${gerenteOperaciones.first_name} ${gerenteOperaciones.last_name}`.trim())) {
                esDelGerente = true;
                nombreDetectado = `${gerenteOperaciones.first_name} ${gerenteOperaciones.last_name}`.trim();
                puestoDetectado = gerenteOperaciones.puesto_id?.nombre || 'Gerente de Operaciones';
            } else if (typeof s.usuario_id === 'object' && s.usuario_id) {
                const puestoObj = ((s.usuario_id as any).puesto || '').toLowerCase();
                if (puestoObj.includes('gerente')) {
                    esDelGerente = true;
                    nombreDetectado = (s.usuario_id as any).fullname || 'Gerente de Operaciones';
                    puestoDetectado = (s.usuario_id as any).puesto || 'Gerente de Operaciones';
                }
            } else if (typeof s.usuario_id === 'string') {
                const usr = usuariosOperaciones.find(u => u.url === s.usuario_id);
                const p = (usr?.puesto_id?.nombre || '').toLowerCase();
                if (p.includes('gerente')) {
                    esDelGerente = true;
                    nombreDetectado = usr ? `${usr.first_name} ${usr.last_name}`.trim() : 'Gerente de Operaciones';
                    puestoDetectado = usr?.puesto_id?.nombre || 'Gerente de Operaciones';
                }
            }

            if (!esDelGerente) continue;

            const solInicio = new Date(s.fecha_inicio + 'T00:00:00');
            const solFin = new Date(s.fecha_final + 'T23:59:59');
            if (fechaIni <= solFin && fechaFin >= solInicio) {
                const sKey = s.url || `${s.fecha_inicio}-${s.fecha_final}-${urlUsuarioSoli}`;
                if (idsProcesados.has(sKey)) continue;
                idsProcesados.add(sKey);

                conflictos.push({
                    nombre: nombreDetectado || 'Gerente de Operaciones',
                    area: 'Operaciones',
                    puesto: puestoDetectado || 'Gerente de Operaciones',
                    estado: this.etiquetaEstado(codigoEstado),
                    fechaInicio: s.fecha_inicio,
                    fechaFinal: s.fecha_final
                });
            }
        }

        return conflictos;
    }

    // Reglas exclusivas del área de Distribución:
    // - Solo cuentan solicitudes Aprobadas (AP) o Aprobadas por Supervisor (AS) de la propia área.
    // - Colaboradores sin mando solo se cruzan con colaboradores sin mando; los mandos
    //   (supervisor, coordinador, jefe) solo se cruzan entre ellos.
    // - Los cruces con el Gerente de Operaciones son solo un aviso, no bloquean.
    private detectarConflictosDistribucion(
        solicitudesArea: SolicitudVacaciones[],
        usuariosArea: Usuario[],
        solicitudesOperaciones: SolicitudVacaciones[],
        usuariosOperaciones: Usuario[],
        inicio: string,
        fin: string,
        solicitante: Usuario | null,
        urlSolicitante: string,
        solicitanteEsMando: boolean
    ): void {
        const estadosAVerificar = ['AP', 'AS'];
        const fechaIni = new Date(inicio + 'T00:00:00');
        const fechaFin = new Date(fin + 'T23:59:59');
        const nombreSolicitante = this.normalizarTexto(solicitante ? `${solicitante.first_name} ${solicitante.last_name}` : '');

        const conflictos: ConflictoFecha[] = [];
        const rangosOcupados: { inicio: string; fin: string }[] = [];
        const idsProcesados = new Set<string>();

        for (const s of solicitudesArea) {
            const codigoEstado = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
            if (!estadosAVerificar.includes(codigoEstado)) continue;

            const datos = this.datosUsuarioSolicitud(s, usuariosArea);
            const esPropia = (!!datos.url && datos.url === urlSolicitante) ||
                (!datos.url && !!nombreSolicitante && this.normalizarTexto(datos.nombre) === nombreSolicitante);
            if (esPropia) continue;

            const otroEsMando = this.esPuestoMando(datos.puesto);
            if (otroEsMando !== solicitanteEsMando) continue;

            const sKey = s.url || `${s.fecha_inicio}-${s.fecha_final}-${datos.url || datos.nombre}`;
            if (idsProcesados.has(sKey)) continue;
            idsProcesados.add(sKey);

            rangosOcupados.push({ inicio: s.fecha_inicio, fin: s.fecha_final });

            const solInicio = new Date(s.fecha_inicio + 'T00:00:00');
            const solFin = new Date(s.fecha_final + 'T23:59:59');
            if (fechaIni <= solFin && fechaFin >= solInicio) {
                conflictos.push({
                    nombre: datos.nombre,
                    area: datos.area || 'Distribución',
                    puesto: datos.puesto,
                    estado: this.etiquetaEstado(codigoEstado),
                    fechaInicio: s.fecha_inicio,
                    fechaFinal: s.fecha_final
                });
            }
        }

        this.conflictosFechas = conflictos;
        this.avisosGerente = solicitanteEsMando
            ? this.detectarConflictosGerente(solicitudesOperaciones, usuariosOperaciones, inicio, fin, urlSolicitante, estadosAVerificar)
            : [];

        if (conflictos.length > 0 && this.mostrarFechasDisponibles) {
            this.calcularFechasDisponibles(inicio, rangosOcupados);
        }
    }

    // Obtiene nombre, área, puesto y url del colaborador dueño de una solicitud
    private datosUsuarioSolicitud(s: SolicitudVacaciones, usuariosArea: Usuario[]): { url: string; nombre: string; area: string; puesto: string } {
        const nombreUsuario = (u: Usuario) => `${u.first_name} ${u.last_name}`.trim();
        const puestoUsuario = (u?: Usuario) => u?.area_puesto?.puesto_nombre || u?.puesto_id?.nombre || '';

        if (typeof s.usuario_id === 'string') {
            const usr = usuariosArea.find(u => u.url === s.usuario_id) || this.usuarios.find(u => u.url === s.usuario_id);
            return {
                url: s.usuario_id,
                nombre: usr ? nombreUsuario(usr) : 'Usuario',
                area: usr?.area_id?.nombre || usr?.area || '',
                puesto: puestoUsuario(usr)
            };
        }

        const obj: any = s.usuario_id || {};
        const nombre = obj.fullname || 'Usuario';
        const usr = usuariosArea.find(u => this.normalizarTexto(nombreUsuario(u)) === this.normalizarTexto(nombre));
        return {
            url: obj.url || usr?.url || '',
            nombre,
            area: obj.area || usr?.area_id?.nombre || '',
            puesto: obj.puesto || puestoUsuario(usr)
        };
    }

    private esPuestoMando(puesto: string): boolean {
        const p = this.normalizarTexto(puesto);
        return p.includes('supervisor') || p.includes('coordinador') || p.includes('jefe');
    }

    private normalizarTexto(texto: string): string {
        return (texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }

    private etiquetaEstado(codigoEstado: string): string {
        return codigoEstado === 'AP' ? 'aprobada' :
            codigoEstado === 'AS' ? 'aprobada por supervisor' : 'pendiente';
    }

    // Calcula los bloques de días libres en la semana (lunes a domingo) de la fecha de inicio;
    // si no hay ninguno, busca en todo el mes. Solo considera días desde hoy en adelante.
    private calcularFechasDisponibles(fechaInicio: string, rangosOcupados: { inicio: string; fin: string }[]): void {
        const base = this.parsearFechaLocal(fechaInicio);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const desplazamientoLunes = (base.getDay() + 6) % 7;
        const inicioSemana = new Date(base);
        inicioSemana.setDate(base.getDate() - desplazamientoLunes);
        const finSemana = new Date(inicioSemana);
        finSemana.setDate(inicioSemana.getDate() + 6);

        let rangos = this.buscarBloquesLibres(inicioSemana, finSemana, hoy, rangosOcupados);
        let alcance: 'semana' | 'mes' = 'semana';

        if (rangos.length === 0) {
            const inicioMes = new Date(base.getFullYear(), base.getMonth(), 1);
            const finMes = new Date(base.getFullYear(), base.getMonth() + 1, 0);
            rangos = this.buscarBloquesLibres(inicioMes, finMes, hoy, rangosOcupados);
            alcance = 'mes';
        }

        this.rangosDisponibles = rangos;
        this.alcanceDisponibilidad = alcance;
    }

    // Recorre día a día el intervalo y agrupa los días libres consecutivos en bloques
    private buscarBloquesLibres(
        desde: Date,
        hasta: Date,
        hoy: Date,
        rangosOcupados: { inicio: string; fin: string }[]
    ): { inicio: string; fin: string; dias: number; etiqueta: string }[] {
        const ocupados = rangosOcupados.map(r => ({
            inicio: this.parsearFechaLocal(r.inicio).getTime(),
            fin: this.parsearFechaLocal(r.fin).getTime()
        }));
        const estaOcupado = (d: Date) => ocupados.some(r => d.getTime() >= r.inicio && d.getTime() <= r.fin);

        const bloques: { inicio: string; fin: string; dias: number; etiqueta: string }[] = [];
        let bloqueInicio: Date | null = null;
        let bloqueFin: Date | null = null;

        const cerrarBloque = () => {
            if (!bloqueInicio || !bloqueFin) return;
            const dias = Math.round((bloqueFin.getTime() - bloqueInicio.getTime()) / 86400000) + 1;
            const etiqueta = dias === 1
                ? this.formatearDiaCorto(bloqueInicio)
                : `${this.formatearDiaCorto(bloqueInicio)} al ${this.formatearDiaCorto(bloqueFin)}`;
            bloques.push({ inicio: this.aFechaIso(bloqueInicio), fin: this.aFechaIso(bloqueFin), dias, etiqueta });
            bloqueInicio = null;
            bloqueFin = null;
        };

        for (const d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
            const libre = d >= hoy && !estaOcupado(d);
            if (libre) {
                if (!bloqueInicio) bloqueInicio = new Date(d);
                bloqueFin = new Date(d);
            } else {
                cerrarBloque();
            }
        }
        cerrarBloque();

        return bloques;
    }

    // Aplica como nueva fecha de inicio el comienzo del bloque disponible seleccionado
    seleccionarRangoDisponible(rango: { inicio: string; dias: number }): void {
        const control = this.formulario.get('fecha_inicio');
        control?.setValue(rango.inicio);
        control?.markAsDirty();
    }

    private parsearFechaLocal(fecha: string): Date {
        return new Date(fecha.split('T')[0] + 'T00:00:00');
    }

    private aFechaIso(d: Date): string {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    private formatearDiaCorto(d: Date): string {
        return d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    // Genera el mensaje de sistema para el campo obs cuando hay conflictos
    private generarMensajeConflictos(): string {
        const todos = [...this.conflictosFechas, ...this.avisosGerente];
        if (todos.length === 0) return '';

        return todos.map(c =>
            `System Message: Ya existe ${c.nombre} (${c.area} - ${c.puesto}) que tiene una solicitud ${c.estado} para las fechas ${c.fechaInicio} al ${c.fechaFinal}.`
        ).join(' | ');
    }

    // Acepta los conflictos detectados y permite continuar
    aceptarConflictos(): void {
        if (!this.puedeAceptarConflictos) return;
        this.conflictosAceptados = true;
    }
}
