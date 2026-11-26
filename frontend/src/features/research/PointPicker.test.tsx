import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PointPicker } from './ResearchReader';
import { makeClaim } from '../../domain/__fixtures__/domain-fixtures';

afterEach(cleanup);

const points = [makeClaim({ id: 'c1', title: 'Sleep helps memory' }), makeClaim({ id: 'c2', title: 'Naps improve recall' })];

function renderPicker(overrides: Partial<React.ComponentProps<typeof PointPicker>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <PointPicker
      rect={null}
      excerpt="Sleep after learning strengthens consolidation."
      truncated={false}
      points={points}
      busy={false}
      error={null}
      onPick={onPick}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onPick, onClose };
}

describe('PointPicker', () => {
  it('saves to an existing point with one click, as support by default', () => {
    const { onPick } = renderPicker();
    expect(screen.getByTestId('point-picker-quote')).toHaveTextContent('Sleep after learning');
    expect(screen.getByTestId('point-picker-input')).toHaveFocus();
    fireEvent.click(screen.getByText('Naps improve recall'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', claimId: 'c2' }, 'supports', '');
  });

  it('filters points as you type and offers a new point for unmatched text', () => {
    const { onPick } = renderPicker();
    fireEvent.change(screen.getByTestId('point-picker-input'), { target: { value: 'nap' } });
    expect(screen.getAllByTestId('point-picker-option').map((b) => b.textContent)).toEqual(['Naps improve recall']);
    expect(screen.getByTestId('point-picker-new')).toHaveTextContent('New point: “nap”');

    fireEvent.change(screen.getByTestId('point-picker-input'), { target: { value: 'Slow-wave sleep replays traces' } });
    fireEvent.keyDown(screen.getByTestId('point-picker-input'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'new', title: 'Slow-wave sleep replays traces' }, 'supports', '');
  });

  it('uses an exact title match instead of creating a duplicate point', () => {
    const { onPick } = renderPicker();
    fireEvent.change(screen.getByTestId('point-picker-input'), { target: { value: ' sleep helps memory ' } });
    expect(screen.queryByTestId('point-picker-new')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('point-picker-input'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', claimId: 'c1' }, 'supports', '');
  });

  it('passes the chosen relation and the optional note', () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByTestId('point-picker-relation-contradicts'));
    expect(screen.getByTestId('point-picker-relation-contradicts')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByTestId('point-picker-note'), { target: { value: 'Only for declarative memory' } });
    fireEvent.click(screen.getByText('Sleep helps memory'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', claimId: 'c1' }, 'contradicts', 'Only for declarative memory');
  });

  it('closes on Escape and shows errors', () => {
    const { onClose } = renderPicker({ error: 'Couldn’t save this excerpt.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save');
    fireEvent.keyDown(screen.getByTestId('point-picker'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('invites a first point when the project has none', () => {
    renderPicker({ points: [] });
    expect(screen.getByText('Your points will appear here.')).toBeInTheDocument();
    expect(screen.getByTestId('point-picker-input')).toHaveAttribute('placeholder', 'Write the point this passage speaks to');
  });
});
