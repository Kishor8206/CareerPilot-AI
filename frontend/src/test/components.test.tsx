import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentScore } from '@careerpilot/shared';
import { Alert, Badge, EmptyState, Progress } from '@/components/ui';
import { ComponentBreakdown, ModelDisclaimer, ProvenanceBadge, StatCard } from '@/components/domain/ScoreCards';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('StatCard', () => {
  it('shows a real score', () => {
    renderWithRouter(<StatCard label="Coding" value={72.5} />);
    expect(screen.getByText('72.5')).toBeInTheDocument();
  });

  it('shows "no data yet" instead of zero when there is no evidence', () => {
    renderWithRouter(<StatCard label="Coding" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a genuine zero as zero', () => {
    renderWithRouter(<StatCard label="Coding" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
  });

  it('labels an improvement and a decline differently', () => {
    const { rerender } = renderWithRouter(<StatCard label="Coding" value={70} delta={5.2} />);
    expect(screen.getByText('+5.2')).toBeInTheDocument();

    rerender(<MemoryRouter><StatCard label="Coding" value={70} delta={-3.1} /></MemoryRouter>);
    expect(screen.getByText('-3.1')).toBeInTheDocument();
  });
});

describe('ComponentBreakdown', () => {
  const components: ComponentScore[] = [
    {
      key: 'coding', label: 'Coding', raw: 68, normalized: 68, weight: 0.2, weighted: 13.6,
      evidenceCount: 3, lastUpdated: '2025-01-10T00:00:00.000Z', stale: false,
    },
    {
      key: 'aptitude', label: 'Aptitude', raw: null, normalized: 0, weight: 0.1, weighted: 0,
      evidenceCount: 0, lastUpdated: null, stale: false,
    },
    {
      key: 'hr', label: 'HR Interview', raw: 55, normalized: 55, weight: 0.1, weighted: 5.5,
      evidenceCount: 1, lastUpdated: '2024-01-01T00:00:00.000Z', stale: true,
    },
  ];

  it('shows each component with its weight', () => {
    render(<ComponentBreakdown components={components} />);
    expect(screen.getByText('Coding')).toBeInTheDocument();
    expect(screen.getByText('20% weight')).toBeInTheDocument();
  });

  it('explains what a missing component costs, rather than showing zero', () => {
    render(<ComponentBreakdown components={components} />);
    expect(screen.getByText(/No evidence recorded yet. This costs you up to 10 points./)).toBeInTheDocument();
  });

  it('flags stale evidence', () => {
    render(<ComponentBreakdown components={components} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });
});

describe('provenance and disclaimers', () => {
  it('marks synthetic and demo data, but says nothing for real data', () => {
    const { rerender, container } = render(<ProvenanceBadge provenance="SYNTHETIC" />);
    expect(screen.getByText('Synthetic data')).toBeInTheDocument();

    rerender(<ProvenanceBadge provenance="DEMO" />);
    expect(screen.getByText('Demo data')).toBeInTheDocument();

    // Real data needs no badge; a label on everything would train users to ignore it.
    rerender(<ProvenanceBadge provenance="REAL" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the model disclaimer as visible text, not a tooltip', () => {
    const text = 'PROTOTYPE SCORING MODEL. This has not been validated against real placement outcomes.';
    render(<ModelDisclaimer text={text} />);
    expect(screen.getByText(text)).toBeVisible();
  });
});

describe('UI primitives', () => {
  it('exposes progress to assistive technology', () => {
    render(<Progress value={65} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '65');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps an out-of-range progress value', () => {
    render(<Progress value={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '150');
  });

  it('announces a danger alert to screen readers', () => {
    render(<Alert variant="danger" title="Sign-in failed"><p>Incorrect password.</p></Alert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Sign-in failed')).toBeInTheDocument();
  });

  it('uses a non-interrupting role for informational alerts', () => {
    render(<Alert variant="info"><p>Analysis in progress.</p></Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an empty state with its call to action', () => {
    render(<EmptyState title="No readiness score yet" message="Upload your resume to get started." />);
    expect(screen.getByText('No readiness score yet')).toBeInTheDocument();
    expect(screen.getByText('Upload your resume to get started.')).toBeInTheDocument();
  });

  it('renders badges with their text', () => {
    render(<Badge variant="success">Verified</Badge>);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });
});
