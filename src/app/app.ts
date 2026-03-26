import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <router-outlet></router-outlet>
    <app-notificacion></app-notificacion>
  `,
  standalone: false,
  styles: []
})
export class App { }
