// Private, local-only worker. Its stdout contains aggregate request counts;
// it writes no files and never changes the Cursor database or export artifacts.
import { resolveCursorTranscriptDirs, listCursorTranscriptFiles, DEFAULT_CURSOR_PROJECTS_DIR } from './parse-cursor.mjs';
import { readCursorLocalMetadata } from './cursor-local-metadata.mjs';

const root = process.env.CURSOR_PROJECTS_DIR || DEFAULT_CURSOR_PROJECTS_DIR;
const sessions = resolveCursorTranscriptDirs(root)
  .flatMap(directory => listCursorTranscriptFiles(directory))
  .map(file => ({ source: 'cursor', composer_id: file.composerId }));
const { report } = readCursorLocalMetadata(sessions);
process.stdout.write(JSON.stringify({ ...report, checked_at: new Date().toISOString() }));
