import type { ParamDescriptor, ParamValue } from '../types.js';

export interface FilterBarProps {
  descriptors: ParamDescriptor[];
  values: Record<string, ParamValue>;
  onChange: (name: string, value: ParamValue) => void;
}

/**
 * Auto-generated filter bar: one control per dashboard param, control
 * type inferred from the default value. Widgets whose SQL references a
 * changed param refetch; everything else keeps its cache.
 */
export function FilterBar({ descriptors, values, onChange }: FilterBarProps) {
  if (descriptors.length === 0) return null;

  return (
    <div className="alpona-filterbar">
      {descriptors.map((descriptor) => {
        const value = values[descriptor.name] ?? descriptor.defaultValue;
        const id = `alpona-param-${descriptor.name}`;
        return (
          <div key={descriptor.name} className="alpona-filterbar__field">
            <label className="alpona-filterbar__label" htmlFor={id}>
              {descriptor.name.replaceAll('_', ' ')}
            </label>
            {descriptor.control === 'number' ? (
              <input
                id={id}
                className="alpona-filterbar__input"
                type="number"
                value={String(value)}
                onChange={(e) => onChange(descriptor.name, Number(e.target.value))}
              />
            ) : descriptor.control === 'date' ? (
              <input
                id={id}
                className="alpona-filterbar__input"
                type="date"
                value={String(value)}
                onChange={(e) => onChange(descriptor.name, e.target.value)}
              />
            ) : descriptor.control === 'select' ? (
              <select
                id={id}
                className="alpona-filterbar__input"
                value={String(value)}
                onChange={(e) => onChange(descriptor.name, e.target.value === 'true')}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                id={id}
                className="alpona-filterbar__input"
                type="text"
                value={String(value)}
                onChange={(e) => onChange(descriptor.name, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
