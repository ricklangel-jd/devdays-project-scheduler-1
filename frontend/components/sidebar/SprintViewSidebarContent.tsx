'use client';

import {useState, useCallback} from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import {useAppState} from '@/frontend/hooks';
import SprintCapacityEditor from './SprintCapacityEditor';

interface SprintViewSidebarContentProps {
    isGenerating?: boolean;
    onSprintOverlapChange?: (hasOverlap: boolean) => void;
}

const SprintViewSidebarContent = ({isGenerating = false, onSprintOverlapChange}: SprintViewSidebarContentProps) => {
    const [hasSprintOverlap, setHasSprintOverlap] = useState(false);

    const {
        boardId,
        sprintCapacities,
        sprintDateOverrides,
        autoAdjustStartDate,
        setSprintCapacities,
        setSprintDateOverride,
        clearSprintDateOverride,
        setAutoAdjustStartDate,
    } = useAppState();

    const handleOverlapError = useCallback((hasOverlap: boolean) => {
        setHasSprintOverlap(hasOverlap);
        onSprintOverlapChange?.(hasOverlap);
    }, [onSprintOverlapChange]);

    // Workflow state
    const hasBoardSelected = !!boardId;
    const hasSprintsSelected = sprintCapacities.length > 0 && !hasSprintOverlap;
    const canSelectSprints = hasBoardSelected;

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

            {/* Status indicator */}
            {isGenerating && (
                <Alert severity="info" sx={{mt: 1}}>
                    Updating schedule...
                </Alert>
            )}
        </Box>
    );
};

export default SprintViewSidebarContent;
