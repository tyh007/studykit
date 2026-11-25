// Tests for the v0.4 shared UI primitives. We assert behavior (refs,
// classes, accessibility, focus) — not pixel paint — because the
// visual layer is a CSS contract covered by manual light/dark QA.

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';
import {
  Button,
  IconButton,
  Input,
  Pill,
  StatusLabel,
  Surface,
  VisuallyHidden,
} from './index';

afterEach(cleanup);

describe('Button', () => {
  it('renders a <button type="button"> by default (not submit)', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('applies variant + size + fullWidth classes', () => {
    render(
      <Button variant="primary" size="lg" fullWidth>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/sk-btn/);
    expect(btn.className).toMatch(/sk-btn-primary/);
    expect(btn.className).toMatch(/sk-btn-lg/);
    expect(btn.className).toMatch(/sk-btn-full/);
  });

  it('forwards ref and respects disabled', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} disabled>
        Disabled
      </Button>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('invokes onClick when clicked', () => {
    let count = 0;
    render(<Button onClick={() => count++}>Tap</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(count).toBe(1);
  });
});

describe('IconButton', () => {
  it('requires an accessible name and exposes it to assistive tech', () => {
    render(
      <IconButton aria-label="Toggle theme">
        <span aria-hidden>X</span>
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('is focusable and uses a neutral type', () => {
    render(
      <IconButton aria-label="Close">
        <span aria-hidden>X</span>
      </IconButton>,
    );
    const btn = screen.getByRole('button');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn).toHaveAttribute('type', 'button');
  });
});

describe('Input', () => {
  it('forwards ref, type, placeholder and aria-invalid', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} type="email" placeholder="you@x" invalid />);
    const input = screen.getByPlaceholderText('you@x');
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not set aria-invalid when not invalid', () => {
    render(<Input placeholder="hi" />);
    expect(screen.getByPlaceholderText('hi').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Surface', () => {
  it('applies the requested level class and supports glass', () => {
    render(
      <Surface level="floating" glass data-testid="s">
        <span>content</span>
      </Surface>,
    );
    const el = screen.getByTestId('s');
    expect(el.className).toMatch(/sk-surface-floating/);
    expect(el.className).toMatch(/sk-surface-glass/);
  });
});

describe('Pill', () => {
  it('applies the requested tone', () => {
    render(<Pill tone="success">verified</Pill>);
    const el = screen.getByText('verified');
    expect(el.className).toMatch(/sk-pill-success/);
  });
});

describe('StatusLabel', () => {
  it('renders text and a visually hidden tone description without an icon by default', () => {
    render(<StatusLabel tone="success">Saved</StatusLabel>);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    // The tone description lives in a visually-hidden span for SR users.
    expect(screen.getByText('success:')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');
  });

  it('renders the supplied icon next to the text', () => {
    render(
      <StatusLabel tone="error" icon={<span data-testid="custom-icon">!</span>}>
        Boom
      </StatusLabel>,
    );
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});

describe('VisuallyHidden', () => {
  it('renders children in the accessibility tree but is visually hidden', () => {
    render(<VisuallyHidden>Screen reader only</VisuallyHidden>);
    const el = screen.getByText('Screen reader only');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/sk-visually-hidden/);
  });
});
