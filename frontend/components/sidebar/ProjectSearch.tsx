'use client';

import { useState, useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { JiraProject } from '@/shared/types';

const debounce = <T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

interface ProjectSearchProps {
  onProjectSelect: (project: JiraProject) => void;
  selectedProjectKey?: string;
  disabled?: boolean;
}

const ProjectSearch = ({ onProjectSelect, selectedProjectKey, disabled = false }: ProjectSearchProps) => {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<JiraProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const searchProjects = useMemo(
    () =>
      debounce(async (query: string) => {
        if (query.length < 2) {
          setOptions([]);
          return;
        }

        setLoading(true);
        try {
          const response = await fetch(`/api/projects/search?q=${encodeURIComponent(query)}`);
          const data = await response.json();

          if (data.results) {
            const filtered = data.results.filter(
              (project: JiraProject) => project.key !== selectedProjectKey
            );
            setOptions(filtered);
          }
        } catch (error) {
          console.error('Project search failed:', error);
          setOptions([]);
        } finally {
          setLoading(false);
        }
      }, 300),
    [selectedProjectKey]
  );

  const handleInputChange = (_event: React.SyntheticEvent, value: string) => {
    setInputValue(value);
    searchProjects(value);
  };

  const handleChange = (_event: React.SyntheticEvent, value: JiraProject | null) => {
    if (value) {
      onProjectSelect(value);
      setInputValue('');
      setOptions([]);
    }
  };

  return (
    <Autocomplete
      disabled={disabled}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      loading={loading}
      value={null}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onChange={handleChange}
      getOptionLabel={(option) => `${option.key}: ${option.name}`}
      isOptionEqualToValue={(option, value) => option.key === value.key}
      filterOptions={(x) => x}
      noOptionsText={inputValue.length < 2 ? 'Type to search...' : 'No projects found'}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Search Projects"
          placeholder="Enter project key or name"
          size="small"
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={16} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      renderOption={(props, option) => {
        const { key, ...restProps } = props;
        return (
          <Box component="li" key={key} {...restProps}>
            <Box>
              <Typography variant="body2" fontWeight="medium">
                {option.key}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {option.name}
              </Typography>
            </Box>
          </Box>
        );
      }}
    />
  );
};

export default ProjectSearch;
