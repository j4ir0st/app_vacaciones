import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { LoginComponent } from './auth/login/login.component';
import { LayoutComponent } from './shared/layout/layout.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MisSolicitudesComponent } from './mis-solicitudes/mis-solicitudes.component';
import { CalendarioComponent } from './calendario/calendario.component';
import { AprobacionesComponent } from './aprobaciones/aprobaciones.component';
import { UsuariosComponent } from './usuarios/usuarios.component';
import { ReportesComponent } from './reportes/reportes.component';

// Definición de rutas de la aplicación de vacaciones
const routes: Routes = [
  // Ruta de inicio de sesión (pública)
  { path: 'login', component: LoginComponent },

  // Rutas protegidas dentro del layout principal
  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
      { path: 'mis-solicitudes', component: MisSolicitudesComponent, canActivate: [AuthGuard] },
      { path: 'calendario', component: CalendarioComponent, canActivate: [AuthGuard] },
      {
        path: 'aprobaciones',
        component: AprobacionesComponent,
        canActivate: [AuthGuard],
        data: { requiereAprobador: true }
      },
      {
        path: 'usuarios',
        component: UsuariosComponent,
        canActivate: [AuthGuard],
        data: { requiereAprobador: true }
      },
      {
        path: 'reportes',
        component: ReportesComponent,
        canActivate: [AuthGuard],
        data: { requiereAprobador: true }
      },
    ]
  },

  // Redirección por defecto
  { path: '**', redirectTo: 'dashboard' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    // Importante para que funcione con base href /app_vacaciones/
    useHash: false,
  })],
  exports: [RouterModule],
})
export class AppRoutingModule { }
