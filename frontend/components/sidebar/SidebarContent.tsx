'use client';

import {useState, useCallback} from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import {useAppState} from '@/frontend/hooks';
import EpicSearch from './EpicSearch';
import EpicKeyPaste from './EpicKeyPaste';
import SelectedEpics from './SelectedEpics';
import SprintCapacityEditor from './SprintCapacityEditor';

interface SidebarContentProps {
    isGenerating?: boolean;
    onSprintOverlapChange?: (hasOverlap: boolean) => void;
}

const SidebarContent = ({isGenerating = false, onSprintOverlapChange}: SidebarContentProps) => {
    const [hasSprintOverlap, setHasSprintOverlap] = useState(false);
    const [pendingMaxDevelopers, setPendingMaxDevelopers] = useState<number | null>(null);

    const {
        projectKey,
        boardId,
        epics,
        epicKeys,
        sprintCapacities,
        maxDevelopers,
        dailyCapacityOverrides,
        sprintDateOverrides,
        autoAdjustStartDate,
        isLoading,
        addEpic,
        removeEpic,
        loadEpicsByKeys,
        setSprintCapacities,
        setMaxDevelopers,
        setSprintDateOverride,
        clearSprintDateOverride,
        setAutoAdjustStartDate,
    } = useAppState();

    const handleOverlapError = useCallback((hasOverlap: boolean) => {
        setHasSprintOverlap(hasOverlap);
        onSprintOverlapChange?.(hasOverlap);
    }, [onSprintOverlapChange]);

    const handleLoadEpicsByPaste = useCallback((keys: string[]) => {
        loadEpicsByKeys(keys, true);
    }, [loadEpicsByKeys]);

    // Workflow state
    const hasProjectSelected = !!projectKey;
    const hasBoardSelected = !!boardId;
    const hasSprintsSelected = sprintCapacities.length > 0 && !hasSprintOverlap;
    const hasPointsPerDay = maxDevelopers > 0;
    const canSelectSprints = hasBoardSelected;
    const canSelectPointsPerDay = hasSprintsSelected;
    const canSelectEpics = hasSprintsSelected && hasPointsPerDay;
    const hasDailyOverrides = dailyCapacityOverrides.length > 0;

    // Handle points per day change with confirmation if there are overrides
    const handlePointsPerDayChange = (value: number) => {
        if (value < 1) return;

        if (hasDailyOverrides) {
            // Show confirmation dialog
            setPendingMaxDevelopers(value);
        } else {
            // No overrides, just update
            setMaxDevelopers(value);
        }
    };

    const handleConfirmPointsChange = () => {
        if (pendingMaxDevelopers !== null) {
            setMaxDevelopers(pendingMaxDevelopers);
            setPendingMaxDevelopers(null);
        }
    };

    const handleCancelPointsChange = () => {
        setPendingMaxDevelopers(null);
    };

    return (
        <Box sx={{display: 'flex', flexDirection: 'column', gap: 2.5}}>
            {/* Step 1: Sprint Selection */}
            <Box sx={{opacity: canSelectSprints ? 1 : 0.5}}>
                <Typography variant="subtitle2" gutterBottom sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                    <Box
                        component="span"
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: hasSprintsSelected ? 'success.main' : 'grey.400',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 'bold',
                        }}
                    >
                        1
                    </Box>
                    Select Sprints
                </Typography>
                <SprintCapacityEditor
                    sprintCapacities={sprintCapacities}
                    onChange={setSprintCapacities}
                    onOverlapError={handleOverlapError}
                    boardId={boardId}
                    projectKey={projectKey}
                    sprintDateOverrides={sprintDateOverrides}
                    onSprintDateOverride={setSprintDateOverride}
                    onClearSprintDateOverride={clearSprintDateOverride}
                    autoAdjustDates={autoAdjustStartDate}
                    onAutoAdjustDatesChange={setAutoAdjustStartDate}
                />
                {!canSelectSprints && (
                    <Typography variant="caption" color="text.secondary" sx={{mt: 1, display: 'block'}}>
                        Select a board first
                    </Typography>
                )}
            </Box>

            <Divider/>

            {/* Step 2: Points Per Day */}
            <Box sx={{opacity: canSelectPointsPerDay ? 1 : 0.5}}>
                <Typography variant="subtitle2" gutterBottom sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                    <Box
                        component="span"
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: canSelectPointsPerDay && hasPointsPerDay ? 'success.main' : 'grey.400',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 'bold',
                        }}
                    >
                        2
                    </Box>
                    Points Per Day
                </Typography>
                <TextField
                    type="number"
                    size="small"
                    fullWidth
                    value={maxDevelopers}
                    onChange={(e) => handlePointsPerDayChange(parseInt(e.target.value, 10))}
                    disabled={!canSelectPointsPerDay}
                    inputProps={{min: 1}}
                    helperText="Story points that can be completed per day. Roughly corresponds to number of developers on team."
                />
                {hasDailyOverrides && (
                    <Alert severity="info" sx={{mt: 1, py: 0, fontSize: 11}}>
                        {dailyCapacityOverrides.length} custom day capacity
                        override{dailyCapacityOverrides.length > 1 ? 's' : ''} active
                    </Alert>
                )}
                {!canSelectPointsPerDay && (
                    <Typography variant="caption" color="text.secondary" sx={{mt: 1, display: 'block'}}>
                        Select sprints first
                    </Typography>
                )}
            </Box>

            <Divider/>

            {/* Step 3: Epic Selection */}
            <Box sx={{opacity: canSelectEpics ? 1 : 0.5}}>
                <Typography variant="subtitle2" gutterBottom sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                    <Box
                        component="span"
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: canSelectEpics && epics.length > 0 ? 'success.main' : 'grey.400',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 'bold',
                        }}
                    >
                        3
                    </Box>
                    Select Epics
                </Typography>

                <Box sx={{pointerEvents: canSelectEpics ? 'auto' : 'none'}}>
                    <EpicSearch onEpicSelect={addEpic} selectedEpicKeys={epicKeys}/>

                    <Box sx={{mt: 1.5, mb: 1.5}}>
                        <EpicKeyPaste onLoadEpics={handleLoadEpicsByPaste} loading={isLoading} initialKeys={epicKeys}/>
                    </Box>

                    <SelectedEpics epics={epics} onRemove={removeEpic}/>
                </Box>

                {!canSelectEpics && (
                    <Typography variant="caption" color="text.secondary" sx={{mt: 1, display: 'block'}}>
                        {!hasSprintsSelected
                            ? 'Select sprints first'
                            : 'Set points per day first'}
                    </Typography>
                )}
            </Box>

            {/* Status indicator */}
            {isGenerating && (
                <Alert severity="info" sx={{mt: 1}}>
                    Updating schedule...
                </Alert>
            )}

            {/* Confirmation Dialog for changing points per day with overrides */}
            <Dialog open={pendingMaxDevelopers !== null} onClose={handleCancelPointsChange}>
                <DialogTitle>Reset Custom Day Capacities?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        You have {dailyCapacityOverrides.length} custom day capacity
                        override{dailyCapacityOverrides.length > 1 ? 's' : ''} set.
                        Changing the points per day will reset all custom overrides.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelPointsChange}>Cancel</Button>
                    <Button onClick={handleConfirmPointsChange} variant="contained" color="primary">
                        Reset & Continue
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default SidebarContent;
