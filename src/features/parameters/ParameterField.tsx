import { useEffect, useMemo, useState } from 'react';
import type { CadParameter, ParameterValue } from '../../core/types';
import {
  calculateParameterRange,
  calculateParameterStep,
  cssColorToHex,
  parseEditorValue,
} from '../../services/cad/parameters';

type ParameterFieldProps = {
  parameter: CadParameter;
  onCommit: (value: ParameterValue) => void;
};

export function ParameterField({ parameter, onCommit }: ParameterFieldProps) {
  const [textValue, setTextValue] = useState(formatParameterValue(parameter.value, parameter.type));

  useEffect(() => {
    setTextValue(formatParameterValue(parameter.value, parameter.type));
  }, [parameter.type, parameter.value]);

  const colorHex = useMemo(() => {
    return parameter.type === 'string' ? cssColorToHex(String(parameter.value)) : '';
  }, [parameter.type, parameter.value]);

  if (parameter.options?.length) {
    return (
      <div className="parameter-field">
        <label>{parameter.displayName}</label>
        {parameter.description && <p>{parameter.description}</p>}
        <select
          value={String(parameter.value)}
          onChange={(event) => {
            const selected = parameter.options?.find((option) => String(option.value) === event.target.value);
            onCommit(selected ? selected.value : event.target.value);
          }}
        >
          {parameter.options.map((option) => (
            <option key={`${option.label}-${option.value}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (parameter.type === 'number') {
    const numericValue = Number(parameter.value);
    const { min, max } = calculateParameterRange(parameter);
    const step = calculateParameterStep(parameter);

    return (
      <div className="parameter-field">
        <div className="parameter-row">
          <div>
            <label>{parameter.displayName}</label>
            {parameter.description && <p>{parameter.description}</p>}
          </div>
          <input
            type="number"
            value={Number.isFinite(numericValue) ? numericValue : 0}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onCommit(Number(event.target.value))}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(numericValue) ? numericValue : 0}
          onChange={(event) => onCommit(Number(event.target.value))}
        />
      </div>
    );
  }

  if (parameter.type === 'boolean') {
    return (
      <label className="parameter-field parameter-checkbox">
        <div>
          <span>{parameter.displayName}</span>
          {parameter.description && <p>{parameter.description}</p>}
        </div>
        <input
          type="checkbox"
          checked={Boolean(parameter.value)}
          onChange={(event) => onCommit(event.target.checked)}
        />
      </label>
    );
  }

  if (parameter.type === 'string') {
    return (
      <div className="parameter-field">
        <div className="parameter-row">
          <div>
            <label>{parameter.displayName}</label>
            {parameter.description && <p>{parameter.description}</p>}
          </div>
          {colorHex && (
            <input
              type="color"
              value={colorHex}
              onChange={(event) => onCommit(event.target.value.toUpperCase())}
            />
          )}
        </div>
        <input
          type="text"
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          onBlur={() => onCommit(textValue)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit(textValue);
          }}
        />
      </div>
    );
  }

  return (
    <div className="parameter-field">
      <label>{parameter.displayName}</label>
      {parameter.description && <p>{parameter.description}</p>}
      <textarea
        value={textValue}
        onChange={(event) => setTextValue(event.target.value)}
        onBlur={() => {
          try {
            onCommit(parseEditorValue(textValue, parameter.type));
          } catch {
            setTextValue(formatParameterValue(parameter.value, parameter.type));
          }
        }}
      />
    </div>
  );
}

function formatParameterValue(value: ParameterValue, type: CadParameter['type']) {
  if (type.endsWith('[]')) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
