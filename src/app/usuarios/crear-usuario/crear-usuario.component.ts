import { Component, OnInit, ElementRef, ViewChild, EventEmitter, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { of, timer } from 'rxjs';
import { switchMap, map, catchError, take } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { VacacionesService } from '../../core/services/vacaciones.service';

@Component({
    selector: 'app-crear-usuario',
    templateUrl: './crear-usuario.component.html',
    styleUrls: ['./crear-usuario.component.css'],
    standalone: false
})
export class CrearUsuarioComponent implements OnInit {
    @ViewChild('fileInput') fileInput!: ElementRef;

    pasoActual = 1;
    totalPasos = 3;
    formulario: FormGroup;
    cargando = false;
    exito = false;
    error = '';

    @Output() cerrar = new EventEmitter<boolean>();
    @Output() cancelar = new EventEmitter<void>();

    // Listas para combos del paso 3
    areasDisponibles: any[] = [];
    puestosDisponibles: any[] = [];
    empresasDisponibles: any[] = [];

    avatarSeleccionado: File | null = null;
    avatarPreview: string | null = null;
    fechaAltaVisual: string = new Date().toLocaleString();

    private extraerId(url: string): string {
        if (!url || typeof url !== 'string') return url;
        const match = url.match(/\/(\d+)\/?/);
        return match ? match[1] : url;
    }

    constructor(
        private fb: FormBuilder,
        private router: Router,
        public authService: AuthService,
        private usuarioService: UsuarioService,
        private vacacionesService: VacacionesService
    ) {
        this.formulario = this.fb.group({
            // Paso 1: Credenciales
            username: ['', [
                Validators.required,
                Validators.maxLength(150),
                Validators.pattern('^[\\w.@+-]+$')
            ], [this.usernameUnicoValidator.bind(this)]],
            password: ['', [Validators.required, Validators.minLength(8)]],
            password_confirm: ['', [Validators.required]],

            // Paso 2: Información Personal
            first_name: ['', Validators.required],
            last_name: ['', Validators.required],
            email: ['', [Validators.required, Validators.email]],

            // Paso 3: Datos Extendidos
            area_id: ['', Validators.required],
            puesto_id: ['', Validators.required],
            empr_id: ['', Validators.required],
            fecha_ingreso: ['', Validators.required]
        }, { validators: this.passwordMatchValidator });
    }

    ngOnInit(): void {
        this.cargarDatosMaestros();
    }

    /**
     * Carga de datos maestros para los selectores del paso 3.
     */
    private cargarDatosMaestros(): void {
        this.usuarioService.obtenerPuestosRaw().subscribe(p => this.puestosDisponibles = p);
        this.usuarioService.obtenerEmpresas().subscribe(e => this.empresasDisponibles = e);

        this.usuarioService.obtenerAreasRaw().subscribe(todasLasAreas => {
            const usuarioActual = this.authService.usuarioActual;
            if (usuarioActual) {
                const nombresPermitidos = this.authService.getAreasVisibles().map(n => n.toLowerCase());
                this.areasDisponibles = todasLasAreas.filter(a =>
                    nombresPermitidos.includes((a.nombre || '').toLowerCase())
                );

                // Auto-selección si solo hay una opción disponible
                if (this.areasDisponibles.length === 1) {
                    this.formulario.get('area_id')?.setValue(this.areasDisponibles[0].url);
                }
            }
        });
    }

    // Validador asíncrono para unicidad de username
    private usernameUnicoValidator(control: AbstractControl) {
        if (!control.value) return of(null);
        return timer(500).pipe(
            switchMap(() => this.usuarioService.verificarUsername(control.value)),
            map(existe => existe ? { usernameTomado: true } : null),
            catchError(() => of(null)),
            take(1)
        );
    }

    // Validador de coincidencia de contraseñas
    private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
        const pass = control.get('password');
        const confirm = control.get('password_confirm');
        return pass && confirm && pass.value !== confirm.value ? { noCoincide: true } : null;
    }

    // Gestión de Pasos
    siguientePaso(): void {
        if (this.pasoValido) {
            this.pasoActual++;
        }
    }

    anteriorPaso(): void {
        if (this.pasoActual > 1) {
            this.pasoActual--;
        }
    }

    get pasoValido(): boolean {
        switch (this.pasoActual) {
            case 1:
                const username = this.formulario.get('username');
                const pass = this.formulario.get('password');
                const confirm = this.formulario.get('password_confirm');
                return (username?.valid && pass?.valid && confirm?.valid && !this.formulario.hasError('noCoincide')) ?? false;
            case 2:
                return (this.formulario.get('first_name')?.valid &&
                    this.formulario.get('last_name')?.valid &&
                    this.formulario.get('email')?.valid) ?? false;
            case 3:
                return this.formulario.get('area_id')?.valid &&
                    this.formulario.get('puesto_id')?.valid &&
                    this.formulario.get('empr_id')?.valid &&
                    this.formulario.get('fecha_ingreso')?.valid || false;
            default:
                return false;
        }
    }

    // Gestión de Avatar
    onFileSelected(event: any): void {
        const file = event.target.files[0];
        if (file) {
            this.avatarSeleccionado = file;
            const reader = new FileReader();
            reader.onload = () => this.avatarPreview = reader.result as string;
            reader.readAsDataURL(file);
        }
    }

    /**
     * Envío final del formulario.
     */
    guardarUsuario(): void {
        if (this.formulario.invalid) return;

        this.cargando = true;
        this.error = '';

        const fVals = this.formulario.value;
        const formData = new FormData();

        // Datos básicos
        formData.append('username', fVals.username);
        formData.append('password', fVals.password);
        formData.append('first_name', fVals.first_name);
        formData.append('last_name', fVals.last_name);
        formData.append('email', fVals.email);

        // Datos extendidos (Usamos campos _write con IDs numéricos para DRF)
        formData.append('area_id_write', this.extraerId(fVals.area_id));
        formData.append('puesto_id_write', this.extraerId(fVals.puesto_id));
        formData.append('empr_id', fVals.empr_id);
        formData.append('fecha_ingreso', fVals.fecha_ingreso);

        // Grupo "Vacaciones" (ID 5) automático - Usamos URL absoluta probada
        formData.append('groups', 'https://appsurgicorperu.com/groups/5/');
        formData.append('is_active', 'true');

        if (this.avatarSeleccionado) {
            formData.append('avatar', this.avatarSeleccionado);
        }

        this.usuarioService.crearUsuarioCompleto(formData).subscribe({
            next: () => {
                this.cargando = false;
                this.exito = true;
                // Limpiamos caché para que el nuevo usuario aparezca en las listas
                this.usuarioService.limpiarCache();
                // Emitimos éxito para que el padre cierre y refresque
                setTimeout(() => this.cerrar.emit(true), 1500);
            },
            error: (err) => {
                this.cargando = false;
                console.error('Error al crear usuario:', err);
                this.error = 'Hubo un error al procesar la creación. Verifique que los datos sean correctos.';
                if (err.error && typeof err.error === 'object') {
                    // Si el backend envía errores de validación específicos
                    const keys = Object.keys(err.error);
                    if (keys.length > 0) {
                        this.error = `Error: ${keys[0]} - ${err.error[keys[0]]}`;
                    }
                }
            }
        });
    }

    finalizar(): void {
        this.cerrar.emit(true);
    }

    cancelarAsistente(): void {
        this.cancelar.emit();
    }
}
