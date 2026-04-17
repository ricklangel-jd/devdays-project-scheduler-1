'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import type { JiraInitiative } from '@/shared/types';

interface InitiativeControlsProps {
  existingKeys: string[];
  onAdd: (init: JiraInitiative) => void;
  onBulkAdd: (inits: JiraInitiative[]) => void;
}

const InitiativeControls = ({
  existingKeys,
  onAdd,
  onBulkAdd,
}: InitiativeControlsProps) => {
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ level: 'error' | 'info'; text: string } | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelMessage, setLabelMessage] = useState<{ level: 'error' | 'info'; text: string } | null>(null);

  const handleAdd = async () => {
    const key = keyInput.trim();
    if (!key) return;
    if (existingKeys.includes(key)) {
      setKeyMessage({ level: 'info', text: `${key} is already added` });
      return;
    }
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const response = await fetch(`/api/initiatives/${encodeURIComponent(key)}`);
      if (response.status === 404) {
        setKeyMessage({ level: 'error', text: `Initiative ${key} not found` });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setKeyMessage({
          level: 'error',
          text: body.message ?? body.error ?? `Lookup failed (${response.status})`,
        });
        return;
      }
      const init = (await response.json()) as JiraInitiative;
      onAdd(init);
      setKeyInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setKeyMessage({ level: 'error', text: message });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleLoadByLabel = async () => {
    const label = labelInput.trim();
    if (!label) return;
    setLabelBusy(true);
    setLabelMessage(null);
    try {
      const response = await fetch(
        `/api/initiatives/by-label?label=${encodeURIComponent(label)}`
      );
      const body = await response.json();
      if (!response.ok) {
        setLabelMessage({
          level: 'error',
          text: body.message ?? body.error ?? `Search failed (${response.status})`,
        });
        return;
      }
      const results = (body.results ?? []) as JiraInitiative[];
      const fresh = results.filter(i => !existingKeys.includes(i.key));
      if (fresh.length === 0) {
        setLabelMessage({
          level: 'info',
          text:
            results.length === 0
              ? `No initiatives found for label "${label}"`
              : 'All matching initiatives are already loaded',
        });
        return;
      }
      onBulkAdd(fresh);
      setLabelInput('');
      setLabelMessage({
        level: 'info',
        text: `Added ${fresh.length} initiative${fresh.length === 1 ? '' : 's'}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setLabelMessage({ level: 'error', text: message });
    } finally {
      setLabelBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 280 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Add initiative (key)"
            placeholder="INIT-123"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            disabled={keyBusy}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={keyBusy || keyInput.trim().length === 0}
          >
            Add
          </Button>
        </Box>
        {keyMessage && (
          <Alert severity={keyMessage.level === 'error' ? 'error' : 'info'} sx={{ py: 0 }}>
            {keyMessage.text}
          </Alert>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 280 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Load by label"
            placeholder="fusion-q2"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLoadByLabel();
            }}
            disabled={labelBusy}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handleLoadByLabel}
            disabled={labelBusy || labelInput.trim().length === 0}
          >
            Load
          </Button>
        </Box>
        {labelMessage && (
          <Alert severity={labelMessage.level === 'error' ? 'error' : 'info'} sx={{ py: 0 }}>
            {labelMessage.text}
          </Alert>
        )}
      </Box>
    </Box>
  );
};

export default InitiativeControls;
