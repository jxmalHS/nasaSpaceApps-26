import { features, groups } from '../lib/catalog.js';
import { setState, useStore } from '../lib/store.js';

export default function EarthLayerSelect({ label = 'Map layer', onChange }) {
  const layer = useStore(s => s.layer);
  return <select className="select sm" aria-label={label} value={layer} onChange={e => {
    setState({ layer: e.target.value });
    onChange?.();
  }}>
    <option value="imagery">Earth imagery only</option>
    <option value="suit">Suitability for this test</option>
          <option value="mask">Pass / fail on strict limits</option>
          {groups.map(group => <optgroup key={group.id} label={group.label}>
        {features.filter(f => f.group === group.id && !f.pending).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
      </optgroup>)}
  </select>;
}
