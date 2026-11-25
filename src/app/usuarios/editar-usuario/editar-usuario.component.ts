import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { UsuarioService } from '../../core/services/usuario.service';
import type { Usuario } from '../../core/models/usuario.model';

type GrupoPermiso = { url: string; name: string };

// Formulario de edición de usuarios (tabla users, serializer ExtendedUserSerializer).
// Exclusivo del Gerente de Operaciones. Todos los campos son opcionales; el username no se modifica.
// is_staff no se expone a propósito.
@Component({
    selector: 'app-editar-usuario',
    templateUrl: './editar-usuario.component.html',
    styleUrls: ['../crear-usuario/crear-usuario.component.css', './editar-usuario.component.css'],
    standalone: false
})
export class EditarUsuarioComponent implements OnInit {
    @Input({ required: true }) usuario!: Usuario;
    @Output() guardado = new EventEmitter<void>();
    @Output() cancelar = new EventEmitter<void>();

    readonly pasos = ['Personal', 'Empresa', 'Acceso'];
    pasoActual = 1;
    formulario: FormGroup;
    cargando = false;
    cargandoMaestros = true;
    exito = false;
    error = '';

    areasDisponibles: any[] = [];
    puestosDisponibles: any[] = [];
    empresasDisponibles: any[] = [];
    oficinasDisponibles: any[] = [];
    gruposDisponibles: GrupoPermiso[] = [];
    gruposSeleccionados = new Set<string>();
    private gruposIniciales = new Set<string>();

    // Valores iniciales de las relaciones, para enviar solo lo que cambió
    private valoresIniciales: Record<string, string> = {};

    avatarSeleccionado: File | null = null;
    avatarPreview: string | null = null;

    get totalPasos(): number {
        return this.pasos.length;
    }

    // Área, puesto y empresa no aceptan nulo en la API: si ya tienen valor no se ofrece "Sin asignar"
    get tieneArea(): boolean { return !!this.valoresIniciales['area_id']; }
    get tienePuesto(): boolean { return !!this.valoresIniciales['puesto_id']; }
    get tieneEmpresa(): boolean { return !!this.valoresIniciales['empr_id']; }

    constructor(
        private fb: FormBuilder,
        private authService: AuthService,
        private usuarioService: UsuarioService
    ) {
        this.formulario = this.fb.group({
            // Paso 1: Información personal
            first_name: ['', Validators.maxLength(150)],
            last_name: ['', Validators.maxLength(150)],
            email: ['', [Validators.email, Validators.maxLength(254)]],
            codigo: ['', Validators.maxLength(30)],

            // Paso 2: Datos de empresa
            area_id: [''],
            area: ['', Validators.maxLength(30)],
            puesto_id: [''],
            empr_id: [''],
            oficina_id: [''],
            fecha_ingreso: [''],
            is_active: [true],

            // Paso 3: Acceso (contraseña opcional)
            password: ['', Validators.minLength(8)],
            password_confirm: ['']
        }, { validators: this.passwordMatchValidator });
    }

    ngOnInit(): void {
        const u = this.usuario;
        this.avatarPreview = u.avatar;
        this.formulario.patchValue({
            first_name: u.first_name || '',
            last_name: u.last_name || '',
            email: u.email || '',
            codigo: u.codigo || '',
            area: u.area || '',
            empr_id: u.empr_id || '',
            fecha_ingreso: (u.fecha_ingreso || '').split('T')[0],
            is_active: u.is_active
        }, { emitEvent: false });

        // Al cambiar el área se sugiere el mismo nombre en el campo de texto "area" (área para aplicaciones)
        this.formulario.get('area_id')?.valueChanges.subscribe((url: string) => {
            const area = this.areasDisponibles.find(a => a.url === url);
            if (area) this.formulario.get('area')?.setValue((area.nombre || '').substring(0, 30));
        });

        this.cargarDatosMaestros();
    }

    private cargarDatosMaestros(): void {
        forkJoin({
            areas: this.usuarioService.obtenerAreasRaw().pipe(catchError(() => of([]))),
            puestos: this.usuarioService.obtenerPuestosRaw().pipe(catchError(() => of([]))),
            empresas: this.usuarioService.obtenerEmpresas().pipe(catchError(() => of([]))),
            oficinas: this.usuarioService.obtenerOficinas().pipe(catchError(() => of([]))),
            grupos: this.usuarioService.obtenerGrupos().pipe(catchError(() => of([])))
        }).subscribe(({ areas, puestos, empresas, oficinas, grupos }) => {
            this.areasDisponibles = this.ordenarPorNombre(areas, 'nombre');
            this.puestosDisponibles = this.ordenarPorNombre(puestos, 'nombre');
            this.empresasDisponibles = empresas;
            this.oficinasDisponibles = this.ordenarPorNombre(oficinas, 'nombre');
            this.gruposDisponibles = this.ordenarPorNombre(grupos, 'name');

            // Las URLs del usuario y de los catálogos pueden diferir en dominio o ?format=json: se comparan por recurso/id
            const area = areas.find(a => this.mismoRecurso(a.url, this.usuario.area_id?.url))?.url || '';
            const puesto = puestos.find(p => this.mismoRecurso(p.url, this.usuario.puesto_id?.url))?.url || '';
            const oficina = oficinas.find(o => this.mismoRecurso(o.url, this.urlOficinaUsuario()))?.url || '';

            this.formulario.patchValue({ area_id: area, puesto_id: puesto, oficina_id: oficina }, { emitEvent: false });
            this.valoresIniciales = { area_id: area, puesto_id: puesto, oficina_id: oficina, empr_id: this.usuario.empr_id || '' };

            // Los grupos llegan como URLs (o nombres en sesiones antiguas)
            for (const valor of this.usuario.groups || []) {
                const grupo = grupos.find(g =>
                    this.mismoRecurso(g.url, valor) || g.name?.toLowerCase() === String(valor).toLowerCase()
                );
                if (grupo) this.gruposIniciales.add(grupo.url);
            }
            this.gruposSeleccionados = new Set(this.gruposIniciales);
            this.cargandoMaestros = false;
        });
    }

    private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
        const pass = control.get('password')?.value || '';
        const confirm = control.get('password_confirm')?.value || '';
        if (!pass && !confirm) return null;
        return pass !== confirm ? { noCoincide: true } : null;
    }

    // Ningún campo es obligatorio: solo se valida el formato de lo que se escriba
    get pasoValido(): boolean {
        const valido = (...campos: string[]) => campos.every(c => this.formulario.get(c)?.valid);
        switch (this.pasoActual) {
            case 1: return valido('first_name', 'last_name', 'email', 'codigo');
            case 2: return valido('area');
            case 3: return valido('password') && !this.formulario.hasError('noCoincide');
            default: return false;
        }
    }

    siguientePaso(): void {
        if (!this.pasoValido) {
            this.formulario.markAllAsTouched();
            return;
        }
        if (this.pasoActual < this.totalPasos) this.pasoActual++;
    }

    anteriorPaso(): void {
        if (this.pasoActual > 1) this.pasoActual--;
    }

    irAPaso(paso: number): void {
        if (paso < this.pasoActual || (paso === this.pasoActual + 1 && this.pasoValido)) {
            this.pasoActual = paso;
        }
    }

    alternarGrupo(url: string): void {
        if (this.gruposSeleccionados.has(url)) {
            this.gruposSeleccionados.delete(url);
        } else {
            this.gruposSeleccionados.add(url);
        }
        this.formulario.markAsDirty();
    }

    onFileSelected(event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        this.avatarSeleccionado = file;
        const reader = new FileReader();
        reader.onload = () => this.avatarPreview = reader.result as string;
        reader.readAsDataURL(file);
    }

    get hayCambios(): boolean {
        return this.formulario.dirty || !!this.avatarSeleccionado;
    }

    guardar(): void {
        if (!this.authService.esGerenteOperaciones) return;
        if (this.formulario.invalid) {
            this.formulario.markAllAsTouched();
            this.error = 'Revise los campos marcados antes de guardar.';
            return;
        }

        this.cargando = true;
        this.error = '';

        const datos = this.construirPayload();
        const avatar = this.avatarSeleccionado;

        // Los datos van en JSON (permite null y listas vacías); la foto, si hay, en un PATCH multipart aparte
        this.usuarioService.actualizarUsuario(this.usuario.url, datos).pipe(
            switchMap(resp => {
                if (!avatar) return of(resp);
                const form = new FormData();
                form.append('avatar', avatar);
                return this.usuarioService.actualizarUsuarioCompleto(this.usuario.url, form);
            })
        ).subscribe({
            next: () => {
                this.cargando = false;
                this.exito = true;
                this.usuarioService.limpiarCache();
            },
            error: (err) => {
                this.cargando = false;
                console.error('Error al actualizar usuario:', err);
                this.error = err?.error?.detail || 'No se pudo guardar los cambios. Verifique que los datos sean correctos.';
            }
        });
    }

    private construirPayload(): Record<string, any> {
        const f = this.formulario.value;
        const texto = (v: string) => (v || '').trim();
        const textoONulo = (v: string) => texto(v) || null;

        const datos: Record<string, any> = {
            first_name: texto(f.first_name),
            last_name: texto(f.last_name),
            email: texto(f.email),
            codigo: textoONulo(f.codigo),
            area: textoONulo(f.area),
            fecha_ingreso: f.fecha_ingreso || null,
            is_active: !!f.is_active
        };

        // Relaciones: solo se envían si cambiaron y tienen valor (la API no acepta nulo en estas)
        if (f.area_id && f.area_id !== this.valoresIniciales['area_id']) {
            datos['area_id_write'] = Number(this.extraerId(f.area_id));
        }
        if (f.puesto_id && f.puesto_id !== this.valoresIniciales['puesto_id']) {
            datos['puesto_id_write'] = Number(this.extraerId(f.puesto_id));
        }
        if (f.empr_id && f.empr_id !== this.valoresIniciales['empr_id']) {
            datos['empr_id'] = f.empr_id;
        }

        // Oficina: se escribe con oficina_id_write (ID numérico o null); se lee en oficina_id {url, id, nombre}
        if ((f.oficina_id || '') !== this.valoresIniciales['oficina_id']) {
            datos['oficina_id_write'] = f.oficina_id ? Number(this.extraerId(f.oficina_id)) : null;
        }

        // Contraseña: write_only; el backend la hashea con set_password. Vacía = no se cambia
        if (f.password) {
            datos['password'] = f.password;
        }

        if (this.gruposDisponibles.length > 0 && !this.mismosGrupos()) {
            datos['groups'] = [...this.gruposSeleccionados];
        }

        return datos;
    }

    finalizar(): void {
        this.guardado.emit();
    }

    obtenerIniciales(): string {
        return ((this.usuario.first_name?.[0] || '') + (this.usuario.last_name?.[0] || '')).toUpperCase() || '?';
    }

    private urlOficinaUsuario(): string {
        const valor: any = this.usuario.oficina_id;
        if (!valor) return '';
        return typeof valor === 'object' ? valor.url : String(valor);
    }

    private ordenarPorNombre<T>(lista: T[], campo: string): T[] {
        return [...lista].sort((a: any, b: any) => String(a?.[campo] || '').localeCompare(String(b?.[campo] || ''), 'es'));
    }

    private mismosGrupos(): boolean {
        if (this.gruposIniciales.size !== this.gruposSeleccionados.size) return false;
        return [...this.gruposSeleccionados].every(g => this.gruposIniciales.has(g));
    }

    // Compara "recurso/id" (ej. EU_Area/3) ignorando dominio, proxy y query string
    private mismoRecurso(a?: string | null, b?: string | null): boolean {
        if (!a || !b) return false;
        const ruta = (url: string) => url.split('?')[0].replace(/\/$/, '').split('/').slice(-2).join('/').toLowerCase();
        return ruta(a) === ruta(b);
    }

    private extraerId(url: string): string {
        if (!url) return '';
        const match = url.match(/\/(\d+)\/?(\?|$)/);
        return match ? match[1] : url;
    }
}
