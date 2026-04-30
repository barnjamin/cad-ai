import { useEffect, useId, useMemo, useState } from 'react';
import type { ModelDefinition, ModelId } from '../core/types';

type ModelPickerProps = {
  models: ModelDefinition[];
  value: ModelId;
  onChange: (modelId: ModelId) => void;
};

const MAX_SUGGESTIONS = 8;

export function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  const listboxId = useId();
  const selectedModel = models.find((model) => model.id === value) ?? models[0] ?? null;
  const [inputValue, setInputValue] = useState(selectedModel?.name ?? value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const suggestions = useMemo(() => {
    const normalizedQuery = normalize(inputValue);

    return [...models]
      .filter((model) => matchesPrefix(model, normalizedQuery))
      .sort((left, right) => scoreModel(right, normalizedQuery, value) - scoreModel(left, normalizedQuery, value))
      .slice(0, MAX_SUGGESTIONS);
  }, [inputValue, models, value]);

  useEffect(() => {
    if (!isOpen) {
      setInputValue(selectedModel?.name ?? value);
    }
  }, [isOpen, selectedModel, value]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [inputValue, isOpen]);

  const commitSelection = (model: ModelDefinition) => {
    onChange(model.id);
    setInputValue(model.name);
    setIsOpen(false);
  };

  return (
    <div
      className="model-picker"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) {
          return;
        }

        setIsOpen(false);
        setInputValue(selectedModel?.name ?? value);
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && suggestions[highlightedIndex] ? `${listboxId}-${suggestions[highlightedIndex].id}` : undefined
        }
        className="model-picker-input"
        value={inputValue}
        placeholder="Start typing a model..."
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setInputValue(event.target.value);
          setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((index) =>
              suggestions.length === 0 ? 0 : Math.min(index + 1, suggestions.length - 1),
            );
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((index) => (suggestions.length === 0 ? 0 : Math.max(index - 1, 0)));
            return;
          }

          if (event.key === 'Enter' && isOpen && suggestions[highlightedIndex]) {
            event.preventDefault();
            commitSelection(suggestions[highlightedIndex]);
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            setInputValue(selectedModel?.name ?? value);
          }
        }}
      />

      {isOpen ? (
        <div className="model-picker-menu" role="listbox" id={listboxId}>
          {suggestions.length > 0 ? (
            suggestions.map((model, index) => {
              const isActive = index === highlightedIndex;
              const isSelected = model.id === value;

              return (
                <button
                  key={model.id}
                  id={`${listboxId}-${model.id}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`model-picker-option${isActive ? ' model-picker-option-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commitSelection(model)}
                >
                  <span className="model-picker-option-header">
                    <span className="model-picker-option-title">{model.name}</span>
                    {model.pricing ? (
                      <span className="model-picker-option-pricing">
                        In {model.pricing.input}/M · Out {model.pricing.output}/M
                      </span>
                    ) : null}
                  </span>
                  <span className="model-picker-option-meta">
                    {model.provider} · {model.id}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="model-picker-empty">No matching models</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function matchesPrefix(model: ModelDefinition, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  return getSearchTerms(model).some((term) => term.startsWith(normalizedQuery));
}

function scoreModel(model: ModelDefinition, normalizedQuery: string, selectedModelId: ModelId) {
  const name = normalize(model.name);
  const provider = normalize(model.provider);
  const id = normalize(model.id);

  let score = model.id === selectedModelId ? 10 : 0;

  if (!normalizedQuery) {
    return score;
  }

  if (name === normalizedQuery || id === normalizedQuery) score += 120;
  if (name.startsWith(normalizedQuery)) score += 90;
  if (id.startsWith(normalizedQuery)) score += 80;
  if (provider.startsWith(normalizedQuery)) score += 60;
  if (getSearchTerms(model).some((term) => term.startsWith(normalizedQuery))) score += 40;

  return score;
}

function getSearchTerms(model: ModelDefinition) {
  return [model.name, model.provider, model.id, `${model.provider} ${model.name}`]
    .flatMap((value) => {
      const normalizedValue = normalize(value);
      return [normalizedValue, ...normalizedValue.split(/[\s/:_-]+/).filter(Boolean)];
    })
    .filter(Boolean);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
