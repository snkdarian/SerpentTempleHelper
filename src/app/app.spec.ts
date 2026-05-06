import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app).toBeTruthy();
  });

  it('should save and render the selected earth sequence', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const earthButton = Array.from(compiled.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Pamant'),
    );

    earthButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(localStorage.getItem('serpent-temple-session')).toContain('"selectedElement":"pamant"');
    expect(compiled.textContent).toContain('Pamant');
    expect(compiled.textContent).toContain('Foc');
    expect(compiled.textContent).toContain('dj');
    expect(compiled.textContent).toContain('dm');
  });
});
