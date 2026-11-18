import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { workspace } = vi.hoisted(() => ({ workspace: { id: 'workspace-a' } }));
vi.mock('../../api/base', () => ({ getActiveWorkspaceId: () => workspace.id }));
vi.mock('../../vendor/leaflet/leaflet.esm.js', () => {
  const map = { setView() { return this; }, invalidateSize() {}, remove() {} };
  const tiles = { on() { return this; }, addTo() { return this; } };
  const layer = { addTo() { return this; }, clearLayers() {} };
  return { map: () => map, tileLayer: () => tiles, layerGroup: () => layer };
});

import { GeographicWorkspaceExplorer } from './GeographicWorkspaceExplorer';

const rows = [{ key: 'place-a', name: 'North Counter', status: 'unreviewed' }];
const options = { fieldMap: { id: 'key', name: 'name', status: 'status' } };
function completed(detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('gyri:record-action-completed', { detail })));
}

afterEach(() => { workspace.id = 'workspace-a'; vi.unstubAllGlobals(); });

describe('geographic notebook refresh', () => {
  it('reloads saved research after a matching notebook action and ignores other workspaces and records', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const reload = vi.fn();
    function Harness() {
      const [currentRows, setRows] = useState(rows);
      return <GeographicWorkspaceExplorer name="Research" rows={currentRows} options={options} onRefresh={() => {
        reload(); setRows([{ ...rows[0], status: 'shortlisted' }]);
      }}/>;
    }
    render(<Harness/>);
    completed({ workspaceId: 'workspace-b', recordId: 'place-a' });
    completed({ workspaceId: 'workspace-a', recordId: 'other-place' });
    completed({ workspaceId: '', recordId: 'place-a' });
    completed(null);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /North Counter.*Not yet reviewed/ })).toBeInTheDocument();

    completed({ workspaceId: 'workspace-a', recordId: 'place-a' });
    await waitFor(() => expect(screen.getByRole('button', { name: /North Counter.*Shortlisted/ })).toBeInTheDocument());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('uses current field bindings and removes its listener when refreshed props change or unmount', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const first = vi.fn(), next = vi.fn();
    const view = render(<GeographicWorkspaceExplorer name="Research" rows={rows} options={options} onRefresh={first}/>);
    view.rerender(<GeographicWorkspaceExplorer name="Research" rows={[{ identity: { id: 'place-b' }, name: 'South Counter' }]} options={{ fieldMap: { id: 'identity.id', name: 'name' } }} onRefresh={next}/>);
    completed({ workspaceId: 'workspace-a', recordId: 'place-a' });
    completed({ workspaceId: 'workspace-a', recordId: 'place-b' });
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    workspace.id = 'workspace-b';
    completed({ workspaceId: 'workspace-a', recordId: 'place-b' });
    expect(next).toHaveBeenCalledTimes(1);
    view.unmount();
    completed({ workspaceId: 'workspace-b', recordId: 'place-b' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
