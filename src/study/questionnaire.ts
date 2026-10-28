import { StudyRunFile } from './types';

/** Use the same prefill contract as the study's operator launcher. */
export function nasaTlxUrl(run: Pick<StudyRunFile, 'participantId' | 'period' | 'taskId' | 'condition'>): string {
  const url = new URL('https://li-ziyou.github.io/weighted-nasa-tlx/');
  url.searchParams.set('participant', run.participantId);
  url.searchParams.set('label', `Period ${run.period}: ${run.taskId} (${run.condition === 'linear' ? 'Linear' : 'GitChat'})`);
  return url.toString();
}
