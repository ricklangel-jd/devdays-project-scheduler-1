'use client';

import {useState, useCallback} from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import {useAppState} from '@/frontend/hooks';
import SprintCapacityEditor from './SprintCapacityEditor';
import ProjectSearch from './ProjectSearch';
import BoardSelector from './BoardSelector';
import type {JiraProject} from '@/shared/types';

interface SprintViewSidebarContentProps {
    isGenerating?: boolean;
    onSprintOverlapChange?: (hasOverlap: boolean) => void;
}

const SprintViewSidebarContent = ({isGenerating = false, onSprintOverlapChange}: SprintViewSidebarContentProps) => {
    const [hasSprintOverlap, setHasSprintOverlap] = useState(false);

    const {
        projectKey,
        boardId,
        sprintCapacities,
        sprintDateOverrides,
        autoAdjustStartDate,
        setProjectKey,
        setBoardId,
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
    const hasProjectSelected = !!projectKey;
    const hasBoardSelected = !!boardId;
    const hasSprintsSelected = sprintCapacities.length > 0 && !hasSprintOverlap;
    const canSelectSprints = hasBoardSelected;

    const handleProjectSelect = useCallback((project: JiraProject) => {
        setProjectKey(project.key);
    }, [setProjectKey]);

    const handleBoardSelect = useCallback((selectedBoardId: number) => {
        setBoardId(selectedBoardId);
    }, [setBoardId]);

    return (
        <Box sx={{display: 'flex', flexDirection: 'column', gap: 2.5}}>
            {/* Step 1: Project Selection */}
            <Box>
                <Typography variant="subtitle2" gutterBottom sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                    <Box
                        component="span"
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: hasProjectSelected ? 'success.main' : 'grey.400',
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
                    Select Project
                </Typography>
                <ProjectSearch
                    onProjectSelect={handleProjectSelect}
                    selectedProjectKey={projectKey}
                />
                {projectKey && (
                    <Typography variant="caption" color="text.secondary" sx={{mt: 0.5, display: 'block'}}>
                        Selected: {projectKey}
                    </Typography>
                )}
            </Box>

            <Divider/>

            {/* Step 2: Board Selection */}
            <Box sx={{opacity: hasProjectSelected ? 1 : 0.5}}>
                <Typography variant="subtitle2" gutterBottom sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                    <Box
                        component="span"
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: hasBoardSelected ? 'success.main' : 'grey.400',
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
                    Select Board
                </Typography>
                <BoardSelector
                    projectKey={projectKey}
                    selectedBoardId={boardId}
                    onBoardSelect={handleBoardSelect}
                    disabled={!hasProjectSelected}
                />
                {!hasProjectSelected && (
                    <Typography variant="caption" color="text.secondary" sx={{mt: 1, display: 'block'}}>
                        Select a project first
                    </Typography>
                )}
            </Box>

            <Divider/>

            {/* Step 3: Sprint Selection */}
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
                        3
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
